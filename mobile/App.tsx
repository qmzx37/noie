import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
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

// 백엔드 API 주소입니다. 실제 휴대폰에서는 PC 내부 IPv4 주소로 바꿔 주세요.
// 예: const API_BASE_URL = "http://192.168.0.10:8000";
const API_BASE_URL = "http://127.0.0.1:8000";

const SESSIONS_STORAGE_KEY = "noie_chat_sessions_v1";
const CURRENT_CHAT_ID_STORAGE_KEY = "noie_current_chat_id_v1";

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

type AnalyzeEmotionResponse = {
  input: string;
  user_view: {
    primary_axis: PrimaryAxis;
    emotion_axis: EmotionAxis;
    state_summary: string;
  };
  admin_view: {
    primary_axis: { like: number; dislike: number };
    emotion_axis: Record<keyof EmotionAxis, number>;
  };
  source: AnalysisSource;
};

type ChatApiResponse = {
  reply: string;
  state_summary: string;
  analysis: AnalyzeEmotionResponse;
  source: AnalysisSource;
};

type GenerateTitleResponse = {
  title: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reply?: string;
  stateSummary?: string;
  analysis?: AnalyzeEmotionResponse;
  isLoading?: boolean;
  error?: string;
  showAdminView?: boolean;
  createdAt: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
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

function createEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: createId("session"),
    title: "새 채팅",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export default function App() {
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 820;
  const scrollViewRef = useRef<ScrollView | null>(null);
  const fallbackSession = useMemo(() => createEmptySession(), []);

  const [sessions, setSessions] = useState<ChatSession[]>([fallbackSession]);
  const [activeSessionId, setActiveSessionId] = useState(fallbackSession.id);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0];

  useEffect(() => {
    loadSavedChats();
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions)).catch(
      (error) => console.log("[noie] 채팅 저장 실패", error)
    );
    AsyncStorage.setItem(CURRENT_CHAT_ID_STORAGE_KEY, activeSessionId).catch(
      (error) => console.log("[noie] 현재 채팅 저장 실패", error)
    );
  }, [activeSessionId, isHydrated, sessions]);

  const loadSavedChats = async () => {
    try {
      const [savedSessions, savedCurrentChatId] = await Promise.all([
        AsyncStorage.getItem(SESSIONS_STORAGE_KEY),
        AsyncStorage.getItem(CURRENT_CHAT_ID_STORAGE_KEY),
      ]);
      const parsedSessions = savedSessions
        ? (JSON.parse(savedSessions) as ChatSession[])
        : [];

      if (Array.isArray(parsedSessions) && parsedSessions.length > 0) {
        setSessions(parsedSessions);
        setActiveSessionId(
          parsedSessions.some((session) => session.id === savedCurrentChatId)
            ? String(savedCurrentChatId)
            : parsedSessions[0].id
        );
      } else {
        const newSession = createEmptySession();
        setSessions([newSession]);
        setActiveSessionId(newSession.id);
      }
    } catch (error) {
      const newSession = createEmptySession();
      setSessions([newSession]);
      setActiveSessionId(newSession.id);
    } finally {
      setIsHydrated(true);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 80);
  };

  const updateSession = (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession
  ) => {
    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === sessionId ? updater(session) : session
      )
    );
  };

  const createNewChat = () => {
    const newSession = createEmptySession();
    setSessions((currentSessions) => [newSession, ...currentSessions]);
    setActiveSessionId(newSession.id);
    setInputText("");
    setIsSending(false);
    setIsDrawerOpen(false);
  };

  const deleteChat = (sessionId: string) => {
    setSessions((currentSessions) => {
      const remainingSessions = currentSessions.filter(
        (session) => session.id !== sessionId
      );

      if (remainingSessions.length === 0) {
        const newSession = createEmptySession();
        setActiveSessionId(newSession.id);
        return [newSession];
      }

      if (sessionId === activeSessionId) {
        setActiveSessionId(remainingSessions[0].id);
      }

      return remainingSessions;
    });
  };

  const sendMessage = async () => {
    const trimmedText = inputText.trim();
    if (!trimmedText || isSending || !activeSession) {
      return;
    }

    const sessionId = activeSession.id;
    const shouldGenerateTitle =
      activeSession.title === "새 채팅" && activeSession.messages.length === 0;
    const now = new Date().toISOString();
    const assistantMessageId = createId("assistant");

    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      text: trimmedText,
      createdAt: now,
    };
    const loadingMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: "noie가 응답을 준비 중...",
      isLoading: true,
      createdAt: now,
    };

    updateSession(sessionId, (session) => ({
      ...session,
      messages: [...session.messages, userMessage, loadingMessage],
      updatedAt: now,
    }));

    setInputText("");
    setIsSending(true);
    scrollToBottom();

    if (shouldGenerateTitle) {
      generateTitle(trimmedText).then((title) => {
        updateSession(sessionId, (session) =>
          session.title === "새 채팅"
            ? { ...session, title, updatedAt: new Date().toISOString() }
            : session
        );
      });
    }

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmedText,
          messages: toChatHistory(activeSession.messages),
        }),
      });

      if (!response.ok) {
        throw new Error(`API 응답 오류: ${response.status}`);
      }

      const data = (await response.json()) as ChatApiResponse;

      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                role: "assistant",
                text: data.reply,
                reply: data.reply,
                stateSummary:
                  data.state_summary || data.analysis.user_view.state_summary,
                analysis: data.analysis,
                showAdminView: false,
                createdAt: message.createdAt,
              }
            : message
        ),
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                role: "assistant",
                text: "noie 응답 생성에 실패했습니다. 백엔드 서버를 확인해주세요.",
                error: "noie 응답 생성에 실패했습니다. 백엔드 서버를 확인해주세요.",
                createdAt: message.createdAt,
              }
            : message
        ),
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setIsSending(false);
      scrollToBottom();
    }
  };

  const generateTitle = async (text: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/generate-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`제목 API 응답 오류: ${response.status}`);
      }

      const data = (await response.json()) as GenerateTitleResponse;
      return cleanTitle(data.title) || makeFallbackTitle(text);
    } catch (error) {
      return makeFallbackTitle(text);
    }
  };

  const toggleAdminView = (messageId: string) => {
    if (!activeSession) {
      return;
    }

    updateSession(activeSession.id, (session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId
          ? { ...message, showAdminView: !message.showAdminView }
          : message
      ),
      updatedAt: new Date().toISOString(),
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
            onSelectSession={(id) => {
              setActiveSessionId(id);
              scrollToBottom();
            }}
            onDeleteSession={deleteChat}
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
              onSelectSession={(id) => {
                setActiveSessionId(id);
                setIsDrawerOpen(false);
                scrollToBottom();
              }}
              onDeleteSession={deleteChat}
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
                감정 분석 채팅 · {activeSession?.title ?? "새 채팅"}
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
            {!isHydrated ? (
              <View style={styles.emptyState}>
                <ActivityIndicator color="#f2f4f8" />
                <Text style={styles.emptyText}>저장된 채팅을 불러오는 중...</Text>
              </View>
            ) : activeSession.messages.length === 0 ? (
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
              editable={!isSending && isHydrated}
              returnKeyType="send"
              onSubmitEditing={sendMessage}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!inputText.trim() || isSending || !isHydrated) &&
                  styles.sendButtonDisabled,
              ]}
              onPress={sendMessage}
              disabled={!inputText.trim() || isSending || !isHydrated}
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
  onDeleteSession: (sessionId: string) => void;
};

