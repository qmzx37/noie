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
const DAILY_TRACES_STORAGE_KEY = "noie_daily_traces_v1";
const DREAM_TORCH_ID_STORAGE_KEY = "noie_dream_torch_id_v1";
const PROJECTS_STORAGE_KEY = "noie_projects_v1";
const PROJECT_MESSAGES_STORAGE_KEY = "noie_project_messages_v1";

type EmotionLevel = "Low" | "Mid" | "High";
type AnalysisSource = "openai" | "rule_based";
type ScreenMode =
  | "chat"
  | "dreamVault"
  | "flow"
  | "dailyTrace"
  | "project"
  | "projectCreate";
type DailyTraceItemType = "schedule" | "record" | "todo" | "quote" | "goal";
type DreamRole = "torch" | "fragment";
type DailyTraceStatus = "pending" | "added" | "dismissed" | "duplicate";

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

type SaveDecision = {
  memoryType: MemorySavePolicyType;
  savePolicy: "ask" | "auto" | "none";
  saveTargets: Array<"daily_piece" | "daily_trace" | "dream_piece" | "dream_torch" | "dream_fragment">;
  importance: number;
  displayCategory: string;
  reason: string;
  askText?: string | null;
  confidence?: number;
  intentCategory?:
    | "identity_goal"
    | "future_dream"
    | "action_todo"
    | "scheduled_event"
    | "completed_achievement"
    | "sensitive_negative_event"
    | "relationship_positive"
    | "daily_note"
    | "casual_none";
  eventTense?: "future" | "present" | "past" | "unknown";
  userActionRequired?: boolean;
  uiType?:
    | "dream_confirm"
    | "trace_confirm"
    | "sensitive_confirm"
    | "auto_saved"
    | "none";
  subjectScope?: "self" | "other_person" | "shared" | "unknown";
  selfRelevance?: "direct" | "indirect" | "none" | "explicit_store_request" | "unknown";
  shouldStore?: boolean;
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
    emotion_axis: NumericEmotionAxis;
  };
  source: AnalysisSource;
  save_decision?: SaveDecision;
  emotionOwner?: "user" | "other_person" | "unknown";
  analysisPerspective?:
    | "self_emotion"
    | "observed_other_info"
    | "shared_event"
    | "neutral_info";
  subjectScope?: "self" | "other_person" | "shared" | "unknown";
  selfRelevance?: "direct" | "indirect" | "none" | "explicit_store_request" | "unknown";
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

type DailyTraceCandidate = {
  type: DailyTraceItemType;
  date: string;
  title: string;
  memo?: string;
  time?: string | null;
  targetDate?: string | null;
  targetYear?: string | null;
  targetText?: string | null;
};

type ExtractDailyTraceResponse = {
  has_trace: boolean;
  type?: DailyTraceItemType | null;
  date?: string | null;
  time?: string | null;
  title?: string | null;
  memo?: string | null;
  targetDate?: string | null;
  targetYear?: string | null;
  targetText?: string | null;
};

type DailyTraceItem = {
  id: string;
  type: DailyTraceItemType;
  date: string;
  title: string;
  memo?: string;
  time?: string;
  targetDate?: string;
  targetYear?: string;
  targetText?: string;
  sourceText?: string;
  sourceMessageId?: string;
  isDone?: boolean;
  memoryType?: MemorySavePolicyType;
  saveTargets?: SaveDecision["saveTargets"];
  importance?: number;
  displayCategory?: string;
  hiddenFromDream?: boolean;
  dreamRole?: DreamRole;
  pinnedAsDreamTorch?: boolean;
  createdAt: string;
  updatedAt?: string;
};

type NoieMemory = DailyTraceItem;

type MemorySavePolicyType =
  | "sensitive_event"
  | "achievement"
  | "relationship"
  | "dream"
  | "goal"
  | "project"
  | "idea"
  | "schedule"
  | "todo"
  | "task"
  | "daily_plan"
  | "note"
  | "important_note"
  | "daily_context"
  | "none";

type MemorySavePolicy = {
  type: MemorySavePolicyType;
  shouldSave: boolean;
  requiresConfirmation: boolean;
  importance: number;
  label: string;
  saveTargets?: SaveDecision["saveTargets"];
  dreamRole?: DreamRole;
};

type DreamSavePromptKind = "torch_first" | "fragment_first";

type EmotionSignals = Partial<Record<EmotionKey, EmotionLevel | number>>;

type DailyPiece = DailyTraceItem & {
  memoryPolicy: MemorySavePolicy;
};

type DailyPieceGroup = {
  date: string;
  label: string;
  pieces: DailyPiece[];
};

