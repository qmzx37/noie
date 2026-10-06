import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { getAuthSessionRevision } from "./authSession";
import { completeSignIn, sessionFromResponse, supabaseAuthConfig } from "./supabaseAuth";

// provider 식별자는 표시 이름과 분리하고, 모든 provider가 같은 PKCE 시도 guard를 공유합니다.
export type SocialProvider = "google" | "kakao" | "custom:naver";
const PROVIDER_NAMES: Record<SocialProvider, string> = { google: "Google", kakao: "카카오", "custom:naver": "네이버" };
let oauthInFlight = false;

// 웹 callback도 동일한 앱을 로드합니다. 라이브러리의 origin/redirect 검사를 끄지 않습니다.
try { WebBrowser.maybeCompleteAuthSession(); } catch { /* SDK 원문 오류/URL을 출력하지 않습니다. */ }

export function socialRedirectUri(): string {
  // 주소는 한 곳에서 생성합니다. 웹은 현재 배포 origin의 루트, native는 등록된 scheme입니다.
  return Linking.createURL(Platform.OS === "web" ? "/" : "auth/callback", { scheme: "noie" });
}

export async function signInWithSocialProvider(provider: SocialProvider): Promise<"ready" | "cancelled"> {
  // TypeScript 밖의 호출도 알 수 없는 provider를 authorize URL에 넣지 못하게 합니다.
  if (provider !== "google" && provider !== "kakao" && provider !== "custom:naver") {
    throw new Error("지원하지 않는 로그인 방식입니다.");
  }
  const name = PROVIDER_NAMES[provider];
  const safeError = `${name} 로그인에 실패했습니다. 설정과 연결 상태를 확인해 주세요.`;
  if (oauthInFlight) throw new Error(`${name} 로그인이 이미 진행 중입니다.`);
  oauthInFlight = true;
  const revision = getAuthSessionRevision();
  try {
    const { url, key } = supabaseAuthConfig();
    const redirect = socialRedirectUri();
    // 256-bit verifier는 이 시도 메모리에만 두며 URL/로그/저장소로 보내지 않습니다.
    const bytes = await Crypto.getRandomBytesAsync(32);
    const verifier = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 });
    const challenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const authorize = `${url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirect)}` +
      `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=s256`;
    const result = await WebBrowser.openAuthSessionAsync(authorize, redirect);
    if (result.type === "cancel" || result.type === "dismiss") return "cancelled";
    if (result.type !== "success" || result.url.split(/[?#]/)[0] !== redirect.split(/[?#]/)[0]) {
      throw new Error(safeError);
    }
    const params = Linking.parse(result.url).queryParams;
    const code = params?.code;
    if (params?.error || params?.error_description || typeof code !== "string" || !code || result.url.includes("#")) {
      throw new Error(safeError);
    }
    if (getAuthSessionRevision() !== revision) throw new Error(safeError);
    // 브라우저 URL의 access token은 사용하지 않습니다. code+verifier를 Supabase에 교환합니다.
    const response = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    if (!response.ok) throw new Error(safeError);
    const session = sessionFromResponse(await response.json());
    await completeSignIn(session, revision);
    return "ready";
  } catch { throw new Error(safeError); }
  finally { oauthInFlight = false; }
}
