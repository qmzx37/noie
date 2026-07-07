import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

// 백엔드 API 주소입니다.
// PC 에뮬레이터나 웹에서 테스트할 때는 127.0.0.1을 사용할 수 있습니다.
// 실제 휴대폰 Expo Go에서 테스트할 때는 127.0.0.1이 휴대폰 자신을 뜻하므로,
// 아래 값을 PC의 내부 IPv4 주소로 바꿔 주세요.
// 예: const API_BASE_URL = "http://192.168.0.10:8000";
const API_BASE_URL = "http://127.0.0.1:8000";

type EmotionLevel = "Low" | "Mid" | "High";
type AnalysisSource = "openai" | "rule_based";

type PrimaryAxis = {
  like: EmotionLevel;
  dislike: EmotionLevel;
};

type EmotionAxis = {
  F: EmotionLevel;
  A: EmotionLevel;
  D: EmotionLevel;
  J: EmotionLevel;
  C: EmotionLevel;
  G: EmotionLevel;
  T: EmotionLevel;
  R: EmotionLevel;
};

type AdminView = {
  primary_axis: {
    like: number;
    dislike: number;
  };
  emotion_axis: Record<keyof EmotionAxis, number>;
};

type AnalyzeEmotionResponse = {
  input: string;
  user_view: {
    primary_axis: PrimaryAxis;
    emotion_axis: EmotionAxis;
    state_summary: string;
  };
  admin_view: AdminView;
  source: AnalysisSource;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  analysis?: AnalyzeEmotionResponse;
  isLoading?: boolean;
  error?: string;
  showAdminView?: boolean;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
};

const primaryLabels: Array<{ key: keyof PrimaryAxis; label: string }> = [
  { key: "like", label: "호감 like" },
  { key: "dislike", label: "불호 dislike" },
];

const emotionLabels: Array<{ key: keyof EmotionAxis; label: string }> = [
  { key: "F", label: "F 공포" },
  { key: "A", label: "A 분노" },
  { key: "D", label: "D 우울" },
  { key: "J", label: "J 기쁨" },
  { key: "C", label: "C 호기심" },
  { key: "G", label: "G 욕구" },
  { key: "T", label: "T 긴장" },
  { key: "R", label: "R 안정" },
];

const emptySession = (): ChatSession => {
  const now = new Date().toISOString();
  return {
    id: createId("session"),
    title: "새 채팅",
    messages: [],
    createdAt: now,
  };
};

