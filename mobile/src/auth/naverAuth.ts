import { signInWithSocialProvider } from "./socialAuth";

// Naver API를 직접 호출하지 않습니다. 설정된 Supabase Custom OIDC 식별자를 그대로 사용합니다.
export function signInWithNaver(): Promise<"ready" | "cancelled"> {
  return signInWithSocialProvider("custom:naver");
}