function Sidebar({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
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
            <View
              key={session.id}
              style={[
                styles.sessionItem,
                isActive && styles.sessionItemActive,
              ]}
            >
              <TouchableOpacity
                style={styles.sessionTitleButton}
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
                  {formatSessionTime(session.updatedAt)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => onDeleteSession(session.id)}
                activeOpacity={0.85}
              >
                <Text style={styles.deleteButtonText}>삭제</Text>
              </TouchableOpacity>
            </View>
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
        noie가 자연스러운 답변, 상태 요약, 감정 분석 카드를 함께 보여줍니다.
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
            <Text style={styles.assistantText}>noie가 응답을 준비 중...</Text>
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
  if (!analysis) return null;

  return (
    <View>
      <Text style={styles.assistantName}>noie 답변</Text>

      <View style={styles.replyBox}>
        <Text style={styles.sectionLabel}>일반 답변</Text>
        <Text style={styles.replyText}>{message.reply || message.text}</Text>
      </View>

      <View style={styles.summaryBox}>
        <Text style={styles.sectionLabel}>상태 요약</Text>
        <Text style={styles.summaryText}>
          {message.stateSummary || analysis.user_view.state_summary}
        </Text>
      </View>

      <Text style={styles.groupTitle}>감정 분석</Text>
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
      <Text style={[styles.metricValue, levelStyle(value)]}>{value}</Text>
    </View>
  );
}

function toChatHistory(messages: ChatMessage[]) {
  return messages
    .filter((message) => !message.isLoading && !message.error)
    .map((message) => ({
      role: message.role,
      content:
        message.role === "assistant"
          ? message.reply || message.text
          : message.text,
    }));
}

function levelStyle(value: EmotionLevel) {
  if (value === "High") return styles.levelHigh;
  if (value === "Mid") return styles.levelMid;
  return styles.levelLow;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeFallbackTitle(text: string) {
  return cleanTitle(text) || "새 채팅";
}

function cleanTitle(text: string) {
  return text.replace(/["'“”‘’.,!?]/g, "").trim().slice(0, 15);
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#050505" },
  appShell: { flex: 1, backgroundColor: "#050505", flexDirection: "row" },
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
  newChatButtonText: { color: "#f5f5f5", fontSize: 15, fontWeight: "700" },
  sidebarSectionLabel: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 22,
  },
  sessionList: { flex: 1 },
  sessionItem: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 8,
    flexDirection: "row",
    marginBottom: 6,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sessionItemActive: { backgroundColor: "#2a2b32" },
  sessionTitleButton: { flex: 1, marginRight: 8 },
  sessionTitle: { color: "#d7d7d7", fontSize: 14, fontWeight: "700" },
  sessionTitleActive: { color: "#ffffff" },
  sessionMeta: { color: "#7d7d7d", fontSize: 12, marginTop: 4 },
  deleteButton: {
    borderColor: "#3a3a3a",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  deleteButtonText: { color: "#b8b8b8", fontSize: 12, fontWeight: "700" },
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
  mainPane: { backgroundColor: "#050505", flex: 1 },
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
  iconButtonText: { color: "#ffffff", fontSize: 20, fontWeight: "800" },
  topBarTitleBlock: { flex: 1 },
  topBarTitle: { color: "#ffffff", fontSize: 18, fontWeight: "800" },
  topBarSubtitle: { color: "#8f8f8f", fontSize: 12, marginTop: 2 },
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
  newChatSmallButtonText: { color: "#ffffff", fontSize: 24, lineHeight: 28 },
  chatScroll: { flex: 1 },
  chatContent: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 18 },
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
    marginTop: 10,
    textAlign: "center",
  },
  messageRow: { flexDirection: "row", marginBottom: 16 },
  userMessageRow: { justifyContent: "flex-end" },
  assistantMessageRow: { justifyContent: "flex-start" },
  bubble: {
    borderRadius: 14,
    maxWidth: "92%",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  userBubble: { backgroundColor: "#2f6fed", borderBottomRightRadius: 4 },
  assistantBubble: {
    backgroundColor: "#171717",
    borderBottomLeftRadius: 4,
    borderColor: "#2b2b2b",
    borderWidth: 1,
    width: "100%",
  },
  userText: { color: "#ffffff", fontSize: 16, lineHeight: 23 },
  assistantText: { color: "#f2f4f8", fontSize: 15, lineHeight: 22 },
  assistantName: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  replyBox: {
    backgroundColor: "#0d0d0d",
    borderColor: "#2b2b2b",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  sectionLabel: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  replyText: { color: "#ffffff", fontSize: 15, lineHeight: 22 },
  inputEcho: {
    color: "#b8b8b8",
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  errorText: { color: "#ffb4b4", fontSize: 15, fontWeight: "700", lineHeight: 22 },
  groupTitle: {
    color: "#f7f7f7",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
    marginTop: 10,
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metricPill: {
    backgroundColor: "#222222",
    borderColor: "#333333",
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 112,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  metricLabel: { color: "#a9a9a9", fontSize: 12, fontWeight: "700", marginBottom: 5 },
  metricValue: { fontSize: 18, fontWeight: "900" },
  levelLow: { color: "#9ca3af" },
  levelMid: { color: "#fbbf24" },
  levelHigh: { color: "#34d399" },
  summaryBox: {
    backgroundColor: "#0d0d0d",
    borderColor: "#2b2b2b",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  summaryText: { color: "#ffffff", flexShrink: 1, fontSize: 15, lineHeight: 22 },
  sourceRow: {
    alignItems: "flex-start",
    columnGap: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 12,
    rowGap: 8,
  },
  sourceLabel: {
    color: "#8f8f8f",
    flexShrink: 0,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 24,
  },
  sourceValue: {
    backgroundColor: "#242424",
    borderRadius: 999,
    color: "#f2f4f8",
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800",
    minWidth: 76,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    textAlign: "center",
  },
  adminToggle: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 40,
  },
  adminToggleText: { color: "#c7c7c7", fontSize: 13, fontWeight: "800" },
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
  sendButtonDisabled: { opacity: 0.38 },
  sendButtonText: { color: "#050505", fontSize: 15, fontWeight: "900" },
});
