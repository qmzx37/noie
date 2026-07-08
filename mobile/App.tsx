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
import Svg, {
  Circle,
  Line,
  Polyline,
  Text as SvgText,
} from "react-native-svg";

// 백엔드 API 주소입니다.
// 실제 휴대폰에서 Expo Go로 테스트할 때는 127.0.0.1 대신 PC의 내부 IPv4 주소로 바꿔주세요.
// 예: const API_BASE_URL = "http://192.168.0.10:8000";
const API_BASE_URL = "http://127.0.0.1:8000";

const SESSIONS_STORAGE_KEY = "noie_chat_sessions_v1";
const CURRENT_CHAT_ID_STORAGE_KEY = "noie_current_chat_id_v1";

type EmotionLevel = "Low" | "Mid" | "High";
type AnalysisSource = "openai" | "rule_based";
type ScreenMode = "chat" | "flow";

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

type EmotionKey = keyof EmotionAxis;
type NumericEmotionAxis = Record<EmotionKey, number>;

type AnalyzeEmotionResponse = {
  input: string;
  user_view: {
    primary_axis: PrimaryAxis;
    emotion_axis: EmotionAxis;
    state_summary: string;
  };
  admin_view: {
    primary_axis: { like: number; dislike: number };
    emotion_axis: NumericEmotionAxis;
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

type EmotionRecord = {
  id: string;
  sessionTitle: string;
  createdAt: string;
  timestamp: number;
  axis: NumericEmotionAxis;
};

type WeeklyAverage = {
  key: EmotionKey;
  label: string;
  value: number;
};

const EMOTION_LABELS: Record<EmotionKey, string> = {
  F: "공포",
  A: "분노",
  D: "우울",
  J: "기쁨",
  C: "호기심",
  G: "욕구",
  T: "긴장",
  R: "안정",
};

const EMOTION_COLORS: Record<EmotionKey, string> = {
  F: "#f97316",
  A: "#ef4444",
  D: "#60a5fa",
  J: "#facc15",
  C: "#22d3ee",
  G: "#a78bfa",
  T: "#fb7185",
  R: "#34d399",
};

const EMOTION_KEYS: EmotionKey[] = ["F", "A", "D", "J", "C", "G", "T", "R"];
const DEFAULT_FLOW_KEYS: EmotionKey[] = ["D", "T", "R"];
const MAX_FLOW_KEYS = 4;

const primaryLabels: Array<{ key: keyof PrimaryAxis; label: string }> = [
  { key: "like", label: "호감 like" },
  { key: "dislike", label: "불호 dislike" },
];

const emotionLabels: Array<{ key: EmotionKey; label: string }> = EMOTION_KEYS.map(
  (key) => ({ key, label: `${key} ${EMOTION_LABELS[key]}` })
);

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
  const [screenMode, setScreenMode] = useState<ScreenMode>("chat");
  const [selectedFlowKeys, setSelectedFlowKeys] =
    useState<EmotionKey[]>(DEFAULT_FLOW_KEYS);
  const [showAllWeeklyAverages, setShowAllWeeklyAverages] = useState(false);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0];

  const emotionRecords = useMemo(() => collectEmotionRecords(sessions), [sessions]);

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
    setScreenMode("chat");
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
        setScreenMode("chat");
        return [newSession];
      }

      if (sessionId === activeSessionId) {
        setActiveSessionId(remainingSessions[0].id);
      }

      return remainingSessions;
    });
  };

  const openEmotionFlow = () => {
    setScreenMode("flow");
    setIsDrawerOpen(false);
  };

  const returnToChat = () => {
    setScreenMode("chat");
    setIsDrawerOpen(false);
    scrollToBottom();
  };

  const toggleFlowKey = (key: EmotionKey) => {
    setSelectedFlowKeys((currentKeys) => {
      if (currentKeys.includes(key)) {
        return currentKeys.length === 1
          ? currentKeys
          : currentKeys.filter((currentKey) => currentKey !== key);
      }

      if (currentKeys.length >= MAX_FLOW_KEYS) {
        return currentKeys;
      }

      return [...currentKeys, key];
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
    setScreenMode("chat");
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
            currentMode={screenMode}
            onNewChat={createNewChat}
            onOpenEmotionFlow={openEmotionFlow}
            onSelectSession={(id) => {
              setActiveSessionId(id);
              setScreenMode("chat");
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
              currentMode={screenMode}
              onNewChat={createNewChat}
              onOpenEmotionFlow={openEmotionFlow}
              onSelectSession={(id) => {
                setActiveSessionId(id);
                setScreenMode("chat");
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
                {screenMode === "flow"
                  ? "감정 창고"
                  : `감정 분석 채팅 · ${activeSession?.title ?? "새 채팅"}`}
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

          {screenMode === "flow" ? (
            <EmotionFlowScreen
              records={emotionRecords}
              selectedKeys={selectedFlowKeys}
              showAllWeeklyAverages={showAllWeeklyAverages}
              onToggleKey={toggleFlowKey}
              onToggleWeeklyAverages={() =>
                setShowAllWeeklyAverages((currentValue) => !currentValue)
              }
              onBackToChat={returnToChat}
            />
          ) : (
            <ChatScreen
              activeSession={activeSession}
              inputText={inputText}
              isHydrated={isHydrated}
              isSending={isSending}
              scrollViewRef={scrollViewRef}
              onChangeInputText={setInputText}
              onSendMessage={sendMessage}
              onToggleAdminView={toggleAdminView}
              onContentSizeChange={scrollToBottom}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type SidebarProps = {
  sessions: ChatSession[];
  activeSessionId: string;
  currentMode: ScreenMode;
  onNewChat: () => void;
  onOpenEmotionFlow: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
};

function Sidebar({
  sessions,
  activeSessionId,
  currentMode,
  onNewChat,
  onOpenEmotionFlow,
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

      <TouchableOpacity
        style={[
          styles.flowButton,
          currentMode === "flow" && styles.flowButtonActive,
        ]}
        onPress={onOpenEmotionFlow}
        activeOpacity={0.85}
      >
        <Text
          style={[
            styles.flowButtonText,
            currentMode === "flow" && styles.flowButtonTextActive,
          ]}
        >
          감정 창고
        </Text>
      </TouchableOpacity>

      <Text style={styles.sidebarSectionLabel}>채팅 목록</Text>
      <ScrollView style={styles.sessionList}>
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId && currentMode === "chat";
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

type ChatScreenProps = {
  activeSession?: ChatSession;
  inputText: string;
  isHydrated: boolean;
  isSending: boolean;
  scrollViewRef: React.MutableRefObject<ScrollView | null>;
  onChangeInputText: (text: string) => void;
  onSendMessage: () => void;
  onToggleAdminView: (messageId: string) => void;
  onContentSizeChange: () => void;
};

function ChatScreen({
  activeSession,
  inputText,
  isHydrated,
  isSending,
  scrollViewRef,
  onChangeInputText,
  onSendMessage,
  onToggleAdminView,
  onContentSizeChange,
}: ChatScreenProps) {
  return (
    <>
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={onContentSizeChange}
      >
        {!isHydrated ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#f2f4f8" />
            <Text style={styles.emptyText}>저장된 채팅을 불러오는 중...</Text>
          </View>
        ) : !activeSession || activeSession.messages.length === 0 ? (
          <EmptyChat />
        ) : (
          activeSession.messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              onToggleAdminView={onToggleAdminView}
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
          onChangeText={onChangeInputText}
          multiline
          editable={!isSending && isHydrated}
          returnKeyType="send"
          onSubmitEditing={onSendMessage}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!inputText.trim() || isSending || !isHydrated) &&
              styles.sendButtonDisabled,
          ]}
          onPress={onSendMessage}
          disabled={!inputText.trim() || isSending || !isHydrated}
          activeOpacity={0.85}
        >
          <Text style={styles.sendButtonText}>전송</Text>
        </TouchableOpacity>
      </View>
    </>
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
          {message.showAdminView ? "개발자 정보 숨기기" : "개발자 정보 보기"}
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

type EmotionFlowScreenProps = {
  records: EmotionRecord[];
  selectedKeys: EmotionKey[];
  showAllWeeklyAverages: boolean;
  onToggleKey: (key: EmotionKey) => void;
  onToggleWeeklyAverages: () => void;
  onBackToChat: () => void;
};

function EmotionFlowScreen({
  records,
  selectedKeys,
  showAllWeeklyAverages,
  onToggleKey,
  onToggleWeeklyAverages,
  onBackToChat,
}: EmotionFlowScreenProps) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(300, Math.min(width - 32, 760));
  const recentRecords = records.slice(-10);
  const weeklyAverages = calculateWeeklyAverages(records);
  const visibleWeeklyAverages = showAllWeeklyAverages
    ? weeklyAverages
    : weeklyAverages.slice(0, 3);
  const interpretation = buildEmotionFlowInterpretation(
    recentRecords,
    weeklyAverages
  );

  return (
    <ScrollView
      style={styles.flowScroll}
      contentContainerStyle={styles.flowContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.flowHeaderRow}>
        <View style={styles.flowHeaderTextBlock}>
          <Text style={styles.flowTitle}>감정 창고</Text>
          <Text style={styles.flowSubtitle}>
            로컬에 저장된 최근 감정 분석 기록을 기준으로 보여줍니다.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.backToChatButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.backToChatButtonText}>채팅으로 돌아가기</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.flowCard}>
        <View style={styles.flowCardHeader}>
          <View>
            <Text style={styles.flowCardTitle}>최근 10개 감정 변화</Text>
            <Text style={styles.flowCardHint}>기본 축: D 우울, T 긴장, R 안정</Text>
          </View>
        </View>

        <View style={styles.axisSelector}>
          {EMOTION_KEYS.map((key) => {
            const isSelected = selectedKeys.includes(key);
            const isDisabled = !isSelected && selectedKeys.length >= MAX_FLOW_KEYS;

            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.axisChip,
                  isSelected && {
                    borderColor: EMOTION_COLORS[key],
                    backgroundColor: `${EMOTION_COLORS[key]}22`,
                  },
                  isDisabled && styles.axisChipDisabled,
                ]}
                onPress={() => onToggleKey(key)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.axisChipText,
                    isSelected && { color: "#ffffff" },
                  ]}
                >
                  {key} {EMOTION_LABELS[key]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.axisLimitText}>
          한 번에 최대 {MAX_FLOW_KEYS}개 축까지 선택할 수 있습니다.
        </Text>

        {recentRecords.length < 2 ? (
          <View style={styles.flowEmptyBox}>
            <Text style={styles.flowEmptyText}>
              감정 흐름을 보려면 noie와 조금 더 대화해 주세요.
            </Text>
          </View>
        ) : (
          <LineChart
            records={recentRecords}
            selectedKeys={selectedKeys}
            width={chartWidth}
          />
        )}
      </View>

      <View style={styles.flowCard}>
        <Text style={styles.flowCardTitle}>최근 7일 감정 평균</Text>
        {weeklyAverages.length === 0 ? (
          <View style={styles.flowEmptyBox}>
            <Text style={styles.flowEmptyText}>
              최근 7일 감정 기록이 없습니다. noie와 대화하면 주간 평균이 생성됩니다.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.weeklyBarList}>
              {visibleWeeklyAverages.map((item) => (
                <WeeklyAverageBar key={item.key} item={item} />
              ))}
            </View>
            {weeklyAverages.length > 3 ? (
              <TouchableOpacity
                style={styles.moreButton}
                onPress={onToggleWeeklyAverages}
                activeOpacity={0.85}
              >
                <Text style={styles.moreButtonText}>
                  {showAllWeeklyAverages ? "접기" : "더보기"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.flowCard}>
        <Text style={styles.flowCardTitle}>noie 해석</Text>
        <Text style={styles.interpretationText}>{interpretation}</Text>
      </View>
    </ScrollView>
  );
}

type LineChartProps = {
  records: EmotionRecord[];
  selectedKeys: EmotionKey[];
  width: number;
};

function LineChart({ records, selectedKeys, width }: LineChartProps) {
  const height = 236;
  const paddingLeft = 34;
  const paddingRight = 16;
  const paddingTop = 18;
  const paddingBottom = 34;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  const getX = (index: number) =>
    paddingLeft + (records.length === 1 ? 0 : (innerWidth * index) / (records.length - 1));
  const getY = (value: number) => paddingTop + (1 - clampScore(value)) * innerHeight;

  return (
    <View style={styles.chartWrap}>
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((tick) => {
          const y = getY(tick);
          return (
            <React.Fragment key={tick}>
              <Line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="#2a2a2a"
                strokeWidth="1"
              />
              <SvgText
                x={4}
                y={y + 4}
                fill="#858585"
                fontSize="10"
              >
                {tick.toFixed(1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {records.map((record, index) => {
          const x = getX(index);
          return (
            <React.Fragment key={record.id}>
              <Line
                x1={x}
                y1={paddingTop}
                x2={x}
                y2={paddingTop + innerHeight}
                stroke="#161616"
                strokeWidth="1"
              />
              <SvgText
                x={x}
                y={height - 10}
                fill="#8f8f8f"
                fontSize="10"
                textAnchor="middle"
              >
                {String(index + 1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {selectedKeys.map((key) => {
          const points = records
            .map((record, index) => `${getX(index)},${getY(record.axis[key])}`)
            .join(" ");

          return (
            <React.Fragment key={key}>
              <Polyline
                points={points}
                fill="none"
                stroke={EMOTION_COLORS[key]}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {records.map((record, index) => (
                <Circle
                  key={`${key}-${record.id}`}
                  cx={getX(index)}
                  cy={getY(record.axis[key])}
                  r="4"
                  fill="#050505"
                  stroke={EMOTION_COLORS[key]}
                  strokeWidth="2"
                />
              ))}
            </React.Fragment>
          );
        })}
      </Svg>

      <View style={styles.chartLegend}>
        {selectedKeys.map((key) => (
          <View key={key} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: EMOTION_COLORS[key] },
              ]}
            />
            <Text style={styles.legendText}>
              {key} {EMOTION_LABELS[key]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type WeeklyAverageBarProps = {
  item: WeeklyAverage;
};

function WeeklyAverageBar({ item }: WeeklyAverageBarProps) {
  const percent = Math.round(clampScore(item.value) * 100);

  return (
    <View style={styles.weeklyBarItem}>
      <View style={styles.weeklyBarHeader}>
        <Text style={styles.weeklyBarLabel}>
          {item.key} {item.label}
        </Text>
        <Text style={styles.weeklyBarValue}>{item.value.toFixed(2)}</Text>
      </View>
      <View style={styles.weeklyTrack}>
        <View
          style={[
            styles.weeklyFill,
            {
              width: `${percent}%`,
              backgroundColor: EMOTION_COLORS[item.key],
            },
          ]}
        />
      </View>
    </View>
  );
}

function collectEmotionRecords(sessions: ChatSession[]) {
  const records: EmotionRecord[] = [];

  sessions.forEach((session) => {
    session.messages.forEach((message) => {
      if (message.role !== "assistant") {
        return;
      }

      const axis = message.analysis?.admin_view?.emotion_axis;
      if (!axis || !hasValidEmotionAxis(axis)) {
        return;
      }

      const timestamp = Date.parse(message.createdAt);
      if (!Number.isFinite(timestamp)) {
        return;
      }

      records.push({
        id: message.id,
        sessionTitle: session.title,
        createdAt: message.createdAt,
        timestamp,
        axis: normalizeEmotionAxis(axis),
      });
    });
  });

  return records.sort((left, right) => left.timestamp - right.timestamp);
}

function calculateWeeklyAverages(records: EmotionRecord[]) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weeklyRecords = records.filter(
    (record) => record.timestamp >= sevenDaysAgo && record.timestamp <= now
  );

  if (weeklyRecords.length === 0) {
    return [];
  }

  return EMOTION_KEYS.map((key) => {
    const total = weeklyRecords.reduce(
      (sum, record) => sum + clampScore(record.axis[key]),
      0
    );

    return {
      key,
      label: EMOTION_LABELS[key],
      value: total / weeklyRecords.length,
    };
  }).sort((left, right) => right.value - left.value);
}

function buildEmotionFlowInterpretation(
  recentRecords: EmotionRecord[],
  weeklyAverages: WeeklyAverage[]
) {
  if (recentRecords.length < 2 && weeklyAverages.length === 0) {
    return "최근 감정 흐름은 아직 뚜렷하지 않습니다.";
  }

  const parts: string[] = [];
  const topWeekly = weeklyAverages[0];

  if (topWeekly) {
    parts.push(
      `최근 7일 평균에서는 ${topWeekly.label}이 가장 높게 나타났습니다.`
    );
  } else {
    parts.push("최근 7일 기록이 아직 충분하지 않아 뚜렷한 평균을 판단하기 어렵습니다.");
  }

  if (recentRecords.length >= 2) {
    const first = recentRecords[0];
    const last = recentRecords[recentRecords.length - 1];
    const tensionTrend = last.axis.T - first.axis.T;
    const stabilityTrend = last.axis.R - first.axis.R;
    const depressionTrend = last.axis.D - first.axis.D;

    if (stabilityTrend > 0.12 && tensionTrend < 0.08) {
      parts.push("흐름상 안정감은 조금 회복되는 중입니다.");
    } else if (stabilityTrend < -0.12) {
      parts.push("흐름상 안정감은 조금 낮아지는 중입니다.");
    } else if (tensionTrend > 0.12 || depressionTrend > 0.12) {
      parts.push("최근 대화에서는 긴장이나 우울이 올라가는 흐름이 보입니다.");
    } else {
      parts.push("최근 흐름은 큰 급변보다 완만한 변화에 가깝습니다.");
    }
  }

  return parts.join(" ");
}

function hasValidEmotionAxis(axis: Partial<Record<EmotionKey, unknown>>) {
  return EMOTION_KEYS.every((key) => {
    const value = axis[key];
    return typeof value === "number" && Number.isFinite(value);
  });
}

function normalizeEmotionAxis(axis: Record<EmotionKey, number>) {
  return EMOTION_KEYS.reduce((result, key) => {
    result[key] = clampScore(axis[key]);
    return result;
  }, {} as NumericEmotionAxis);
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
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
  if (Number.isNaN(date.getTime())) {
    return "방금";
  }

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
  flowButton: {
    alignItems: "center",
    backgroundColor: "#171717",
    borderColor: "#2c2c2c",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  flowButtonActive: {
    backgroundColor: "#2a2b32",
    borderColor: "#50515f",
  },
  flowButtonText: {
    color: "#d8d8d8",
    fontSize: 14,
    fontWeight: "800",
  },
  flowButtonTextActive: { color: "#ffffff" },
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
  metricLabel: {
    color: "#a9a9a9",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 5,
  },
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
  flowScroll: { flex: 1 },
  flowContent: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingBottom: 34,
  },
  flowHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 14,
  },
  flowHeaderTextBlock: { flex: 1, minWidth: 210 },
  flowTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 6,
  },
  flowSubtitle: { color: "#9ca3af", fontSize: 14, lineHeight: 20 },
  backToChatButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  backToChatButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
  },
  flowCard: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  flowCardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  flowCardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  flowCardHint: { color: "#8f8f8f", fontSize: 12, lineHeight: 18 },
  axisSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  axisChip: {
    backgroundColor: "#1c1c1c",
    borderColor: "#303030",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  axisChipDisabled: { opacity: 0.42 },
  axisChipText: { color: "#b8b8b8", fontSize: 12, fontWeight: "800" },
  axisLimitText: {
    color: "#777777",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  flowEmptyBox: {
    alignItems: "center",
    backgroundColor: "#0b0b0b",
    borderColor: "#242424",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 120,
    padding: 18,
  },
  flowEmptyText: {
    color: "#b8b8b8",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  chartWrap: {
    alignItems: "center",
    backgroundColor: "#0a0a0a",
    borderColor: "#242424",
    borderRadius: 8,
    borderWidth: 1,
    paddingTop: 8,
  },
  chartLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    paddingBottom: 12,
    paddingHorizontal: 10,
  },
  legendItem: { alignItems: "center", flexDirection: "row", gap: 6 },
  legendDot: { borderRadius: 999, height: 8, width: 8 },
  legendText: { color: "#d1d5db", fontSize: 12, fontWeight: "700" },
  weeklyBarList: { gap: 12, marginTop: 8 },
  weeklyBarItem: { gap: 7 },
  weeklyBarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  weeklyBarLabel: { color: "#eeeeee", fontSize: 14, fontWeight: "800" },
  weeklyBarValue: { color: "#a9a9a9", fontSize: 13, fontWeight: "800" },
  weeklyTrack: {
    backgroundColor: "#242424",
    borderRadius: 999,
    height: 10,
    overflow: "hidden",
  },
  weeklyFill: { borderRadius: 999, height: 10 },
  moreButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 38,
  },
  moreButtonText: { color: "#d8d8d8", fontSize: 13, fontWeight: "900" },
  interpretationText: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 23,
  },
});
