import AsyncStorage from "@react-native-async-storage/async-storage";
import { AUTH_SESSION_STORAGE_KEY } from "../constants/storageKeys";
import type { AuthSession } from "./authSession";

// Web에는 OS SecureStore가 없습니다. 기존 호환성을 유지하며 XSS 위험은 별도 해결해야 합니다.
export const memoryOnlyAccessToken = false;
export type AuthMaterial = { kind: "session"; session: AuthSession } |
  { kind: "refresh"; refreshToken: string };

export async function readAuthMaterial(validate: (value: unknown) => AuthSession | null): Promise<AuthMaterial | null> {
  const raw = await AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (raw === null) return null;
  let session: AuthSession | null = null;
  try { session = validate(JSON.parse(raw)); } catch { /* 원문/파싱 오류를 출력하지 않습니다. */ }
  if (!session) throw new Error("로그인 정보를 확인할 수 없습니다.");
  return { kind: "session", session };
}

export async function writeAuthMaterial(session: AuthSession): Promise<void> {
  await AsyncStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function deleteAuthMaterial(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}