export default function App() {
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 820;
  const scrollViewRef = useRef<ScrollView | null>(null);

  // 아직 DB 저장은 하지 않고 앱이 켜져 있는 동안 state로만 채팅 세션을 관리합니다.
  const initialSession = useMemo(() => emptySession(), []);
  const [sessions, setSessions] = useState<ChatSession[]>([initialSession]);
  const [activeSessionId, setActiveSessionId] = useState(initialSession.id);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0];

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 80);
  };

  const updateActiveSession = (
    updater: (session: ChatSession) => ChatSession
  ) => {
    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === activeSessionId ? updater(session) : session
      )
    );
  };

  const createNewChat = () => {
    const newSession = emptySession();
    setSessions((currentSessions) => [newSession, ...currentSessions]);
    setActiveSessionId(newSession.id);
    setInputText("");
    setIsSending(false);
    setIsDrawerOpen(false);
  };

  const selectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setIsDrawerOpen(false);
    scrollToBottom();
  };

  const sendMessage = async () => {
    const trimmedText = inputText.trim();

    if (!trimmedText || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      text: trimmedText,
    };
    const assistantMessageId = createId("assistant");
    const loadingMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: "noie가 분석 중...",
      isLoading: true,
    };

    // 첫 문장을 채팅 제목으로 사용해 사이드바 목록에서 알아보기 쉽게 만듭니다.
    updateActiveSession((session) => ({
      ...session,
      title:
        session.messages.length === 0
          ? makeSessionTitle(trimmedText)
          : session.title,
      messages: [...session.messages, userMessage, loadingMessage],
    }));

    setInputText("");
    setIsSending(true);
    scrollToBottom();

    try {
      const response = await fetch(`${API_BASE_URL}/analyze-emotion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // FastAPI 백엔드는 text 필드로 사용자 문장을 받습니다.
        body: JSON.stringify({ text: trimmedText }),
      });

      if (!response.ok) {
        throw new Error(`API 응답 오류: ${response.status}`);
      }

      const analysis = (await response.json()) as AnalyzeEmotionResponse;

      updateActiveSession((session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                role: "assistant",
                text: analysis.user_view.state_summary,
                analysis,
                showAdminView: false,
              }
            : message
        ),
      }));
    } catch (error) {
      updateActiveSession((session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                role: "assistant",
                text: "분석에 실패했습니다. 백엔드 서버가 켜져 있는지 확인해주세요.",
                error: "분석에 실패했습니다. 백엔드 서버가 켜져 있는지 확인해주세요.",
              }
            : message
        ),
      }));
    } finally {
      setIsSending(false);
      scrollToBottom();
    }
  };

  const toggleAdminView = (messageId: string) => {
    updateActiveSession((session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId
          ? { ...message, showAdminView: !message.showAdminView }
          : message
      ),
    }));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.appShell}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {isWideScreen ? (
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onNewChat={createNewChat}
            onSelectSession={selectSession}
          />
        ) : null}

        {!isWideScreen && isDrawerOpen ? (
          <View style={styles.drawerLayer}>
            <TouchableOpacity
              style={styles.drawerBackdrop}
              activeOpacity={1}
              onPress={() => setIsDrawerOpen(false)}
            />
            <Sidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onNewChat={createNewChat}
              onSelectSession={selectSession}
            />
          </View>
        ) : null}

        <View style={styles.mainPane}>
          <View style={styles.topBar}>
            {!isWideScreen ? (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setIsDrawerOpen(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.iconButtonText}>☰</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.topBarTitleBlock}>
              <Text style={styles.topBarTitle}>noie</Text>
              <Text style={styles.topBarSubtitle}>
                감정 분석 채팅 · {activeSession.title}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.newChatSmallButton}
              onPress={createNewChat}
              activeOpacity={0.85}
            >
              <Text style={styles.newChatSmallButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollViewRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={scrollToBottom}
          >
            {activeSession.messages.length === 0 ? (
              <EmptyChat />
            ) : (
              activeSession.messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  onToggleAdminView={toggleAdminView}
                />
              ))
            )}
          </ScrollView>

          <View style={styles.inputBar}>
            <TextInput
              style={styles.messageInput}
              placeholder="오늘의 감정을 입력해 주세요"
              placeholderTextColor="#8b949e"
              value={inputText}
              onChangeText={setInputText}
              multiline
              editable={!isSending}
              returnKeyType="send"
              onSubmitEditing={sendMessage}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!inputText.trim() || isSending) && styles.sendButtonDisabled,
              ]}
              onPress={sendMessage}
              disabled={!inputText.trim() || isSending}
              activeOpacity={0.85}
            >
              <Text style={styles.sendButtonText}>전송</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type SidebarProps = {
  sessions: ChatSession[];
  activeSessionId: string;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
};

function Sidebar({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
}: SidebarProps) {
  return (
    <View style={styles.sidebar}>
      <Text style={styles.logo}>noie</Text>
      <TouchableOpacity
        style={styles.newChatButton}
        onPress={onNewChat}
        activeOpacity={0.85}
      >
        <Text style={styles.newChatButtonText}>+ 새 채팅</Text>
      </TouchableOpacity>

      <Text style={styles.sidebarSectionLabel}>채팅 목록</Text>
      <ScrollView style={styles.sessionList}>
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <TouchableOpacity
              key={session.id}
              style={[
                styles.sessionItem,
                isActive && styles.sessionItemActive,
              ]}
              onPress={() => onSelectSession(session.id)}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.sessionTitle,
                  isActive && styles.sessionTitleActive,
                ]}
                numberOfLines={1}
              >
                {session.title}
              </Text>
              <Text style={styles.sessionMeta}>
                {formatSessionTime(session.createdAt)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function EmptyChat() {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>오늘의 감정을 입력해 주세요</Text>
      <Text style={styles.emptyText}>
        noie가 문장의 호감/불호와 8축 감정을 분석해 대화처럼 보여줍니다.
      </Text>
    </View>
  );
}

type ChatBubbleProps = {
  message: ChatMessage;
  onToggleAdminView: (messageId: string) => void;
};

function ChatBubble({ message, onToggleAdminView }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <View
      style={[
        styles.messageRow,
        isUser ? styles.userMessageRow : styles.assistantMessageRow,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        {isUser ? <Text style={styles.userText}>{message.text}</Text> : null}

        {!isUser && message.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#f2f4f8" />
            <Text style={styles.assistantText}>noie가 분석 중...</Text>
          </View>
        ) : null}

        {!isUser && message.error ? (
          <Text style={styles.errorText}>{message.error}</Text>
        ) : null}

        {!isUser && message.analysis ? (
          <AnalysisCard
            message={message}
            onToggleAdminView={onToggleAdminView}
          />
        ) : null}
      </View>
    </View>
  );
}

type AnalysisCardProps = {
  message: ChatMessage;
  onToggleAdminView: (messageId: string) => void;
};

function AnalysisCard({ message, onToggleAdminView }: AnalysisCardProps) {
  const analysis = message.analysis;

  if (!analysis) {
    return null;
  }

  return (
    <View>
      <Text style={styles.assistantName}>noie</Text>
      <Text style={styles.inputEcho}>{analysis.input}</Text>

      <Text style={styles.groupTitle}>1차 반응</Text>
      <View style={styles.metricGrid}>
        {primaryLabels.map((item) => (
          <MetricPill
            key={item.key}
            label={item.label}
            value={analysis.user_view.primary_axis[item.key]}
          />
        ))}
      </View>

      <Text style={styles.groupTitle}>2차 감정 8축</Text>
      <View style={styles.metricGrid}>
        {emotionLabels.map((item) => (
          <MetricPill
            key={item.key}
            label={item.label}
            value={analysis.user_view.emotion_axis[item.key]}
          />
        ))}
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.summaryLabel}>상태 요약</Text>
        <Text style={styles.summaryText}>
          {analysis.user_view.state_summary}
        </Text>
      </View>

      <View style={styles.sourceRow}>
        <Text style={styles.sourceLabel}>source</Text>
        <Text style={styles.sourceValue}>{analysis.source}</Text>
      </View>

      <TouchableOpacity
        style={styles.adminToggle}
        onPress={() => onToggleAdminView(message.id)}
        activeOpacity={0.85}
      >
        <Text style={styles.adminToggleText}>
          {message.showAdminView ? "관리자 숫자 접기" : "관리자 숫자 펼치기"}
        </Text>
      </TouchableOpacity>

      {message.showAdminView ? (
        <Text style={styles.adminJson}>
          {JSON.stringify(analysis.admin_view, null, 2)}
        </Text>
      ) : null}
    </View>
  );
}

type MetricPillProps = {
  label: string;
  value: EmotionLevel;
};

function MetricPill({ label, value }: MetricPillProps) {
  return (
    <View style={styles.metricPill}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, styles[`level${value}`]]}>
        {value}
      </Text>
    </View>
  );
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeSessionTitle(text: string) {
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#050505",
  },
  appShell: {
    flex: 1,
    backgroundColor: "#050505",
    flexDirection: "row",
  },
  sidebar: {
    backgroundColor: "#111111",
    borderRightColor: "#242424",
    borderRightWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 18,
    width: 286,
    zIndex: 5,
  },
  logo: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 16,
  },
  newChatButton: {
    alignItems: "center",
    backgroundColor: "#202123",
    borderColor: "#343541",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  newChatButtonText: {
    color: "#f5f5f5",
    fontSize: 15,
    fontWeight: "700",
  },
  sidebarSectionLabel: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 22,
  },
  sessionList: {
    flex: 1,
  },
  sessionItem: {
    backgroundColor: "transparent",
    borderRadius: 8,
    marginBottom: 6,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sessionItemActive: {
    backgroundColor: "#2a2b32",
  },
  sessionTitle: {
    color: "#d7d7d7",
    fontSize: 14,
    fontWeight: "700",
  },
  sessionTitleActive: {
    color: "#ffffff",
  },
  sessionMeta: {
    color: "#7d7d7d",
    fontSize: 12,
    marginTop: 4,
  },
  drawerLayer: {
    bottom: 0,
    flexDirection: "row",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  drawerBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  mainPane: {
    backgroundColor: "#050505",
    flex: 1,
  },
  topBar: {
    alignItems: "center",
    backgroundColor: "#050505",
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 62,
    paddingHorizontal: 14,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    marginRight: 12,
    width: 40,
  },
  iconButtonText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
  },
  topBarTitleBlock: {
    flex: 1,
  },
  topBarTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  topBarSubtitle: {
    color: "#8f8f8f",
    fontSize: 12,
    marginTop: 2,
  },
  newChatSmallButton: {
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  newChatSmallButtonText: {
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 28,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "center",
  },
  emptyText: {
    color: "#a4a4a4",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  userMessageRow: {
    justifyContent: "flex-end",
  },
  assistantMessageRow: {
    justifyContent: "flex-start",
  },
  bubble: {
    borderRadius: 14,
    maxWidth: "92%",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  userBubble: {
    backgroundColor: "#2f6fed",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: "#171717",
    borderColor: "#2b2b2b",
    borderWidth: 1,
    borderBottomLeftRadius: 4,
  },
  userText: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 23,
  },
  assistantText: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 22,
  },
  assistantName: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 8,
  },
  inputEcho: {
    color: "#b8b8b8",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  errorText: {
    color: "#ffb4b4",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
  },
  groupTitle: {
    color: "#f7f7f7",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
    marginTop: 10,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricPill: {
    backgroundColor: "#222222",
    borderColor: "#333333",
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 112,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  metricLabel: {
    color: "#a9a9a9",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 5,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "900",
  },
  levelLow: {
    color: "#9ca3af",
  },
  levelMid: {
    color: "#fbbf24",
  },
  levelHigh: {
    color: "#34d399",
  },
  summaryBox: {
    backgroundColor: "#0d0d0d",
    borderColor: "#2b2b2b",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  summaryLabel: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  summaryText: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 22,
  },
  sourceRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  sourceLabel: {
    color: "#8f8f8f",
    fontSize: 13,
    fontWeight: "700",
  },
  sourceValue: {
    backgroundColor: "#242424",
    borderRadius: 999,
    color: "#f2f4f8",
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  adminToggle: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    minHeight: 40,
    justifyContent: "center",
  },
  adminToggleText: {
    color: "#c7c7c7",
    fontSize: 13,
    fontWeight: "800",
  },
  adminJson: {
    backgroundColor: "#050505",
    borderColor: "#262626",
    borderRadius: 8,
    borderWidth: 1,
    color: "#cbd5e1",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    padding: 10,
  },
  inputBar: {
    alignItems: "flex-end",
    backgroundColor: "#050505",
    borderTopColor: "#1f1f1f",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageInput: {
    backgroundColor: "#171717",
    borderColor: "#333333",
    borderRadius: 12,
    borderWidth: 1,
    color: "#ffffff",
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  sendButtonDisabled: {
    opacity: 0.38,
  },
  sendButtonText: {
    color: "#050505",
    fontSize: 15,
    fontWeight: "900",
  },
});
