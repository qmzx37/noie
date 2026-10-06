// 기존 TypeScript와 Node 내장 테스트만 사용합니다. 모든 HTTP/저장소는 메모리 mock입니다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const authKey = "noie_auth_session_v1";
const fresh = () => ({ accessToken: "test-access", refreshToken: "test-refresh", expiresAt: Date.now() / 1000 + 3600 });
const tokenResponse = (suffix = "new") => ({ access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, expires_in: 3600 });
const response = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// 실제 인증 대신 작은 React 렌더 mock으로 UI 이벤트와 기존 핸들러 연결을 검증합니다.
function loginUI({ google = async () => "cancelled", signup = async () => "confirmation_required" } = {}) {
  const values = [];
  const refs = [];
  const calls = [];
  let cursor = 0;
  let refCursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    Fragment: "Fragment",
    useState: (initial) => { const i = cursor++; if (!(i in values)) values[i] = initial;
      return [values[i], (value) => { values[i] = value; }]; },
    useRef: (initial) => { const i = refCursor++; return refs[i] ||= { current: initial }; },
  };
  function load(name) {
    const module = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(path.join(root, "src/features/auth", name), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      reportDiagnostics: true,
    });
    assert.equal((output.diagnostics || []).length, 0);
    const requireMock = (id) => {
      if (id === "react") return react;
      if (id === "react-native") return new Proxy({ StyleSheet: { create: (x) => x }, Platform: { OS: "web" } },
        { get: (target, key) => target[key] || key });
      if (id === "react-native-svg") return { __esModule: true, default: "Svg", Path: "Path" };
      if (id === "./GoogleMark") return load("GoogleMark.tsx");
      if (id.endsWith("supabaseAuth")) return {
        signInWithPassword: async (...args) => calls.push(["login", ...args]),
        signUpWithPassword: async (...args) => { calls.push(["signup", ...args]); return signup(); },
      };
      if (id.endsWith("googleAuth")) return {
        signInWithGoogle: async () => { calls.push(["google"]); return google(); },
      };
      throw new Error(`Unexpected UI dependency: ${id}`);
    };
    vm.runInNewContext(output.outputText, { require: requireMock, module, exports: module.exports });
    return module.exports;
  }
  const { LoginFeature } = load("LoginFeature.tsx");
  function render() { cursor = 0; refCursor = 0; return LoginFeature({}); }
  function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...tree.children.flatMap(nodes)];
  }
  return { render, nodes, calls, mark: load("GoogleMark.tsx").GoogleMark };
}

test("polished auth UI preserves password/signup wiring and confirmation validation", async () => {
  const ui = loginUI();
  const find = (type) => ui.nodes(ui.render()).filter((node) => node.type === type);
  let inputs = find("TextInput");
  inputs[0].props.onChangeText("dev@example.test");
  inputs[1].props.onChangeText("test-password");
  find("TouchableOpacity")[0].props.onPress();
  await new Promise(setImmediate);
  assert.deepEqual(ui.calls[0], ["login", "dev@example.test", "test-password"]);
  find("TouchableOpacity")[1].props.onPress();
  inputs = find("TextInput");
  assert.equal(inputs.length, 3);
  inputs[1].props.onChangeText("test-password");
  inputs[2].props.onChangeText("different-password");
  find("TouchableOpacity")[0].props.onPress();
  assert.equal(ui.calls.length, 1);
  assert.ok(ui.nodes(ui.render()).some((node) => node.children.includes("비밀번호가 일치하지 않습니다.")));
  find("TextInput")[2].props.onChangeText("test-password");
  find("TouchableOpacity")[0].props.onPress();
  await new Promise(setImmediate);
  assert.equal(ui.calls[1][0], "signup");
  assert.equal(find("TextInput").length, 2);
  assert.ok(ui.nodes(ui.render()).some((node) => node.children.includes("이메일을 확인한 뒤 로그인해 주세요.")));
});

test("Google icon preserves cancellation notice, busy state and shared submission guard", async () => {
  const pending = deferred();
  const ui = loginUI({ google: () => pending.promise });
  const buttons = () => ui.nodes(ui.render()).filter((node) => node.type === "TouchableOpacity");
  let google = buttons()[2];
  assert.equal(google.props.accessibilityLabel, "Google로 로그인");
  assert.equal(google.props.style[0].width, 52);
  assert.equal(google.props.style[0].borderRadius, 26);
  google.props.onPress();
  buttons()[0].props.onPress();
  google.props.onPress();
  assert.equal(ui.calls.length, 1);
  assert.ok(buttons().every((node) => node.props.disabled));
  assert.equal(buttons()[2].props.accessibilityState.busy, true);
  pending.resolve("cancelled");
  await new Promise(setImmediate);
  assert.ok(ui.nodes(ui.render()).some((node) => node.children.includes("Google 로그인을 취소했습니다.")));
  assert.equal(buttons()[2].props.disabled, false);
  const mark = ui.mark();
  assert.equal(mark.type, "Svg");
  assert.equal(mark.children.length, 4);
  assert.equal(new Set(mark.children.map((node) => node.props.fill)).size, 4);
});

