import React, { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { signInWithPassword, signUpWithPassword } from "../../auth/supabaseAuth";
import { signInWithGoogle } from "../../auth/googleAuth";
import { signInWithKakao } from "../../auth/kakaoAuth";
import { signInWithNaver } from "../../auth/naverAuth";
import { GoogleMark } from "./GoogleMark";
import { KakaoMark } from "./KakaoMark";
import { NaverMark } from "./NaverMark";

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

  async function socialLogin(provider: "google" | "kakao" | "custom:naver") {
    // 같은 버튼 guard를 재사용하여 password/OAuth 흐름의 동시 시작을 막습니다.
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    // 서버 provider 식별자와 사용자용 한국어 안내 이름을 혼동하지 않습니다.
    const name = provider === "google" ? "Google" : provider === "kakao" ? "카카오" : "네이버";
    try {
      const result = await (provider === "google" ? signInWithGoogle()
        : provider === "kakao" ? signInWithKakao() : signInWithNaver());
      if (result === "cancelled") setNotice(`${name} 로그인을 취소했습니다.`);
    } catch {
      setError(`${name} 로그인에 실패했습니다. 설정과 연결 상태를 확인해 주세요.`);
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
              {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>{signup ? "회원가입" : "로그인"}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.switchMode} disabled={loading} accessibilityRole="button"
              onPress={() => { setSignup(!signup); setError(""); setNotice(""); setPassword(""); setPasswordConfirm(""); }}>
              <Text style={styles.switchText}>{signup ? "이미 계정이 있나요? 로그인" : "회원가입"}</Text>
            </TouchableOpacity>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{signup ? "간편 가입" : "간편 로그인"}</Text>
              <View style={styles.dividerLine} />
            </View>
            {/* 모든 소셜 버튼은 기존 password/OAuth 제출 guard를 공유합니다. */}
            <View style={styles.socialButtons}>
              <TouchableOpacity style={[styles.googleButton, loading && styles.disabled]} disabled={loading}
                accessibilityRole="button" accessibilityLabel="Google로 로그인"
                accessibilityState={{ disabled: loading, busy: loading }} onPress={() => void socialLogin("google")}>
                <GoogleMark />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.kakaoButton, loading && styles.disabled]} disabled={loading}
                accessibilityRole="button" accessibilityLabel="카카오로 로그인"
                accessibilityState={{ disabled: loading, busy: loading }} onPress={() => void socialLogin("kakao")}>
                <KakaoMark />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.naverButton, loading && styles.disabled]} disabled={loading}
                accessibilityRole="button" accessibilityLabel="네이버로 로그인"
                accessibilityState={{ disabled: loading, busy: loading }} onPress={() => void socialLogin("custom:naver")}>
                <NaverMark />
              </TouchableOpacity>
            </View>
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
  content: { flexGrow: 1, justifyContent: "center", padding: 20 },
  // 카드 폭은 화면 안에 맞추고, 키보드 표시 시에도 기존 ScrollView로 입력에 접근합니다.
  form: { width: "100%", maxWidth: 420, alignSelf: "center", backgroundColor: "#ffffff",
    borderRadius: 8, padding: 28, borderWidth: 1, borderColor: "#e7e9ed" },
  brand: { fontSize: 36, fontWeight: "700", color: "#17191d", textAlign: "center", marginBottom: 8 },
  heading: { fontSize: 20, fontWeight: "600", color: "#404650", textAlign: "center", marginBottom: 32 },
  label: { fontSize: 13, fontWeight: "500", color: "#404650", marginBottom: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#dce0e6", borderRadius: 6,
    backgroundColor: "#ffffff", color: "#17191d", paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, marginBottom: 20 },
  error: { fontSize: 13, lineHeight: 20, color: "#b42318", marginBottom: 16 },
  button: { minHeight: 48, borderRadius: 6, backgroundColor: "#17191d", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.6 },
  notice: { fontSize: 13, lineHeight: 20, color: "#5f6672", marginBottom: 16 },
  switchMode: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  switchText: { fontSize: 13, fontWeight: "500", color: "#535b68" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20, marginBottom: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#e7e9ed" },
  dividerText: { fontSize: 12, color: "#737b87" },
  socialButtons: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center" },
  googleButton: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: "#dce0e6",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  // Google과 동일한 터치 영역과 간격을 유지하는 Kakao 전용 브랜드 색상입니다.
  kakaoButton: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: "#FEE500",
    backgroundColor: "#FEE500", alignItems: "center", justifyContent: "center" },
  // 기존 row/gap과 동일한 52px 터치 영역을 유지합니다.
  naverButton: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: "#03C75A",
    backgroundColor: "#03C75A", alignItems: "center", justifyContent: "center" },
});
