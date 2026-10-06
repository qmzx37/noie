// 실제 source를 Node VM에서 실행합니다. HTTP/React/AsyncStorage는 로컬 mock입니다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const session = (label) => ({ accessToken: `fixture-access-${label}`,
  refreshToken: `fixture-refresh-${label}`, expiresAt: Date.now() / 1000 + 3600 });
const response = (status, value) => ({ ok: status >= 200 && status < 300, status,
  json: async () => value });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve }; };

function harness({ initial = {}, identity = accountA, initialSession = session("A") } = {}) {
  const data = new Map(Object.entries(initial));
  const calls = [];
  const storageCalls = [];
  const logs = [];
  const listeners = new Set();
  const cache = new Map();
  let generation = 1;
  let current = initialSession;
  let fetchImpl = async () => response(200, { id: identity, email: "ignore@example.test" });
  const storage = {
    getItem: async (key) => { storageCalls.push(["read", key]); return data.get(key) ?? null; },
    setItem: async (key, value) => { storageCalls.push(["write", key]); data.set(key, value); },
    removeItem: async (key) => { storageCalls.push(["delete", key]); data.delete(key); },
  };
  const auth = {
    getAuthSessionRevision: () => generation,
    getAuthSessionGeneration: () => generation,
    subscribeAuthSession: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    clearAuthSession: async () => { generation++; current = null; listeners.forEach((l) => l(null)); },
  };
  function publish(value, changeGeneration = false) {
    if (changeGeneration) generation++;
    current = value;
    listeners.forEach((listener) => listener(value));
  }
  function load(relative, react = null) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const requireMock = (name) => {
      if (name === "@react-native-async-storage/async-storage") return storage;
      if (name === "expo-crypto") return {
        CryptoDigestAlgorithm: { SHA256: "SHA-256" },
        digestStringAsync: async (_, value) => crypto.createHash("sha256").update(value).digest("hex"),
      };
      if (name.endsWith("/authSession") || name === "./authSession") return auth;
      if (name.endsWith("/supabaseAuth") || name === "./supabaseAuth") return {
        supabaseAuthConfig: () => ({ url: "https://example.supabase.co", key: "sb_publishable_fixture" }),
        getValidAuthSession: async () => current,
      };
      if (name === "react") return react;
      if (name === "react-native") return { ActivityIndicator: "ActivityIndicator", SafeAreaView: "SafeAreaView",
        Text: "Text", TouchableOpacity: "TouchableOpacity", View: "View", StyleSheet: { create: (x) => x } };
      if (name === "./LoginFeature") return { LoginFeature: "LoginFeature" };
      if (name === "./AccountDeletionControl") return { AccountDeletionControl: "AccountDeletionControl" };
      if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name) + ".ts", react);
      throw new Error("Unexpected mock dependency");
    };
    vm.runInNewContext(output, { module, exports: module.exports, require: requireMock,
      AbortController, setTimeout, clearTimeout,
      fetch: async (...args) => {
        calls.push(args);
        const result = await fetchImpl(...args);
        // 새 /account 경계는 기존 provider fixture의 id와 구분된 local UUID를 반환합니다.
        if (args[0].endsWith("/account") && result.ok) {
          const value = await result.json();
          return response(result.status, { user_id: value?.user_id ?? value?.id });
        }
        return result;
      },
      console: { log: (...args) => logs.push(args) },
    }, { filename });
    return module.exports;
  }
  return { data, storage, calls, storageCalls, logs, load, auth, publish,
    generation: () => generation, fetch: (fn) => { fetchImpl = fn; } };
}

async function namespace(h, value = session("A")) {
  return h.load("src/auth/accountIdentity.ts").resolveAccountNamespace(value);
}