function harness({ configured = true, configOverrides = {}, initial = {}, storageFailure = false, platform = "web" } = {}) {
  const data = new Map(Object.entries(initial));
  const cache = new Map();
  const calls = [];
  const oauthCalls = [];
  let uuidCount = 0;
  let fetchImpl = async () => { throw new Error("Unexpected network attempt"); };
  // 기존 회귀의 계정 준비는 fake ready입니다. onboarding 음성 검사에서는 명시적으로 바꿉니다.
  let bootstrapImpl = async () => response(200, { status: "ready" });
  let oauthImpl = async () => { throw new Error("Unexpected browser attempt"); };
  const storage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { if (storageFailure) throw new Error("secret storage detail"); data.set(key, value); },
    removeItem: async (key) => { if (storageFailure) throw new Error("secret storage detail"); data.delete(key); },
  };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const localRequire = (name) => {
      if (name === "@react-native-async-storage/async-storage") return storage;
      if (name === "expo-crypto") return {
        randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, "0")}`,
        getRandomBytesAsync: async (count) => crypto.randomBytes(count),
        digestStringAsync: async (_, input) => crypto.createHash("sha256").update(input).digest("base64"),
        CryptoDigestAlgorithm: { SHA256: "SHA-256" }, CryptoEncoding: { BASE64: "base64" },
      };
      if (name === "react-native") return { Platform: { OS: platform } };
      if (name === "expo-linking") return {
        createURL: (pathname) => platform === "web" ? "https://example.test/" : `noie://${pathname}`,
        parse: (uri) => {
          const params = new URL(uri).searchParams;
          return { queryParams: Object.fromEntries([...new Set(params.keys())].map((key) => {
            const values = params.getAll(key); return [key, values.length === 1 ? values[0] : values];
          })) };
        },
      };
      if (name === "expo-web-browser") return {
        maybeCompleteAuthSession: () => ({ type: "success" }),
        openAuthSessionAsync: async (...args) => { oauthCalls.push(args); return oauthImpl(...args); },
      };
      if (name.endsWith("constants/authConfig")) return configured
        ? { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", ...configOverrides }
        : { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "" };
      if (name.startsWith(".")) {
        const target = path.resolve(path.dirname(filename), name);
        return load(`${target}.ts`);
      }
      throw new Error(`Unexpected dependency ${name}`);
    };
    vm.runInNewContext(output, {
      module, exports: module.exports, require: localRequire, Date, Set, Promise, Number,
      fetch: async (url, options) => {
        calls.push({ url, options });
        return url.endsWith("/auth/bootstrap") ? bootstrapImpl(url, options) : fetchImpl(url, options);
      },
      console: { log: () => { throw new Error("Auth must not log"); } },
    }, { filename });
    return module.exports;
  }
  return { load, data, calls, oauthCalls, storage, fetch: (fn) => { fetchImpl = fn; },
    bootstrap: (fn) => { bootstrapImpl = fn; }, oauth: (fn) => { oauthImpl = fn; }, uuidCount: () => uuidCount };
}

test("session persists only allowed fields; logout retains NOIE data and storage key list", async () => {
  const h = harness({ initial: { noie_sessions_v1: "untouched" } });
  const session = h.load("src/auth/authSession.ts");
  await session.saveAuthSession({ ...fresh(), password: "never-store", user: { id: "unused" } });
  assert.deepEqual(Object.keys(JSON.parse(h.data.get(authKey))).sort(), ["accessToken", "expiresAt", "refreshToken"]);
  assert.equal(await session.getAccessToken(), "test-access");
  assert.equal(h.load("src/constants/storageKeys.ts").NOIE_STORAGE_KEYS.includes(authKey), false);
  await session.clearAuthSession();
  assert.equal(await session.loadAuthSession(), null);
  assert.equal(h.data.get("noie_sessions_v1"), "untouched");
});

test("null expiry is valid; corrupted/invalid sessions are cleared", async () => {
  for (const raw of ["{broken", JSON.stringify({ accessToken: "x" }), JSON.stringify({ ...fresh(), expiresAt: -1 })]) {
    const h = harness({ initial: { [authKey]: raw } });
    assert.equal(await h.load("src/auth/authSession.ts").loadAuthSession(), null);
    assert.equal(h.data.has(authKey), false);
  }
  const h = harness();
  const session = h.load("src/auth/authSession.ts");
  await session.saveAuthSession({ ...fresh(), expiresAt: null });
  assert.equal((await session.loadAuthSession()).expiresAt, null);
});

