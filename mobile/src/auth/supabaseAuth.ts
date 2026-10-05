import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../constants/authConfig";
import { AuthSession, clearAuthSession, getAuthSessionRevision, loadAuthSession, saveAuthSession } from "./authSession";

export const LOGIN_REQUIRED_MESSAGE = "로그인이 만료되었습니다. 다시 로그인해 주세요.";
let refreshInFlight: { revision: number; promise: Promise<AuthSession> } | null = null;

// 공개 키만 허용하고, 설정 오류에서도 앱을 종료하거나 설정값을 출력하지 않습니다.
function config() {
  const url = SUPABASE_URL.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(url) ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error("Supabase URL과 공개 publishable key 설정을 확인해 주세요.");
  }
  return { url, key: SUPABASE_PUBLISHABLE_KEY };
}

// 전체 응답 대신 토큰 두 개와 만료 시각만 추출합니다. JWT를 해석하지 않습니다.
function sessionFromResponse(value: unknown): AuthSession {
  if (!value || typeof value !== "object") throw new Error("로그인 응답을 확인할 수 없습니다.");
  const data = value as Record<string, unknown>;
  if (typeof data.access_token !== "string" || !data.access_token.trim() ||
      typeof data.refresh_token !== "string" || !data.refresh_token.trim()) throw new Error("로그인 응답을 확인할 수 없습니다.");
  let expiresAt: number | null = null;
  if (typeof data.expires_at === "number" && Number.isFinite(data.expires_at) && data.expires_at > 0) {
    expiresAt = data.expires_at;
  } else if (typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0) {
    expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt };
}

async function requestToken(grant: "password" | "refresh_token", body: object): Promise<AuthSession> {
  const { url, key } = config();
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch { throw new Error("로그인 서버에 연결할 수 없습니다. 연결 상태를 확인해 주세요."); }
  // raw 오류 응답은 개인정보를 포함할 수 있어 파싱/출력하지 않습니다.
  if (!response.ok) throw new Error(grant === "password"
    ? "로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요." : LOGIN_REQUIRED_MESSAGE);
  try { return sessionFromResponse(await response.json()); }
  catch { throw new Error("로그인 응답을 확인할 수 없습니다."); }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const revision = getAuthSessionRevision();
  const session = await requestToken("password", { email: email.trim(), password });
  try { await saveAuthSession(session, revision); }
  catch { throw new Error("로그인 정보를 저장할 수 없습니다. 다시 시도해 주세요."); }
}

// 회전되는 refresh token은 동시에 한 번만 사용합니다. 다른 세션과는 공유하지 않습니다.
export function refreshAuthSession(session: AuthSession): Promise<AuthSession> {
  const revision = getAuthSessionRevision();
  if (refreshInFlight?.revision === revision) return refreshInFlight.promise;
  const promise = (async () => {
    try {
      const next = await requestToken("refresh_token", { refresh_token: session.refreshToken });
      await saveAuthSession(next, revision, true);
      if ((await loadAuthSession())?.accessToken !== next.accessToken) throw new Error(LOGIN_REQUIRED_MESSAGE);
      return next;
    } catch {
      try { await clearAuthSession(revision); } catch { /* 화면은 이미 로그인 필요 상태입니다. */ }
      throw new Error(LOGIN_REQUIRED_MESSAGE);
    }
  })();
  refreshInFlight = { revision, promise };
  void promise.then(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  }, () => { if (refreshInFlight?.promise === promise) refreshInFlight = null; });
  return promise;
}

// 앱 시작/채팅 전송 전 만료 60초 이내 토큰을 갱신합니다. 만료 정보가 없으면 401 경로가 처리합니다.
export async function getValidAuthSession(): Promise<AuthSession | null> {
  const session = await loadAuthSession();
  if (session && session.expiresAt !== null && session.expiresAt <= Date.now() / 1000 + 60) return refreshAuthSession(session);
  return session;
}
