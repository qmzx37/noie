import AsyncStorage from "@react-native-async-storage/async-storage";
import { AUTH_SESSION_STORAGE_KEY } from "../constants/storageKeys";

// expiresAt은 Unix 초입니다. 비밀번호/사용자 객체는 저장하지 않습니다.
// AsyncStorage는 암호화 저장소가 아닙니다. 실제 배포 전 기기 보안 저장소 적용을 별도 검토해야 합니다.
export type AuthSession = { accessToken: string; refreshToken: string; expiresAt: number | null };
let revision = 0;
let generation = 0;
let cleared = false;
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
  // 추가 속성이 들어와도 세 가지 허용 필드만 저장합니다.
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresAt: session.expiresAt };
}

export function loadAuthSession(): Promise<AuthSession | null> {
  return serialize(async () => {
    if (cleared) return null;
    const raw = await AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (cleared) return null; // 읽기를 기다리는 사이 로그아웃되었으면 이전 토큰을 반환하지 않습니다.
    if (!raw) return null;
    let session: AuthSession | null = null;
    try { session = validate(JSON.parse(raw)); } catch { /* 손상된 JSON을 출력하지 않습니다. */ }
    if (!session) {
      cleared = true;
      revision += 1;
      generation += 1;
      notify(null);
      await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
    return session;
  });
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
    await AsyncStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(safeSession));
    if (expectedRevision !== revision) throw new Error("다시 로그인해 주세요.");
    cleared = false;
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
  notify(null); // 삭제 실패 시에도 이 실행 중에는 인증된 화면/토큰을 사용하지 않습니다.
  return serialize(() => AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY));
}

export async function getAccessToken(): Promise<string | null> {
  return (await loadAuthSession())?.accessToken ?? null;
}

// /chat에서 401로 세션이 삭제되어도 바깥쪽 로그인 gate에 알립니다.
export function subscribeAuthSession(listener: (session: AuthSession | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
