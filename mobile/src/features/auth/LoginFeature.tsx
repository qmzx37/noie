import React, { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { signInWithPassword } from "../../auth/supabaseAuth";

// 비밀번호는 입력 중 메모리에만 두고 저장소/로그에는 남기지 않습니다.
export function LoginFeature({ initialError = "" }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function login() {
    if (submitting.current) return; // 재렌더링 전 연속 클릭도 막습니다.
    if (!email.trim() || !password) { setError("이메일과 비밀번호를 입력해 주세요."); return; }
    submitting.current = true;
    setLoading(true);
    setError("");
    try { await signInWithPassword(email, password); }
    catch (failure) {
      // 인증 모듈에서 정제한 오류만 표시하며 원본 서버 응답은 표시하지 않습니다.
      setError(failure instanceof Error ? failure.message : "로그인에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setPassword("");
      setLoading(false);
      submitting.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Text style={styles.brand}>noie</Text>
            <Text style={styles.heading}>로그인</Text>
            <Text style={styles.label}>이메일</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail}
              placeholder="이메일 주소" placeholderTextColor="#777d86" keyboardType="email-address"
              autoCapitalize="none" autoCorrect={false} textContentType="username"
              accessibilityLabel="이메일" editable={!loading} />
            <Text style={styles.label}>비밀번호</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword}
              placeholder="비밀번호" placeholderTextColor="#777d86" secureTextEntry
              autoCapitalize="none" autoCorrect={false} textContentType="password"
              accessibilityLabel="비밀번호" editable={!loading} onSubmitEditing={() => void login()} />
            {!!(error || initialError) && <Text accessibilityRole="alert" style={styles.error}>{error || initialError}</Text>}
            <TouchableOpacity style={[styles.button, loading && styles.disabled]} disabled={loading}
              accessibilityRole="button" accessibilityState={{ disabled: loading, busy: loading }}
              onPress={() => void login()}>
              {loading ? <ActivityIndicator color="#151619" /> : <Text style={styles.buttonText}>로그인</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// 기존 appStyles는 건드리지 않고 로그인 화면에만 사용하는 작은 스타일입니다.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#101114" },
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: 24 },
  form: { width: "100%", maxWidth: 400, alignSelf: "center" },
  brand: { fontSize: 36, fontWeight: "700", color: "#f3f4f6", marginBottom: 10 },
  heading: { fontSize: 20, fontWeight: "600", color: "#bfc4cb", marginBottom: 28 },
  label: { fontSize: 13, color: "#bfc4cb", marginBottom: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#34373e", borderRadius: 8,
    backgroundColor: "#1a1c21", color: "#f3f4f6", paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, marginBottom: 20 },
  error: { fontSize: 13, lineHeight: 20, color: "#e8a5a5", marginBottom: 16 },
  button: { minHeight: 48, borderRadius: 8, backgroundColor: "#eef0f3", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#151619", fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
