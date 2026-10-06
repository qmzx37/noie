import { signInWithSocialProvider } from "./socialAuth";

// Kakao 토큰을 직접 교환하지 않고 Supabase의 기존 PKCE/bootstrap 경로를 사용합니다.
export function signInWithKakao(): Promise<"ready" | "cancelled"> {
  return signInWithSocialProvider("kakao");
}