type SaveNoieMemoryResult = {
  items: DailyTraceItem[];
  saved: boolean;
  duplicate: boolean;
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
  dailyTraceCandidate?: DailyTraceCandidate;
  dailyTraceStatus?: DailyTraceStatus;
  dailyTraceNotice?: string;
  dailyMemoryPolicy?: MemorySavePolicy;
  dreamSavePromptKind?: DreamSavePromptKind;
  createdAt: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type ProjectEmotionAdminView = {
  like?: number;
  dislike?: number;
  F?: number;
  A?: number;
  D?: number;
  J?: number;
  C?: number;
  G?: number;
  T?: number;
  R?: number;
};

type NoieProject = {
  id: string;
  title: string;
  goal: string;
  deadline?: string;
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
};

type NoieProjectMessage = {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  emotionAdminView?: ProjectEmotionAdminView;
  stateSummary?: string;
  source?: string;
  isLoading?: boolean;
  error?: string;
};

type ProjectFormState = {
  title: string;
  goal: string;
  deadline: string;
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

const TRACE_TYPE_LABELS: Record<DailyTraceItemType, string> = {
  schedule: "일정",
  record: "오늘의 기록",
  todo: "할 일",
  quote: "남긴 말",
  goal: "장기 목표",
};

const TRACE_CONFIRM_LABELS: Record<DailyTraceItemType, string> = {
  schedule: "일정 추가",
  record: "기록 추가",
  todo: "할 일 추가",
  quote: "남긴 말 추가",
  goal: "목표 추가",
};

const TRACE_QUESTION_LABELS: Record<DailyTraceItemType, string> = {
  schedule: "일정으로 추가할까요?",
  record: "오늘의 기록으로 남길까요?",
  todo: "할 일로 추가할까요?",
  quote: "남긴 말로 저장할까요?",
  goal: "장기 목표로 남길까요?",
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
  const [dailyTraces, setDailyTraces] = useState<DailyTraceItem[]>([]);
  const [dreamTorchId, setDreamTorchId] = useState<string | null>(null);
  const [projects, setProjects] = useState<NoieProject[]>([]);
  const [projectMessages, setProjectMessages] = useState<NoieProjectMessage[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectInputText, setProjectInputText] = useState("");
  const [isProjectSending, setIsProjectSending] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectFormState>({
    title: "",
    goal: "",
    deadline: "",
  });
  const [selectedTraceDate, setSelectedTraceDate] = useState(
    getLocalDateString(new Date())
  );
  const [calendarMonth, setCalendarMonth] = useState(
    getMonthStart(new Date())
  );
  const [dailyTraceCleanupMessage, setDailyTraceCleanupMessage] = useState("");
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
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;
  const activeProjectMessages = useMemo(
    () =>
      activeProjectId
        ? projectMessages.filter((message) => message.projectId === activeProjectId)
        : [],
    [activeProjectId, projectMessages]
  );

  const emotionRecords = useMemo(() => collectEmotionRecords(sessions), [sessions]);

  useEffect(() => {
    loadSavedData();
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
    AsyncStorage.setItem(DAILY_TRACES_STORAGE_KEY, JSON.stringify(dailyTraces)).catch(
      (error) => console.log("[noie] 하루의 흔적 저장 실패", error)
    );
    if (dreamTorchId) {
      AsyncStorage.setItem(DREAM_TORCH_ID_STORAGE_KEY, dreamTorchId).catch(
        (error) => console.log("[noie] dream torch save failed", error)
      );
    } else {
      AsyncStorage.removeItem(DREAM_TORCH_ID_STORAGE_KEY).catch((error) =>
        console.log("[noie] dream torch clear failed", error)
      );
    }
    AsyncStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects)).catch(
      (error) => console.log("[noie] 프로젝트 저장 실패", error)
    );
    AsyncStorage.setItem(
      PROJECT_MESSAGES_STORAGE_KEY,
      JSON.stringify(projectMessages)
    ).catch((error) => console.log("[noie] 프로젝트 메시지 저장 실패", error));
  }, [
    activeSessionId,
    dailyTraces,
    dreamTorchId,
    isHydrated,
    projectMessages,
    projects,
    sessions,
  ]);

  const loadSavedData = async () => {
    try {
      const [
        savedSessions,
        savedCurrentChatId,
        savedDailyTraces,
        savedDreamTorchId,
        savedProjects,
        savedProjectMessages,
      ] =
        await Promise.all([
          AsyncStorage.getItem(SESSIONS_STORAGE_KEY),
          AsyncStorage.getItem(CURRENT_CHAT_ID_STORAGE_KEY),
          AsyncStorage.getItem(DAILY_TRACES_STORAGE_KEY),
          AsyncStorage.getItem(DREAM_TORCH_ID_STORAGE_KEY),
          AsyncStorage.getItem(PROJECTS_STORAGE_KEY),
          AsyncStorage.getItem(PROJECT_MESSAGES_STORAGE_KEY),
        ]);
      const parsedSessions = savedSessions
        ? (JSON.parse(savedSessions) as ChatSession[])
        : [];
      const parsedDailyTraces = savedDailyTraces
        ? (JSON.parse(savedDailyTraces) as DailyTraceItem[])
        : [];
      const parsedProjects = savedProjects
        ? (JSON.parse(savedProjects) as NoieProject[])
        : [];
      const parsedProjectMessages = savedProjectMessages
        ? (JSON.parse(savedProjectMessages) as NoieProjectMessage[])
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

      if (Array.isArray(parsedDailyTraces)) {
        const dedupedDailyTraces = dedupeMemories(parsedDailyTraces);
        setDailyTraces(dedupedDailyTraces);
        if (dedupedDailyTraces.length !== parsedDailyTraces.length) {
          AsyncStorage.setItem(
            DAILY_TRACES_STORAGE_KEY,
            JSON.stringify(dedupedDailyTraces)
          ).catch((error) => console.log("[noie] 하루의 흔적 중복 정리 실패", error));
        }
      }
      setDreamTorchId(savedDreamTorchId || null);
      if (Array.isArray(parsedProjects)) {
        setProjects(parsedProjects);
      }
      if (Array.isArray(parsedProjectMessages)) {
        setProjectMessages(parsedProjectMessages);
      }
    } catch (error) {
      const newSession = createEmptySession();
      setSessions([newSession]);
      setActiveSessionId(newSession.id);
      setDailyTraces([]);
      setDreamTorchId(null);
      setProjects([]);
      setProjectMessages([]);
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

  const openDreamVault = () => {
    setScreenMode("dreamVault");
    setIsDrawerOpen(false);
  };

  const openDailyTrace = () => {
    setScreenMode("dailyTrace");
    setIsDrawerOpen(false);
  };

  const openProjectCreate = () => {
    setProjectForm({ title: "", goal: "", deadline: "" });
    setScreenMode("projectCreate");
    setIsDrawerOpen(false);
  };

  const openProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setScreenMode("project");
    setProjectInputText("");
    setIsDrawerOpen(false);
  };

  const createProject = () => {
    const title = projectForm.title.trim();
    const goal = projectForm.goal.trim();
    const deadline = normalizeDeadlineInput(projectForm.deadline);

    if (!title || !goal) {
      return;
    }

    const now = new Date().toISOString();
    const newProject: NoieProject = {
      id: createId("project"),
      title,
      goal,
      deadline: deadline || undefined,
      createdAt: now,
      updatedAt: now,
    };

    setProjects((currentProjects) => [newProject, ...currentProjects]);
    setActiveProjectId(newProject.id);
    setProjectForm({ title: "", goal: "", deadline: "" });
    setScreenMode("project");
  };

  const updateProject = (
    projectId: string,
    values: Pick<NoieProject, "title" | "goal"> & { deadline?: string }
  ) => {
    const title = values.title.trim();
    const goal = values.goal.trim();
    const deadline = normalizeDeadlineInput(values.deadline ?? "");

    if (!title || !goal) {
      return;
    }

    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              title,
              goal,
              deadline: deadline || undefined,
              updatedAt: new Date().toISOString(),
            }
          : project
      )
    );
  };

  const archiveProject = (projectId: string) => {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === projectId
          ? { ...project, isArchived: true, updatedAt: new Date().toISOString() }
          : project
      )
    );

    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setScreenMode("chat");
    }
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
      const [chatData, traceCandidate] = await Promise.all([
        requestChatReply(trimmedText, activeSession.messages),
        extractDailyTraceCandidate(trimmedText),
      ]);
      const saveDecision = chatData.analysis.save_decision;
      const baseMemoryPolicy = saveDecision
        ? buildMemorySavePolicyFromDecision(saveDecision)
        : classifyMemorySavePolicy(
            trimmedText,
            chatData.analysis.user_view.emotion_axis,
            traceCandidate ?? undefined
          );
      const memoryPolicy = adjustMemoryPolicyForText(
        baseMemoryPolicy,
        trimmedText
      );
      const resolvedTraceCandidate = resolveDailyTraceCandidate(
        trimmedText,
        traceCandidate,
        memoryPolicy
      );
      let dailyTraceStatus: DailyTraceStatus | undefined;
      let dailyTraceNotice: string | undefined;

      if (
        resolvedTraceCandidate &&
        memoryPolicy.shouldSave &&
        memoryPolicy.type !== "none"
      ) {
        if (memoryPolicy.requiresConfirmation) {
          dailyTraceStatus = "pending";
          dailyTraceNotice = getPendingMemoryNotice(memoryPolicy);
        } else if (saveDecision?.savePolicy !== "none") {
          const autoSavedItem = buildDailyTraceItem(
            resolvedTraceCandidate,
            trimmedText,
            assistantMessageId,
            now,
            memoryPolicy
          );
          const saveResult = saveNoieMemory(
            dailyTraces,
            autoSavedItem,
            trimmedText,
            { shouldLog: false }
          );

          setDailyTraces((currentItems) =>
            saveNoieMemory(currentItems, autoSavedItem, trimmedText).items
          );

          dailyTraceStatus = saveResult.duplicate ? "duplicate" : "added";
          dailyTraceNotice = saveResult.duplicate
            ? getDuplicateMemoryNotice(memoryPolicy)
            : getAutoSavedMemoryNotice(memoryPolicy.type);
        }
      }

      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                role: "assistant",
                text: chatData.reply,
                reply: chatData.reply,
                stateSummary:
                  chatData.state_summary ||
                  chatData.analysis.user_view.state_summary,
                analysis: chatData.analysis,
                dailyTraceCandidate: resolvedTraceCandidate ?? undefined,
                dailyTraceStatus,
                dailyTraceNotice,
                dailyMemoryPolicy: memoryPolicy,
                dreamSavePromptKind: isDreamOrGoalType(memoryPolicy.type)
                  ? getDreamSavePromptKind(trimmedText)
                  : undefined,
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

  const sendProjectMessage = async () => {
    const trimmedText = projectInputText.trim();
    if (!trimmedText || isProjectSending || !activeProject) {
      return;
    }

    const projectId = activeProject.id;
    const now = new Date().toISOString();
    const assistantMessageId = createId("project-assistant");
    const previousMessages = projectMessages.filter(
      (message) => message.projectId === projectId && !message.isLoading && !message.error
    );

    const userMessage: NoieProjectMessage = {
      id: createId("project-user"),
      projectId,
      role: "user",
      content: trimmedText,
      createdAt: now,
    };
    const loadingMessage: NoieProjectMessage = {
      id: assistantMessageId,
      projectId,
      role: "assistant",
      content: "noie가 작업 흐름을 정리하는 중...",
      isLoading: true,
      createdAt: now,
    };

    setProjectMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      loadingMessage,
    ]);
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.id === projectId ? { ...project, updatedAt: now } : project
      )
    );
    setProjectInputText("");
    setIsProjectSending(true);

    try {
      const data = await requestProjectChatReply(
        trimmedText,
        previousMessages,
        activeProject
      );
      setProjectMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                projectId,
                role: "assistant",
                content: data.reply,
                emotionAdminView: flattenEmotionAdminView(data.analysis),
                stateSummary:
                  data.state_summary || data.analysis.user_view.state_summary,
                source: data.source,
                createdAt: message.createdAt,
              }
            : message
        )
      );
      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.id === projectId
            ? { ...project, updatedAt: new Date().toISOString() }
            : project
        )
      );
    } catch (error) {
      setProjectMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                projectId,
                role: "assistant",
                content: "프로젝트 응답 생성에 실패했습니다. 백엔드 서버를 확인해주세요.",
                error: "프로젝트 응답 생성에 실패했습니다. 백엔드 서버를 확인해주세요.",
                createdAt: message.createdAt,
              }
            : message
        )
      );
    } finally {
      setIsProjectSending(false);
    }
  };

  const requestProjectChatReply = async (
    text: string,
    messages: NoieProjectMessage[],
    project: NoieProject
  ) => {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        messages: toProjectChatHistory(messages),
        is_project: true,
        project_name: project.title,
        project_goal: project.goal,
      }),
    });

    if (!response.ok) {
      throw new Error(`프로젝트 API 응답 오류: ${response.status}`);
    }

    return (await response.json()) as ChatApiResponse;
  };

  const requestChatReply = async (text: string, messages: ChatMessage[]) => {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        messages: toChatHistory(messages),
      }),
    });

    if (!response.ok) {
      throw new Error(`API 응답 오류: ${response.status}`);
    }

    return (await response.json()) as ChatApiResponse;
  };

  const extractDailyTraceCandidate = async (text: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/extract-daily-trace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          current_date: getLocalDateString(new Date()),
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as ExtractDailyTraceResponse;
      if (
        !data.has_trace ||
        !data.type ||
        !data.date ||
        !data.title ||
        !isDailyTraceType(data.type)
      ) {
        return null;
      }

      return {
        type: data.type,
        date: data.date,
        time: data.time ?? undefined,
        title: data.title,
        memo: data.memo ?? text,
        targetDate: data.targetDate ?? undefined,
        targetYear: data.targetYear ?? undefined,
        targetText: data.targetText ?? undefined,
      } satisfies DailyTraceCandidate;
    } catch (error) {
      return null;
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

  const confirmDailyTrace = (messageId: string, dreamRole?: DreamRole) => {
    if (!activeSession) {
      return;
    }

    const message = activeSession.messages.find((item) => item.id === messageId);
    const candidate = message?.dailyTraceCandidate;
    if (!candidate || message.dailyTraceStatus === "added") {
      return;
    }

    const now = new Date().toISOString();
    const sourceUserMessage = findPreviousUserMessage(activeSession.messages, messageId);
    const memoryInput = getMemoryInputText({
      title: candidate.title,
      memo: candidate.memo,
      sourceText: sourceUserMessage?.text,
    });
    const selectedMemoryPolicy: MemorySavePolicy | undefined = message.dailyMemoryPolicy
      ? {
          ...message.dailyMemoryPolicy,
          dreamRole: dreamRole ?? message.dailyMemoryPolicy.dreamRole,
          saveTargets:
            dreamRole === "torch"
              ? ["dream_piece", "dream_torch"]
              : dreamRole === "fragment"
              ? ["dream_piece", "dream_fragment"]
              : message.dailyMemoryPolicy.saveTargets,
        }
      : undefined;
    const newItem = buildDailyTraceItem(
      candidate,
      sourceUserMessage?.text ?? memoryInput,
      messageId,
      now,
      selectedMemoryPolicy
    );
    const saveResult = saveNoieMemory(dailyTraces, newItem, memoryInput, {
      shouldLog: false,
    });
    const memoryPolicy = selectedMemoryPolicy ?? getMemoryPolicy(newItem);
    setDailyTraces((currentItems) => {
      return saveNoieMemory(currentItems, newItem, memoryInput).items;
    });

    updateSession(activeSession.id, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === messageId
          ? {
              ...item,
              dailyTraceStatus: saveResult.duplicate ? "duplicate" : "added",
              dailyTraceNotice: saveResult.duplicate
                ? getDuplicateMemoryNotice(memoryPolicy)
                : getSavedMemoryNotice(memoryPolicy),
            }
          : item
      ),
      updatedAt: now,
    }));

    setSelectedTraceDate(candidate.date);
    setCalendarMonth(getMonthStart(new Date(`${candidate.date}T00:00:00`)));
  };

  const dismissDailyTrace = (messageId: string) => {
    if (!activeSession) {
      return;
    }

    updateSession(activeSession.id, (session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              dailyTraceStatus: "dismissed",
              dailyTraceNotice: "저장하지 않았어요.",
            }
          : message
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const cleanupDuplicateMemories = async () => {
    try {
      const savedDailyTraces = await AsyncStorage.getItem(DAILY_TRACES_STORAGE_KEY);
      const parsedDailyTraces = savedDailyTraces
        ? (JSON.parse(savedDailyTraces) as DailyTraceItem[])
        : dailyTraces;
      const sourceMemories = Array.isArray(parsedDailyTraces)
        ? parsedDailyTraces
        : dailyTraces;
      const dedupedMemories = dedupeMemories(sourceMemories);

      await AsyncStorage.setItem(
        DAILY_TRACES_STORAGE_KEY,
        JSON.stringify(dedupedMemories)
      );
      setDailyTraces(dedupedMemories);
      setDailyTraceCleanupMessage("중복 기록을 정리했어요.");
    } catch (error) {
      console.log("[noie] 중복 기록 정리 실패", error);
      setDailyTraceCleanupMessage("중복 기록 정리에 실패했어요.");
    }
  };

  const toggleDailyTraceDone = (itemId: string) => {
    setDailyTraces((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId && item.type === "todo"
          ? {
              ...item,
              isDone: !item.isDone,
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  };

  const pinDreamTorch = (itemId: string) => {
    setDreamTorchId(itemId);
    setDailyTraces((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              dreamRole: "torch",
              pinnedAsDreamTorch: true,
              hiddenFromDream: false,
              updatedAt: new Date().toISOString(),
            }
          : item.pinnedAsDreamTorch
          ? { ...item, pinnedAsDreamTorch: false, updatedAt: new Date().toISOString() }
          : item
      )
    );
  };

  const hideFromDreamVault = (itemId: string) => {
    setDailyTraces((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? { ...item, hiddenFromDream: true, updatedAt: new Date().toISOString() }
          : item
      )
    );

    if (dreamTorchId === itemId) {
      setDreamTorchId(null);
    }
  };

  const deleteDailyTraceGoal = (itemId: string) => {
    setDailyTraces((currentItems) =>
      currentItems.filter(
        (item) => !(item.id === itemId && item.type === "goal")
      )
    );
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
            projects={projects}
            activeSessionId={activeSessionId}
            activeProjectId={activeProjectId}
            currentMode={screenMode}
            onNewChat={createNewChat}
            onOpenDreamVault={openDreamVault}
            onOpenEmotionFlow={openEmotionFlow}
            onOpenDailyTrace={openDailyTrace}
            onCreateProject={openProjectCreate}
            onSelectProject={openProject}
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
              projects={projects}
              activeSessionId={activeSessionId}
              activeProjectId={activeProjectId}
              currentMode={screenMode}
              onNewChat={createNewChat}
              onOpenDreamVault={openDreamVault}
              onOpenEmotionFlow={openEmotionFlow}
              onOpenDailyTrace={openDailyTrace}
              onCreateProject={openProjectCreate}
              onSelectProject={openProject}
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
                {screenMode === "dreamVault"
                  ? "꿈의 조각"
                  : screenMode === "flow"
                  ? "감정 흐름 보기"
                  : screenMode === "dailyTrace"
                  ? "하루의 흔적"
                  : screenMode === "projectCreate"
                  ? "새 프로젝트"
                  : screenMode === "project"
                  ? activeProject?.title ?? "프로젝트"
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

          {screenMode === "dreamVault" ? (
            <DreamVaultScreen
              dailyTraces={dailyTraces}
              dreamTorchId={dreamTorchId}
              onPinDreamTorch={pinDreamTorch}
              onHideFromDream={hideFromDreamVault}
              onBackToChat={returnToChat}
            />
          ) : screenMode === "flow" ? (
            <EmotionVaultScreen
              records={emotionRecords}
              dailyTraces={dailyTraces}
              selectedKeys={selectedFlowKeys}
              showAllWeeklyAverages={showAllWeeklyAverages}
              onToggleKey={toggleFlowKey}
              onToggleWeeklyAverages={() =>
                setShowAllWeeklyAverages((currentValue) => !currentValue)
              }
              onBackToChat={returnToChat}
            />
          ) : screenMode === "dailyTrace" ? (
            <DailyTraceScreen
              dailyTraces={dailyTraces}
              selectedTraceDate={selectedTraceDate}
              calendarMonth={calendarMonth}
              onSelectTraceDate={setSelectedTraceDate}
              onChangeCalendarMonth={setCalendarMonth}
              onToggleDailyTraceDone={toggleDailyTraceDone}
              onDeleteDailyTraceGoal={deleteDailyTraceGoal}
              onCleanupDuplicateMemories={cleanupDuplicateMemories}
              cleanupMessage={dailyTraceCleanupMessage}
              onBackToChat={returnToChat}
            />
          ) : screenMode === "projectCreate" ? (
            <ProjectCreateScreen
              form={projectForm}
              onChangeForm={setProjectForm}
              onCreateProject={createProject}
              onBackToChat={returnToChat}
            />
          ) : screenMode === "project" && activeProject ? (
            <ProjectScreen
              project={activeProject}
              messages={activeProjectMessages}
              inputText={projectInputText}
              isSending={isProjectSending}
              onChangeInputText={setProjectInputText}
              onSendMessage={sendProjectMessage}
              onUpdateProject={updateProject}
              onArchiveProject={archiveProject}
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
              onConfirmDailyTrace={confirmDailyTrace}
              onDismissDailyTrace={dismissDailyTrace}
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
  projects: NoieProject[];
  activeSessionId: string;
  activeProjectId: string | null;
  currentMode: ScreenMode;
  onNewChat: () => void;
  onOpenDreamVault: () => void;
  onOpenEmotionFlow: () => void;
  onOpenDailyTrace: () => void;
  onCreateProject: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
};

function Sidebar({
  sessions,
  projects,
  activeSessionId,
  activeProjectId,
  currentMode,
  onNewChat,
  onOpenDreamVault,
  onOpenEmotionFlow,
  onOpenDailyTrace,
  onCreateProject,
  onSelectProject,
  onSelectSession,
  onDeleteSession,
}: SidebarProps) {
  const activeProjects = projects.filter((project) => !project.isArchived);

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
          currentMode === "dreamVault" && styles.flowButtonActive,
        ]}
        onPress={onOpenDreamVault}
        activeOpacity={0.85}
      >
        <Text
          style={[
            styles.flowButtonText,
            currentMode === "dreamVault" && styles.flowButtonTextActive,
          ]}
        >
          꿈의 조각
        </Text>
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

      <TouchableOpacity
        style={[
          styles.flowButton,
          currentMode === "dailyTrace" && styles.flowButtonActive,
        ]}
        onPress={onOpenDailyTrace}
        activeOpacity={0.85}
      >
        <Text
          style={[
            styles.flowButtonText,
            currentMode === "dailyTrace" && styles.flowButtonTextActive,
          ]}
        >
          하루의 흔적
        </Text>
      </TouchableOpacity>

      <ScrollView style={styles.sessionList}>
        <Text style={styles.sidebarSectionLabel}>프로젝트</Text>
        <TouchableOpacity
          style={styles.projectCreateButton}
          onPress={onCreateProject}
          activeOpacity={0.85}
        >
          <Text style={styles.projectCreateButtonText}>+ 새 프로젝트</Text>
        </TouchableOpacity>
        {activeProjects.map((project) => {
          const isActive =
            project.id === activeProjectId && currentMode === "project";
          const dDay = formatDDay(project.deadline);

          return (
            <TouchableOpacity
              key={project.id}
              style={[
                styles.projectItem,
                isActive && styles.projectItemActive,
              ]}
              onPress={() => onSelectProject(project.id)}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.projectItemTitle,
                  isActive && styles.projectItemTitleActive,
                ]}
                numberOfLines={1}
              >
                {project.title}
              </Text>
              {dDay ? <Text style={styles.projectDday}>{dDay}</Text> : null}
            </TouchableOpacity>
          );
        })}

        <Text style={styles.sidebarSectionLabel}>채팅 목록</Text>
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
  onConfirmDailyTrace: (messageId: string) => void;
  onDismissDailyTrace: (messageId: string) => void;
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
  onConfirmDailyTrace,
  onDismissDailyTrace,
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
              onConfirmDailyTrace={onConfirmDailyTrace}
              onDismissDailyTrace={onDismissDailyTrace}
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

function ProjectCreateScreen({
  form,
  onChangeForm,
  onCreateProject,
  onBackToChat,
}: {
  form: ProjectFormState;
  onChangeForm: (form: ProjectFormState) => void;
  onCreateProject: () => void;
  onBackToChat: () => void;
}) {
  const canCreate = form.title.trim().length > 0 && form.goal.trim().length > 0;

  return (
    <ScrollView
      style={styles.projectScroll}
      contentContainerStyle={styles.projectContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.projectHeaderRow}>
        <View style={styles.projectHeaderTextBlock}>
          <Text style={styles.projectTitle}>새 프로젝트</Text>
          <Text style={styles.projectSubtitle}>
            목표와 마감일이 있는 집중 작업 공간을 만듭니다.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.projectSecondaryButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.projectSecondaryButtonText}>채팅으로 돌아가기</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.projectPanel}>
        <Text style={styles.projectFieldLabel}>프로젝트 이름</Text>
        <TextInput
          style={styles.projectInput}
          placeholder="예: noie 개발"
          placeholderTextColor="#7d7d7d"
          value={form.title}
          onChangeText={(title) => onChangeForm({ ...form, title })}
        />

        <Text style={styles.projectFieldLabel}>목표</Text>
        <TextInput
          style={[styles.projectInput, styles.projectTextArea]}
          placeholder="예: 개인 AI MVP 완성"
          placeholderTextColor="#7d7d7d"
          value={form.goal}
          onChangeText={(goal) => onChangeForm({ ...form, goal })}
          multiline
        />

        <Text style={styles.projectFieldLabel}>마감일</Text>
        <TextInput
          style={styles.projectInput}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#7d7d7d"
          value={form.deadline}
          onChangeText={(deadline) => onChangeForm({ ...form, deadline })}
        />

        <TouchableOpacity
          style={[
            styles.projectPrimaryButton,
            !canCreate && styles.sendButtonDisabled,
          ]}
          onPress={onCreateProject}
          disabled={!canCreate}
          activeOpacity={0.85}
        >
          <Text style={styles.projectPrimaryButtonText}>프로젝트 만들기</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function ProjectScreen({
  project,
  messages,
  inputText,
  isSending,
  onChangeInputText,
  onSendMessage,
  onUpdateProject,
  onArchiveProject,
  onBackToChat,
}: {
  project: NoieProject;
  messages: NoieProjectMessage[];
  inputText: string;
  isSending: boolean;
  onChangeInputText: (text: string) => void;
  onSendMessage: () => void;
  onUpdateProject: (
    projectId: string,
    values: Pick<NoieProject, "title" | "goal"> & { deadline?: string }
  ) => void;
  onArchiveProject: (projectId: string) => void;
  onBackToChat: () => void;
}) {
  const scrollViewRef = useRef<ScrollView | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormState>({
    title: project.title,
    goal: project.goal,
    deadline: project.deadline ?? "",
  });
  const dDay = formatDDay(project.deadline);

  useEffect(() => {
    setEditForm({
      title: project.title,
      goal: project.goal,
      deadline: project.deadline ?? "",
    });
    setIsEditing(false);
    setIsConfirmingArchive(false);
  }, [project.id, project.title, project.goal, project.deadline]);

  const saveEdit = () => {
    onUpdateProject(project.id, editForm);
    setIsEditing(false);
  };

  return (
    <View style={styles.projectShell}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.projectScroll}
        contentContainerStyle={styles.projectContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          scrollViewRef.current?.scrollToEnd({ animated: true })
        }
      >
        <View style={styles.projectHeaderRow}>
          <View style={styles.projectHeaderTextBlock}>
            <View style={styles.projectTitleRow}>
              <Text style={styles.projectTitle}>{project.title}</Text>
              {dDay ? <Text style={styles.projectDdayBadge}>{dDay}</Text> : null}
            </View>
            <Text style={styles.projectSubtitle}>프로젝트 작업 공간</Text>
          </View>
          <TouchableOpacity
            style={styles.projectSecondaryButton}
            onPress={onBackToChat}
            activeOpacity={0.85}
          >
            <Text style={styles.projectSecondaryButtonText}>채팅으로 돌아가기</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.projectPanel}>
          <View style={styles.projectPanelHeader}>
            <Text style={styles.projectPanelTitle}>목표</Text>
            <TouchableOpacity
              style={styles.projectTinyButton}
              onPress={() => setIsEditing((currentValue) => !currentValue)}
              activeOpacity={0.85}
            >
              <Text style={styles.projectTinyButtonText}>
                {isEditing ? "닫기" : "수정"}
              </Text>
            </TouchableOpacity>
          </View>

          {isEditing ? (
            <View>
              <Text style={styles.projectFieldLabel}>프로젝트 이름</Text>
              <TextInput
                style={styles.projectInput}
                value={editForm.title}
                onChangeText={(title) => setEditForm({ ...editForm, title })}
                placeholderTextColor="#7d7d7d"
              />
              <Text style={styles.projectFieldLabel}>목표</Text>
              <TextInput
                style={[styles.projectInput, styles.projectTextArea]}
                value={editForm.goal}
                onChangeText={(goal) => setEditForm({ ...editForm, goal })}
                multiline
                placeholderTextColor="#7d7d7d"
              />
              <Text style={styles.projectFieldLabel}>마감일</Text>
              <TextInput
                style={styles.projectInput}
                value={editForm.deadline}
                onChangeText={(deadline) =>
                  setEditForm({ ...editForm, deadline })
                }
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#7d7d7d"
              />
              <TouchableOpacity
                style={styles.projectPrimaryButton}
                onPress={saveEdit}
                activeOpacity={0.85}
              >
                <Text style={styles.projectPrimaryButtonText}>저장</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.projectGoalText}>{project.goal}</Text>
          )}
        </View>

        <View style={styles.projectPanel}>
          <Text style={styles.projectPanelTitle}>프로젝트 대화</Text>
          {messages.length === 0 ? (
            <Text style={styles.projectEmptyText}>
              오늘 할 작업을 noie에게 말해보세요.
            </Text>
          ) : (
            messages.map((message) => (
              <ProjectMessageBubble key={message.id} message={message} />
            ))
          )}
        </View>

        <View style={styles.projectArchiveRow}>
          {isConfirmingArchive ? (
            <>
              <Text style={styles.projectArchiveText}>이 프로젝트를 보관할까요?</Text>
              <TouchableOpacity
                style={styles.projectDangerButton}
                onPress={() => onArchiveProject(project.id)}
                activeOpacity={0.85}
              >
                <Text style={styles.projectDangerButtonText}>보관</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.projectSecondaryButton}
                onPress={() => setIsConfirmingArchive(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.projectSecondaryButtonText}>취소</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.projectSecondaryButton}
              onPress={() => setIsConfirmingArchive(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.projectSecondaryButtonText}>프로젝트 보관</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.messageInput}
          placeholder="프로젝트 작업을 입력해 주세요"
          placeholderTextColor="#8b949e"
          value={inputText}
          onChangeText={onChangeInputText}
          multiline
          editable={!isSending}
          returnKeyType="send"
          onSubmitEditing={onSendMessage}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!inputText.trim() || isSending) && styles.sendButtonDisabled,
          ]}
          onPress={onSendMessage}
          disabled={!inputText.trim() || isSending}
          activeOpacity={0.85}
        >
          <Text style={styles.sendButtonText}>전송</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ProjectMessageBubble({ message }: { message: NoieProjectMessage }) {
  const isUser = message.role === "user";

  return (
    <View
      style={[
        styles.projectMessageRow,
        isUser ? styles.projectUserMessageRow : styles.projectAssistantMessageRow,
      ]}
    >
      <View
        style={[
          styles.projectMessageBubble,
          isUser ? styles.projectUserBubble : styles.projectAssistantBubble,
        ]}
      >
        {message.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#f2f4f8" />
            <Text style={styles.assistantText}>{message.content}</Text>
          </View>
        ) : (
          <Text
            style={isUser ? styles.userText : styles.projectAssistantText}
          >
            {message.content}
          </Text>
        )}
        {message.error ? <Text style={styles.errorText}>{message.error}</Text> : null}
      </View>
    </View>
  );
}