test("password grant sends publishable key; trims only email; stores no password/full user response", async () => {
  const h = harness();
  h.fetch(async () => response(200, { ...tokenResponse(), user: { email: "private" }, password: "private" }));
  await h.load("src/auth/supabaseAuth.ts").signInWithPassword(" user@example.test ", " password ");
  const request = h.calls[0];
  assert.match(request.url, /grant_type=password$/);
  assert.equal(request.options.headers.apikey, "sb_publishable_test");
  assert.equal(request.options.body, JSON.stringify({ email: "user@example.test", password: " password " }));
  assert.equal(h.data.get(authKey).includes("private"), false);
  assert.equal(h.data.get(authKey).includes("password"), false);
});

test("missing config gives safe error without fetch or storage write", async () => {
  const h = harness({ configured: false });
  await assert.rejects(h.load("src/auth/supabaseAuth.ts").signInWithPassword("a", "b"), /publishable/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.data.size, 0);
});

test("non-public keys and unsafe URL configuration are rejected before network access", async () => {
  for (const configOverrides of [
    { SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" },
    { SUPABASE_PUBLISHABLE_KEY: "eyJ.fake-service-role" },
    { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" },
    { SUPABASE_URL: "http://example.supabase.co" },
    { SUPABASE_URL: "https://user:password@example.supabase.co" },
  ]) {
    const h = harness({ configOverrides });
    await assert.rejects(h.load("src/auth/supabaseAuth.ts").signInWithPassword("a", "b"), /publishable/);
    assert.equal(h.calls.length, 0);
  }
});

test("login failure never exposes server/network/parse/storage details", async () => {
  for (const mode of ["http", "network", "parse", "tokens", "storage"]) {
    const h = harness({ storageFailure: mode === "storage" });
    h.fetch(async () => {
      if (mode === "network") throw new Error("RAW_SECRET");
      if (mode === "http") return response(400, { message: "RAW_SECRET" });
      if (mode === "parse") return { ok: true, json: async () => { throw new Error("RAW_SECRET"); } };
      return response(200, mode === "tokens" ? { user: "RAW_SECRET" } : tokenResponse());
    });
    await assert.rejects(h.load("src/auth/supabaseAuth.ts").signInWithPassword("a", "b"), (error) => {
      assert.doesNotMatch(error.message, /RAW_SECRET|secret storage detail/); return true;
    });
    assert.equal(h.data.has(authKey), false);
  }
});

test("startup near-expiry refresh rotates both tokens; fresh session avoids fetch", async () => {
  for (const offset of [-1, 30, 3600]) {
    const h = harness();
    await h.load("src/auth/authSession.ts").saveAuthSession({ ...fresh(), expiresAt: Date.now() / 1000 + offset });
    h.fetch(async () => response(200, tokenResponse()));
    const session = await h.load("src/auth/supabaseAuth.ts").getValidAuthSession();
    assert.equal(h.calls.length, offset < 60 ? 1 : 0);
    assert.equal(session.accessToken, offset < 60 ? "access-new" : "test-access");
    if (offset < 60) {
      assert.match(h.calls[0].url, /grant_type=refresh_token$/);
      assert.equal(h.calls[0].options.body, JSON.stringify({ refresh_token: "test-refresh" }));
      assert.equal(JSON.parse(h.data.get(authKey)).refreshToken, "refresh-new");
    }
  }
});

test("refresh failure clears session, not NOIE data", async () => {
  const h = harness({ initial: { noie_projects_v1: "keep" } });
  const session = h.load("src/auth/authSession.ts");
  await session.saveAuthSession({ ...fresh(), expiresAt: 1 });
  h.fetch(async () => response(401, { error: "RAW_SECRET" }));
  await assert.rejects(h.load("src/auth/supabaseAuth.ts").getValidAuthSession(), /다시 로그인/);
  assert.equal(await session.loadAuthSession(), null);
  assert.equal(h.data.get("noie_projects_v1"), "keep");
});

test("malformed refresh JSON and network failure clear session without loops or raw errors", async () => {
  for (const mode of ["json", "tokens", "network"]) {
    const h = harness();
    const session = h.load("src/auth/authSession.ts");
    await session.saveAuthSession({ ...fresh(), expiresAt: 1 });
    h.fetch(async () => {
      if (mode === "network") throw new Error("RAW_SECRET");
      if (mode === "json") return { ok: true, json: async () => { throw new Error("RAW_SECRET"); } };
      return response(200, { access_token: "missing-refresh" });
    });
    await assert.rejects(h.load("src/auth/supabaseAuth.ts").getValidAuthSession(), /다시 로그인/);
    assert.equal(h.calls.length, 1);
    assert.equal(await session.loadAuthSession(), null);
  }
});

test("concurrent refresh shares one request", async () => {
  const h = harness();
  const session = h.load("src/auth/authSession.ts");
  await session.saveAuthSession({ ...fresh(), expiresAt: 1 });
  const wait = deferred();
  h.fetch(() => wait.promise);
  const auth = h.load("src/auth/supabaseAuth.ts");
  const promises = [auth.getValidAuthSession(), auth.getValidAuthSession()];
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  wait.resolve(response(200, tokenResponse()));
  assert.equal((await Promise.all(promises))[0].accessToken, "access-new");
});

test("logout fences delayed refresh and delayed login", async () => {
  for (const kind of ["refresh", "login"]) {
    const h = harness();
    const session = h.load("src/auth/authSession.ts");
    await session.saveAuthSession(fresh());
    const wait = deferred();
    h.fetch(() => wait.promise);
    const auth = h.load("src/auth/supabaseAuth.ts");
    const request = kind === "refresh" ? auth.refreshAuthSession(fresh()) : auth.signInWithPassword("a", "b");
    const rejected = assert.rejects(request);
    await session.clearAuthSession();
    wait.resolve(response(200, tokenResponse()));
    await rejected;
    assert.equal(await session.loadAuthSession(), null);
    assert.equal(h.data.has(authKey), false);
  }
});

test("old refresh failure does not clear a newer login", async () => {
  const h = harness();
  const session = h.load("src/auth/authSession.ts");
  await session.saveAuthSession(fresh());
  const wait = deferred();
  h.fetch(() => wait.promise);
  const request = h.load("src/auth/supabaseAuth.ts").refreshAuthSession(fresh());
  const rejected = assert.rejects(request);
  await session.clearAuthSession();
  await session.saveAuthSession({ ...fresh(), accessToken: "new-account" });
  wait.resolve(response(401));
  await rejected;
  assert.equal(await session.getAccessToken(), "new-account");
});

test("chat and project chat retry once with same body/UUID and rotated Bearer", async () => {
  for (const project of [false, true]) {
    const h = harness();
    await h.load("src/auth/authSession.ts").saveAuthSession(fresh());
    let chatCount = 0;
    h.fetch(async (url) => url.includes("grant_type") ? response(200, tokenResponse())
      : response(++chatCount === 1 ? 401 : 200, { reply: "original reply" }));
    const api = h.load("src/noie/noieApi.ts");
    const messages = [{ role: "user", content: "unchanged" }];
    const result = project ? await api.requestProjectChatReply({ text: "same", messages,
      projectId: "p", projectName: "name", projectGoal: "goal" }) : await api.requestChatReply("same", messages);
    const chats = h.calls.filter((item) => item.url.endsWith("/chat"));
    assert.equal(chats.length, 2);
    assert.equal(chats[0].options.body, chats[1].options.body);
    assert.equal(chats[0].options.headers.Authorization, "Bearer test-access");
    assert.equal(chats[1].options.headers.Authorization, "Bearer access-new");
    assert.equal(h.uuidCount(), 1);
    assert.equal(result.reply, "original reply");
    const body = JSON.parse(chats[0].options.body);
    assert.equal(body.text, "same");
    assert.deepEqual(body.messages, messages);
    assert.equal("user_id" in body, false);
    if (project) assert.deepEqual({ ...body, request_id: null }, { text: "same", messages, request_id: null,
      is_project: true, project_id: "p", project_name: "name", project_goal: "goal",
      project_next_action: null, project_status: null, latest_checkpoint: null });
  }
});

test("repeated 401 clears session; failed refresh makes no chat retry", async () => {
  for (const refreshOk of [true, false]) {
    const h = harness();
    const session = h.load("src/auth/authSession.ts");
    await session.saveAuthSession(fresh());
    h.fetch(async (url) => url.includes("grant_type") ? response(refreshOk ? 200 : 401, tokenResponse()) : response(401));
    await assert.rejects(h.load("src/noie/noieApi.ts").requestChatReply("same", []), /다시 로그인/);
    assert.equal(h.calls.filter((c) => c.url.endsWith("/chat")).length, refreshOk ? 2 : 1);
    assert.equal(h.calls.filter((c) => c.url.includes("grant_type")).length, 1);
    assert.equal(await session.loadAuthSession(), null);
  }
});

test("concurrent 401 requests refresh once, including a late old-token 401", async () => {
  const h = harness();
  await h.load("src/auth/authSession.ts").saveAuthSession(fresh());
  const delayed401 = deferred();
  let initialRequests = 0;
  h.fetch(async (url, options) => {
    if (url.includes("grant_type")) return response(200, tokenResponse());
    if (options.headers.Authorization === "Bearer test-access") {
      return ++initialRequests === 1 ? response(401) : delayed401.promise;
    }
    return response(200, { reply: "ok" });
  });
  const api = h.load("src/noie/noieApi.ts");
  const first = api.requestChatReply("one", []);
  const second = api.requestChatReply("two", []);
  await first;
  delayed401.resolve(response(401));
  await second;
  assert.equal(h.calls.filter((c) => c.url.includes("grant_type")).length, 1);
  assert.equal(h.calls.filter((c) => c.url.endsWith("/chat")).length, 4);
});

test("late 401 after account switch cannot retry as the new account or clear it", async () => {
  const h = harness();
  const session = h.load("src/auth/authSession.ts");
  await session.saveAuthSession(fresh());
  const wait = deferred();
  h.fetch(() => wait.promise);
  const request = h.load("src/noie/noieApi.ts").requestChatReply("old", []);
  const rejected = assert.rejects(request, /다시 로그인/);
  await new Promise(setImmediate);
  await session.clearAuthSession();
  await session.saveAuthSession({ ...fresh(), accessToken: "account-B" });
  wait.resolve(response(401));
  await rejected;
  assert.equal(h.calls.length, 1);
  assert.equal(await session.getAccessToken(), "account-B");
});

test("no session preserves legacy POST without Bearer; helper endpoints use the current session", async () => {
  const h = harness();
  h.fetch(async () => response(200, {}));
  const api = h.load("src/noie/noieApi.ts");
  await api.requestChatReply("legacy", []);
  await api.extractDailyTraceCandidate("text", "2026-10-05");
  await api.generateTitle("text");
  h.calls.forEach((call) => assert.equal(call.options.headers.Authorization, undefined));
  // 같은 기존 API들도 세션이 있으면 Bearer를 사용합니다.
  await h.load("src/auth/authSession.ts").saveAuthSession(fresh());
  await api.extractDailyTraceCandidate("text", "2026-10-05");
  await api.generateTitle("text");
  h.calls.slice(3).forEach((call) => assert.equal(call.options.headers.Authorization, "Bearer test-access"));
});

// 기존 채팅 20개 검사는 유지하고 제목/추출에서도 동일한 인증 안전성을 확인합니다.
test("title and daily extraction retry once with identical body and rotated Bearer", async () => {
  for (const endpoint of ["generate-title", "extract-daily-trace"]) {
    const h = harness();
    await h.load("src/auth/authSession.ts").saveAuthSession(fresh());
    let count = 0;
    const payload = endpoint === "generate-title" ? { title: "same title" } : { has_trace: false };
    h.fetch(async (url) => url.includes("grant_type") ? response(200, tokenResponse())
      : response(++count === 1 ? 401 : 200, payload));
    const api = h.load("src/noie/noieApi.ts");
    const result = endpoint === "generate-title" ? await api.generateTitle("same text")
      : await api.extractDailyTraceCandidate("same text", "2026-10-05");
    const requests = h.calls.filter((c) => c.url.endsWith(`/${endpoint}`));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.body, requests[1].options.body);
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-access");
    assert.equal(requests[1].options.headers.Authorization, "Bearer access-new");
    assert.equal(h.calls.filter((c) => c.url.includes("grant_type")).length, 1);
    assert.deepEqual(result, payload);
    assert.equal(h.uuidCount(), 0);
  }
});

test("helper endpoints repeated 401 or failed refresh require login without loops", async () => {
  for (const endpoint of ["title", "daily"]) for (const refreshOk of [true, false]) {
    const h = harness();
    const session = h.load("src/auth/authSession.ts");
    await session.saveAuthSession(fresh());
    h.fetch(async (url) => url.includes("grant_type") ? response(refreshOk ? 200 : 401, tokenResponse()) : response(401));
    const api = h.load("src/noie/noieApi.ts");
    await assert.rejects(endpoint === "title" ? api.generateTitle("text")
      : api.extractDailyTraceCandidate("text", "2026-10-05"), /다시 로그인/);
    assert.equal(h.calls.filter((c) => !c.url.includes("grant_type")).length, refreshOk ? 2 : 1);
    assert.equal(h.calls.filter((c) => c.url.includes("grant_type")).length, 1);
    assert.equal(await session.loadAuthSession(), null);
  }
});

test("helper endpoint late 401 cannot resend or clear a new account after logout", async () => {
  for (const endpoint of ["title", "daily"]) {
    const h = harness();
    const session = h.load("src/auth/authSession.ts");
    await session.saveAuthSession(fresh());
    const wait = deferred();
    h.fetch(() => wait.promise);
    const api = h.load("src/noie/noieApi.ts");
    const pending = endpoint === "title" ? api.generateTitle("old")
      : api.extractDailyTraceCandidate("old", "2026-10-05");
    const rejected = assert.rejects(pending, /다시 로그인/);
    await new Promise(setImmediate);
    await session.clearAuthSession();
    await session.saveAuthSession({ ...fresh(), accessToken: "account-B" });
    wait.resolve(response(401));
    await rejected;
    assert.equal(h.calls.length, 1);
    assert.equal(await session.getAccessToken(), "account-B");
  }
});

test("chat and title concurrent 401 coalesce refresh and preserve each original body", async () => {
  const h = harness();
  await h.load("src/auth/authSession.ts").saveAuthSession(fresh());
  const late = deferred();
  let count = 0;
  h.fetch(async (url, options) => {
    if (url.includes("grant_type")) return response(200, tokenResponse());
    if (options.headers.Authorization === "Bearer test-access") return ++count === 1 ? response(401) : late.promise;
    return response(200, url.endsWith("/chat") ? { reply: "ok" } : { title: "ok" });
  });
  const api = h.load("src/noie/noieApi.ts");
  const chat = api.requestChatReply("same", []);
  const title = api.generateTitle("same");
  await chat;
  late.resolve(response(401));
  await title;
  assert.equal(h.calls.filter((c) => c.url.includes("grant_type")).length, 1);
  for (const endpoint of ["chat", "generate-title"]) {
    const requests = h.calls.filter((c) => c.url.endsWith(`/${endpoint}`));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.body, requests[1].options.body);
  }
  assert.equal(h.uuidCount(), 1);
});