// 실제 AuthGate hooks를 작은 결정론적 렌더 루프에서 실행합니다. Native LIVE 증거는 아닙니다.
function gateHarness(h) {
  const values = [];
  const effects = [];
  let stateCursor = 0, effectCursor = 0, dirty = true, tree;
  const pendingEffects = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (initial) => {
      const i = stateCursor++;
      if (!(i in values)) values[i] = typeof initial === "function" ? initial() : initial;
      return [values[i], (value) => {
        const next = typeof value === "function" ? value(values[i]) : value;
        if (!Object.is(next, values[i])) { values[i] = next; dirty = true; }
      }];
    },
    useEffect: (setup, deps) => {
      const i = effectCursor++;
      const old = effects[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        pendingEffects.push(() => {
          old?.cleanup?.();
          effects[i] = { deps, cleanup: setup() };
        });
      }
    },
  };
  const { AuthGate } = h.load("src/features/auth/AuthGate.tsx", react);
  let privateCalls = 0;
  function render() {
    stateCursor = 0; effectCursor = 0; dirty = false;
    tree = AuthGate({ children: (accountNamespace) => {
      privateCalls++;
      return react.createElement("NoieApp", { key: accountNamespace, accountNamespace });
    } });
    while (pendingEffects.length) pendingEffects.shift()();
    return tree;
  }
  async function flush() {
    for (let i = 0; i < 8; i++) { if (dirty) render(); await new Promise(setImmediate); }
    if (dirty) render();
    return tree;
  }
  function find(type, node = tree) {
    if (!node || typeof node !== "object") return null;
    if (node.type === type) return node;
    for (const child of node.children || []) { const found = find(type, child); if (found) return found; }
    return null;
  }
  return { render, flush, find, privateCalls: () => privateCalls };
}

test("namespace derives deterministically from verified /user, not email or tokens", async () => {
  const h = harness();
  const a = await namespace(h);
  const again = await namespace(h, session("rotated"));
  assert.equal(a, again);
  assert.match(a, /^noie_u_[0-9a-f]{64}$/);
  assert.ok(!a.includes(accountA) && !a.includes("@") && !a.includes("fixture"));
  const [url, options] = h.calls[0];
  assert.equal(url, "https://example.supabase.co/auth/v1/user");
  assert.equal(options.method, "GET");
  assert.equal(options.headers.Authorization, "Bearer fixture-access-A");
  assert.equal(options.headers.apikey, "sb_publishable_fixture");
  assert.equal(options.body, undefined);
  h.fetch(async () => response(200, { id: accountB, email: "ignore@example.test" }));
  assert.notEqual(await namespace(h), a);
  h.fetch(async () => response(200, { id: accountA.toUpperCase() }));
  assert.equal(await namespace(h), a);
});

test("ATTACK-LOCAL-004 UI-like fields and unverified payload never select a namespace", async () => {
  const h = harness();
  const verified = await namespace(h);
  const supplied = { ...session("A"), user_id: accountB, email: "spoof@example.test",
    accountNamespace: "attacker", user: { id: accountB } };
  assert.equal(await namespace(h, supplied), verified);
  assert.equal(h.calls.at(-1)[0].includes(accountB), false);
  const { createAccountStorage } = h.load("src/noie/accountStorage.ts");
  assert.throws(() => createAccountStorage(accountB), /저장소/);
  assert.throws(() => createAccountStorage("spoof@example.test"), /저장소/);
});

test("identity failure, malformed id and anonymous user fail closed without storage access or raw details", async () => {
  for (const value of [null, {}, { id: "not-uuid" }, { id: "00000000-0000-0000-0000-000000000000" },
    { id: accountA, is_anonymous: true }]) {
    const h = harness();
    h.fetch(async () => response(200, value));
    await assert.rejects(namespace(h), /계정 정보를 확인/);
    assert.equal(h.storageCalls.length, 0);
    assert.equal(h.logs.length, 0);
  }
  for (const mode of ["http", "network", "json"]) {
    const h = harness();
    h.fetch(async () => {
      if (mode === "network") throw new Error("PRIVATE_PROVIDER_DETAIL");
      if (mode === "json") return { ok: true, json: async () => { throw new Error("PRIVATE_JSON_DETAIL"); } };
      return response(401, { secret: "PRIVATE_DETAIL" });
    });
    await assert.rejects(namespace(h), (error) => {
      assert.doesNotMatch(error.message, /PRIVATE/); return true;
    });
    assert.equal(h.storageCalls.length, 0);
    assert.equal(h.logs.length, 0);
  }
});

