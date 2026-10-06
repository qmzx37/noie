import { signInWithSocialProvider, socialRedirectUri } from "./socialAuth";

// 기존 Google 공개 함수 이름과 반환 계약을 유지합니다.
export const googleRedirectUri = socialRedirectUri;
export function signInWithGoogle(): Promise<"ready" | "cancelled"> {
  return signInWithSocialProvider("google");
}
