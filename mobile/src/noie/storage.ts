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
  } catch (error) {
    console.log("[noie] storage parse failed", { key, error });
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