test("late identity response and stale generation cannot select an account", async () => {
  const h = harness();
  const wait = deferred();
  h.fetch(() => wait.promise);
  const old = namespace(h);
  const rejected = assert.rejects(old, /계정 정보를 확인/);
  const previous = h.generation();
  await h.auth.clearAuthSession();
  h.publish(session("B"), true);
  wait.resolve(response(200, { id: accountA }));
  await rejected;
  const count = h.calls.length;
  await assert.rejects(h.load("src/auth/accountIdentity.ts").resolveAccountNamespace(session("A"), previous));
  assert.equal(h.calls.length, count);
});

test("A/B isolation covers all seven private keys and preserves A on relogin", async () => {
  const h = harness();
  const a = await namespace(h);
  h.fetch(async () => response(200, { id: accountB }));
  const b = await namespace(h, session("B"));
  const { createAccountStorage } = h.load("src/noie/accountStorage.ts");
  const keys = h.load("src/constants/storageKeys.ts").NOIE_STORAGE_KEYS;
  assert.equal(keys.length, 7);
  const storageA = createAccountStorage(a), storageB = createAccountStorage(b);
  for (const key of keys) {
    await storageA.saveStringValue(key, "private-A");
    assert.equal(await storageB.loadStringValue(key), null);
    await storageB.saveStringValue(key, "private-B");
  }
  await h.auth.clearAuthSession();
  h.publish(session("A"), true);
  h.fetch(async () => response(200, { id: accountA }));
  const restored = createAccountStorage(await namespace(h));
  for (const key of keys) {
    assert.equal(await restored.loadStringValue(key), "private-A");
    assert.equal(await storageB.loadStringValue(key), "private-B");
  }
});

test("ATTACK-LOCAL-002/003 legacy globals are neither read, migrated nor deleted", async () => {
  const h = harness();
  const keys = h.load("src/constants/storageKeys.ts").NOIE_STORAGE_KEYS;
  keys.forEach((key) => h.data.set(key, "quarantined-legacy"));
  const b = await namespace(h);
  const storage = h.load("src/noie/accountStorage.ts").createAccountStorage(b);
  for (const key of keys) {
    assert.equal(await storage.loadStringValue(key), null);
    await storage.saveStringValue(key, "own-B");
    await storage.removeStorageValue(key);
    assert.equal(h.data.get(key), "quarantined-legacy");
  }
  assert.ok(h.storageCalls.every(([, key]) => key.startsWith(b + "_")));
});

test("ATTACK-LOCAL-001 delayed A write stays in A namespace after B login", async () => {
  const h = harness();
  const a = await namespace(h);
  const { createAccountStorage } = h.load("src/noie/accountStorage.ts");
  const key = h.load("src/constants/storageKeys.ts").STORAGE_KEYS.sessions;
  const storageA = createAccountStorage(a);
  const wait = deferred();
  const write = h.storage.setItem;
  h.storage.setItem = async (...args) => { await wait.promise; return write(...args); };
  const late = storageA.saveJsonValue(key, ["private-A"]);
  await h.auth.clearAuthSession();
  h.publish(session("B"), true);
  h.fetch(async () => response(200, { id: accountB }));
  const b = await namespace(h);
  const storageB = createAccountStorage(b);
  wait.resolve();
  await late;
  assert.equal(await storageB.loadStringValue(key), null);
  assert.deepEqual(Array.from(await storageA.loadJsonValue(key, [])), ["private-A"]);
});

