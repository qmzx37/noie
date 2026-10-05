import React, { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { signInWithPassword, signUpWithPassword } from "../../auth/supabaseAuth";
import { signInWithGoogle } from "../../auth/googleAuth";

// 비밀번호는 입력 중 메모리에만 두고 저장소/로그에는 남기지 않습니다.
export function LoginFeature({ initialError = "" }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [signup, setSignup] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function login() {
    if (submitting.current) return; // 재렌더링 전 연속 클릭도 막습니다.
    if (!email.trim() || !password) { setError("이메일과 비밀번호를 입력해 주세요."); return; }
    if (signup && password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    submitting.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (signup) {
        const result = await signUpWithPassword(email, password);
        if (result === "confirmation_required") {
          setNotice("이메일을 확인한 뒤 로그인해 주세요.");
          setSignup(false);
        }
      } else { await signInWithPassword(email, password); }
    }
    catch (failure) {
      // 인증 모듈에서 정제한 오류만 표시하며 원본 서버 응답은 표시하지 않습니다.
      setError(failure instanceof Error ? failure.message : "로그인에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setPassword("");
      setPasswordConfirm("");
      setLoading(false);
      submitting.current = false;
    }
  }

  async function googleLogin() {
    // 같은 버튼 guard를 재사용하여 password/OAuth 흐름의 동시 시작을 막습니다.
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (await signInWithGoogle() === "cancelled") setNotice("Google 로그인을 취소했습니다.");
    } catch {
      setError("Google 로그인에 실패했습니다. 설정과 연결 상태를 확인해 주세요.");
    } finally {
      setPassword("");
      setPasswordConfirm("");
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
            <Text style={styles.heading}>{signup ? "회원가입" : "로그인"}</Text>
            <Text style={styles.label}>이메일</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail}
              placeholder="이메일 주소" placeholderTextColor="#777d86" keyboardType="email-address"
              autoCapitalize="none" autoCorrect={false} textContentType="username"
              accessibilityLabel="이메일" editable={!loading} />
            <Text style={styles.label}>비밀번호</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword}
              placeholder="비밀번호" placeholderTextColor="#777d86" secureTextEntry
              autoCapitalize="none" autoCorrect={false} textContentType={signup ? "newPassword" : "password"}
              accessibilityLabel="비밀번호" editable={!loading} onSubmitEditing={() => void login()} />
            {signup && <>
              <Text style={styles.label}>비밀번호 확인</Text>
              <TextInput style={styles.input} value={passwordConfirm} onChangeText={setPasswordConfirm}
                placeholder="비밀번호 확인" placeholderTextColor="#777d86" secureTextEntry
                autoCapitalize="none" autoCorrect={false} textContentType="newPassword"
                accessibilityLabel="비밀번호 확인" editable={!loading} onSubmitEditing={() => void login()} />
            </>}
            {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
            {!!(error || initialError) && <Text accessibilityRole="alert" style={styles.error}>{error || initialError}</Text>}
            <TouchableOpacity style={[styles.button, loading && styles.disabled]} disabled={loading}
              accessibilityRole="button" accessibilityState={{ disabled: loading, busy: loading }}
              onPress={() => void login()}>
              {loading ? <ActivityIndicator color="#151619" /> : <Text style={styles.buttonText}>{signup ? "회원가입" : "로그인"}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.switchMode} disabled={loading} accessibilityRole="button"
              onPress={() => { setSignup(!signup); setError(""); setNotice(""); setPassword(""); setPasswordConfirm(""); }}>
              <Text style={styles.switchText}>{signup ? "이미 계정이 있나요? 로그인" : "계정이 없나요? 회원가입"}</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={[styles.googleButton, loading && styles.disabled]} disabled={loading}
              accessibilityRole="button" accessibilityState={{ disabled: loading }} onPress={() => void googleLogin()}>
              <Text style={styles.googleText}>Google로 계속하기</Text>
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
  notice: { fontSize: 13, lineHeight: 20, color: "#bfc4cb", marginBottom: 16 },
  switchMode: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  switchText: { fontSize: 13, color: "#bfc4cb" },
  divider: { height: 1, backgroundColor: "#34373e", marginVertical: 16 },
  googleButton: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: "#34373e",
    backgroundColor: "#1a1c21", alignItems: "center", justifyContent: "center" },
  googleText: { fontSize: 15, fontWeight: "600", color: "#f3f4f6" },
});
