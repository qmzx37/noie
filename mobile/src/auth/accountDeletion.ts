import { API_BASE_URL } from "../constants/appConstants";
import { clearAuthSession, getAuthSessionGeneration, getAuthSessionRevision } from "./authSession";
import { getValidAuthSession } from "./supabaseAuth";
import { purgeAccountStorage, type AccountNamespace } from "../noie/accountStorage";

export const DELETE_CONFIRMATION = "DELETE_MY_NOIE_ACCOUNT";

export async function requestAccountDeletion(namespace: AccountNamespace, confirmation: string, expectedGeneration: number): Promise<void> {
  // 사용자 ID는 보내지 않습니다. backend의 verified Principal만 삭제 대상을 정합니다.
  if (confirmation !== DELETE_CONFIRMATION) throw new Error("삭제 확인 문구를 정확히 입력해 주세요.");
  const generation = getAuthSessionGeneration();
  if (generation !== expectedGeneration) throw new Error("다시 로그인해 주세요.");
  const session = await getValidAuthSession();
  if (!session || getAuthSessionGeneration() !== generation) throw new Error("다시 로그인해 주세요.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE_URL}/account/delete`, {
      method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation }), signal: controller.signal,
    });
    if (response.status !== 202 || (await response.json())?.status !== "deletion_requested") {
      throw new Error("계정 삭제 요청을 완료하지 못했습니다. 마지막 OWNER 여부와 연결 상태를 확인해 주세요.");
    }
  } catch {
    // 네트워크 timeout은 서버 rollback을 의미하지 않습니다. 성공/완전 삭제를 주장하지 않습니다.
    throw new Error("계정 삭제 접수를 확인하지 못했습니다. 다시 로그인하여 계정 상태를 확인해 주세요.");
  } finally { clearTimeout(timeout); }
  // 먼저 unmount합니다. 지연 응답이 새 B session을 지우지 않도록 같은 세대만 clear합니다.
  let cleanupFailed = false;
  if (getAuthSessionGeneration() === generation) {
    // 같은 계정의 refresh가 revision만 갱신했어도 삭제 후 토큰은 반드시 지웁니다.
    try { await clearAuthSession(getAuthSessionRevision()); } catch { cleanupFailed = true; }
  }
  try { await purgeAccountStorage(namespace); } catch { cleanupFailed = true; }
  if (cleanupFailed) {
    throw new Error("서버에서 삭제 요청을 접수했지만 기기 정리가 완료되지 않았습니다. 기기의 앱 데이터를 정리해 주세요.");
  }
}
