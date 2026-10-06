import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AUTH_SESSION_STORAGE_KEY } from "../constants/storageKeys";
import type { AuthSession } from "./authSession";
import type { AuthMaterial } from "./authSessionStorage.web";

// Native에서는 refresh 자격증명만 디스크에 둡니다. access token은 authSession의 메모리 전용입니다.
export const memoryOnlyAccessToken = true;
const SECURE_KEY = "noie_auth_refresh_v1";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "noie.auth.refresh",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

function encodeCredential(refreshToken: string): string {
  const raw = JSON.stringify({ version: 1, refreshToken });
  // SDK 48의 2048-byte 한도보다 보수적으로 제한합니다. JSON 600 UTF-16 글자는 최대 1800 bytes입니다.
  if (!refreshToken.trim() || raw.length > 600) throw new Error("로그인 정보를 확인할 수 없습니다.");
  return raw;
}

export async function readAuthMaterial(validate: (value: unknown) => AuthSession | null): Promise<AuthMaterial | null> {
  // secure 값이 손상됐거나 읽기 실패하면 legacy 값을 인증 근거로 사용하지 않습니다.
  const raw = await SecureStore.getItemAsync(SECURE_KEY, OPTIONS);
  if (raw !== null) {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || typeof value.refreshToken !== "string" ||
        Object.keys(value).sort().join(",") !== "refreshToken,version") {
      throw new Error("로그인 정보를 확인할 수 없습니다.");
    }
    encodeCredential(value.refreshToken);
    await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return { kind: "refresh", refreshToken: value.refreshToken };
  }
  // 최초 실행의 legacy session은 기존 검증을 통과한 refresh 자격증명만 이동합니다.
  const legacy = await AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (legacy === null) return null;
  const session = validate(JSON.parse(legacy));
  if (!session) throw new Error("로그인 정보를 확인할 수 없습니다.");
  await writeAuthMaterial(session);
  return { kind: "refresh", refreshToken: session.refreshToken };
}

export async function writeAuthMaterial(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(SECURE_KEY, encodeCredential(session.refreshToken), OPTIONS);
  // 삭제까지 성공해야 메모리에 세션을 공개합니다. legacy access token을 다시 쓰지 않습니다.
  await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export async function deleteAuthMaterial(): Promise<void> {
  // 한 저장소 삭제가 실패해도 다른 저장소의 삭제를 반드시 시도합니다.
  let failed = false;
  try {
    await SecureStore.deleteItemAsync(SECURE_KEY, OPTIONS);
    // SDK 48 iOS 삭제는 일부 OS 오류를 전달하지 않으므로 삭제 결과도 확인합니다.
    if (await SecureStore.getItemAsync(SECURE_KEY, OPTIONS) !== null) failed = true;
  } catch { failed = true; }
  try { await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY); } catch { failed = true; }
  if (failed) throw new Error("로그인 정보를 삭제할 수 없습니다.");
}