test("a new invocation with identical text gets a distinct request_id", async () => {
  const h = harness();
  h.fetch(async () => response(200));
  const api = h.load("src/noie/noieApi.ts");
  await api.requestChatReply("same", []);
  await api.requestChatReply("same", []);
  assert.notEqual(JSON.parse(h.calls[0].options.body).request_id, JSON.parse(h.calls[1].options.body).request_id);
});

test("session listeners drive login/logout gate; storage deletion failure remains fail-closed in memory", async () => {
  const h = harness();
  const session = h.load("src/auth/authSession.ts");
  const observed = [];
  const unsubscribe = session.subscribeAuthSession((next) => observed.push(next));
  await session.saveAuthSession(fresh());
  await session.clearAuthSession();
  unsubscribe();
  assert.equal(observed.length, 2);
  assert.equal(observed[1], null);
  const broken = harness({ storageFailure: true, initial: { [authKey]: JSON.stringify(fresh()) } });
  const brokenSession = broken.load("src/auth/authSession.ts");
  await assert.rejects(brokenSession.clearAuthSession());
  assert.equal(await brokenSession.getAccessToken(), null);
});

test("login UI/auth gate contracts do not refactor old App or shared styles", () => {
  const app = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
  const login = fs.readFileSync(path.join(root, "src/features/auth/LoginFeature.tsx"), "utf8");
  const gate = fs.readFileSync(path.join(root, "src/features/auth/AuthGate.tsx"), "utf8");
  assert.match(app, /return <AuthGate><NoieApp \/><\/AuthGate>/);
  assert.match(login, /secureTextEntry/);
  assert.match(login, /if \(submitting.current\) return/);
  assert.match(login, /setPassword\(""\)/);
  assert.match(gate, /if \(loading\)/);
  assert.match(gate, /if \(!session\) return <LoginFeature/);
  assert.match(gate, /clearAuthSession\(\)/);
  const executable = ts.transpileModule(login + gate, {
    compilerOptions: { removeComments: true, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
  assert.doesNotMatch(executable, /require\([^)]*appStyles|console\.log|AsyncStorage\.clear/);
});

// onboarding은 토큰을 임시로 저장하지 않습니다. 실제 service 대신 HTTP/browser mock만 사용합니다.
test("password login waits for bootstrap before session persistence and gate notification", async () => {
  const h = harness();
  const session = h.load("src/auth/authSession.ts");
  const observed = [];
  session.subscribeAuthSession((next) => observed.push(next));
  h.fetch(async () => response(200, tokenResponse()));
  const wait = deferred();
  h.bootstrap(() => wait.promise);
  const pending = h.load("src/auth/supabaseAuth.ts").signInWithPassword("a", "b");
  await new Promise(setImmediate);
  assert.equal(h.data.has(authKey), false);
  assert.equal(observed.length, 0);
  assert.equal(h.calls[1].options.headers.Authorization, "Bearer access-new");
  assert.equal(h.calls[1].options.body, undefined);
  wait.resolve(response(200, { status: "ready" }));
  await pending;
  assert.equal(observed.length, 1);
  assert.equal(await session.getAccessToken(), "access-new");
});

test("signup confirmation response sends only credentials and stores no session/password", async () => {
  for (const payload of [{ id: "user-id", email: "private" }, { user: { id: "user-id" }, session: null }]) {
    const h = harness();
    h.fetch(async () => response(200, payload));
    const result = await h.load("src/auth/supabaseAuth.ts").signUpWithPassword(" a@example.test ", " password123 ");
    assert.equal(result, "confirmation_required");
    assert.equal(h.calls.length, 1);
    assert.match(h.calls[0].url, /\/auth\/v1\/signup$/);
    assert.equal(h.calls[0].options.headers.apikey, "sb_publishable_test");
    assert.equal(h.calls[0].options.body, JSON.stringify({ email: "a@example.test", password: " password123 " }));
    assert.equal(h.data.size, 0);
  }
});

test("immediate signup bootstraps and stores only safe Supabase session fields", async () => {
  const h = harness();
  h.fetch(async () => response(200, { ...tokenResponse(), user: { email: "private" }, provider_token: "private" }));
  assert.equal(await h.load("src/auth/supabaseAuth.ts").signUpWithPassword("a@example.test", "password123"), "ready");
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].url, /\/auth\/bootstrap$/);
  const stored = h.data.get(authKey);
  assert.doesNotMatch(stored, /password|private|provider/);
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ["accessToken", "expiresAt", "refreshToken"]);
});

