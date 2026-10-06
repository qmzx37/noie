import * as Crypto from "expo-crypto";
import { AuthSession, getAuthSessionGeneration } from "./authSession";
import { supabaseAuthConfig } from "./supabaseAuth";
import type { AccountNamespace } from "../noie/accountStorage";
import { registerLegacyAccountNamespace } from "../noie/accountStorage";
import { API_BASE_URL } from "../constants/appConstants";

export const ACCOUNT_IDENTITY_ERROR = "계정 정보를 확인할 수 없습니다. 다시 로그인해 주세요.";

export async function resolveAccountNamespace(
  session: AuthSession,
  expectedGeneration = getAuthSessionGeneration(),
): Promise<AccountNamespace> {
  // 이메일/표시 이름/미검증 JWT payload/UI 입력은 namespace 근거로 사용하지 않습니다.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    if (getAuthSessionGeneration() !== expectedGeneration) throw new Error(ACCOUNT_IDENTITY_ERROR);
    const { url, key } = supabaseAuthConfig();
    const response = await fetch(`${url}/auth/v1/user`, {
      method: "GET", headers: { Authorization: `Bearer ${session.accessToken}`, apikey: key },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(ACCOUNT_IDENTITY_ERROR);
    const value = await response.json();
    if (!value || typeof value.id !== "string" || value.is_anonymous === true ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) ||
        value.id.toLowerCase() === "00000000-0000-0000-0000-000000000000") {
      throw new Error(ACCOUNT_IDENTITY_ERROR);
    }
    // 같은 Supabase identity로 재가입해도 새 NOIE local UUID는 다른 저장소를 사용합니다.
    // provider 검증만으로 삭제된 NOIE 계정을 mount하지 않습니다. dev fallback도 금지합니다.
    const accountResponse = await fetch(`${API_BASE_URL}/account`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, signal: controller.signal,
    });
    if (!accountResponse.ok) throw new Error(ACCOUNT_IDENTITY_ERROR);
    const account = await accountResponse.json();
    if (!account || typeof account.user_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.user_id) ||
        account.user_id.toLowerCase() === "00000000-0000-0000-0000-000000000000") {
      throw new Error(ACCOUNT_IDENTITY_ERROR);
    }
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
      `noie.account-local.v2:${value.id.toLowerCase()}:${account.user_id.toLowerCase()}`);
    if (!/^[0-9a-f]{64}$/.test(hash) || getAuthSessionGeneration() !== expectedGeneration) {
      throw new Error(ACCOUNT_IDENTITY_ERROR);
    }
    const namespace = `noie_u_${hash}` as AccountNamespace;
    const legacyHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
      `noie.account-local.v1:${value.id.toLowerCase()}`);
    if (getAuthSessionGeneration() !== expectedGeneration) throw new Error(ACCOUNT_IDENTITY_ERROR);
    registerLegacyAccountNamespace(namespace, `noie_u_${legacyHash}` as AccountNamespace);
    return namespace;
  } catch {
    // provider 응답/UUID/token/네트워크 오류 원문을 출력하거나 상위로 전달하지 않습니다.
    throw new Error(ACCOUNT_IDENTITY_ERROR);
  } finally {
    clearTimeout(timeout);
  }
}
