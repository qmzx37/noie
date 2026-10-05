import React, { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AuthSession, clearAuthSession, subscribeAuthSession } from "../../auth/authSession";
import { getValidAuthSession } from "../../auth/supabaseAuth";
import { LoginFeature } from "./LoginFeature";

// 인증 전에는 기존 앱을 마운트하지 않아 NOIE의 저장/초기화 useEffect를 그대로 보존합니다.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = subscribeAuthSession((next) => {
      changed = true;
      if (active) { setSession(next); setError(""); }
    });
    void getValidAuthSession().then((next) => {
      if (active && !changed) setSession(next);
    }).catch(() => {
      if (active) setError("로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, []);

  async function logout() {
    // 기존 로컬 NOIE 데이터는 사용자별 저장소가 아닙니다. 이번 단계에서는 삭제/이전을 하지 않습니다.
    try { await clearAuthSession(); }
    catch { setError("로그인 정보 삭제에 실패했습니다. 앱을 닫기 전에 다시 로그인 후 로그아웃해 주세요."); }
  }

  if (loading) return <SafeAreaView style={styles.loading}><ActivityIndicator color="#eef0f3" /></SafeAreaView>;
  if (!session) return <LoginFeature initialError={error} />;
  return (
    <View style={styles.shell}>
      <SafeAreaView style={styles.toolbar}>
        <TouchableOpacity style={styles.logout} accessibilityRole="button" onPress={() => void logout()}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </SafeAreaView>
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#101114" },
  fill: { flex: 1 },
  loading: { flex: 1, backgroundColor: "#101114", alignItems: "center", justifyContent: "center" },
  toolbar: { backgroundColor: "#101114", alignItems: "flex-end", borderBottomWidth: 1, borderBottomColor: "#292c32" },
  logout: { paddingHorizontal: 18, minHeight: 44, justifyContent: "center" },
  logoutText: { fontSize: 13, color: "#bfc4cb" },
});