test("signup input validation and malformed/error responses stay safe", async () => {
  const h = harness();
  const auth = h.load("src/auth/supabaseAuth.ts");
  for (const [email, password] of [["", "password123"], ["a", ""], ["a", "short"], ["a", "        "]]) {
    await assert.rejects(auth.signUpWithPassword(email, password));
  }
  assert.equal(h.calls.length, 0);
  for (const mode of ["http", "network", "json", "partial", "empty"]) {
    h.fetch(async () => {
      if (mode === "network") throw new Error("RAW_SECRET");
      if (mode === "json") return { ok: true, json: async () => { throw new Error("RAW_SECRET"); } };
      return response(mode === "http" ? 400 : 200, mode === "partial" ? { access_token: "RAW_SECRET" } : {});
    });
    await assert.rejects(auth.signUpWithPassword("a@example.test", "password123"), (error) => {
      assert.doesNotMatch(error.message, /RAW_SECRET/); return true;
    });
    assert.equal(h.data.has(authKey), false);
  }
});

test("login and signup bootstrap failure never publish app session or raw server details", async () => {
  for (const signup of [false, true]) for (const mode of ["http", "network", "json", "status"]) {
    const h = harness();
    h.fetch(async () => response(200, tokenResponse()));
    h.bootstrap(async () => {
      if (mode === "network") throw new Error("RAW_DATABASE_TOKEN");
      if (mode === "json") return { ok: true, json: async () => { throw new Error("RAW_DATABASE_TOKEN"); } };
      return response(mode === "http" ? 403 : 200, { status: "RAW_DATABASE_TOKEN" });
    });
    const auth = h.load("src/auth/supabaseAuth.ts");
    await assert.rejects(signup ? auth.signUpWithPassword("a", "password123") : auth.signInWithPassword("a", "b"), (error) => {
      assert.doesNotMatch(error.message, /RAW_DATABASE_TOKEN/); return true;
    });
    assert.equal(h.data.has(authKey), false);
    assert.equal(await h.load("src/auth/authSession.ts").loadAuthSession(), null);
  }
});