test("current account reset leaves other account, legacy globals and credentials untouched", async () => {
  const h = harness();
  const a = await namespace(h);
  h.fetch(async () => response(200, { id: accountB }));
  const b = await namespace(h);
  const { createAccountStorage } = h.load("src/noie/accountStorage.ts");
  const keys = h.load("src/constants/storageKeys.ts").NOIE_STORAGE_KEYS;
  const storageA = createAccountStorage(a), storageB = createAccountStorage(b);
  h.data.set("noie_auth_session_v1", "credential-fixture");
  for (const key of keys) {
    h.data.set(key, "legacy");
    await storageA.saveStringValue(key, "A");
    await storageB.saveStringValue(key, "B");
  }
  await Promise.all(keys.map((key) => storageA.removeStorageValue(key)));
  for (const key of keys) {
    assert.equal(await storageA.loadStringValue(key), null);
    assert.equal(await storageB.loadStringValue(key), "B");
    assert.equal(h.data.get(key), "legacy");
  }
  assert.equal(h.data.get("noie_auth_session_v1"), "credential-fixture");
  await assert.rejects(storageA.saveStringValue("noie_auth_session_v1", "forbidden"), /로컬/);
});

test("corrupt A JSON and storage failure never disclose contents or fall back to B", async () => {
  const h = harness();
  const a = await namespace(h);
  h.fetch(async () => response(200, { id: accountB }));
  const b = await namespace(h);
  const { createAccountStorage } = h.load("src/noie/accountStorage.ts");
  const key = h.load("src/constants/storageKeys.ts").STORAGE_KEYS.sessions;
  const storageA = createAccountStorage(a), storageB = createAccountStorage(b);
  h.data.set(a + "_" + key, "{PRIVATE_CONVERSATION_BROKEN");
  await storageB.saveJsonValue(key, ["private-B"]);
  assert.equal(await storageA.loadJsonValue(key, "safe-default"), "safe-default");
  assert.deepEqual(Array.from(await storageB.loadJsonValue(key, [])), ["private-B"]);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE|noie_u_|11111111|22222222/);
  h.storage.getItem = async () => { throw new Error("PRIVATE_STORAGE_DETAIL"); };
  await assert.rejects(storageA.loadStringValue(key), (error) => {
    assert.doesNotMatch(error.message, /PRIVATE|noie_u_/); return true;
  });
  assert.equal(h.data.get(b + "_" + key), JSON.stringify(["private-B"]));
});

test("AuthGate does not mount private app before identity resolves or after identity failure", async () => {
  const h = harness();
  const wait = deferred();
  h.fetch(() => wait.promise);
  const gate = gateHarness(h);
  await gate.flush();
  assert.equal(gate.privateCalls(), 0);
  assert.equal(gate.find("NoieApp"), null);
  assert.equal(h.storageCalls.length, 0);
  wait.resolve(response(503, { detail: "PRIVATE_DETAIL" }));
  await gate.flush();
  assert.equal(gate.privateCalls(), 0);
  assert.ok(gate.find("LoginFeature"));
  assert.doesNotMatch(gate.find("LoginFeature").props.initialError, /PRIVATE/);
});

test("AuthGate blocks late A identity, mounts B only, and does not remount on refresh", async () => {
  const h = harness();
  const wait = deferred();
  h.fetch(() => wait.promise);
  const gate = gateHarness(h);
  await gate.flush();
  await h.auth.clearAuthSession();
  await gate.flush();
  h.fetch(async () => response(200, { id: accountB }));
  h.publish(session("B"), true);
  await gate.flush();
  const b = gate.find("NoieApp").props.accountNamespace;
  wait.resolve(response(200, { id: accountA }));
  await gate.flush();
  assert.equal(gate.find("NoieApp").props.accountNamespace, b);
  const requests = h.calls.length;
  h.publish(session("B-refreshed"));
  await gate.flush();
  assert.equal(gate.find("NoieApp").props.key, b);
  assert.equal(h.calls.length, requests);
});