type ChatBubbleProps = {
  message: ChatMessage;
  onToggleAdminView: (messageId: string) => void;
  onConfirmDailyTrace: (messageId: string) => void;
  onDismissDailyTrace: (messageId: string) => void;
};

function ChatBubble({
  message,
  onToggleAdminView,
  onConfirmDailyTrace,
  onDismissDailyTrace,
}: ChatBubbleProps) {
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

        {!isUser && message.dailyTraceCandidate ? (
          <DailyTraceCandidateCard
            message={message}
            onConfirm={onConfirmDailyTrace}
            onDismiss={onDismissDailyTrace}
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

function DailyTraceCandidateCard({
  message,
  onConfirm,
  onDismiss,
}: {
  message: ChatMessage;
  onConfirm: (messageId: string, dreamRole?: DreamRole) => void;
  onDismiss: (messageId: string) => void;
}) {
  const candidate = message.dailyTraceCandidate;
  const memoryPolicy = message.dailyMemoryPolicy;

  if (!candidate || shouldHideSaveUi(message.analysis?.save_decision, memoryPolicy)) {
    return null;
  }

  const isAdded = message.dailyTraceStatus === "added";
  const isDuplicate = message.dailyTraceStatus === "duplicate";
  const isDismissed = message.dailyTraceStatus === "dismissed";
  const memoryType = memoryPolicy?.type;
  const isDreamOrGoal = isDreamOrGoalType(memoryType);
  const questionText = message.dailyTraceNotice ?? getPendingMemoryNotice(
    memoryPolicy ?? buildMemorySavePolicy("none"),
    message.dreamSavePromptKind
  );
  const canRespond = !isAdded && !isDuplicate && !isDismissed;

  return (
    <View style={styles.traceCandidateCard}>
      <Text style={styles.traceCandidateQuestion}>{questionText}</Text>
      <Text style={styles.traceCandidateTitle}>{candidate.title}</Text>
      <Text style={styles.traceCandidateMeta}>
        {candidate.date}
        {candidate.time ? ` · ${candidate.time}` : ""}
        {candidate.type === "goal" && getGoalTargetLabel(candidate)
          ? ` · 목표 시점: ${getGoalTargetLabel(candidate)}`
          : ""}
        {" · "}
        {TRACE_TYPE_LABELS[candidate.type]}
      </Text>
      {candidate.memo ? (
        <Text style={styles.traceCandidateMemo}>{candidate.memo}</Text>
      ) : null}
      {canRespond ? (
        <View style={styles.traceCandidateActions}>
          {isDreamOrGoal ? (
            <>
              {getDreamRoleButtonOrder(message.dreamSavePromptKind).map((role) => (
                <TouchableOpacity
                  key={role}
                  style={styles.traceConfirmButton}
                  onPress={() => onConfirm(message.id, role)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.traceConfirmButtonText}>
                    {role === "torch" ? "꿈의 횃불로 저장" : "꿈의 파편으로 저장"}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <TouchableOpacity
              style={styles.traceConfirmButton}
              onPress={() => onConfirm(message.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.traceConfirmButtonText}>
                {getConfirmButtonLabel(memoryType, candidate.type)}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.traceCancelButton}
            onPress={() => onDismiss(message.id)}
            activeOpacity={0.85}
          >
            <Text style={styles.traceCancelButtonText}>안 할래</Text>
          </TouchableOpacity>
        </View>
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

function DreamVaultScreen({
  dailyTraces,
  dreamTorchId,
  onPinDreamTorch,
  onHideFromDream,
  onBackToChat,
}: {
  dailyTraces: DailyTraceItem[];
  dreamTorchId: string | null;
  onPinDreamTorch: (itemId: string) => void;
  onHideFromDream: (itemId: string) => void;
  onBackToChat: () => void;
}) {
  const dreamTorchCandidates = getDreamTorchCandidates(dailyTraces);
  const torchPiece = selectDreamTorchPiece(dreamTorchCandidates, dreamTorchId);
  const dreamFragments = getDreamFragments(dailyTraces).filter(
    (piece) => piece.id !== torchPiece?.id
  );
  const hasDreamContent = Boolean(torchPiece) || dreamFragments.length > 0;

  return (
    <ScrollView
      style={styles.flowScroll}
      contentContainerStyle={styles.flowContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.flowHeaderRow}>
        <View style={styles.flowHeaderTextBlock}>
          <Text style={styles.flowTitle}>꿈의 조각</Text>
          <Text style={styles.flowSubtitle}>내가 향하는 방향</Text>
        </View>
        <TouchableOpacity
          style={styles.backToChatButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.backToChatButtonText}>채팅으로 돌아가기</Text>
        </TouchableOpacity>
      </View>

      {!hasDreamContent ? (
        <View style={styles.flowCard}>
          <View style={styles.flowEmptyBox}>
            <Text style={styles.flowEmptyText}>
              아직 꿈의 조각이 없어요.{"\n"}채팅에서 되고 싶은 모습이나 목표를 말하면 여기에 모여요.
            </Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.flowCard}>
            <Text style={styles.flowCardTitle}>꿈의 횃불</Text>
            {torchPiece ? (
              <DreamPieceCard
                piece={torchPiece}
                isTorch
                onPinDreamTorch={onPinDreamTorch}
                onHideFromDream={onHideFromDream}
              />
            ) : null}
          </View>

          <View style={styles.flowCard}>
            <Text style={styles.flowCardTitle}>꿈의 파편</Text>
            {dreamFragments.length > 0 ? (
              dreamFragments.map((piece) => (
                <DreamPieceCard
                  key={piece.id}
                  piece={piece}
                  onPinDreamTorch={onPinDreamTorch}
                  onHideFromDream={onHideFromDream}
                />
              ))
            ) : (
              <View style={styles.flowEmptyBox}>
                <Text style={styles.flowEmptyText}>아직 남은 꿈의 파편이 없어요.</Text>
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function DreamPieceCard({
  piece,
  isTorch = false,
  onPinDreamTorch,
  onHideFromDream,
}: {
  piece: DailyTraceItem;
  isTorch?: boolean;
  onPinDreamTorch: (itemId: string) => void;
  onHideFromDream: (itemId: string) => void;
}) {
  return (
    <View style={styles.traceListItem}>
      <View style={styles.traceListTextBlock}>
        <Text style={styles.traceItemTitle}>{piece.title}</Text>
        {piece.memo ? <Text style={styles.traceItemMemo}>{piece.memo}</Text> : null}
        <Text style={styles.dreamPieceDate}>{formatRelativeTraceDate(piece.date)}</Text>
        <View style={styles.dreamPieceActions}>
          {!isTorch ? (
            <TouchableOpacity
              style={styles.dreamPieceActionButton}
              onPress={() => onPinDreamTorch(piece.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceActionText}>횃불로 올리기</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.dreamPieceActionButtonMuted}
            onPress={() => onHideFromDream(piece.id)}
            activeOpacity={0.85}
          >
            <Text style={styles.dreamPieceActionTextMuted}>꿈에서 제외</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
type EmotionVaultScreenProps = {
  records: EmotionRecord[];
  dailyTraces: DailyTraceItem[];
  selectedKeys: EmotionKey[];
  showAllWeeklyAverages: boolean;
  onToggleKey: (key: EmotionKey) => void;
  onToggleWeeklyAverages: () => void;
  onBackToChat: () => void;
};

function EmotionVaultScreen({
  records,
  dailyTraces,
  selectedKeys,
  showAllWeeklyAverages,
  onToggleKey,
  onToggleWeeklyAverages,
  onBackToChat,
}: EmotionVaultScreenProps) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(300, Math.min(width - 32, 760));
  const recentRecords = records.slice(-10);
  const weeklyAverages = calculateWeeklyAverages(records);
  const visibleWeeklyAverages = showAllWeeklyAverages
    ? weeklyAverages
    : weeklyAverages.slice(0, 3);
  const dailyPieces = getRecentDailyPieces(dailyTraces);
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
            감정 흐름은 그래프로, 일정과 기록은 하루의 흔적으로 따로 보관합니다.
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

      <DailyPiecesSection pieces={dailyPieces} />

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

function DailyPiecesSection({ pieces }: { pieces: DailyPieceGroup[] }) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(260, Math.min(width * 0.82, 380));

  return (
    <View style={styles.dailyPiecesSection}>
      <Text style={styles.dailyPiecesTitle}>하루의 조각</Text>
      <Text style={styles.dailyPiecesSubtitle}>최근 3일 동안 남은 조각들</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dailyPiecesCarousel}
      >
        {pieces.map((group) => (
          <View
            key={group.date}
            style={[styles.dailyPieceCard, { width: cardWidth }]}
          >
            <Text style={styles.dailyPieceDateTitle}>{group.label}</Text>
            {group.pieces.length === 0 ? (
              <Text style={styles.dailyPieceEmptyText}>
                아직 남은 조각이 없어요
              </Text>
            ) : (
              <View style={styles.dailyPieceList}>
                {group.pieces.map((piece, index) => (
                  <Text key={piece.id} style={styles.dailyPieceText}>
                    {index + 1}. {piece.memo || piece.title}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function DailyTraceScreen({
  dailyTraces,
  selectedTraceDate,
  calendarMonth,
  onSelectTraceDate,
  onChangeCalendarMonth,
  onToggleDailyTraceDone,
  onDeleteDailyTraceGoal,
  onCleanupDuplicateMemories,
  cleanupMessage,
  onBackToChat,
}: {
  dailyTraces: DailyTraceItem[];
  selectedTraceDate: string;
  calendarMonth: Date;
  onSelectTraceDate: (date: string) => void;
  onChangeCalendarMonth: (date: Date) => void;
  onToggleDailyTraceDone: (itemId: string) => void;
  onDeleteDailyTraceGoal: (itemId: string) => void;
  onCleanupDuplicateMemories: () => void;
  cleanupMessage: string;
  onBackToChat: () => void;
}) {
  return (
    <ScrollView
      style={styles.flowScroll}
      contentContainerStyle={styles.flowContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.flowHeaderRow}>
        <View style={styles.flowHeaderTextBlock}>
          <Text style={styles.flowTitle}>하루의 흔적</Text>
          <Text style={styles.flowSubtitle}>
            날짜별 일정, 오늘의 기록, 할 일, 남긴 말을 모아봅니다.
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

      <DailyTraceCalendar
        items={dailyTraces}
        selectedDate={selectedTraceDate}
        calendarMonth={calendarMonth}
        onSelectDate={onSelectTraceDate}
        onChangeMonth={onChangeCalendarMonth}
        onToggleDone={onToggleDailyTraceDone}
        onDeleteGoal={onDeleteDailyTraceGoal}
      />

      {/* 개발 테스트용 버튼 */}
      <TouchableOpacity
        style={styles.projectSecondaryButton}
        onPress={onCleanupDuplicateMemories}
        activeOpacity={0.85}
      >
        <Text style={styles.projectSecondaryButtonText}>중복 기록 정리</Text>
      </TouchableOpacity>
      {cleanupMessage ? (
        <Text style={styles.traceCandidateMemo}>{cleanupMessage}</Text>
      ) : null}
    </ScrollView>
  );
}

function DailyTraceCalendar({
  items,
  selectedDate,
  calendarMonth,
  onSelectDate,
  onChangeMonth,
  onToggleDone,
  onDeleteGoal,
}: {
  items: DailyTraceItem[];
  selectedDate: string;
  calendarMonth: Date;
  onSelectDate: (date: string) => void;
  onChangeMonth: (date: Date) => void;
  onToggleDone: (itemId: string) => void;
  onDeleteGoal: (itemId: string) => void;
}) {
  const monthCells = buildCalendarMonth(calendarMonth);
  const datesWithItems = useMemo(
    () =>
      new Set(
        dedupeMemories(items)
          .filter((item) => {
            const memoryPolicy = getMemoryPolicy(item);
            return shouldSaveToDailyTrace(memoryPolicy);
          })
          .map((item) => item.date)
      ),
    [items]
  );
  const selectedItems = dedupeMemories(items)
    .filter((item) => {
      const memoryPolicy = getMemoryPolicy(item);

      return item.date === selectedDate && shouldSaveToDailyTrace(memoryPolicy);
    })
    .sort(sortDailyTraceItems);

  return (
    <View style={styles.flowCard}>
      <View style={styles.traceHeaderRow}>
        <View>
          <Text style={styles.flowCardTitle}>하루의 흔적</Text>
          <Text style={styles.flowCardHint}>
            일정, 오늘의 기록, 할 일, 남긴 말을 날짜별로 보관합니다.
          </Text>
        </View>
      </View>

      <View style={styles.calendarHeader}>
        <TouchableOpacity
          style={styles.calendarNavButton}
          onPress={() => onChangeMonth(addMonths(calendarMonth, -1))}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarNavText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.calendarMonthTitle}>{formatMonthTitle(calendarMonth)}</Text>
        <TouchableOpacity
          style={styles.calendarNavButton}
          onPress={() => onChangeMonth(addMonths(calendarMonth, 1))}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarNavText}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekdayRow}>
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <Text key={day} style={styles.weekdayText}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.calendarGrid}>
        {monthCells.map((cell) => {
          const dateKey = getLocalDateString(cell.date);
          const isSelected = dateKey === selectedDate;
          const hasItems = datesWithItems.has(dateKey);

          return (
            <TouchableOpacity
              key={dateKey}
              style={[
                styles.calendarDayCell,
                !cell.isCurrentMonth && styles.calendarDayMuted,
                isSelected && styles.calendarDaySelected,
              ]}
              onPress={() => onSelectDate(dateKey)}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.calendarDayText,
                  !cell.isCurrentMonth && styles.calendarDayTextMuted,
                  isSelected && styles.calendarDayTextSelected,
                ]}
              >
                {cell.date.getDate()}
              </Text>
              {hasItems ? <View style={styles.calendarDot} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.traceDetail}>
        <Text style={styles.traceDateTitle}>{formatKoreanDate(selectedDate)}</Text>
        <Text style={styles.traceDetailTitle}>하루의 흔적</Text>

        {selectedItems.length === 0 ? (
          <View style={styles.traceEmptyBox}>
            <Text style={styles.traceEmptyText}>
              이 날짜에는 아직 남긴 흔적이 없습니다.
            </Text>
          </View>
        ) : (
          ([
            "schedule",
            "record",
            "todo",
            "quote",
            "goal",
          ] as DailyTraceItemType[]).map(
            (type) => {
              const groupItems = selectedItems.filter((item) => item.type === type);
              if (groupItems.length === 0) {
                return null;
              }

              return (
                <View key={type} style={styles.traceGroup}>
                  <Text style={styles.traceGroupTitle}>{TRACE_TYPE_LABELS[type]}</Text>
                  {groupItems.map((item) => (
                    <DailyTraceListItem
                      key={item.id}
                      item={item}
                      onToggleDone={onToggleDone}
                      onDeleteGoal={onDeleteGoal}
                    />
                  ))}
                </View>
              );
            }
          )
        )}
      </View>
    </View>
  );
}

function DailyTraceListItem({
  item,
  onToggleDone,
  onDeleteGoal,
}: {
  item: DailyTraceItem;
  onToggleDone: (itemId: string) => void;
  onDeleteGoal: (itemId: string) => void;
}) {
  const goalTargetLabel = item.type === "goal" ? getGoalTargetLabel(item) : "";

  return (
    <View style={styles.traceListItem}>
      {item.type === "todo" ? (
        <TouchableOpacity
          style={[styles.todoCheck, item.isDone && styles.todoCheckDone]}
          onPress={() => onToggleDone(item.id)}
          activeOpacity={0.85}
        >
          <Text style={styles.todoCheckText}>{item.isDone ? "✓" : ""}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.traceListTextBlock}>
        <Text
          style={[
            styles.traceItemTitle,
            item.type === "todo" && item.isDone && styles.traceItemDone,
          ]}
        >
          {item.time ? `${item.time} · ` : ""}
          {item.title}
          {goalTargetLabel ? ` · ${goalTargetLabel}` : ""}
        </Text>
        {item.memo ? <Text style={styles.traceItemMemo}>{item.memo}</Text> : null}
      </View>
      {item.type === "goal" ? (
        <TouchableOpacity
          style={styles.traceDeleteButton}
          onPress={() => onDeleteGoal(item.id)}
          activeOpacity={0.85}
        >
          <Text style={styles.traceDeleteButtonText}>삭제</Text>
        </TouchableOpacity>
      ) : null}
    </View>
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
    paddingLeft +
    (records.length === 1 ? 0 : (innerWidth * index) / (records.length - 1));
  const getY = (value: number) =>
    paddingTop + (1 - clampScore(value)) * innerHeight;

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
              <SvgText x={4} y={y + 4} fill="#858585" fontSize="10">
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

function getMemoryInputText(input: {
  title?: string;
  memo?: string;
  sourceText?: string;
}) {
  return input.sourceText || input.memo || input.title || "";
}

function buildDailyTraceItem(
  candidate: DailyTraceCandidate,
  sourceText: string,
  sourceMessageId: string,
  createdAt: string,
  memoryPolicy?: MemorySavePolicy
): DailyTraceItem {
  return {
    id: createId("trace"),
    type: candidate.type,
    date: candidate.date,
    title: candidate.title,
    memo: candidate.memo,
    time: candidate.time ?? undefined,
    targetDate: candidate.targetDate ?? undefined,
    targetYear: candidate.targetYear ?? undefined,
    targetText: candidate.targetText ?? undefined,
    sourceText,
    sourceMessageId,
    isDone: candidate.type === "todo" ? false : undefined,
    memoryType: memoryPolicy?.type,
    saveTargets: memoryPolicy?.saveTargets,
    importance: memoryPolicy?.importance,
    displayCategory: memoryPolicy?.label,
    dreamRole: memoryPolicy?.dreamRole,
    pinnedAsDreamTorch: memoryPolicy?.dreamRole === "torch" ? true : undefined,
    createdAt,
  };
}

function resolveDailyTraceCandidate(
  text: string,
  extractedCandidate: DailyTraceCandidate | null,
  memoryPolicy: MemorySavePolicy
): DailyTraceCandidate | null {
  if (!memoryPolicy.shouldSave || memoryPolicy.type === "none") {
    return null;
  }

  if (extractedCandidate) {
    return extractedCandidate;
  }

  return {
    type: getDailyTraceTypeForMemory(memoryPolicy.type),
    date: getLocalDateString(new Date()),
    title: makeMemoryTitle(text),
    memo: text,
  };
}

function getDailyTraceTypeForMemory(type: MemorySavePolicyType): DailyTraceItemType {
  if (type === "schedule" || type === "daily_plan") {
    return "schedule";
  }

  if (type === "todo" || type === "task") {
    return "todo";
  }

  if (type === "goal" || type === "dream" || type === "project") {
    return "goal";
  }

  if (type === "idea") {
    return "quote";
  }

  return "record";
}

function makeMemoryTitle(text: string) {
  const trimmedText = text.trim();
  if (trimmedText.length <= 24) {
    return trimmedText;
  }

  return `${trimmedText.slice(0, 24)}...`;
}

function getAutoSavedMemoryNotice(type: MemorySavePolicyType) {
  const noticeMap: Partial<Record<MemorySavePolicyType, string>> = {
    achievement: "성과로 하루의 조각에 담았어요.",
    goal: "목표로 하루의 조각에 담았어요.",
    dream: "꿈으로 하루의 조각에 담았어요.",
    idea: "아이디어로 하루의 조각에 담았어요.",
    relationship: "관계의 조각으로 담았어요.",
    schedule: "일정으로 하루의 흔적에 담았어요.",
    todo: "할 일로 하루의 흔적에 담았어요.",
    daily_context: "오늘의 기록으로 담았어요.",
  };

  return noticeMap[type] ?? "";
}

function isDreamOrGoalType(type?: MemorySavePolicyType) {
  return type === "dream" || type === "goal";
}

function isDailyTraceConfirmType(type?: MemorySavePolicyType) {
  return type === "todo" || type === "task" || type === "schedule" || type === "daily_plan";
}

function isTodoLikeText(text: string) {
  const normalizedText = text.trim().toLowerCase();

  return /해야\s*겠|해야겠다|해야겠어|해야\s*함|해야함|해야\s*해|정리해야|운동해야|훈련.*해야|준비해야/.test(
    normalizedText
  );
}

function adjustMemoryPolicyForText(
  memoryPolicy: MemorySavePolicy,
  text: string
): MemorySavePolicy {
  if (
    memoryPolicy.type !== "sensitive_event" &&
    isTodoLikeText(text) &&
    !/되고\s*싶|되는\s*게\s*목표|내\s*꿈|목표야|목표는/.test(text)
  ) {
    return {
      type: "todo",
      shouldSave: true,
      requiresConfirmation: true,
      importance: calculateMemoryImportance("todo"),
      label: "할 일",
      saveTargets: ["daily_trace"],
    };
  }

  return memoryPolicy;
}

function getPendingMemoryNotice(
  memoryPolicy: MemorySavePolicy,
  dreamPromptKind?: DreamSavePromptKind
) {
  if (isDreamOrGoalType(memoryPolicy.type)) {
    return dreamPromptKind === "fragment_first"
      ? "꿈의 파편에 저장할까요?"
      : "꿈으로 저장할까요?";
  }

  if (memoryPolicy.type === "relationship") {
    return "관계의 조각으로 저장할까요?";
  }

  if (memoryPolicy.type === "achievement") {
    return "성과로 저장할까요?";
  }

  if (isDailyTraceConfirmType(memoryPolicy.type)) {
    return "하루의 흔적에 저장할까요?";
  }

  if (memoryPolicy.type === "sensitive_event") {
    return "최근 사건을 저장할까요?";
  }

  return "";
}

function getConfirmButtonLabel(
  memoryType: MemorySavePolicyType | undefined,
  candidateType: DailyTraceItemType
) {
  if (memoryType === "relationship") {
    return "관계 저장하기";
  }

  if (memoryType === "achievement") {
    return "성과 저장하기";
  }

  if (
    memoryType === "sensitive_event" ||
    isDailyTraceConfirmType(memoryType)
  ) {
    return "저장하기";
  }

  return TRACE_CONFIRM_LABELS[candidateType] ?? "저장하기";
}

function getDreamRoleButtonOrder(kind?: DreamSavePromptKind): DreamRole[] {
  return kind === "fragment_first" ? ["fragment", "torch"] : ["torch", "fragment"];
}

function getDreamSavePromptKind(text: string): DreamSavePromptKind {
  return isDreamFragmentText(text) ? "fragment_first" : "torch_first";
}

function isDreamFragmentText(text: string) {
  const normalizedText = text.trim().toLowerCase();
  return /noie|노이에|개인\s*ai|앱|출시|포트폴리오|기능|서비스|완성하고\s*싶|만들고\s*싶|고도화/.test(
    normalizedText
  );
}

function shouldHideSaveUi(
  decision?: SaveDecision,
  memoryPolicy?: MemorySavePolicy
) {
  if (!memoryPolicy || !memoryPolicy.shouldSave || memoryPolicy.type === "none") {
    return true;
  }

  if (!decision) {
    return false;
  }

  return (
    decision.shouldStore === false ||
    decision.savePolicy === "none" ||
    decision.uiType === "none" ||
    decision.memoryType === "none" ||
    decision.saveTargets.length === 0 ||
    (decision.subjectScope === "other_person" && decision.selfRelevance === "none")
  );
}
function getSavedMemoryNotice(memoryPolicy: MemorySavePolicy) {
  if (isDreamOrGoalType(memoryPolicy.type)) {
    return memoryPolicy.dreamRole === "fragment"
      ? "꿈의 파편에 저장했어요."
      : "꿈의 횃불에 저장했어요.";
  }

  if (memoryPolicy.type === "sensitive_event") {
    return "하루의 조각에 저장했어요.";
  }

  if (isDailyTraceConfirmType(memoryPolicy.type)) {
    return "하루의 흔적에 저장했어요.";
  }

  return getAutoSavedMemoryNotice(memoryPolicy.type) || "하루의 조각에 저장했어요.";
}

function getDuplicateMemoryNotice(memoryPolicy?: MemorySavePolicy) {
  if (isDreamOrGoalType(memoryPolicy?.type)) {
    return "이미 꿈의 조각에 있는 내용이에요.";
  }

  return "이미 하루의 조각에 있는 내용이에요.";
}

function buildMemorySavePolicyFromDecision(decision: SaveDecision): MemorySavePolicy {
  if (
    decision.shouldStore === false ||
    decision.savePolicy === "none" ||
    decision.uiType === "none" ||
    decision.memoryType === "none" ||
    decision.saveTargets.length === 0
  ) {
    return {
      type: "none",
      shouldSave: false,
      requiresConfirmation: false,
      importance: decision.importance ?? 0,
      label: decision.displayCategory || "저장 안 함",
      saveTargets: [],
    };
  }

  if (decision.memoryType === "dream" || decision.memoryType === "goal") {
    return {
      type: decision.memoryType,
      shouldSave: true,
      requiresConfirmation: true,
      importance: decision.importance,
      label: decision.displayCategory,
      saveTargets: ["dream_piece", "daily_trace"],
    };
  }

  if (
    decision.memoryType === "todo" ||
    decision.memoryType === "task" ||
    decision.memoryType === "schedule" ||
    decision.memoryType === "daily_plan"
  ) {
    return {
      type: decision.memoryType,
      shouldSave: true,
      requiresConfirmation: true,
      importance: decision.importance,
      label: decision.displayCategory,
      saveTargets: ["daily_trace"],
    };
  }

  return {
    type: decision.memoryType,
    shouldSave: true,
    requiresConfirmation: true,
    importance: decision.importance,
    label: decision.displayCategory,
    saveTargets: decision.saveTargets,
  };
}

function getMemoryPolicy(memory: NoieMemory): MemorySavePolicy {
  if (memory.memoryType) {
    return {
      type: memory.memoryType,
      shouldSave: memory.memoryType !== "none",
      requiresConfirmation: memory.memoryType !== "none",
      importance:
        memory.importance ??
        calculateMemoryImportance(memory.memoryType),
      label: memory.displayCategory ?? memory.memoryType,
      saveTargets: memory.saveTargets,
    };
  }

  return classifyMemorySavePolicy(
    getMemoryInputText({
      title: memory.title,
      memo: memory.memo,
      sourceText: memory.sourceText,
    }),
    undefined,
    memory
  );
}

function shouldSaveToDailyTrace(memoryPolicy: MemorySavePolicy) {
  if (!memoryPolicy.shouldSave || memoryPolicy.type === "sensitive_event") {
    return false;
  }

  if (memoryPolicy.saveTargets) {
    return memoryPolicy.saveTargets.includes("daily_trace");
  }

  return true;
}

function shouldSaveToDailyPieces(memoryPolicy: MemorySavePolicy) {
  if (!memoryPolicy.shouldSave || memoryPolicy.type === "none") {
    return false;
  }

  if (memoryPolicy.saveTargets) {
    return (
      memoryPolicy.saveTargets.includes("daily_piece") ||
      memoryPolicy.saveTargets.includes("dream_piece")
    );
  }

  return true;
}

function normalizeMemoryInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[.,!?。！？，]/g, "")
    .replace(/\s+/g, " ")
    .replace(/ai\s*개발자/g, "ai개발자")
    .replace(/내\s*꿈/g, "꿈")
    .replace(/내꿈/g, "꿈")
    .replace(/내\s*목표/g, "목표")
    .replace(/\b나는\b|\b나\b|\b내\b/g, "")
    .replace(/개발자가\s*되는\s*게/g, "개발자 되는")
    .replace(/개발자가\s*되는게/g, "개발자 되는")
    .replace(/개발자가\s*되는거야/g, "개발자 되는")
    .replace(/개발자\s*되고/g, "개발자 되는")
    .replace(/개발자가\s*되고/g, "개발자 되는")
    .replace(/되고\s*싶어/g, "되는 목표")
    .replace(/되는\s*게/g, "되는")
    .replace(/되는게/g, "되는")
    .replace(/되는거야/g, "되는")
    .replace(/목표\s*야/g, "목표")
    .replace(/목표야/g, "목표")
    .replace(/목표는/g, "목표")
    .replace(/꿈은/g, "꿈")
    .replace(/\s+/g, " ")
    .trim();
}

function getMemoryDateKey(createdAt: string): string {
  const createdAtDate = new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    return "";
  }

  return getLocalDateString(createdAtDate);
}

function getMemoryCreatedDate(item: Pick<DailyTraceItem, "createdAt">) {
  return getMemoryDateKey(item.createdAt);
}

function getMemorySemanticKey(memory: NoieMemory): string {
  const dateKey = getMemoryDateKey(memory.createdAt);
  const input = getMemoryInputText({
    title: memory.title,
    memo: memory.memo,
    sourceText: memory.sourceText,
  });
  const normalizedInput = normalizeMemoryInput(input);

  const isDeveloperGoal =
    /ai?개발자|개발자/.test(normalizedInput) &&
    /목표|꿈|되는|취직/.test(normalizedInput);

  if (isDeveloperGoal) {
    return `${dateKey}_developer_goal`;
  }

  const memoryPolicy = getMemoryPolicy(memory);
  return `${dateKey}_${memoryPolicy.type}_${normalizedInput}`;
}

function getMemoryTypePriority(type: MemorySavePolicyType) {
  const priorityMap: Record<MemorySavePolicyType, number> = {
    goal: 6,
    dream: 5,
    project: 4,
    achievement: 4,
    relationship: 3,
    idea: 2,
    schedule: 2,
    todo: 2,
    task: 2,
    daily_plan: 2,
    note: 1,
    important_note: 2,
    daily_context: 1,
    sensitive_event: 0,
    none: -1,
  };

  return priorityMap[type];
}

function getMemoryNaturalScore(memory: NoieMemory) {
  const input = getMemoryInputText({
    title: memory.title,
    memo: memory.memo,
    sourceText: memory.sourceText,
  }).trim();

  if (input.length >= 8 && input.length <= 40) {
    return 2;
  }

  if (input.length > 40) {
    return 1;
  }

  return 0;
}

function chooseRepresentativeMemory(left: NoieMemory, right: NoieMemory) {
  const leftPolicy = getMemoryPolicy(left);
  const rightPolicy = getMemoryPolicy(right);
  const importanceDiff = rightPolicy.importance - leftPolicy.importance;

  if (importanceDiff > 0) {
    return right;
  }

  if (importanceDiff < 0) {
    return left;
  }

  const typePriorityDiff =
    getMemoryTypePriority(rightPolicy.type) -
    getMemoryTypePriority(leftPolicy.type);

  if (typePriorityDiff > 0) {
    return right;
  }

  if (typePriorityDiff < 0) {
    return left;
  }

  const createdAtDiff = left.createdAt.localeCompare(right.createdAt);
  if (createdAtDiff < 0) {
    return left;
  }

  if (createdAtDiff > 0) {
    return right;
  }

  return getMemoryNaturalScore(right) > getMemoryNaturalScore(left)
    ? right
    : left;
}

function dedupeMemories(memories: NoieMemory[]): NoieMemory[] {
  console.log("중복 제거 전:", memories.length);

  const memoryMap = new Map<string, NoieMemory>();

  memories.forEach((memory) => {
    const semanticKey = getMemorySemanticKey(memory);
    console.log("중복 키:", semanticKey);
    const existingMemory = memoryMap.get(semanticKey);

    memoryMap.set(
      semanticKey,
      existingMemory
        ? chooseRepresentativeMemory(existingMemory, memory)
        : memory
    );
  });

  const dedupedMemories = Array.from(memoryMap.values()).sort(sortDailyTraceItems);
  console.log("중복 제거 후:", dedupedMemories.length);

  return dedupedMemories;
}

function isDuplicateMemoryOnSameDate(
  items: DailyTraceItem[],
  newMemory: DailyTraceItem
) {
  const newMemoryKey = getMemorySemanticKey(newMemory);
  if (!newMemoryKey) {
    return false;
  }

  return items.some((item) => getMemorySemanticKey(item) === newMemoryKey);
}

function saveNoieMemory(
  currentItems: DailyTraceItem[],
  newItem: DailyTraceItem,
  input: string,
  options: { shouldLog?: boolean } = {}
): SaveNoieMemoryResult {
  const memoryPolicy = getMemoryPolicy(newItem);
  const shouldLog = options.shouldLog ?? true;

  if (shouldLog) {
    console.log("저장 후보:", input, memoryPolicy.type, memoryPolicy.importance);
  }

  if (isDuplicateMemoryOnSameDate(currentItems, newItem)) {
    if (shouldLog) {
      console.log("중복이라 저장하지 않음:", input);
    }
    return {
      items: currentItems,
      saved: false,
      duplicate: true,
    };
  }

  return {
    items: dedupeMemories(
      newItem.pinnedAsDreamTorch
        ? [
            ...currentItems.map((item) =>
              item.pinnedAsDreamTorch
                ? { ...item, pinnedAsDreamTorch: false, updatedAt: new Date().toISOString() }
                : item
            ),
            newItem,
          ]
        : [...currentItems, newItem]
    ),
    saved: true,
    duplicate: false,
  };
}

function isHiddenFromDream(item: DailyTraceItem) {
  if (item.hiddenFromDream) {
    return true;
  }

  const forbiddenTypes: MemorySavePolicyType[] = [
    "sensitive_event",
    "achievement",
    "relationship",
    "schedule",
    "todo",
    "task",
    "daily_plan",
    "daily_context",
    "none",
  ];

  return forbiddenTypes.includes(getMemoryPolicy(item).type);
}

function sortDreamItemsByImportance(left: DailyTraceItem, right: DailyTraceItem) {
  const leftPolicy = getMemoryPolicy(left);
  const rightPolicy = getMemoryPolicy(right);
  const importanceDiff = rightPolicy.importance - leftPolicy.importance;

  if (importanceDiff !== 0) {
    return importanceDiff;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

function getDreamTorchCandidates(items: DailyTraceItem[]) {
  return dedupeMemories(items)
    .filter((item) => {
      if (isHiddenFromDream(item) || item.dreamRole === "fragment") {
        return false;
      }

      return isDreamOrGoalType(getMemoryPolicy(item).type);
    })
    .sort(sortDreamItemsByImportance);
}

function getDreamFragments(items: DailyTraceItem[]) {
  return dedupeMemories(items)
    .filter((item) => {
      if (isHiddenFromDream(item)) {
        return false;
      }

      const memoryPolicy = getMemoryPolicy(item);
      return (
        item.dreamRole === "fragment" ||
        item.saveTargets?.includes("dream_fragment") ||
        memoryPolicy.dreamRole === "fragment" ||
        memoryPolicy.saveTargets?.includes("dream_fragment")
      );
    })
    .sort(sortDreamItemsByImportance);
}

function selectDreamTorchPiece(
  dreamPieces: DailyTraceItem[],
  dreamTorchId: string | null
) {
  const pinnedPiece = dreamPieces.find((piece) => piece.pinnedAsDreamTorch) ??
    (dreamTorchId ? dreamPieces.find((piece) => piece.id === dreamTorchId) : undefined);

  if (pinnedPiece) {
    return pinnedPiece;
  }

  return [...dreamPieces].sort(sortDreamItemsByImportance)[0];
}
function getRecentDailyPieces(items: DailyTraceItem[]): DailyPieceGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayGroups = ["오늘", "어제", "그제"].map((label, index) => {
    const date = new Date(todayStart);
    date.setDate(todayStart.getDate() - index);

    return {
      date: getLocalDateString(date),
      label,
      pieces: [] as DailyPiece[],
    };
  });
  const piecesByDate = new Map<string, DailyPieceGroup>(
    dayGroups.map((group) => [group.date, group])
  );

  items.forEach((item) => {
    const createdAtDate = new Date(item.createdAt);
    if (Number.isNaN(createdAtDate.getTime())) {
      return;
    }

    const targetGroup = piecesByDate.get(getLocalDateString(createdAtDate));
    if (!targetGroup) {
      return;
    }

    const memoryPolicy = getMemoryPolicy(item);

    if (!shouldSaveToDailyPieces(memoryPolicy)) {
      return;
    }

    const dailyPiece: DailyPiece = {
      ...item,
      memoryPolicy,
    };
    targetGroup.pieces.push(dailyPiece);
  });

  return dayGroups.map((group) => {
    const uniquePieces = removeDuplicateDailyPieces(group.pieces);
    const topPieces = selectDailyPieceTop3(uniquePieces);

    console.log("하루의 조각 TOP3:", group.label, topPieces);

    return {
      ...group,
      pieces: topPieces,
    };
  });
}

function sortDailyPiecesByImportance(left: DailyPiece, right: DailyPiece) {
  const importanceDiff =
    right.memoryPolicy.importance - left.memoryPolicy.importance;
  if (importanceDiff !== 0) {
    return importanceDiff;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

function selectDailyPieceTop3(pieces: DailyPiece[]) {
  const sensitivePieces = pieces
    .filter((piece) => piece.memoryPolicy.type === "sensitive_event")
    .sort(sortDailyPiecesByImportance);
  const normalPieces = pieces
    .filter((piece) => piece.memoryPolicy.type !== "sensitive_event")
    .sort(sortDailyPiecesByImportance);
  const selectedPieces: DailyPiece[] = [];

  if (sensitivePieces[0]) {
    selectedPieces.push(sensitivePieces[0]);
  }

  selectedPieces.push(...normalPieces.slice(0, 3 - selectedPieces.length));

  if (selectedPieces.length < 3) {
    const selectedIds = new Set(selectedPieces.map((piece) => piece.id));
    const fallbackPieces = pieces
      .filter(
        (piece) =>
          piece.memoryPolicy.type !== "sensitive_event" &&
          !selectedIds.has(piece.id)
      )
      .sort(sortDailyPiecesByImportance);

    selectedPieces.push(...fallbackPieces.slice(0, 3 - selectedPieces.length));
  }

  return selectedPieces.slice(0, 3);
}

function removeDuplicateDailyPieces(pieces: DailyPiece[]) {
  const pieceMap = new Map(pieces.map((piece) => [piece.id, piece]));

  return dedupeMemories(pieces).map((memory) => {
    const existingPiece = pieceMap.get(memory.id);
    if (existingPiece) {
      return existingPiece;
    }

    return {
      ...memory,
      memoryPolicy: getMemoryPolicy(memory),
    };
  });
}

function classifyMemorySavePolicy(
  text: string,
  emotionSignals?: EmotionSignals,
  traceItem?: {
    type?: DailyTraceItemType | null;
    targetDate?: string | null;
    targetYear?: string | null;
    targetText?: string | null;
  }
): MemorySavePolicy {
  const normalizedText = text.trim().toLowerCase();
  const has = (patterns: RegExp[]) =>
    patterns.some((pattern) => pattern.test(normalizedText));

  const sensitivePatterns = [
    /싸움|싸웠|싸웟|다툼|다퉜|갈등|차단|상처|배신|헤어졌|헤어짐|이별|손절/,
    /실패|실패햇|떨어졌|떨어졋|탈락|불합격|망했|망쳣|망침|못했|안\s*됐|안됐|안됏|거절|거절당/,
    /취직\s*실패|면접\s*떨어|시험\s*망|프로젝트\s*실패|코딩\s*테스트\s*떨어|서류\s*탈락/,
    /무너졌|좌절|포기하고\s*싶|절망|끝난\s*것\s*같|잃었|잃어버렸|해고|퇴사당|버림받/,
    /불안|무서|무서운\s*꿈|악몽|공포|놀랐|충격|멘붕|긴장돼|숨\s*막혀/,
    /우울|힘들|힘들엇|지쳤|지침|번아웃|아무것도\s*하기\s*싫|눈물|울었|울엇|울음/,
  ];
  const achievementActionPatterns = [
    /완료|끝냄|해냄|성공|통과|해결/,
    /수정|고침|구현|만듦|제작|시작|진행/,
    /정리|연결|실행|테스트|검증|배포|확인/,
  ];
  const achievementTopicPatterns = [
    /코드|앱|모바일|백엔드|프론트|api|ui|화면/,
    /노이에\s*개발|감정\s*분석기|하루의\s*조각|감정창고|app\.tsx/,
  ];
  const relationshipPatterns = [
    /친구|새\s*친구|사귐|사귀|친해짐/,
    /만남|대화|연락|도움|화해|같이|약속/,
    /선배|동기|가족/,
  ];
  const dreamPatterns = [
    /꿈|되고\s*싶|가고\s*싶|만들고\s*싶/,
    /나중에|언젠가|장기적으로/,
    /개인\s*ai|ai\s*개발자|개발자|뤼튼|취직|창업|내\s*ai|노이에|아미/,
  ];
  const explicitGoalPatterns = [
    /내\s*목표|목표는|목표가|목표야|목표\s*야/,
    /되고\s*싶|개발자가\s*되는|개발자가\s*될/,
    /되는\s*게\s*목표|되는게\s*목표/,
    /완성하는\s*게\s*목표|완성하는게\s*목표/,
    /ai\s*개발자|취직|뤼튼|개인\s*ai\s*만들고\s*싶/,
  ];
  const timePatterns = [
    /오늘|내일|이번\s*주|다음\s*주|방학|주말|아침|저녁/,
    /월요일|화요일|수요일|목요일|금요일|토요일|일요일/,
    /\d{1,2}월|\d{1,2}일/,
  ];
  const goalPatterns = [
    /해야|할\s*일|계획|목표|예정|준비/,
    /공부|개발|만들기|확인|정리|예비군/,
  ];
  const ideaPatterns = [
    /아이디어|기능|버튼|화면|ui|ux|카드/,
    /섹션|추천|저장|분류|자동저장|감정창고/,
    /하루의\s*조각|프로젝트|사이드바|탑\s*3|top\s*3|가로\s*카드/,
    /넣자|바꾸자|추가|개선|구조|올리자|띄우자|가자/,
  ];
  const dailyContextPatterns = [
    /방학\s*이야|방학이야|방학\s*시작|방학시작/,
    /휴가\s*야|휴가야|쉬는\s*날/,
    /생일\s*이야|생일이야/,
  ];
  const vacationPlanPatterns = [
    /방학.*개발|방학.*공부|방학.*만들|방학.*노이에/,
    /방학.*할\s*거야|방학.*해야|방학.*계획|방학.*목표/,
  ];

  const hasSensitiveSignal = has(sensitivePatterns);
  const hasAchievementAction = has(achievementActionPatterns);
  const hasAchievementTopic = has(achievementTopicPatterns);
  const hasRelationshipSignal = has(relationshipPatterns);
  const hasDreamSignal = has(dreamPatterns);
  const hasExplicitGoalSignal = has(explicitGoalPatterns);
  const hasTimeSignal = has(timePatterns);
  const hasGoalSignal =
    has(goalPatterns) ||
    traceItem?.type === "goal" ||
    traceItem?.type === "todo" ||
    traceItem?.type === "schedule" ||
    Boolean(
      traceItem?.targetDate || traceItem?.targetYear || traceItem?.targetText
    );
  const hasIdeaSignal = has(ideaPatterns);
  const hasVacationPlanSignal = has(vacationPlanPatterns);
  const hasHighNegativeEmotion = (["D", "A", "T", "F"] as EmotionKey[]).some(
    (key) => isHighEmotion(emotionSignals?.[key])
  );
  const isAchievement =
    hasAchievementAction ||
    (hasAchievementTopic &&
      /시작|진행|확인|수정|완료|성공|실행/.test(normalizedText));
  const isGoal =
    (hasGoalSignal && (hasTimeSignal || traceItem?.type !== undefined)) ||
    hasVacationPlanSignal;
  const isDailyContext = has(dailyContextPatterns) && !hasVacationPlanSignal;

  if (hasSensitiveSignal) {
    return buildMemorySavePolicy("sensitive_event");
  }

  if (isDailyContext) {
    return buildMemorySavePolicy("daily_context");
  }

  if (isAchievement) {
    return buildMemorySavePolicy("achievement");
  }

  if (hasExplicitGoalSignal) {
    return buildMemorySavePolicy("goal", { isExplicitGoal: true });
  }

  if (hasDreamSignal) {
    return buildMemorySavePolicy("dream");
  }

  if (hasRelationshipSignal) {
    return buildMemorySavePolicy("relationship");
  }

  if (isGoal) {
    return buildMemorySavePolicy("goal");
  }

  if (hasIdeaSignal) {
    return buildMemorySavePolicy("idea");
  }

  if (hasHighNegativeEmotion) {
    return buildMemorySavePolicy("sensitive_event");
  }

  return buildMemorySavePolicy("none");
}

function isHighEmotion(value: EmotionLevel | number | undefined) {
  if (typeof value === "number") {
    return value >= 0.7;
  }

  return value === "High";
}

function calculateMemoryImportance(
  type: MemorySavePolicyType,
  options: { isExplicitGoal?: boolean } = {}
) {
  if (type === "goal" && options.isExplicitGoal) {
    return 88;
  }

  const importanceMap: Record<MemorySavePolicyType, number> = {
    sensitive_event: 100,
    achievement: 90,
    relationship: 80,
    dream: 85,
    goal: 78,
    project: 76,
    idea: 70,
    schedule: 60,
    todo: 65,
    task: 65,
    daily_plan: 65,
    note: 45,
    important_note: 75,
    daily_context: 40,
    none: 0,
  };

  return importanceMap[type];
}

function buildMemorySavePolicy(
  type: MemorySavePolicyType,
  options: { isExplicitGoal?: boolean } = {}
): MemorySavePolicy {
  const policyMap: Record<MemorySavePolicyType, Omit<MemorySavePolicy, "importance">> = {
    sensitive_event: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "최근 사건",
    },
    achievement: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "성과",
      saveTargets: ["daily_piece", "daily_trace"],
    },
    relationship: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "관계",
      saveTargets: ["daily_piece"],
    },
    dream: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "꿈",
      saveTargets: ["dream_piece", "daily_trace"],
    },
    goal: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "목표",
      saveTargets: ["dream_piece", "daily_trace"],
    },
    project: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "프로젝트",
      saveTargets: ["dream_piece", "dream_fragment"],
      dreamRole: "fragment",
    },
    idea: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "아이디어",
      saveTargets: ["daily_piece"],
    },
    schedule: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "일정",
      saveTargets: ["daily_trace"],
    },
    todo: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "할 일",
      saveTargets: ["daily_trace"],
    },
    task: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "할 일",
      saveTargets: ["daily_trace"],
    },
    daily_plan: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "계획",
      saveTargets: ["daily_trace"],
    },
    note: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "기록",
      saveTargets: ["daily_piece"],
    },
    important_note: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "중요 기록",
      saveTargets: ["daily_trace"],
    },
    daily_context: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "기록",
      saveTargets: ["daily_piece"],
    },
    none: {
      type,
      shouldSave: false,
      requiresConfirmation: false,
      label: "저장 안 함",
    },
  };

  return {
    ...policyMap[type],
    importance: calculateMemoryImportance(type, options),
  };
}
function getDailyPieceCategory(item: DailyTraceItem) {
  const text = `${item.title} ${item.memo ?? ""}`;

  if (item.type === "goal") return "목표";
  if (item.type === "todo") return "할 일";
  if (item.type === "quote") return "문장";
  if (/친구|사람|관계|만남|연락|가족|동료/.test(text)) return "관계";
  if (/개발|완성|시작|저장|확인|성공|공부|포트폴리오|프로젝트/.test(text)) {
    return "성과";
  }
  if (/꿈|놀랐|무서|병원|예비군|훈련|학교|출근|약속/.test(text)) return "사건";

  return item.type === "schedule" ? "사건" : "기록";
}

function formatRelativeTraceDate(dateText: string) {
  const targetDate = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(targetDate.getTime())) {
    return dateText;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (todayStart.getTime() - targetDate.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  return `${diffDays}일 전`;
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

function toProjectChatHistory(messages: NoieProjectMessage[]) {
  return messages.slice(-20).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function flattenEmotionAdminView(
  analysis: AnalyzeEmotionResponse
): ProjectEmotionAdminView {
  return {
    like: analysis.admin_view.primary_axis.like,
    dislike: analysis.admin_view.primary_axis.dislike,
    ...analysis.admin_view.emotion_axis,
  };
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

function formatDDay(deadline?: string) {
  const normalizedDeadline = normalizeDeadlineInput(deadline ?? "");
  if (!normalizedDeadline) {
    return "";
  }

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const deadlineDate = new Date(`${normalizedDeadline}T00:00:00`);

  if (Number.isNaN(deadlineDate.getTime())) {
    return "";
  }

  const diffDays = Math.round(
    (deadlineDate.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays === 0) {
    return "D-Day";
  }

  return diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
}

function normalizeDeadlineInput(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  const compactMatch = trimmedValue.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  const separatedMatch = trimmedValue.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (separatedMatch) {
    return `${separatedMatch[1]}-${separatedMatch[2].padStart(
      2,
      "0"
    )}-${separatedMatch[3].padStart(2, "0")}`;
  }

  return "";
}

function isDailyTraceType(value: string): value is DailyTraceItemType {
  return ["schedule", "record", "todo", "quote", "goal"].includes(value);
}

function getGoalTargetLabel(
  item: {
    targetDate?: string | null;
    targetYear?: string | null;
    targetText?: string | null;
  }
) {
  if (item.targetText && item.targetYear) {
    return `${item.targetYear}년쯤`;
  }

  if (item.targetYear) {
    return `${item.targetYear}년쯤`;
  }

  if (item.targetText) {
    return item.targetText;
  }

  if (item.targetDate) {
    return item.targetDate;
  }

  return "";
}

function getLocalDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function buildCalendarMonth(monthDate: Date) {
  const firstDay = getMonthStart(monthDate);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      date,
      isCurrentMonth: date.getMonth() === monthDate.getMonth(),
    };
  });
}

function formatMonthTitle(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function formatKoreanDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }

  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function sortDailyTraceItems(left: DailyTraceItem, right: DailyTraceItem) {
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }

  const leftTime = left.time ?? "99:99";
  const rightTime = right.time ?? "99:99";
  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function findPreviousUserMessage(messages: ChatMessage[], assistantMessageId: string) {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId
  );
  if (assistantIndex <= 0) {
    return undefined;
  }

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages[index];
    }
  }

  return undefined;
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
  projectCreateButton: {
    alignItems: "center",
    backgroundColor: "#171717",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginBottom: 8,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  projectCreateButtonText: {
    color: "#f2f4f8",
    fontSize: 13,
    fontWeight: "900",
  },
  projectItem: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  projectItemActive: { backgroundColor: "#2a2b32" },
  projectItemTitle: {
    color: "#d7d7d7",
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    marginRight: 8,
  },
  projectItemTitleActive: { color: "#ffffff" },
  projectDday: {
    color: "#34d399",
    fontSize: 12,
    fontWeight: "900",
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
  traceCandidateCard: {
    backgroundColor: "#0b0b0b",
    borderColor: "#343541",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  traceCandidateQuestion: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  traceCandidateTitle: {
    color: "#f2f4f8",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
  },
  traceCandidateMeta: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 5,
  },
  traceCandidateMemo: {
    color: "#c7c7c7",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  traceCandidateActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  traceConfirmButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 12,
  },
  traceConfirmButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
  },
  traceCancelButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 12,
  },
  traceCancelButtonText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
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
  projectShell: { flex: 1, backgroundColor: "#050505" },
  projectScroll: { flex: 1 },
  projectContent: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingBottom: 34,
  },
  projectHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 14,
  },
  projectHeaderTextBlock: { flex: 1, minWidth: 220 },
  projectTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  projectTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 30,
  },
  projectSubtitle: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  projectDdayBadge: {
    backgroundColor: "#123026",
    borderColor: "#1f6f55",
    borderRadius: 999,
    borderWidth: 1,
    color: "#34d399",
    fontSize: 13,
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  projectPanel: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  projectPanelHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  projectPanelTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 8,
  },
  projectGoalText: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 23,
  },
  projectFieldLabel: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 7,
    marginTop: 10,
  },
  projectInput: {
    backgroundColor: "#0a0a0a",
    borderColor: "#333333",
    borderRadius: 8,
    borderWidth: 1,
    color: "#ffffff",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  projectTextArea: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  projectPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 9,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  projectPrimaryButtonText: {
    color: "#050505",
    fontSize: 14,
    fontWeight: "900",
  },
  projectSecondaryButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  projectSecondaryButtonText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "900",
  },
  projectTinyButton: {
    borderColor: "#3a3a3a",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  projectTinyButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
  },
  projectEmptyText: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 21,
    paddingVertical: 10,
  },
  projectMessageRow: {
    flexDirection: "row",
    marginTop: 12,
  },
  projectUserMessageRow: { justifyContent: "flex-end" },
  projectAssistantMessageRow: { justifyContent: "flex-start" },
  projectMessageBubble: {
    borderRadius: 12,
    maxWidth: "90%",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  projectUserBubble: {
    backgroundColor: "#2f6fed",
    borderBottomRightRadius: 4,
  },
  projectAssistantBubble: {
    backgroundColor: "#171717",
    borderColor: "#2b2b2b",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  projectAssistantText: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 22,
  },
  projectArchiveRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  projectArchiveText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
  },
  projectDangerButton: {
    alignItems: "center",
    backgroundColor: "#3a1515",
    borderColor: "#7f1d1d",
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  projectDangerButtonText: {
    color: "#fecaca",
    fontSize: 13,
    fontWeight: "900",
  },
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
  dailyPiecesSection: {
    marginBottom: 14,
  },
  dailyPiecesTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 5,
  },
  dailyPiecesSubtitle: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginBottom: 10,
  },
  dailyPiecesCarousel: {
    paddingRight: 18,
  },
  dailyPieceCard: {
    backgroundColor: "#181818",
    borderColor: "#303030",
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 12,
    minHeight: 178,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  dailyPieceDateTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
  },
  dailyPieceList: {
    gap: 10,
  },
  dailyPieceText: {
    color: "#f2f4f8",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 23,
  },
  dailyPieceEmptyText: {
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 22,
  },
  dailyPiecesEmptyBox: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 86,
    padding: 14,
  },
  dailyPiecesEmptyText: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
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
  dreamPieceDate: {
    color: "#777777",
    fontSize: 11,
    marginTop: 8,
  },
  dreamPieceActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  dreamPieceActionButton: {
    borderColor: "#4a5568",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dreamPieceActionButtonMuted: {
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dreamPieceActionText: {
    color: "#e5e7eb",
    fontSize: 11,
    fontWeight: "800",
  },
  dreamPieceActionTextMuted: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "800",
  },
  traceHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  calendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  calendarNavButton: {
    alignItems: "center",
    backgroundColor: "#1c1c1c",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  calendarNavText: { color: "#ffffff", fontSize: 24, lineHeight: 26 },
  calendarMonthTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  weekdayText: {
    color: "#8f8f8f",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 16,
  },
  calendarDayCell: {
    alignItems: "center",
    aspectRatio: 1,
    borderRadius: 8,
    justifyContent: "center",
    position: "relative",
    width: `${100 / 7}%`,
  },
  calendarDayMuted: { opacity: 0.36 },
  calendarDaySelected: {
    backgroundColor: "#f2f4f8",
  },
  calendarDayText: {
    color: "#e5e7eb",
    fontSize: 13,
    fontWeight: "800",
  },
  calendarDayTextMuted: { color: "#8f8f8f" },
  calendarDayTextSelected: { color: "#050505" },
  calendarDot: {
    backgroundColor: "#34d399",
    borderRadius: 999,
    bottom: 7,
    height: 5,
    position: "absolute",
    width: 5,
  },
  traceDetail: {
    backgroundColor: "#0a0a0a",
    borderColor: "#242424",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  traceDateTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 6,
  },
  traceDetailTitle: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 12,
  },
  traceEmptyBox: {
    alignItems: "center",
    minHeight: 82,
    justifyContent: "center",
  },
  traceEmptyText: {
    color: "#a9a9a9",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  traceGroup: { marginBottom: 14 },
  traceGroupTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  traceListItem: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  traceListTextBlock: { flex: 1 },
  traceItemTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  traceItemDone: {
    color: "#8f8f8f",
    textDecorationLine: "line-through",
  },
  traceItemMemo: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  traceDeleteButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 9,
  },
  traceDeleteButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "800",
  },
  todoCheck: {
    alignItems: "center",
    borderColor: "#555555",
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    marginTop: 1,
    width: 22,
  },
  todoCheckDone: {
    backgroundColor: "#34d399",
    borderColor: "#34d399",
  },
  todoCheckText: {
    color: "#050505",
    fontSize: 14,
    fontWeight: "900",
  },
});




