test("logout fences late bootstrap success and failure without clearing newer account", async () => {
  for (const success of [true, false]) {
    const h = harness();
    const session = h.load("src/auth/authSession.ts");
    h.fetch(async () => response(200, tokenResponse()));
    const wait = deferred();
    h.bootstrap(() => wait.promise);
    const pending = h.load("src/auth/supabaseAuth.ts").signInWithPassword("a", "b");
    const rejected = assert.rejects(pending);
    await new Promise(setImmediate);
    await session.clearAuthSession();
    await session.saveAuthSession({ ...fresh(), accessToken: "account-B" });
    wait.resolve(response(success ? 200 : 503, { status: "ready" }));
    await rejected;
    assert.equal(await session.getAccessToken(), "account-B");
  }
});

test("Google web/native PKCE success exchanges code before bootstrap and storage", async () => {
  for (const platform of ["web", "ios", "android"]) {
    const h = harness({ platform });
    const google = h.load("src/auth/googleAuth.ts");
    h.oauth(async (_, redirect) => ({ type: "success", url: `${redirect}?code=verified-code` }));
    h.fetch(async () => response(200, { ...tokenResponse(), provider_token: "DO_NOT_STORE" }));
    assert.equal(await google.signInWithGoogle(), "ready");
    const [authorize, redirect] = h.oauthCalls[0];
    const params = new URL(authorize).searchParams;
    assert.equal(params.get("provider"), "google");
    assert.equal(params.get("redirect_to"), redirect);
    assert.equal(params.get("code_challenge_method"), "s256");
    assert.equal(redirect, platform === "web" ? "https://example.test/" : "noie://auth/callback");
    const body = JSON.parse(h.calls[0].options.body);
    assert.match(body.code_verifier, /^[0-9a-f]{64}$/);
    assert.equal(body.auth_code, "verified-code");
    assert.equal(params.get("code_challenge"), crypto.createHash("sha256").update(body.code_verifier).digest("base64url"));
    assert.equal(authorize.includes(body.code_verifier), false);
    assert.match(h.calls[0].url, /grant_type=pkce$/);
    assert.match(h.calls[1].url, /\/auth\/bootstrap$/);
    assert.equal(h.calls[1].options.headers.Authorization, "Bearer access-new");
    assert.doesNotMatch(h.data.get(authKey), /DO_NOT_STORE|verified-code|code_verifier/);
  }
});