test("AuthGate account changes use different React key and logout unmounts private app", async () => {
  const h = harness();
  const gate = gateHarness(h);
  await gate.flush();
  const a = gate.find("NoieApp").props.key;
  await h.auth.clearAuthSession();
  await gate.flush();
  assert.equal(gate.find("NoieApp"), null);
  h.fetch(async () => response(200, { id: accountB }));
  h.publish(session("B"), true);
  await gate.flush();
  assert.notEqual(gate.find("NoieApp").props.key, a);
});

test("all App persistence captures mounted adapter, with no global legacy import or namespace input", () => {
  const app = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
  assert.doesNotMatch(app, /from ["']\.\/src\/noie\/storage["']/);
  assert.match(app, /useState\(\(\) => createAccountStorage\(accountNamespace\)\)/);
  assert.match(app, /const \{ loadStringValue, removeStorageValue, saveJsonValue, saveStringValue \} = accountStorage/);
  assert.match(app, /key=\{accountNamespace\} accountNamespace=\{accountNamespace\}/);
  assert.match(app, /NOIE_STORAGE_KEYS\.map\(\(key\) => removeStorageValue\(key\)\)/);
  const identity = fs.readFileSync(path.join(root, "src/auth/accountIdentity.ts"), "utf8");
  assert.doesNotMatch(identity, /atob|jwtDecode|user_metadata|display_name|console\./);
});

test("ATTACK-DELETE-LOCAL-001 same provider rejoin uses new NOIE incarnation", async () => {
  const h = harness();
  const old = await namespace(h);
  const storage = h.load("src/noie/accountStorage.ts");
  const key = h.load("src/constants/storageKeys.ts").STORAGE_KEYS.sessions;
  await storage.createAccountStorage(old).saveStringValue(key,"old private data");
  h.fetch(async (url) => response(200,url.endsWith("/account") ? {user_id:accountB} : {id:accountA}));
  const next = await namespace(h);
  assert.notEqual(next,old);
  assert.equal(await storage.createAccountStorage(next).loadStringValue(key),null);
});

test("account purge removes seven keys and verified v1 alias but not B or globals", async () => {
  const h = harness();
  const a = await namespace(h);
  const legacy = "noie_u_"+crypto.createHash("sha256").update(`noie.account-local.v1:${accountA}`).digest("hex");
  const storage = h.load("src/noie/accountStorage.ts");
  const keys = h.load("src/constants/storageKeys.ts").NOIE_STORAGE_KEYS;
  h.fetch(async () => response(200,{id:accountB}));
  const b = await namespace(h);
  for(const key of keys) {
    await storage.createAccountStorage(a).saveStringValue(key,"A");
    await storage.createAccountStorage(b).saveStringValue(key,"B");
    h.data.set(legacy+"_"+key,"legacy A"); h.data.set(key,"unknown legacy global");
  }
  await storage.purgeAccountStorage(a);
  for(const key of keys) {
    assert.equal(h.data.has(a+"_"+key),false);
    assert.equal(h.data.has(legacy+"_"+key),false);
    assert.equal(await storage.createAccountStorage(b).loadStringValue(key),"B");
    assert.equal(h.data.get(key),"unknown legacy global");
  }
  await assert.rejects(storage.createAccountStorage(a).saveStringValue(keys[0],"resurrection"));
});

test("in-flight write finishes before purge and cannot recreate deleted account", async () => {
  const h = harness(); const a = await namespace(h);
  const storage = h.load("src/noie/accountStorage.ts");
  const key = h.load("src/constants/storageKeys.ts").STORAGE_KEYS.sessions;
  const wait = deferred(); const original=h.storage.setItem;
  h.storage.setItem=async (...args) => { if(args[0]===a+"_"+key) await wait.promise; return original(...args); };
  const late=storage.createAccountStorage(a).saveStringValue(key,"old pending write");
  await new Promise(setImmediate);
  const purge=storage.purgeAccountStorage(a);
  wait.resolve(); await late; await purge;
  assert.equal(h.data.has(a+"_"+key),false);
  await assert.rejects(storage.createAccountStorage(a).saveStringValue(key,"late retry"));
});

test("server deletion request is self only and clears session/local on 202", async () => {
  const h=harness(); const a=await namespace(h);
  h.fetch(async () => response(202,{status:"deletion_requested"}));
  const deletion=h.load("src/auth/accountDeletion.ts");
  await assert.rejects(deletion.requestAccountDeletion(a,"wrong",h.generation()));
  await deletion.requestAccountDeletion(a,"DELETE_MY_NOIE_ACCOUNT",h.generation());
  const [url,options]=h.calls.at(-1);
  assert.ok(url.endsWith("/account/delete")); assert.equal(options.method,"POST");
  assert.deepEqual(JSON.parse(options.body),{confirmation:"DELETE_MY_NOIE_ACCOUNT"});
  assert.equal(h.generation(),2);
  assert.equal(h.data.get(a+"_deleted_v1"),"1");
});

test("delete failure leaves session/data and raw server errors are not exposed", async () => {
  const h=harness(); const a=await namespace(h);
  h.fetch(async () => response(503,{secret:"PRIVATE_SECRET"}));
  await assert.rejects(h.load("src/auth/accountDeletion.ts").requestAccountDeletion(a,"DELETE_MY_NOIE_ACCOUNT",h.generation()),
    error => !error.message.includes("PRIVATE_SECRET"));
  assert.equal(h.generation(),1); assert.equal(h.data.has(a+"_deleted_v1"),false);
});

test("stale account A deletion handler cannot delete account B", async () => {
  const h=harness(); const a=await namespace(h); const old=h.generation();
  await h.auth.clearAuthSession(); h.publish(session("B"),true);
  const before=h.calls.length;
  await assert.rejects(h.load("src/auth/accountDeletion.ts").requestAccountDeletion(a,"DELETE_MY_NOIE_ACCOUNT",old));
  assert.equal(h.calls.length,before);
});

test("late A deletion response cannot clear newly signed in B", async () => {
  const h=harness(); const a=await namespace(h); const wait=deferred();
  h.fetch(() => wait.promise);
  const deletion=h.load("src/auth/accountDeletion.ts").requestAccountDeletion(a,"DELETE_MY_NOIE_ACCOUNT",h.generation());
  await new Promise(setImmediate);
  await h.auth.clearAuthSession(); h.publish(session("B"),true);
  const generation=h.generation();
  wait.resolve(response(202,{status:"deletion_requested"})); await deletion;
  assert.equal(h.generation(),generation); assert.equal(h.data.get(a+"_deleted_v1"),"1");
});

test("active provider cannot mount a deleted NOIE account", async () => {
  const h=harness();
  h.fetch(async url => url.endsWith("/account") ? response(403,{detail:"PRIVATE_SERVER_DETAIL"}) : response(200,{id:accountA}));
  await assert.rejects(namespace(h),error => !error.message.includes("PRIVATE_SERVER_DETAIL"));
  assert.equal(h.storageCalls.length,0);
});

test("device cleanup failure is reported after server acceptance and session clear", async () => {
  const h=harness(); const a=await namespace(h);
  h.fetch(async () => response(202,{status:"deletion_requested"}));
  h.storage.removeItem=async () => {throw new Error("PRIVATE_DISK_DETAIL");};
  await assert.rejects(h.load("src/auth/accountDeletion.ts").requestAccountDeletion(a,"DELETE_MY_NOIE_ACCOUNT",h.generation()),
    error => error.message.includes("기기 정리") && !error.message.includes("PRIVATE_DISK_DETAIL"));
  assert.equal(h.generation(),2);
  await assert.rejects(h.load("src/noie/accountStorage.ts").createAccountStorage(a).saveStringValue(
    h.load("src/constants/storageKeys.ts").STORAGE_KEYS.sessions,"resurrection"));
});
