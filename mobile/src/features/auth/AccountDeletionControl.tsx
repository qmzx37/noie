import React, { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { DELETE_CONFIRMATION, requestAccountDeletion } from "../../auth/accountDeletion";
import type { AccountNamespace } from "../../noie/accountStorage";

export function AccountDeletionControl({ namespace, generation, onError }: { namespace: AccountNamespace; generation: number; onError: (error: string) => void }) {
  // 별도의 명시적 확인 화면에서만 삭제를 요청합니다. appStyles와 기존 업무 화면은 변경하지 않습니다.
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (busy || confirmation !== DELETE_CONFIRMATION) return;
    setBusy(true); setError("");
    try { await requestAccountDeletion(namespace, confirmation, generation); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : "계정 삭제 요청을 확인할 수 없습니다.";
      setError(message); onError(message); // 세션 clear로 unmount되어도 부모 Login 화면에 정리 실패를 남깁니다.
    }
    finally { setBusy(false); }
  }
  return <>
    <TouchableOpacity style={styles.button} onPress={() => { setOpen(true); setError(""); setConfirmation(""); }} accessibilityRole="button">
      <Text style={styles.danger}>계정 삭제</Text>
    </TouchableOpacity>
    <Modal visible={open} transparent onRequestClose={() => { if (!busy) setOpen(false); }}>
      <View style={styles.backdrop}><View style={styles.dialog}>
        <Text style={styles.title}>NOIE 계정 삭제</Text>
        <Text style={styles.text}>요청이 접수되면 계정 접근이 차단되고 NOIE 데이터 삭제가 진행됩니다. 되돌릴 수 없습니다. 보안 감사 기록과 백업, Supabase 로그인 계정은 별도로 남을 수 있습니다.</Text>
        <Text style={styles.text}>확인 문구: {DELETE_CONFIRMATION}</Text>
        <TextInput style={styles.input} value={confirmation} onChangeText={setConfirmation} autoCapitalize="none" autoCorrect={false} editable={!busy} accessibilityLabel="계정 삭제 확인 문구" />
        {error ? <Text style={styles.danger}>{error}</Text> : null}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.button} disabled={busy} onPress={() => setOpen(false)}><Text style={styles.text}>취소</Text></TouchableOpacity>
          <TouchableOpacity style={styles.button} disabled={busy || confirmation !== DELETE_CONFIRMATION} onPress={() => void submit()}>
            <Text style={[styles.danger, (busy || confirmation !== DELETE_CONFIRMATION) && styles.disabled]}>{busy ? "접수 중..." : "삭제 요청"}</Text>
          </TouchableOpacity>
        </View>
      </View></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center" },
  danger: { color: "#f19797", fontSize: 13 },
  disabled: { opacity: 0.4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 440, backgroundColor: "#191b20", borderWidth: 1, borderColor: "#34373d", borderRadius: 8, padding: 20, gap: 16 },
  title: { color: "#eef0f3", fontSize: 20, fontWeight: "600" },
  text: { color: "#bfc4cb", fontSize: 14, lineHeight: 22 },
  input: { borderWidth: 1, borderColor: "#4b4e54", borderRadius: 6, padding: 12, color: "#eef0f3" },
  actions: { flexDirection: "row", justifyContent: "flex-end" },
});
