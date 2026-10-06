import AsyncStorage from "@react-native-async-storage/async-storage";

export async function loadStringValue(key: string) {
  return AsyncStorage.getItem(key);
}

export async function loadJsonValue<T>(key: string, fallback: T): Promise<T> {
  try {
    const rawValue = await AsyncStorage.getItem(key);
    if (!rawValue) {
      return fallback;
    }
    return JSON.parse(rawValue) as T;
  } catch {
    // 파싱 오류에 대화 원문이나 account key가 섞일 수 있으므로 상세 값은 출력하지 않습니다.
    console.log("[noie] storage parse failed");
    return fallback;
  }
}

export async function saveStringValue(key: string, value: string) {
  await AsyncStorage.setItem(key, value);
}

export async function saveJsonValue<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function removeStorageValue(key: string) {
  await AsyncStorage.removeItem(key);
}