test("Google cancel/dismiss leave no app session and perform no HTTP", async () => {
  for (const type of ["cancel", "dismiss"]) {
    const h = harness();
    h.oauth(async () => ({ type }));
    assert.equal(await h.load("src/auth/googleAuth.ts").signInWithGoogle(), "cancelled");
    assert.equal(h.calls.length, 0);
    assert.equal(h.data.size, 0);
  }
});

test("Google wrong redirect, duplicate code, implicit tokens and provider errors are rejected", async () => {
  for (const uri of ["https://attacker.test/?code=x", "https://example.test/?code=a&code=b",
    "https://example.test/#access_token=RAW_SECRET", "https://example.test/?error=RAW_SECRET",
    "https://example.test/?code=x#error_description=RAW_SECRET", "https://example.test/"]) {
    const h = harness();
    h.oauth(async () => ({ type: "success", url: uri }));
    await assert.rejects(h.load("src/auth/googleAuth.ts").signInWithGoogle(), (error) => {
      assert.doesNotMatch(error.message, /RAW_SECRET|attacker/); return true;
    });
    assert.equal(h.calls.length, 0);
    assert.equal(h.data.size, 0);
  }
});

test("Google exchange, browser and bootstrap failures expose no raw errors/session", async () => {
  for (const mode of ["browser", "exchange", "parse", "bootstrap"]) {
    const h = harness();
    h.oauth(async (_, redirect) => {
      if (mode === "browser") throw new Error("RAW_OAUTH_SECRET");
      return { type: "success", url: `${redirect}?code=valid` };
    });
    h.fetch(async () => mode === "parse" ? { ok: true, json: async () => { throw new Error("RAW_OAUTH_SECRET"); } }
      : response(mode === "exchange" ? 400 : 200, tokenResponse()));
    if (mode === "bootstrap") h.bootstrap(async () => response(403, { secret: "RAW_OAUTH_SECRET" }));
    await assert.rejects(h.load("src/auth/googleAuth.ts").signInWithGoogle(), (error) => {
      assert.doesNotMatch(error.message, /RAW_OAUTH_SECRET/); return true;
    });
    assert.equal(h.data.has(authKey), false);
  }
});

