import { NOIE_STORAGE_KEYS } from "../constants/storageKeys";
import * as storage from "./storage";

// local namespace는 backend 권한이 아닙니다. AuthGate가 인증된 /user 응답에서만 생성합니다.
export type AccountNamespace = string & { readonly __accountNamespace: unique symbol };

// 계정별 queue로 이미 시작한 저장이 purge 뒤 옛 데이터를 재생성하지 못하게 합니다.
const pending = new Map<AccountNamespace, Promise<unknown>>();
const deleted = new Set<AccountNamespace>();
const legacyNamespaces = new Map<AccountNamespace, AccountNamespace>();
export function registerLegacyAccountNamespace(namespace: AccountNamespace, legacy: AccountNamespace) {
  // verified provider + NOIE account 조회를 마친 identity resolver만 호출합니다.
  validateNamespace(namespace); validateNamespace(legacy);
  legacyNamespaces.set(namespace, legacy);
}
function validateNamespace(namespace: AccountNamespace) {
  if (!/^noie_u_[0-9a-f]{64}$/.test(namespace)) throw new Error("계정 저장소를 확인할 수 없습니다.");
}
function enqueue<T>(namespace: AccountNamespace, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(namespace) ?? Promise.resolve()).then(operation);
  pending.set(namespace, result.catch(() => undefined));
  return result;
}

export async function purgeAccountStorage(namespace: AccountNamespace): Promise<void> {
  // 이 namespace만 차단하며 다른 계정/legacy/global credential key를 지우지 않습니다.
  validateNamespace(namespace);
  const legacy = legacyNamespaces.get(namespace);
  deleted.add(namespace);
  if (legacy) deleted.add(legacy);
  let failed = false;
  if (legacy && legacy !== namespace) {
    try { await purgeSingleNamespace(legacy); } catch { failed = true; }
  }
  try { await purgeSingleNamespace(namespace); } catch { failed = true; }
  if (failed) throw new Error("기기의 계정 데이터 삭제를 완료하지 못했습니다.");
}

async function purgeSingleNamespace(namespace: AccountNamespace): Promise<void> {
  // 이전 v1 namespace도 검증된 현재 provider에 대응하는 한 건만 정리합니다.
  deleted.add(namespace);
  await enqueue(namespace, async () => {
    try {
      await storage.saveStringValue(`${namespace}_deleted_v1`, "1");
      for (const key of NOIE_STORAGE_KEYS) await storage.removeStorageValue(`${namespace}_${key}`);
    } catch { throw new Error("기기의 계정 데이터 삭제를 완료하지 못했습니다."); }
  });
}

export function createAccountStorage(namespace: AccountNamespace) {
  // mount 시 받은 namespace를 closure에 고정하여 A의 늦은 쓰기가 B로 이동하지 않게 합니다.
  validateNamespace(namespace);
  const keyFor = (baseKey: string) => {
    // 인증 자격증명과 임의 key는 account-private 저장소에 섞지 않습니다.
    if (!NOIE_STORAGE_KEYS.some((key) => key === baseKey)) throw new Error("계정 저장소를 확인할 수 없습니다.");
    return `${namespace}_${baseKey}`;
  };
  function safe<T>(operation: () => Promise<T>): Promise<T> {
    return enqueue(namespace, async () => {
      try {
        if (deleted.has(namespace) || await storage.loadStringValue(`${namespace}_deleted_v1`) === "1") {
          throw new Error("deleted account");
        }
        return await operation();
      } catch { throw new Error("로컬 데이터를 처리할 수 없습니다."); }
    });
  }
  return Object.freeze({
    loadStringValue: (key: string) => safe(() => storage.loadStringValue(keyFor(key))),
    loadJsonValue: <T>(key: string, fallback: T) => safe(() => storage.loadJsonValue(keyFor(key), fallback)),
    saveStringValue: (key: string, value: string) => safe(() => storage.saveStringValue(keyFor(key), value)),
    saveJsonValue: <T>(key: string, value: T) => safe(() => storage.saveJsonValue(keyFor(key), value)),
    removeStorageValue: (key: string) => safe(() => storage.removeStorageValue(keyFor(key))),
  });
}
