import { clearAuthSession, getAuthSessionGeneration, getAuthSessionRevision, loadAuthSession } from "./authSession";
import { getValidAuthSession, LOGIN_REQUIRED_MESSAGE, refreshAuthSession } from "./supabaseAuth";

// 인증이 필요한 POST에서 재사용합니다. 고정 body/세대 검사/한 번의 401 재시도를 유지합니다.
// 기존 이름을 유지하여 두 /chat 경로의 request_id 재사용 계약을 바꾸지 않습니다.
export async function fetchChatWithAuth(url: string, body: string): Promise<Response> {
  const generation = getAuthSessionGeneration();
  const session = await getValidAuthSession();
  if (getAuthSessionGeneration() !== generation) throw new Error(LOGIN_REQUIRED_MESSAGE);
  const send = (token: string | null) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body,
  });
  const response = await send(session?.accessToken ?? null);
  if (response.status !== 401) return response;
  // 로그아웃/다른 계정 로그인 후 늦게 도착한 401을 새 계정으로 재전송하지 않습니다.
  if (getAuthSessionGeneration() !== generation || !session) throw new Error(LOGIN_REQUIRED_MESSAGE);
  const current = await loadAuthSession();
  if (!current || getAuthSessionGeneration() !== generation) throw new Error(LOGIN_REQUIRED_MESSAGE);
  // 다른 동시 요청이 이미 refresh했다면 회전된 토큰을 재사용하고 refresh를 중복 실행하지 않습니다.
  const refreshed = current.accessToken !== session.accessToken ? current : await refreshAuthSession(current);
  if (getAuthSessionGeneration() !== generation) throw new Error(LOGIN_REQUIRED_MESSAGE);
  const retryRevision = getAuthSessionRevision();
  const retry = await send(refreshed.accessToken); // 한 번만 재전송하고 반복 401은 로그인으로 돌아갑니다.
  if (retry.status === 401) {
    try { await clearAuthSession(retryRevision); } catch { /* 안전한 메시지만 반환합니다. */ }
    throw new Error(LOGIN_REQUIRED_MESSAGE);
  }
  return retry;
}