test("Google logout fence and concurrent browser guard preserve newer session", async () => {
  const h = harness();
  const session = h.load("src/auth/authSession.ts");
  const wait = deferred();
  h.oauth(() => wait.promise);
  const google = h.load("src/auth/googleAuth.ts");
  const pending = google.signInWithGoogle();
  const rejected = assert.rejects(pending);
  await new Promise(setImmediate);
  await assert.rejects(google.signInWithGoogle(), /이미 진행/);
  await session.clearAuthSession();
  await session.saveAuthSession({ ...fresh(), accessToken: "account-B" });
  wait.resolve({ type: "success", url: "https://example.test/?code=valid" });
  await rejected;
  assert.equal(h.calls.length, 0);
  assert.equal(await session.getAccessToken(), "account-B");
});

test("existing fresh startup avoids bootstrap; UI confirmation and Google controls are present", async () => {
  const h = harness({ initial: { [authKey]: JSON.stringify(fresh()) } });
  assert.equal((await h.load("src/auth/supabaseAuth.ts").getValidAuthSession()).accessToken, "test-access");
  assert.equal(h.calls.length, 0);
  const login = fs.readFileSync(path.join(root, "src/features/auth/LoginFeature.tsx"), "utf8");
  assert.match(login, /password !== passwordConfirm/);
  assert.match(login, /이메일을 확인한 뒤 로그인해 주세요/);
  assert.match(login, /accessibilityLabel="Google로 로그인"/);
  assert.match(login, /setPasswordConfirm\(""\)/);
});
