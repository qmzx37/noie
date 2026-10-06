import React, { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AuthSession, clearAuthSession, getAuthSessionGeneration, subscribeAuthSession } from "../../auth/authSession";
import { getValidAuthSession } from "../../auth/supabaseAuth";
import { ACCOUNT_IDENTITY_ERROR, resolveAccountNamespace } from "../../auth/accountIdentity";
import type { AccountNamespace } from "../../noie/accountStorage";
import { LoginFeature } from "./LoginFeature";
import { AccountDeletionControl } from "./AccountDeletionControl";

// 인증 전에는 기존 앱을 마운트하지 않아 NOIE의 저장/초기화 useEffect를 그대로 보존합니다.
export function AuthGate({ children }: { children: (namespace: AccountNamespace) => React.ReactNode }) {
  // 세션과 세대를 함께 갱신하여 새 계정 세션에 이전 namespace가 잠시라도 붙지 않게 합니다.
  const [auth, setAuth] = useState<{ session: AuthSession | null; generation: number }>({
    session: null, generation: getAuthSessionGeneration(),
  });
  const session = auth.session;
  const [account, setAccount] = useState<{ namespace: AccountNamespace; generation: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = subscribeAuthSession((next) => {
      changed = true;
      if (active) { setAuth({ session: next, generation: getAuthSessionGeneration() }); setError(""); }
    });
    void getValidAuthSession().then((next) => {
      if (active && !changed) setAuth({ session: next, generation: getAuthSessionGeneration() });
    }).catch(() => {
      if (active) setError("로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session) { setAccount(null); return; }
    // 같은 로그인 세대의 refresh는 재조회/remount 없이 기존 화면 상태를 유지합니다.
    if (account?.generation === auth.generation) return;
    let active = true;
    setAccount(null);
    void resolveAccountNamespace(session, auth.generation).then((namespace) => {
      if (active && getAuthSessionGeneration() === auth.generation) {
        setAccount({ namespace, generation: auth.generation });
      }
    }).catch(() => {
      if (active && getAuthSessionGeneration() === auth.generation) setError(ACCOUNT_IDENTITY_ERROR);
    });
    // A의 늦은 identity 응답은 logout/B login 이후의 mount에 사용하지 않습니다.
    return () => { active = false; };
  }, [session, auth.generation]);

  async function logout() {
    // token만 11.2 정책으로 삭제합니다. account 데이터는 같은 본인의 재로그인을 위해 남깁니다.
    try { await clearAuthSession(); }
    catch { setError("로그인 정보 삭제에 실패했습니다. 앱을 닫기 전에 다시 로그인 후 로그아웃해 주세요."); }
  }

  if (loading) return <SafeAreaView style={styles.loading}><ActivityIndicator color="#eef0f3" /></SafeAreaView>;
  if (!session) return <LoginFeature initialError={error} />;
  // identity 확인 전에는 children을 호출하지 않아 private 데이터 hydrate도 시작되지 않습니다.
  if (!account || account.generation !== auth.generation || auth.generation !== getAuthSessionGeneration()) {
    if (error) return <LoginFeature initialError={error} />;
    return <SafeAreaView style={styles.loading}><ActivityIndicator color="#eef0f3" /></SafeAreaView>;
  }
  return (
    <View style={styles.shell}>
      <SafeAreaView style={styles.toolbar}>
        <AccountDeletionControl namespace={account.namespace} generation={account.generation} onError={setError} />
        <TouchableOpacity style={styles.logout} accessibilityRole="button" onPress={() => void logout()}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </SafeAreaView>
      <View style={styles.fill}>{children(account.namespace)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#101114" },
  fill: { flex: 1 },
  loading: { flex: 1, backgroundColor: "#101114", alignItems: "center", justifyContent: "center" },
  toolbar: { backgroundColor: "#101114", flexDirection: "row", justifyContent: "flex-end", borderBottomWidth: 1, borderBottomColor: "#292c32" },
  logout: { paddingHorizontal: 18, minHeight: 44, justifyContent: "center" },
  logoutText: { fontSize: 13, color: "#bfc4cb" },
});
