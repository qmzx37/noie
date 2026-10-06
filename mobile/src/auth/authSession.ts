import { deleteAuthMaterial, memoryOnlyAccessToken, readAuthMaterial, writeAuthMaterial } from "./authSessionStorage";
import { refreshAuthCredential } from "./supabaseAuth";

// expiresAt은 Unix 초입니다. 비밀번호/사용자 객체는 저장하지 않습니다.
// Native access token은 메모리 전용이고 refresh만 SecureStore에 둡니다. Web은 기존 저장 방식을 유지합니다.
export type AuthSession = { accessToken: string; refreshToken: string; expiresAt: number | null };
let revision = 0;
let generation = 0;
let cleared = false;
let memorySession: AuthSession | null = null;
let operations: Promise<unknown> = Promise.resolve();
const listeners = new Set<(session: AuthSession | null) => void>();

// 저장과 삭제를 직렬화하여 로그아웃 뒤 늦은 refresh 응답이 세션을 되살리지 못하게 합니다.
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}

function notify(session: AuthSession | null) {
  listeners.forEach((listener) => {
    try { listener(session); } catch { /* 화면 구독 오류가 저장 작업을 막지 않습니다. */ }
  });
}

function validate(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<AuthSession>;
  if (typeof session.accessToken !== "string" || !session.accessToken.trim() ||
      typeof session.refreshToken !== "string" || !session.refreshToken.trim() ||
      !(session.expiresAt === null || (typeof session.expiresAt === "number" &&
        Number.isFinite(session.expiresAt) && session.expiresAt > 0))) return null;
  // 추가 속성이 들어와도 검증 결과에는 세 가지 허용 필드만 남깁니다.
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresAt: session.expiresAt };
}

// 저장소 오류/손상 때 원문 오류를 노출하지 않고 인증 상태부터 즉시 차단합니다.
function invalidateSession() {
  cleared = true;
  memorySession = null;
  revision += 1;
  generation += 1;
  notify(null);
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  const material = await serialize(async () => {
    if (cleared) return null;
    if (memoryOnlyAccessToken && memorySession) return { kind: "session" as const, session: memorySession };
    try {
      const stored = await readAuthMaterial(validate);
      if (cleared) return null; // 읽는 동안 로그아웃됐으면 이전 세션을 공개하지 않습니다.
      return stored ? { ...stored, revision } : null;
    } catch {
      // 읽는 동안 logout이 이미 세대를 바꿨다면 새 로그인까지 추가로 무효화하지 않습니다.
      if (!cleared) invalidateSession();
      try { await deleteAuthMaterial(); } catch { /* 삭제 실패여도 인증 상태는 사용하지 않습니다. */ }
      return null;
    }
  });
  if (!material) return null;
  if (material.kind === "session") return material.session;
  if (material.revision !== revision) return memorySession;
  // queue 밖에서 refresh합니다. save가 같은 queue를 사용하므로 내부 await는 deadlock을 만듭니다.
  // 상호 참조 함수는 모듈 초기화 때 호출하지 않고, 저장소 읽기가 끝난 뒤에만 사용합니다.
  return refreshAuthCredential(material.refreshToken, material.revision);
}

export function getAuthSessionRevision() { return revision; }
// refresh는 같은 로그인 세대입니다. 로그아웃/다른 계정 로그인만 세대를 바꿉니다.
export function getAuthSessionGeneration() { return generation; }

// 시작 시점 revision이 다르면 로그아웃/새 로그인 이후의 오래된 응답입니다.
export function saveAuthSession(session: AuthSession, expectedRevision = revision, isRefresh = false): Promise<void> {
  return serialize(async () => {
    if (expectedRevision !== revision) throw new Error("다시 로그인해 주세요.");
    const safeSession = validate(session);
    if (!safeSession) throw new Error("로그인 정보를 확인할 수 없습니다.");
    try { await writeAuthMaterial(safeSession); }
    catch {
      if (expectedRevision === revision) {
        invalidateSession();
        try { await deleteAuthMaterial(); } catch { /* 불완전한 저장은 로그인 재요구로 처리합니다. */ }
      }
      throw new Error("로그인 정보를 저장할 수 없습니다. 다시 로그인해 주세요.");
    }
    if (expectedRevision !== revision) throw new Error("다시 로그인해 주세요.");
    cleared = false;
    memorySession = safeSession;
    revision += 1;
    if (!isRefresh) generation += 1;
    notify(safeSession);
  });
}

// 이전 요청 실패가 새 로그인까지 삭제하지 않도록 expectedRevision을 확인합니다.
export function clearAuthSession(expectedRevision?: number): Promise<void> {
  if (expectedRevision !== undefined && expectedRevision !== revision) return Promise.resolve();
  revision += 1;
  generation += 1;
  cleared = true;
  memorySession = null;
  notify(null); // 삭제 실패 시에도 이 실행 중에는 인증된 화면/토큰을 사용하지 않습니다.
  return serialize(async () => {
    try { await deleteAuthMaterial(); }
    catch { throw new Error("로그인 정보를 삭제할 수 없습니다."); }
  });
}

export async function getAccessToken(): Promise<string | null> {
  return (await loadAuthSession())?.accessToken ?? null;
}

// /chat에서 401로 세션이 삭제되어도 바깥쪽 로그인 gate에 알립니다.
export function subscribeAuthSession(listener: (session: AuthSession | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
