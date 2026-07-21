import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
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
  ClipPath,
  Defs,
  G,
  Line,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import type {
  AnalysisSource,
  AnalyzeEmotionResponse,
  ChatApiResponse,
  ChatMessage,
  ChatSession,
  DailyPiece,
  DailyPieceGroup,
  DailyTraceCandidate,
  DailyTraceItem,
  DailyTraceItemType,
  DailyTraceStatus,
  DreamCompletionCriterion,
  DreamEvidence,
  DreamMilestone,
  DreamMilestonePriority,
  DreamMilestoneStatus,
  DreamProjectStatus,
  DreamRole,
  DreamRoutine,
  DreamRoutineDailySetting,
  DreamRoutineLifecycleStatus,
  DreamRoutineQuickScore,
  DreamRoutineRecord,
  DreamRoutineRecordType,
  DreamSavePromptKind,
  DreamSeason,
  DreamSeasonStatus,
  EmotionAxis,
  EmotionKey,
  EmotionLevel,
  EmotionRecord,
  EmotionSignals,
  ExtractDailyTraceResponse,
  GenerateTitleResponse,
  GoalDurationMonths,
  MemorySavePolicy,
  MemorySavePolicyType,
  NoieMemory,
  NoieProject,
  NoieProjectMessage,
  NumericEmotionAxis,
  PrimaryAxis,
  ProjectDailyActionRecord,
  ProjectEmotionAdminView,
  ProjectFormState,
  SaveDecision,
  SaveNoieMemoryResult,
  ScreenMode,
  StartProjectInput,
  WeeklyAverage
} from "./src/noie/types";
import {
  CURRENT_CHAT_ID_STORAGE_KEY,
  DAILY_TRACES_STORAGE_KEY,
  DEFAULT_FLOW_KEYS,
  DREAM_TORCH_ID_STORAGE_KEY,
  EMOTION_COLORS,
  EMOTION_KEYS,
  EMOTION_LABELS,
  MAX_FLOW_KEYS,
  MAX_TODAY_ME_CARDS,
  MAX_TODAY_ME_RECOMMENDATIONS,
  PROJECT_MESSAGES_STORAGE_KEY,
  PROJECTS_STORAGE_KEY,
  SESSIONS_STORAGE_KEY,
  TRACE_CONFIRM_LABELS,
  TRACE_QUESTION_LABELS,
  TRACE_TYPE_LABELS,
  emotionLabels,
  primaryLabels
} from "./src/noie/constants";
import {
  addMonths,
  addMonthsToLocalDate,
  addDays,
  buildCalendarMonth,
  enumerateDateKeys,
  formatDateDot,
  formatKoreanDate,
  formatMonthTitle,
  formatRelativeTraceDate,
  getGoalDurationMessage,
  getLocalDateString,
  getMonthStart,
  getSelectedGoalDuration,
  isValidDateKey,
  parseDateOnly,
} from "./src/noie/dateUtils";
import {
  normalizeDailyTraces,
  normalizeProjects,
} from "./src/noie/normalize";
import {
  loadStringValue,
  removeStorageValue,
  saveJsonValue,
  saveStringValue,
} from "./src/noie/storage";
import {
  getNextTodayMeOrder,
  getTodayMeProjects,
  isActiveTodayMeProject,
} from "./src/noie/selectors";

// 백엔드 API 주소입니다.
// 실제 휴대폰에서 Expo Go로 테스트할 때는 127.0.0.1 대신 PC의 내부 IPv4 주소로 바꿔주세요.
// 예: const API_BASE_URL = "http://192.168.0.10:8000";
const API_BASE_URL = "http://127.0.0.1:8000";
const DAILY_LONG_RECORDS_STORAGE_KEY = "noie_daily_long_records_v1";

type DailyLongRecord = {
  id: string;
  dateKey: string;
  title?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type NoieSaveRoute =
  | "routine_record"
  | "routine_create"
  | "routine_adjustment_intent"
  | "routine_adjustment_confirm"
  | "project_create"
  | "completed_action"
  | "completed_project"
  | "life_schedule_once"
  | "life_schedule_repeat"
  | "life_schedule_date_request"
  | "life_schedule_missing_date"
  | "life_schedule_reminder_update"
  | "life_schedule_cancel"
  | "life_action_record"
  | "dream_torch"
  | "dream_fragment"
  | "dream_fragment_rename"
  | "dream_fragment_complete"
  | "dream_fragment_next_action_update"
  | "daily_long_record_create"
  | "daily_long_record_title_update"
  | "daily_long_record_append"
  | "daily_trace_update"
  | "daily_trace"
  | "important_day_event"
  | "daily_idea"
  | "achievement"
  | "sensitive_event"
  | "none";

type NoieDestination =
  | "dream_torch"
  | "dream_fragment"
  | "today_me_routine"
  | "today_me_project"
  | "daily_trace"
  | "completed_action"
  | "completed_project"
  | "routine_execution"
  | "life_schedule"
  | "routine_update"
  | "project_update"
  | "none";

type NoieSuggestionAction =
  | "set_dream_torch"
  | "save_dream_fragment"
  | "create_routine"
  | "create_project"
  | "record_daily_trace"
  | "record_routine_execution"
  | "update_routine"
  | "complete_action"
  | "complete_project"
  | "save_life_schedule"
  | "record_life_action"
  | "select_schedule_date"
  | "end_routine"
  | "none";

type NoieSaveRoutingResult = {
  route: NoieSaveRoute;
  title: string;
  originalText: string;
  normalizedText: string;
  reason?: string;
  confidence: number;
  scheduledDate?: string | null;
  needsDateSelection?: boolean;
  recurrence?: "daily" | "weekly" | null;
  repeatType?: "daily" | "weekly" | null;
  targetValue?: number | null;
  minimumValue?: number | null;
  unit?: string;
  actualValue?: number | null;
  actualUnit?: string | null;
  displayValue?: number | null;
  displayUnit?: string | null;
  endTime?: string | null;
  endDisplayUnit?: string | null;
  reminder?: string | null;
  isExplicitOverride?: boolean;
  isSensitive?: boolean;
  isOtherPerson?: boolean;
  matchedRoutineId?: string | null;
  matchedProjectId?: string | null;
  matchedNextAction?: string | null;
  hasExistingRoutineRecord?: boolean;
  matchedDailyTraceId?: string | null;
  previousTitle?: string | null;
  nextTitle?: string | null;
  nextAction?: string | null;
  longRecordBody?: string | null;
  longRecordTitle?: string | null;
  isAdditiveRecord?: boolean;
};

type PendingRoutineAdjustment = {
  routineId: string;
  routineTitle: string;
  currentTargetValue: number;
  currentUnit: string;
  requestedValue?: number | null;
  applyMode?: "today" | "default" | null;
};

type RecordRoutineExecutionInput = {
  itemId?: string;
  routineId: string;
  dateKey: string;
  actualValue: number;
  unit?: string;
  source: "chat" | "button" | "manual_adjustment";
  originalText?: string;
  completedOnly?: boolean;
};

type RoutedChatMessage = ChatMessage & {
  saveRoutingResult?: NoieSaveRoutingResult;
};

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
  const repairedDreamFragmentLinksRef = useRef(false);
  const fallbackSession = useMemo(() => createEmptySession(), []);

  const [sessions, setSessions] = useState<ChatSession[]>([fallbackSession]);
  const [activeSessionId, setActiveSessionId] = useState(fallbackSession.id);
  const [dailyTraces, setDailyTraces] = useState<DailyTraceItem[]>([]);
  const [dailyLongRecords, setDailyLongRecords] = useState<DailyLongRecord[]>([]);
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
  const [savingDailyTraceMessageIds, setSavingDailyTraceMessageIds] = useState<string[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [screenMode, setScreenMode] = useState<ScreenMode>("chat");
  const [selectedFlowKeys, setSelectedFlowKeys] =
    useState<EmotionKey[]>(DEFAULT_FLOW_KEYS);
  const [showAllWeeklyAverages, setShowAllWeeklyAverages] = useState(false);
  const [todayMeFeedback, setTodayMeFeedback] = useState("");
  const [isStartingProject, setIsStartingProject] = useState(false);
  const [isSavingGoalDuration, setIsSavingGoalDuration] = useState(false);
  const [pendingRoutineAdjustment, setPendingRoutineAdjustment] =
    useState<PendingRoutineAdjustment | null>(null);

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
    if (!isHydrated || repairedDreamFragmentLinksRef.current) {
      return;
    }
    repairedDreamFragmentLinksRef.current = true;
    const now = new Date().toISOString();
    const repairedItems = repairRecentDreamFragmentLinks(dailyTraces, now);
    if (repairedItems === dailyTraces) {
      return;
    }
    setDailyTraces(repairedItems);
    saveJsonValue(DAILY_TRACES_STORAGE_KEY, repairedItems).catch((error) =>
      console.log("[noie] 꿈의 파편 연결 복구 실패", error)
    );
  }, [dailyTraces, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    saveJsonValue(SESSIONS_STORAGE_KEY, sessions).catch(
      (error) => console.log("[noie] 채팅 저장 실패", error)
    );
    saveStringValue(CURRENT_CHAT_ID_STORAGE_KEY, activeSessionId).catch(
      (error) => console.log("[noie] 현재 채팅 저장 실패", error)
    );
    saveJsonValue(DAILY_TRACES_STORAGE_KEY, dailyTraces).catch(
      (error) => console.log("[noie] 하루의 흔적 저장 실패", error)
    );
    saveJsonValue(DAILY_LONG_RECORDS_STORAGE_KEY, dailyLongRecords).catch(
      (error) => console.log("[noie] 날짜별 긴 기록 저장 실패", error)
    );
    if (dreamTorchId) {
      saveStringValue(DREAM_TORCH_ID_STORAGE_KEY, dreamTorchId).catch(
        (error) => console.log("[noie] dream torch save failed", error)
      );
    } else {
      removeStorageValue(DREAM_TORCH_ID_STORAGE_KEY).catch((error) =>
        console.log("[noie] dream torch clear failed", error)
      );
    }
    saveJsonValue(PROJECTS_STORAGE_KEY, projects).catch(
      (error) => console.log("[noie] 프로젝트 저장 실패", error)
    );
    saveJsonValue(PROJECT_MESSAGES_STORAGE_KEY, projectMessages).catch((error) => console.log("[noie] 프로젝트 메시지 저장 실패", error));
  }, [
    activeSessionId,
    dailyTraces,
    dailyLongRecords,
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
        savedDailyLongRecords,
        savedDreamTorchId,
        savedProjects,
        savedProjectMessages,
      ] =
        await Promise.all([
          loadStringValue(SESSIONS_STORAGE_KEY),
          loadStringValue(CURRENT_CHAT_ID_STORAGE_KEY),
          loadStringValue(DAILY_TRACES_STORAGE_KEY),
          loadStringValue(DAILY_LONG_RECORDS_STORAGE_KEY),
          loadStringValue(DREAM_TORCH_ID_STORAGE_KEY),
          loadStringValue(PROJECTS_STORAGE_KEY),
          loadStringValue(PROJECT_MESSAGES_STORAGE_KEY),
        ]);
      const parsedSessions = savedSessions
        ? (JSON.parse(savedSessions) as ChatSession[])
        : [];
      const parsedDailyTraces = savedDailyTraces
        ? (JSON.parse(savedDailyTraces) as DailyTraceItem[])
        : [];
      const parsedDailyLongRecords = savedDailyLongRecords
        ? (JSON.parse(savedDailyLongRecords) as DailyLongRecord[])
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

      if (normalizeDailyTraces(parsedDailyTraces).length >= 0) {
        const repairedDailyTraces = repairRoutineTitlesFromOriginalText(normalizeDailyTraces(parsedDailyTraces));
        const dedupedDailyTraces = dedupeMemories(repairedDailyTraces);
        setDailyTraces(dedupedDailyTraces);
        if (dedupedDailyTraces.length !== parsedDailyTraces.length || dedupedDailyTraces !== repairedDailyTraces) {
          saveJsonValue(DAILY_TRACES_STORAGE_KEY, dedupedDailyTraces).catch((error) => console.log("[noie] 하루의 흔적 중복 정리 실패", error));
        }
      }
      if (Array.isArray(parsedDailyLongRecords)) {
        setDailyLongRecords(normalizeDailyLongRecords(parsedDailyLongRecords));
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
      setDailyLongRecords([]);
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
      const recentDreamReference = findRecentDreamReference(activeSession.messages, dailyTraces);
      const routingResult = resolvePrimarySaveRoute({
        userText: trimmedText,
        saveDecision,
        memoryPolicy,
        existingItems: dailyTraces,
        dailyLongRecords,
        projects,
        pendingRoutineAdjustment,
        recentDreamReference,
      });
      const routedMemoryPolicy = getMemoryPolicyForRoute(memoryPolicy, routingResult);
      const assistantReply =
        routingResult.route === "life_schedule_missing_date"
          ? "날짜가 필요해요.\n“내일 오전 8시 30분에 일어나야 해”처럼\n날짜와 시간을 함께 말해 주세요."
          : routingResult.route === "none" && routingResult.reason?.includes("일정을 찾지 못함")
          ? "일정을 찾지 못했어요.\n날짜와 일정 이름을 함께 말해 주세요."
          : routingResult.route === "none" && routingResult.reason?.includes("취소할 일정을 찾지 못함")
          ? "취소할 일정을 찾지 못했어요.\n날짜와 일정 이름을 함께 말해 주세요."
          : isExplicitTorchReferenceText(trimmedText) && !recentDreamReference
          ? "어떤 꿈을 횃불로 밝힐까요?"
          : chatData.reply;
      const resolvedTraceCandidate = routingResult.route === "none"
        ? null
        : resolveDailyTraceCandidate(
        trimmedText,
        traceCandidate,
        routedMemoryPolicy
      );
      if (resolvedTraceCandidate) {
        if (routingResult.route === "routine_create") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = routingResult.targetValue
            ? `반복 · ${routingResult.repeatType === "weekly" ? "매주" : "매일"}\n오늘 목표 · ${routingResult.targetValue}${routingResult.unit ?? ""}`
            : `반복 · ${routingResult.repeatType === "weekly" ? "매주" : "매일"}`;
        }
        if (routingResult.route === "project_create") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "오늘의 나 프로젝트";
        }
        if (routingResult.route === "routine_record") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = `실제 수행량 · ${formatRoutineTarget(routingResult.displayValue ?? routingResult.actualValue ?? 0, routingResult.displayUnit ?? routingResult.actualUnit ?? routingResult.unit)}`;
        }
        if (routingResult.route === "important_day_event") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "오늘의 중요한 사건";
        }
        if (routingResult.route === "daily_idea") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "오늘의 아이디어";
        }
        if (routingResult.route === "daily_trace") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "하루의 흔적";
        }
        if (routingResult.route === "daily_long_record_create") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.title = getDailyLongRecordTitle(
            resolvedTraceCandidate.date,
            getLocalDateString(new Date())
          );
          resolvedTraceCandidate.memo = routingResult.longRecordBody ?? "";
        }
        if (routingResult.route === "daily_long_record_title_update") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.title = getDailyLongRecordTitle(
            resolvedTraceCandidate.date,
            getLocalDateString(new Date())
          );
          resolvedTraceCandidate.memo = routingResult.longRecordTitle ?? "";
        }
        if (routingResult.route === "daily_long_record_append") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.title = getDailyLongRecordTitle(
            resolvedTraceCandidate.date,
            getLocalDateString(new Date())
          );
          resolvedTraceCandidate.memo = routingResult.longRecordBody ?? "";
        }
        if (routingResult.route === "daily_trace_update") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = `${routingResult.previousTitle ?? ""}\n→ ${routingResult.nextTitle ?? ""}`;
        }
        if (routingResult.route === "completed_action") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "완료한 행동";
        }
        if (routingResult.route === "completed_project") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "완료한 프로젝트";
        }
        if (routingResult.route === "life_schedule_once" || routingResult.route === "life_schedule_repeat") {
          resolvedTraceCandidate.type = "todo";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo =
            routingResult.route === "life_schedule_repeat"
              ? "생활 반복 · 매일\n알림 · 시간에 맞춰"
              : "알림 · 시간에 맞춰";
        }
        if (routingResult.route === "life_schedule_date_request") {
          resolvedTraceCandidate.type = "todo";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
          resolvedTraceCandidate.memo = "날짜 선택 필요";
        }
        if (routingResult.route === "life_action_record") {
          resolvedTraceCandidate.type = "record";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "직접 기록";
        }
        if (routingResult.route === "life_schedule_reminder_update") {
          resolvedTraceCandidate.type = "todo";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = `${routingResult.previousTitle ?? ""}\n→ ${routingResult.unit ?? ""}`;
        }
        if (routingResult.route === "life_schedule_cancel") {
          resolvedTraceCandidate.type = "todo";
          resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
          resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "일정 취소";
        }
        if (routingResult.route === "routine_adjustment_intent") {
          resolvedTraceCandidate.type = "todo";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = routingResult.targetValue
            ? `현재 목표 · ${routingResult.targetValue}${routingResult.unit ?? ""}`
            : "얼마로 바꾸고 싶은지 알려주세요.";
        }
        if (routingResult.route === "routine_adjustment_confirm") {
          resolvedTraceCandidate.type = "todo";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = `변경 목표 · ${formatRoutineTargetForDisplay(routingResult.targetValue ?? 0, routingResult.unit)}`;
        }
        if (routingResult.route === "dream_fragment") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.title;
        }
        if (routingResult.route === "dream_torch") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.title;
        }
        if (routingResult.route === "dream_fragment_rename") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.previousTitle ?? routingResult.title;
          resolvedTraceCandidate.memo = `${routingResult.previousTitle ?? ""}\n→ ${routingResult.nextTitle ?? ""}`;
        }
        if (routingResult.route === "dream_fragment_complete") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = "꿈의 파편 완료";
        }
        if (routingResult.route === "dream_fragment_next_action_update") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = `다음 할 일\n→ ${routingResult.nextAction ?? ""}`;
        }
      }
      let dailyTraceStatus: DailyTraceStatus | undefined;
      let dailyTraceNotice: string | undefined;

      if (
        resolvedTraceCandidate &&
        routedMemoryPolicy.shouldSave &&
        routedMemoryPolicy.type !== "none"
      ) {
        if (routingResult.route === "dream_fragment" && isDuplicateDreamFragmentRoute(routingResult, dailyTraces)) {
          dailyTraceStatus = "duplicate";
          dailyTraceNotice = "이미 꿈의 파편에 남아 있어요.";
        } else if (isDuplicateLifeScheduleRoute(routingResult, dailyTraces)) {
          dailyTraceStatus = "duplicate";
          dailyTraceNotice = "이미 하루의 흔적에 같은 생활 반복이 있어요.";
        } else if (isDuplicateRoutineRoute(routingResult, dailyTraces)) {
          dailyTraceStatus = "duplicate";
          dailyTraceNotice = "이미 오늘의 나에 같은 반복 목표가 있어요.";
        } else if (routedMemoryPolicy.requiresConfirmation) {
          dailyTraceStatus = "pending";
          dailyTraceNotice = getPendingMemoryNotice(routedMemoryPolicy, isDreamOrGoalType(routedMemoryPolicy.type) ? getDreamSavePromptKind(trimmedText) : undefined, routingResult);
        } else if (saveDecision?.savePolicy !== "none") {
          const autoSavedItem = buildDailyTraceItem(
            resolvedTraceCandidate,
            trimmedText,
            assistantMessageId,
            now,
            routedMemoryPolicy
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
            ? getDuplicateMemoryNotice(routedMemoryPolicy)
            : getAutoSavedMemoryNotice(routedMemoryPolicy.type);
        }
      }

      if (routingResult.route === "routine_adjustment_intent" && routingResult.matchedRoutineId) {
        setPendingRoutineAdjustment({
          routineId: routingResult.matchedRoutineId,
          routineTitle: routingResult.title,
          currentTargetValue: routingResult.targetValue ?? 0,
          currentUnit: routingResult.unit ?? "",
        });
        dailyTraceStatus = "pending";
        dailyTraceNotice = getPendingMemoryNotice(routedMemoryPolicy, undefined, routingResult);
      }

      if (routingResult.route === "routine_adjustment_confirm") {
        dailyTraceStatus = "pending";
        dailyTraceNotice = getPendingMemoryNotice(routedMemoryPolicy, undefined, routingResult);
      }

      if (routingResult.route === "routine_record") {
        dailyTraceStatus = "pending";
        dailyTraceNotice = getPendingMemoryNotice(routedMemoryPolicy, undefined, routingResult);
      }

      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                id: assistantMessageId,
                role: "assistant",
                text: assistantReply,
                reply: assistantReply,
                stateSummary:
                  chatData.state_summary ||
                  chatData.analysis.user_view.state_summary,
                analysis: chatData.analysis,
                dailyTraceCandidate: resolvedTraceCandidate ?? undefined,
                dailyTraceStatus,
                dailyTraceNotice,
                dailyMemoryPolicy: routedMemoryPolicy,
                saveRoutingResult: routingResult,
                dreamSavePromptKind: routedMemoryPolicy.type === "project" && routingResult.route === "dream_fragment"
                  ? "fragment_first"
                  : isDreamOrGoalType(routedMemoryPolicy.type)
                  ? getDreamSavePromptKind(trimmedText)
                  : undefined,
                showAdminView: false,
                showSaveDecisionView: false,
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

  const toggleSaveDecisionView = (messageId: string) => {
    if (!activeSession) {
      return;
    }

    updateSession(activeSession.id, (session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId
          ? { ...message, showSaveDecisionView: !message.showSaveDecisionView }
          : message
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const readStoredDailyTraces = async () => {
    try {
      const savedDailyTraces = await loadStringValue(DAILY_TRACES_STORAGE_KEY);
      const parsedDailyTraces = savedDailyTraces
        ? (JSON.parse(savedDailyTraces) as DailyTraceItem[])
        : dailyTraces;

      return Array.isArray(parsedDailyTraces) ? parsedDailyTraces : dailyTraces;
    } catch (error) {
      console.log("[noie] 저장된 memories 읽기 실패", error);
      return dailyTraces;
    }
  };

  const mergeDreamTorchMemory = (
    currentItems: DailyTraceItem[],
    newItem: DailyTraceItem
  ) => {
    const newItemKey = getMemorySemanticKey(newItem);
    const existingTorch = currentItems.find((item) => {
      const isTorch = item.pinnedAsDreamTorch || item.dreamRole === "torch" || item.saveTargets?.includes("dream_torch");
      return isTorch && getMemorySemanticKey(item) === newItemKey;
    });

    if (!existingTorch) {
      return newItem;
    }

    return {
      ...existingTorch,
      ...newItem,
      id: existingTorch.id,
      createdAt: existingTorch.createdAt,
      goalStartDate: existingTorch.goalStartDate,
      goalTargetDate: existingTorch.goalTargetDate,
      goalDurationMonths: existingTorch.goalDurationMonths,
      completionCriteria: existingTorch.completionCriteria,
      currentSeason: existingTorch.currentSeason,
      seasons: existingTorch.seasons,
      activeSeasonId: existingTorch.activeSeasonId,
      milestones: existingTorch.milestones,
      currentMilestoneId: existingTorch.currentMilestoneId,
      evidence: existingTorch.evidence,
      routines: existingTorch.routines,
      routineRecords: existingTorch.routineRecords,
      overallProgress: existingTorch.overallProgress,
      baseProgress: existingTorch.baseProgress,
      paceBonus: existingTorch.paceBonus,
      progressUpdatedAt: existingTorch.progressUpdatedAt,
      pinnedAsDreamTorch: true,
      dreamRole: "torch" as const,
      hiddenFromDream: false,
      updatedAt: newItem.updatedAt,
    };
  };

  const buildDreamSaveMemories = (
    currentItems: DailyTraceItem[],
    newItem: DailyTraceItem,
    options: { replaceTorch: boolean }
  ) => {
    const now = new Date().toISOString();
    const itemToSave = options.replaceTorch
      ? mergeDreamTorchMemory(currentItems, newItem)
      : newItem;
    const sourceMemories = options.replaceTorch
      ? currentItems
          .filter((item) => item.id !== itemToSave.id)
          .map((item) =>
            item.pinnedAsDreamTorch
              ? { ...item, pinnedAsDreamTorch: false, updatedAt: now }
              : item
          )
      : currentItems;

    return dedupeMemories([...sourceMemories, itemToSave]);
  };

  const applyDreamSaveResult = async (
    messageId: string,
    newItem: DailyTraceItem,
    notice: string,
    options: { replaceTorch: boolean }
  ) => {
    const storedMemories = await readStoredDailyTraces();
    const mergedSourceMemories = dedupeMemories([...storedMemories, ...dailyTraces]);
    const updatedMemories = buildDreamSaveMemories(
      mergedSourceMemories,
      newItem,
      options
    );
    const savedItem = updatedMemories.find((item) => getMemorySemanticKey(item) === getMemorySemanticKey(newItem)) ?? newItem;
    const now = new Date().toISOString();

    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, updatedMemories);
    setDailyTraces(updatedMemories);

    if (options.replaceTorch) {
      setDreamTorchId(savedItem.id);
    }

    console.log(options.replaceTorch ? "[dream-torch-saved]" : "[dream-fragment-saved]", {
      id: savedItem.id,
      title: savedItem.title,
      count: updatedMemories.length,
    });

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === messageId
          ? {
              ...item,
              dailyTraceStatus: "added",
              dailyTraceNotice: notice,
            }
          : item
      ),
      updatedAt: now,
    }));
  };

  const handleSaveAsDreamTorch = async (
    message: ChatMessage,
    candidate: DailyTraceCandidate,
    messageText: string
  ) => {
    const now = new Date().toISOString();
    const routingResult = (message as RoutedChatMessage).saveRoutingResult;
    if (routingResult?.matchedDailyTraceId) {
      const targetItem = dailyTraces.find((item) => item.id === routingResult.matchedDailyTraceId);
      if (targetItem) {
        const nextItems = dailyTraces.map((item) => {
          if (item.id === targetItem.id) {
            return {
              ...item,
              saveTargets: Array.from(new Set([...(item.saveTargets ?? []), "dream_torch"])) as SaveDecision["saveTargets"],
              dreamRole: "torch" as DreamRole,
              pinnedAsDreamTorch: true,
              hiddenFromDream: false,
              updatedAt: now,
            };
          }

          return item.pinnedAsDreamTorch || item.dreamRole === "torch"
            ? {
                ...item,
                pinnedAsDreamTorch: false,
                dreamRole: item.dreamRole === "torch" ? undefined : item.dreamRole,
                updatedAt: now,
              }
            : item;
        });
        setDailyTraces(nextItems);
        setDreamTorchId(targetItem.id);
        await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
        await saveStringValue(DREAM_TORCH_ID_STORAGE_KEY, targetItem.id);
        updateSession(activeSession?.id ?? activeSessionId, (session) => ({
          ...session,
          messages: session.messages.map((item) =>
            item.id === message.id
              ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "꿈의 횃불로 밝혔어요." }
              : item
          ),
          updatedAt: now,
        }));
        return;
      }
    }

    const baseMemoryPolicy = message.dailyMemoryPolicy ?? buildMemorySavePolicy("dream");
    const memoryPolicy: MemorySavePolicy = {
      ...baseMemoryPolicy,
      type: isDreamOrGoalType(baseMemoryPolicy.type) ? baseMemoryPolicy.type : "dream",
      shouldSave: true,
      requiresConfirmation: true,
      importance: baseMemoryPolicy.importance ?? 90,
      label: baseMemoryPolicy.label ?? "꿈",
      saveTargets: ["dream_torch"],
      dreamRole: "torch",
    };
    const newItem: DailyTraceItem = {
      ...buildDailyTraceItem(candidate, messageText, message.id, now, memoryPolicy),
      title: routingResult?.title ?? makeMemoryTitle(messageText),
      memo: routingResult?.title ?? messageText,
      text: routingResult?.title ?? messageText,
      sourceText: routingResult?.title ?? messageText,
      memoryType: memoryPolicy.type,
      saveTargets: ["dream_torch"],
      importance: memoryPolicy.importance,
      dreamRole: "torch",
      pinnedAsDreamTorch: true,
      hiddenFromDream: false,
    };

    await applyDreamSaveResult(message.id, newItem, "꿈의 횃불에 저장했어요.", {
      replaceTorch: true,
    });
  };

  const handleSaveAsDreamFragment = async (
    message: ChatMessage,
    candidate: DailyTraceCandidate,
    messageText: string
  ) => {
    const now = new Date().toISOString();
    const memoryPolicy: MemorySavePolicy = {
      ...(message.dailyMemoryPolicy ?? buildMemorySavePolicy("project")),
      type: "project",
      shouldSave: true,
      requiresConfirmation: true,
      importance: message.dailyMemoryPolicy?.importance ?? 70,
      label: "프로젝트",
      saveTargets: ["dream_fragment"],
      dreamRole: "fragment",
    };
    const newItem: DailyTraceItem = {
      ...buildDailyTraceItem(candidate, messageText, message.id, now, memoryPolicy),
      title: makeMemoryTitle(messageText),
      memo: messageText,
      text: messageText,
      originalText: messageText,
      sourceText: messageText,
      memoryType: "project",
      saveTargets: ["dream_fragment"],
      importance: Math.max(memoryPolicy.importance, 96),
      dreamRole: "fragment",
      pinnedAsDreamTorch: false,
      hiddenFromDream: false,
      relatedDreamTorchId: selectDreamTorchPiece(getDreamTorchCandidates(dailyTraces), dreamTorchId)?.id,
      linkedProjectId: undefined,
      projectStatus: "idea",
      nextAction: "",
      progressPercent: 0,
    };

    const storedMemories = await readStoredDailyTraces();
    if (hasDuplicateDreamFragment(storedMemories, messageText)) {
      updateSession(activeSession?.id ?? activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === message.id
            ? { ...item, dailyTraceStatus: "duplicate", dailyTraceNotice: "이미 꿈의 파편에 있는 내용이에요." }
            : item
        ),
        updatedAt: now,
      }));
      return;
    }

    await applyDreamSaveResult(message.id, newItem, "꿈의 파편에 저장했어요.", {
      replaceTorch: false,
    });
  };
  const handleSaveTodayMeRoutine = async (
    message: RoutedChatMessage,
    candidate: DailyTraceCandidate,
    routingResult: NoieSaveRoutingResult
  ) => {
    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());
    const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(dailyTraces), dreamTorchId);
    const targetTorch = torchPiece ?? {
      id: createId("dream"),
      type: "goal" as DailyTraceItemType,
      date: today,
      title: "오늘의 나",
      memo: "오늘 집중할 반복 목표",
      text: "오늘의 나",
      sourceText: "오늘의 나",
      memoryType: "goal" as MemorySavePolicyType,
      saveTargets: ["dream_torch"] as SaveDecision["saveTargets"],
      importance: 60,
      dreamRole: "torch" as DreamRole,
      pinnedAsDreamTorch: true,
      hiddenFromDream: false,
      createdAt: now,
      updatedAt: now,
      routines: [],
      routineRecords: [],
    };
    const routineTitle = routingResult.title || candidate.title;
    const routineKey = normalizeRoutineTitleKey(routineTitle);
    const existingRoutine = (targetTorch.routines ?? []).find(
      (routine) => isRoutineAvailableForTodayMe(routine) && normalizeRoutineTitleKey(routine.title) === routineKey
    );
    const todayMeDreamFragments = getDreamFragments(dailyTraces).filter((piece) => piece.id !== targetTorch.id);
    const activeCardCount = getVisibleTodayMeCards(targetTorch, todayMeDreamFragments, projects, today).length;
    const isExistingRoutineVisible = existingRoutine ? isActiveTodayMeRoutine(existingRoutine) : false;

    if (existingRoutine && isExistingRoutineVisible) {
      updateSession(activeSession?.id ?? activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === message.id
            ? { ...item, dailyTraceStatus: "duplicate", dailyTraceNotice: "이미 오늘의 나에 같은 반복 목표가 있어요." }
            : item
        ),
        updatedAt: now,
      }));
      return;
    }

    if (activeCardCount >= MAX_TODAY_ME_CARDS) {
      updateSession(activeSession?.id ?? activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                dailyTraceStatus: "pending",
                dailyTraceNotice: "오늘의 나는 네 가지에만 집중할 수 있어요.\n기존 목표나 프로젝트를 완료하거나 정리한 뒤 추가해보세요.",
              }
            : item
        ),
        updatedAt: now,
      }));
      return;
    }

    if (existingRoutine) {
      const nextTorch: DailyTraceItem = {
        ...targetTorch,
        routines: (targetTorch.routines ?? []).map((routine) =>
          routine.id === existingRoutine.id
            ? {
                ...routine,
                lifecycleStatus: "active",
                archivedFromTodayMe: false,
                active: true,
                updatedAt: now,
              }
            : routine
        ),
        updatedAt: now,
      };
      const nextItems = torchPiece
        ? dailyTraces.map((item) => item.id === nextTorch.id ? nextTorch : item)
        : dedupeMemories([
            ...dailyTraces.map((item) =>
              item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
            ),
            nextTorch,
          ]);

      setDailyTraces(nextItems);
      await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
      if (!torchPiece) {
        setDreamTorchId(nextTorch.id);
      }

      updateSession(activeSession?.id ?? activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === message.id
            ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "기존 반복 목표를 오늘의 나에 다시 담았어요." }
            : item
        ),
        updatedAt: now,
      }));
      return;
    }

    const newRoutine: DreamRoutine = {
      id: createId("routine"),
      title: routineTitle,
      recordType: "quantity",
      repeatType: routingResult.repeatType ?? "daily",
      targetValue: routingResult.targetValue ?? undefined,
      minimumValue: routingResult.minimumValue ?? 0,
      unit: routingResult.unit,
      dailySettings: {},
      lifecycleStatus: "active",
      archivedFromTodayMe: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const nextTorch: DailyTraceItem = {
      ...targetTorch,
      routines: [...(targetTorch.routines ?? []), newRoutine],
      updatedAt: now,
    };
    const nextItems = torchPiece
      ? dailyTraces.map((item) => item.id === nextTorch.id ? nextTorch : item)
      : dedupeMemories([
          ...dailyTraces.map((item) =>
            item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
          ),
          nextTorch,
        ]);

    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
    if (!torchPiece) {
      setDreamTorchId(nextTorch.id);
    }

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "오늘의 나에 저장했어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const handleSaveTodayMeProjectFromChat = async (
    message: RoutedChatMessage,
    candidate: DailyTraceCandidate,
    routingResult: NoieSaveRoutingResult
  ) => {
    const now = new Date().toISOString();
    const sourceUserMessage = findPreviousUserMessage(activeSession?.messages ?? [], message.id);
    const originalText = sourceUserMessage?.text ?? routingResult.originalText ?? candidate.memo ?? candidate.title;
    const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(dailyTraces), dreamTorchId);
    const duplicateProject = findDuplicateProjectRoute(routingResult, projects);

    if (duplicateProject) {
      updateSession(activeSession?.id ?? activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                dailyTraceStatus: "duplicate",
                dailyTraceNotice: "이미 진행 중인 프로젝트예요.",
              }
            : item
        ),
        updatedAt: now,
      }));
      return;
    }

    const started = await handleStartProjectInTodayMe({
      title: routingResult.title || candidate.title,
      originalText,
      relatedDreamTorchId: torchPiece?.id ?? null,
      relatedDreamFragmentId: null,
      source: "chat",
    });

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? {
              ...item,
              dailyTraceStatus: started ? "added" : "pending",
              dailyTraceNotice: started ? "오늘의 나에 프로젝트를 담았어요." : "오늘의 나에 담지 못했어요.",
            }
          : item
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const addRoutineToTodayMe = async (input: { title: string; targetValue: number }) => {
    const routineTitle = input.title.trim();
    if (!routineTitle) {
      setTodayMeFeedback("반복 목표 이름을 입력해 주세요.");
      return false;
    }

    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());
    const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(dailyTraces), dreamTorchId);
    const targetTorch = torchPiece ?? {
      id: createId("dream"),
      type: "goal" as DailyTraceItemType,
      date: today,
      title: "오늘의 나",
      memo: "오늘 집중할 반복 목표",
      text: "오늘의 나",
      sourceText: "오늘의 나",
      memoryType: "goal" as MemorySavePolicyType,
      saveTargets: ["dream_torch"] as SaveDecision["saveTargets"],
      importance: 60,
      dreamRole: "torch" as DreamRole,
      pinnedAsDreamTorch: true,
      hiddenFromDream: false,
      createdAt: now,
      updatedAt: now,
      routines: [],
      routineRecords: [],
    };
    const titleKey = normalizeMemoryInput(routineTitle);
    const existingRoutine = (targetTorch.routines ?? []).find(
      (routine) => normalizeMemoryInput(routine.title) === titleKey
    );

    if (existingRoutine) {
      setTodayMeFeedback("이미 같은 반복 목표가 있어요.");
      return false;
    }

    const todayMeDreamFragments = getDreamFragments(dailyTraces).filter((piece) => piece.id !== targetTorch.id);
    const activeRoutineCount = getVisibleTodayMeCards(targetTorch, todayMeDreamFragments, projects, today).filter(
      (card) => card.cardType === "routine"
    ).length;
    if (activeRoutineCount >= MAX_TODAY_ME_CARDS) {
      setTodayMeFeedback("오늘의 나는 네 가지에만 집중할 수 있어요. 기존 목표를 정리한 뒤 추가해보세요.");
      return false;
    }

    const newRoutine: DreamRoutine = {
      id: createId("routine"),
      title: routineTitle,
      recordType: "quantity",
      repeatType: "daily",
      targetValue: Math.max(30, input.targetValue),
      minimumValue: 0,
      unit: "분",
      dailySettings: {},
      lifecycleStatus: "active",
      archivedFromTodayMe: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    const nextTorch: DailyTraceItem = {
      ...targetTorch,
      routines: [...(targetTorch.routines ?? []), newRoutine],
      updatedAt: now,
    };
    const nextItems = torchPiece
      ? dailyTraces.map((item) => item.id === nextTorch.id ? nextTorch : item)
      : dedupeMemories([
          ...dailyTraces.map((item) =>
            item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
          ),
          nextTorch,
        ]);

    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
    if (!torchPiece) {
      setDreamTorchId(nextTorch.id);
    }
    setTodayMeFeedback("반복 목표를 오늘의 나에 담았어요.");
    return true;
  };

  const handleConfirmRoutineAdjustment = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult,
    action?: "today" | "tomorrow" | "default" | "archive" | "continue" | "open_calendar"
  ) => {
    if (!routingResult.matchedRoutineId || typeof routingResult.targetValue !== "number") {
      return;
    }
    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());
    const applyMode = action === "today" ? "today" : "default";
    const nextItems = dailyTraces.map((item) => ({
      ...item,
      routines: (item.routines ?? []).map((routine) => {
        if (routine.id !== routingResult.matchedRoutineId) {
          return routine;
        }
        if (applyMode === "default") {
          return {
            ...routine,
            targetValue: routingResult.targetValue ?? routine.targetValue,
            minimumValue: 0,
            unit: routingResult.unit ?? routine.unit,
            updatedAt: now,
          };
        }
        return {
          ...routine,
          dailySettings: {
            ...(routine.dailySettings ?? {}),
            [today]: {
              ...(routine.dailySettings?.[today] ?? {}),
              targetValue: routingResult.targetValue ?? routine.targetValue,
              minimumValue: 0,
              unit: routingResult.unit ?? routine.unit,
              updatedAt: now,
            },
          },
          updatedAt: now,
        };
      }),
      updatedAt: (item.routines ?? []).some((routine) => routine.id === routingResult.matchedRoutineId)
        ? now
        : item.updatedAt,
    }));
    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
    setPendingRoutineAdjustment(null);
    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? {
              ...item,
              dailyTraceStatus: "added",
              dailyTraceNotice:
                applyMode === "default"
                  ? `기본 목표를 ${formatRoutineTarget(routingResult.targetValue ?? 0, routingResult.unit)}으로 변경했어요.`
                  : `오늘 목표만 ${formatRoutineTarget(routingResult.targetValue ?? 0, routingResult.unit)}으로 변경했어요.`,
            }
          : item
      ),
      updatedAt: now,
    }));
  };

  const handleConfirmCompletedProject = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedProjectId) {
      return;
    }
    const now = new Date().toISOString();
    const nextProjects = projects.map((project) =>
      project.id === routingResult.matchedProjectId
        ? {
            ...project,
            status: "done" as DreamProjectStatus,
            archivedFromTodayMe: true,
            completedAt: now,
            updatedAt: now,
          }
        : project
    );
    setProjects(nextProjects);
    await saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects);

    const today = getLocalDateString(new Date());
    const completedTraceSourceId = `completed_project:${routingResult.matchedProjectId}:${today}`;
    const hasCompletedTrace = dailyTraces.some((item) => {
      const typedItem = item as DailyTraceItem & { sourceId?: string };
      return typedItem.sourceId === completedTraceSourceId;
    });
    if (!hasCompletedTrace) {
      const completedTrace = {
        id: createId("trace"),
        type: "record" as DailyTraceItemType,
        date: today,
        title: `${routingResult.title} 프로젝트 완료`,
        memo: "완료한 프로젝트",
        text: routingResult.originalText,
        originalText: routingResult.originalText,
        sourceText: routingResult.originalText,
        memoryType: "achievement" as MemorySavePolicyType,
        saveTargets: ["daily_piece", "daily_trace"] as SaveDecision["saveTargets"],
        importance: 94,
        displayCategory: "완료한 프로젝트",
        category: "completed_project",
        sourceType: "completed_project",
        sourceId: completedTraceSourceId,
        createdAt: now,
      } as DailyTraceItem;
      const nextItems = saveNoieMemory(dailyTraces, completedTrace, routingResult.originalText, {
        shouldLog: false,
      }).items;
      setDailyTraces(nextItems);
      await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
    }

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "완료한 프로젝트로 보관했어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const handleRenameDreamFragment = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedDailyTraceId || !routingResult.nextTitle?.trim()) {
      return;
    }

    const now = new Date().toISOString();
    const nextTitle = routingResult.nextTitle.trim();
    const nextItems = dailyTraces.map((item) =>
      item.id === routingResult.matchedDailyTraceId
        ? {
            ...item,
            title: nextTitle,
            updatedAt: now,
          }
        : item
    );
    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "꿈의 파편 이름을 바꿨어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const handleCompleteDreamFragment = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedDailyTraceId) {
      return;
    }

    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());
    const fragment = dailyTraces.find((item) => item.id === routingResult.matchedDailyTraceId);
    if (!fragment) {
      return;
    }

    const completionSourceId = `dream_fragment_complete:${fragment.id}:${today}`;
    const nextItemsBase = dailyTraces.map((item) =>
      item.id === fragment.id
        ? {
            ...item,
            projectStatus: "done" as DreamProjectStatus,
            completedAt: (item as DailyTraceItem & { completedAt?: string }).completedAt ?? now,
            updatedAt: now,
          } as DailyTraceItem
        : item
    );
    const hasCompletionTrace = nextItemsBase.some((item) => {
      const typedItem = item as DailyTraceItem & { sourceId?: string };
      return typedItem.sourceId === completionSourceId;
    });
    const nextItems = hasCompletionTrace
      ? nextItemsBase
      : [
          ...nextItemsBase,
          {
            id: createId("trace"),
            type: "record" as DailyTraceItemType,
            date: today,
            title: `${fragment.title} 완료`,
            memo: "꿈의 파편",
            text: routingResult.originalText,
            originalText: routingResult.originalText,
            sourceText: routingResult.originalText,
            memoryType: "achievement" as MemorySavePolicyType,
            saveTargets: ["daily_piece", "daily_trace"] as SaveDecision["saveTargets"],
            importance: 94,
            displayCategory: "꿈의 파편 완료",
            category: "dream_fragment_complete",
            sourceType: "dream_fragment_complete",
            sourceId: completionSourceId,
            relatedDreamTorchId: fragment.relatedDreamTorchId,
            createdAt: now,
          } as DailyTraceItem,
        ];

    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "꿈의 파편을 완료했어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const handleUpdateDreamFragmentNextAction = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedDailyTraceId || !routingResult.nextAction?.trim()) {
      return;
    }

    const now = new Date().toISOString();
    const nextAction = routingResult.nextAction.trim();
    const nextItems = dailyTraces.map((item) =>
      item.id === routingResult.matchedDailyTraceId
        ? {
            ...item,
            nextAction,
            updatedAt: now,
          }
        : item
    );
    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "다음 할 일을 바꿨어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const markMatchedProjectNextActionDone = async (
    routingResult: NoieSaveRoutingResult,
    completedAt: string
  ) => {
    if (routingResult.route !== "completed_action" || !routingResult.matchedProjectId) {
      return;
    }
    const today = getLocalDateString(new Date());
    const nextProjects = projects.map((project) => {
      if (project.id !== routingResult.matchedProjectId) {
        return project;
      }
      const action = routingResult.matchedNextAction ?? project.nextAction?.trim() ?? routingResult.title;
      return {
        ...project,
        dailyActionRecords: {
          ...(project.dailyActionRecords ?? {}),
          [today]: {
            action,
            completed: true,
            source: "quick_check" as const,
            createdAt: project.dailyActionRecords?.[today]?.createdAt ?? completedAt,
            updatedAt: completedAt,
          },
        },
        updatedAt: completedAt,
      };
    });
    setProjects(nextProjects);
    await saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects);
  };

  const confirmDailyTrace = async (
    messageId: string,
    dreamRole?: DreamRole,
    action?: "today" | "tomorrow" | "default" | "archive" | "continue" | "open_calendar"
  ) => {
    if (!activeSession || savingDailyTraceMessageIds.includes(messageId)) {
      return;
    }

    const message = activeSession.messages.find((item) => item.id === messageId);
    const candidate = message?.dailyTraceCandidate;
    if (
      !message ||
      !candidate ||
      message.dailyTraceStatus === "added" ||
      message.dailyTraceStatus === "duplicate" ||
      message.dailyTraceStatus === "dismissed"
    ) {
      return;
    }

    setSavingDailyTraceMessageIds((currentIds) =>
      currentIds.includes(messageId) ? currentIds : [...currentIds, messageId]
    );

    try {
      const now = new Date().toISOString();
      const sourceUserMessage = findPreviousUserMessage(activeSession.messages, messageId);
      const memoryInput = getMemoryInputText({
        title: candidate.title,
        memo: candidate.memo,
        sourceText: sourceUserMessage?.text,
      });
      const routingResult = (message as RoutedChatMessage).saveRoutingResult;

      if (routingResult?.route === "life_schedule_date_request") {
        if (action === "open_calendar") {
          setScreenMode("dailyTrace");
          updateSession(activeSession.id, (session) => ({
            ...session,
            messages: session.messages.map((item) =>
              item.id === messageId
                ? { ...item, dailyTraceStatus: "dismissed", dailyTraceNotice: "하루의 흔적에서 날짜를 선택해 주세요." }
                : item
            ),
            updatedAt: now,
          }));
          return;
        }

        if (action !== "today" && action !== "tomorrow") {
          updateSession(activeSession.id, (session) => ({
            ...session,
            messages: session.messages.map((item) =>
              item.id === messageId
                ? { ...item, dailyTraceStatus: "dismissed", dailyTraceNotice: "저장하지 않았어요." }
                : item
            ),
            updatedAt: now,
          }));
          return;
        }

        const selectedDateKey = getLocalDateString(addDays(new Date(), action === "tomorrow" ? 1 : 0));
        candidate.date = selectedDateKey;
        candidate.type = "todo";
        candidate.title = routingResult.title;
        candidate.time = routingResult.displayUnit ?? candidate.time;
        candidate.memo = "알림 · 시간에 맞춰";
        routingResult.route = "life_schedule_once";
        routingResult.scheduledDate = selectedDateKey;
        routingResult.needsDateSelection = false;
      }

      if (routingResult?.route === "routine_create") {
        await handleSaveTodayMeRoutine(message as RoutedChatMessage, candidate, routingResult);
        return;
      }

      if (routingResult?.route === "daily_long_record_create") {
        await saveChatDailyLongRecord(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "daily_long_record_title_update") {
        await updateChatDailyLongRecordTitle(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "daily_long_record_append") {
        await appendChatDailyLongRecord(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "daily_trace_update") {
        await updateRecentDailyTraceLine(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "life_schedule_reminder_update") {
        await updateLifeScheduleReminder(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "life_schedule_cancel") {
        await cancelLifeSchedule(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "project_create") {
        await handleSaveTodayMeProjectFromChat(message as RoutedChatMessage, candidate, routingResult);
        return;
      }

      if (routingResult?.route === "routine_adjustment_confirm") {
        await handleConfirmRoutineAdjustment(message as RoutedChatMessage, routingResult, action);
        return;
      }

      if (routingResult?.route === "routine_record") {
        if (!routingResult.matchedRoutineId || typeof routingResult.actualValue !== "number") {
          updateSession(activeSession.id, (session) => ({
            ...session,
            messages: session.messages.map((item) =>
              item.id === messageId
                ? { ...item, dailyTraceStatus: "dismissed", dailyTraceNotice: "기록할 반복 목표를 찾지 못했어요." }
                : item
            ),
            updatedAt: now,
          }));
          return;
        }

        const didRecord = await recordRoutineExecution({
          routineId: routingResult.matchedRoutineId,
          dateKey: candidate.date,
          actualValue: routingResult.actualValue,
          unit: routingResult.actualUnit ?? routingResult.unit,
          source: "chat",
          originalText: sourceUserMessage?.text ?? memoryInput,
        });

        updateSession(activeSession.id, (session) => ({
          ...session,
          messages: session.messages.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  dailyTraceStatus: didRecord ? "added" : "dismissed",
                  dailyTraceNotice: didRecord ? "반복 목표 수행으로 기록했어요." : "기록할 반복 목표를 찾지 못했어요.",
                }
              : item
          ),
          updatedAt: now,
        }));
        return;
      }

      if (routingResult?.route === "dream_fragment_rename") {
        await handleRenameDreamFragment(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "dream_fragment_complete") {
        await handleCompleteDreamFragment(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "dream_fragment_next_action_update") {
        await handleUpdateDreamFragmentNextAction(message as RoutedChatMessage, routingResult);
        return;
      }

      if (routingResult?.route === "completed_project") {
        if (action === "archive") {
          await handleConfirmCompletedProject(message as RoutedChatMessage, routingResult);
        } else {
          updateSession(activeSession.id, (session) => ({
            ...session,
            messages: session.messages.map((item) =>
              item.id === messageId
                ? { ...item, dailyTraceStatus: "dismissed", dailyTraceNotice: "계속 진행할게요." }
                : item
            ),
            updatedAt: now,
          }));
        }
        return;
      }

      if (dreamRole === "torch") {
        await handleSaveAsDreamTorch(
          message,
          candidate,
          sourceUserMessage?.text ?? memoryInput
        );
        return;
      }

      if (dreamRole === "fragment") {
        await handleSaveAsDreamFragment(
          message,
          candidate,
          sourceUserMessage?.text ?? memoryInput
        );
        return;
      }

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
      const baseItem = buildDailyTraceItem(
        candidate,
        sourceUserMessage?.text ?? memoryInput,
        messageId,
        now,
        selectedMemoryPolicy
      );
      const newItem = applyRoutingFieldsToDailyTrace(baseItem, routingResult);
      if (routingResult?.route === "completed_action") {
        await markMatchedProjectNextActionDone(routingResult, now);
      }
      const saveResult = saveNoieMemory(dailyTraces, newItem, memoryInput, {
        shouldLog: false,
      });
      const memoryPolicy = selectedMemoryPolicy ?? getMemoryPolicy(newItem);
      const nextDailyTraces = saveNoieMemory(dailyTraces, newItem, memoryInput, {
        shouldLog: false,
      }).items;
      setDailyTraces(nextDailyTraces);
      await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextDailyTraces);

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
    } catch (error) {
      console.error("[dream-storage-save-error]", error);
      updateSession(activeSession.id, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === messageId
            ? {
                ...item,
                dailyTraceStatus: "pending",
                dailyTraceNotice: "저장하지 못했어요. 다시 눌러주세요.",
              }
            : item
        ),
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setSavingDailyTraceMessageIds((currentIds) =>
        currentIds.filter((id) => id !== messageId)
      );
    }
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
      const savedDailyTraces = await loadStringValue(DAILY_TRACES_STORAGE_KEY);
      const parsedDailyTraces = savedDailyTraces
        ? (JSON.parse(savedDailyTraces) as DailyTraceItem[])
        : dailyTraces;
      const sourceMemories = Array.isArray(parsedDailyTraces)
        ? parsedDailyTraces
        : dailyTraces;
      const dedupedMemories = dedupeMemories(sourceMemories);

      await saveJsonValue(DAILY_TRACES_STORAGE_KEY, dedupedMemories);
      setDailyTraces(dedupedMemories);
      setDailyTraceCleanupMessage("중복 기록을 정리했어요.");
    } catch (error) {
      console.log("[noie] 중복 기록 정리 실패", error);
      setDailyTraceCleanupMessage("중복 기록 정리에 실패했어요.");
    }
  };

  const toggleDailyTraceDone = (itemId: string, dateKey?: string) => {
    const now = new Date().toISOString();
    setDailyTraces((currentItems) =>
      currentItems.map((item) => {
        if (item.id !== itemId || item.type !== "todo") {
          return item;
        }

        if (isLifeRepeatTraceItem(item)) {
          const targetDateKey = dateKey ?? getLocalDateString(new Date());
          const typedItem = item as DailyTraceItem & { completedDates?: Record<string, string> };
          if (typedItem.completedDates?.[targetDateKey]) {
            return item;
          }
          return {
            ...item,
            completedDates: {
              ...(typedItem.completedDates ?? {}),
              [targetDateKey]: now,
            },
            updatedAt: now,
          } as DailyTraceItem;
        }

        const nextDone = !item.isDone;
        return {
          ...item,
          isDone: nextDone,
          ...(nextDone ? { completedAt: now } : { completedAt: undefined }),
          updatedAt: now,
        } as DailyTraceItem;
      })
    );
  };

  const addManualDailyTraceItem = (input: {
    type: "todo" | "schedule" | "record";
    date: string;
    title: string;
    time?: string;
    endTime?: string;
    reminder?: string;
  }) => {
    const title = input.title.trim();
    if (!title) {
      return false;
    }

    const now = new Date().toISOString();
    const sourceKind =
      input.type === "todo"
        ? "manual_todo"
        : input.type === "schedule"
        ? "manual_schedule"
        : "manual_record";
    const nextItem = {
      id: createId("trace"),
      type: input.type,
      date: input.date,
      title,
      memo: input.type === "record" ? undefined : input.reminder,
      time: input.time || undefined,
      sourceText: title,
      text: title,
      originalText: title,
      sourceId: `${sourceKind}:${input.date}:${normalizeMemoryInput(title)}:${now}`,
      sourceType: sourceKind,
      reminder: input.reminder || "none",
      endTime: input.endTime || undefined,
      isDone: input.type === "todo" ? false : undefined,
      memoryType: input.type === "schedule" ? "schedule" : input.type === "todo" ? "todo" : "daily_context",
      saveTargets: ["daily_trace"],
      displayCategory:
        input.type === "schedule"
          ? "일정"
          : input.type === "todo"
          ? "할 일"
          : "직접 기록",
      createdAt: now,
      updatedAt: now,
    } as DailyTraceItem;

    setDailyTraces((currentItems) => [...currentItems, nextItem]);
    return true;
  };

  const saveDailyLongRecord = (input: {
    dateKey: string;
    title?: string;
    body: string;
  }) => {
    const body = input.body.trim();
    if (!body) {
      return false;
    }

    const title = input.title?.trim();
    const now = new Date().toISOString();
    setDailyLongRecords((currentRecords) => {
      const existingRecord = currentRecords.find((record) => record.dateKey === input.dateKey);
      if (existingRecord) {
        return currentRecords.map((record) =>
          record.dateKey === input.dateKey
            ? {
                ...record,
                title: title || undefined,
                body,
                updatedAt: now,
              }
            : record
        );
      }

      return [
        ...currentRecords,
        {
          id: createId("daily-long-record"),
          dateKey: input.dateKey,
          title: title || undefined,
          body,
          createdAt: now,
          updatedAt: now,
        },
      ];
    });

    return true;
  };

  const saveChatDailyLongRecord = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    const dateKey = routingResult.scheduledDate ?? getLocalDateString(new Date());
    const body = routingResult.longRecordBody?.trim();
    if (!body) {
      return;
    }

    const now = new Date().toISOString();
    let didSave = false;
    const nextRecords = normalizeDailyLongRecords([
      ...dailyLongRecords.filter((record) => record.dateKey !== dateKey),
      {
        id: dailyLongRecords.find((record) => record.dateKey === dateKey)?.id ?? createId("daily-long-record"),
        dateKey,
        title: dailyLongRecords.find((record) => record.dateKey === dateKey)?.title,
        body,
        createdAt: dailyLongRecords.find((record) => record.dateKey === dateKey)?.createdAt ?? now,
        updatedAt: now,
      },
    ]);
    didSave = true;
    setDailyLongRecords(nextRecords);
    await saveJsonValue(DAILY_LONG_RECORDS_STORAGE_KEY, nextRecords);
    setSelectedTraceDate(dateKey);

    if (didSave) {
      updateSession(activeSession?.id ?? activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === message.id
            ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "오늘의 기록에 남겼어요." }
            : item
        ),
        updatedAt: now,
      }));
    }
  };

  const updateChatDailyLongRecordTitle = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    const dateKey = routingResult.scheduledDate ?? getLocalDateString(new Date());
    const title = routingResult.longRecordTitle?.trim();
    if (!title) {
      return;
    }

    const now = new Date().toISOString();
    const existingRecord = dailyLongRecords.find((record) => record.dateKey === dateKey);
    if (!existingRecord) {
      return;
    }

    const nextRecords = dailyLongRecords.map((record) =>
      record.dateKey === dateKey
        ? {
            ...record,
            title,
            updatedAt: now,
          }
        : record
    );
    setDailyLongRecords(nextRecords);
    await saveJsonValue(DAILY_LONG_RECORDS_STORAGE_KEY, nextRecords);
    setSelectedTraceDate(dateKey);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "기록 제목을 바꿨어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const appendChatDailyLongRecord = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    const dateKey = routingResult.scheduledDate ?? getLocalDateString(new Date());
    const body = routingResult.longRecordBody?.trim();
    if (!body) {
      return;
    }

    const now = new Date().toISOString();
    const existingRecord = dailyLongRecords.find((record) => record.dateKey === dateKey);
    const nextRecords = normalizeDailyLongRecords([
      ...dailyLongRecords.filter((record) => record.dateKey !== dateKey),
      existingRecord
        ? {
            ...existingRecord,
            body: `${existingRecord.body.trim()}\n\n${body}`,
            updatedAt: now,
          }
        : {
            id: createId("daily-long-record"),
            dateKey,
            body,
            createdAt: now,
            updatedAt: now,
          },
    ]);
    setDailyLongRecords(nextRecords);
    await saveJsonValue(DAILY_LONG_RECORDS_STORAGE_KEY, nextRecords);
    setSelectedTraceDate(dateKey);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "기록에 덧붙였어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const updateRecentDailyTraceLine = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedDailyTraceId || !routingResult.nextTitle?.trim()) {
      return;
    }

    const now = new Date().toISOString();
    const nextText = routingResult.nextTitle.trim();
    const nextItems = dailyTraces.map((item) =>
      item.id === routingResult.matchedDailyTraceId
        ? {
            ...item,
            title: nextText,
            text: nextText,
            memo: nextText,
            updatedAt: now,
          }
        : item
    );
    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "방금 남긴 기록을 수정했어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const updateLifeScheduleReminder = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedDailyTraceId || !routingResult.reminder) {
      return;
    }

    const now = new Date().toISOString();
    const reminder = routingResult.reminder;
    const nextItems = dailyTraces.map((item) =>
      item.id === routingResult.matchedDailyTraceId
        ? {
            ...item,
            reminder,
            memo: `🔔 ${routingResult.unit ?? getReminderLabelByValue(reminder)}`,
            updatedAt: now,
          }
        : item
    );
    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "일정 알림을 바꿨어요." }
          : item
      ),
      updatedAt: now,
    }));
  };

  const cancelLifeSchedule = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedDailyTraceId) {
      return;
    }

    const now = new Date().toISOString();
    const nextItems = dailyTraces.map((item) =>
      item.id === routingResult.matchedDailyTraceId
        ? {
            ...item,
            status: "cancelled",
            cancelledAt: now,
            updatedAt: now,
          }
        : item
    );
    setDailyTraces(nextItems);
    await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "일정을 취소했어요." }
          : item
      ),
      updatedAt: now,
    }));
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
    setDailyTraces((currentItems) => {
      const nextItems = currentItems.map((item) =>
        item.id === itemId
          ? { ...item, hiddenFromDream: true, updatedAt: new Date().toISOString() }
          : item
      );
      saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems).catch((error) =>
        console.error("[dream-fragment-delete-save-error]", error)
      );
      return nextItems;
    });

    if (dreamTorchId === itemId) {
      setDreamTorchId(null);
    }
  };

  const updateDreamTorchPlan = (itemId: string, values: Partial<DailyTraceItem>) => {
    const now = new Date().toISOString();
    setDailyTraces((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ...values,
              progressUpdatedAt: now,
              updatedAt: now,
            }
          : item
      )
    );
  };

  const recordRoutineExecution = async ({
    itemId,
    routineId,
    dateKey,
    actualValue,
    unit,
    source,
    originalText,
    completedOnly,
  }: RecordRoutineExecutionInput) => {
    const now = new Date().toISOString();
    const safeActualValue = Math.max(0, safeNumber(actualValue));
    if (!routineId || !Number.isFinite(safeActualValue)) {
      return false;
    }

    let routineTitle = "";
    let displayUnit = unit ?? "";
    let didUpdate = false;
    let nextItems = dailyTraces.map((item) => {
      if (itemId && item.id !== itemId) {
        return item;
      }
      if (!(item.routines ?? []).some((routine) => routine.id === routineId)) {
        return item;
      }

      const routine = (item.routines ?? []).find((candidate) => candidate.id === routineId);
      if (!routine) {
        return item;
      }
      routineTitle = routine.title;
      displayUnit = unit ?? routine.unit ?? "";
      const normalizedValue = convertRoutineRecordValueToRoutineUnit(
        safeActualValue,
        unit,
        routine.unit
      );
      const existingRecord = findRoutineRecord(item.routineRecords ?? [], routineId, dateKey);
      const score = completedOnly
        ? existingRecord?.score ?? 1
        : calculateRoutineScore(routine, normalizedValue, dateKey);
      const nextRecord = {
        ...existingRecord,
        id: existingRecord?.id ?? createId("routine-record"),
        routineId,
        date: dateKey,
        score,
        value: completedOnly ? existingRecord?.value : normalizedValue,
        note: originalText ?? existingRecord?.note,
        createdAt: existingRecord?.createdAt ?? now,
        updatedAt: now,
      } as DreamRoutineRecord & { completed?: boolean };
      if (completedOnly) {
        nextRecord.completed = true;
      }
      const nextRecords = upsertDreamRoutineRecord(item.routineRecords ?? [], nextRecord);
      didUpdate = true;

      return {
        ...item,
        routineRecords: nextRecords,
        progressUpdatedAt: now,
        updatedAt: now,
      };
    });

    if (didUpdate && source === "chat") {
      const traceTitle = completedOnly
        ? `${routineTitle || "반복 목표"} 수행`
        : `${routineTitle || "반복 목표"} ${formatRoutineTarget(safeActualValue, displayUnit)}`;
      const traceSourceId = `routine_execution:${routineId}:${dateKey}`;
      const traceItem = {
        id: createId("trace"),
        type: "record",
        date: dateKey,
        title: traceTitle,
        memo: "오늘의 불씨",
        text: originalText ?? traceTitle,
        originalText: originalText ?? traceTitle,
        sourceText: originalText ?? traceTitle,
        memoryType: "achievement",
        saveTargets: ["daily_trace"],
        importance: 70,
        displayCategory: "반복 목표 수행",
        sourceType: "routine_execution",
        sourceId: traceSourceId,
        createdAt: now,
      } as DailyTraceItem;
      let didUpdateTrace = false;
      nextItems = nextItems
        .filter((item) => !isLegacyRoutineExecutionTrace(item, routineTitle, dateKey, traceSourceId))
        .map((item) => {
          const typedItem = item as DailyTraceItem & { sourceId?: string };
          if (typedItem.sourceId !== traceSourceId) {
            return item;
          }
          didUpdateTrace = true;
          return {
            ...item,
            ...traceItem,
            id: item.id,
            createdAt: item.createdAt,
            updatedAt: now,
          };
        });
      if (!didUpdateTrace) {
        nextItems = [...nextItems, traceItem];
      }
    }

    if (didUpdate) {
      setDailyTraces(nextItems);
      await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
      console.log("[today-me-routine-completed]", { id: routineId, dateKey, source });
    }

    return didUpdate;
  };

  const recordDreamRoutineQuick = (
    itemId: string,
    routineId: string,
    score: DreamRoutineQuickScore,
    value?: number
  ) => {
    const today = getLocalDateString(new Date());
    void recordRoutineExecution({
      itemId,
      routineId,
      dateKey: today,
      actualValue: value ?? 0,
      source: "button",
      completedOnly: value === undefined && score > 0,
    });
  };

  const cancelRoutineTodayRecord = (itemId: string, routineId: string) => {
    const today = getLocalDateString(new Date());
    const now = new Date().toISOString();
    setDailyTraces((currentItems) => {
      const nextItems = currentItems.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          routineRecords: (item.routineRecords ?? []).filter(
            (record) => !(record.routineId === routineId && record.date === today)
          ),
          progressUpdatedAt: now,
          updatedAt: now,
        };
      });
      saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems).catch((error) =>
        console.error("[routine-today-cancel-save-error]", error)
      );
      console.log("[routine-today-record-cancelled]", { routineId, dateKey: today });
      return nextItems;
    });
  };

  const adjustRoutineTodayTarget = (
    itemId: string,
    routineId: string,
    delta: number
  ) => {
    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());

    setDailyTraces((currentItems) => {
      const nextItems = currentItems.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        const nextRoutines = (item.routines ?? []).map((routine) => {
          if (routine.id !== routineId) {
            return routine;
          }

          const currentTarget = getEffectiveRoutineTargetValue(routine, today);
          const nextTarget = Math.max(0, roundRoutineTarget(currentTarget + delta));
          const currentMinimum = getEffectiveRoutineMinimumValue(routine, today);
          const nextMinimum = currentMinimum > 0 ? Math.min(currentMinimum, nextTarget) : currentMinimum;
          return {
            ...routine,
            dailySettings: {
              ...(routine.dailySettings ?? {}),
              [today]: {
                ...(routine.dailySettings?.[today] ?? {}),
                targetValue: nextTarget,
                minimumValue: nextMinimum,
                unit: routine.unit,
                updatedAt: now,
              },
            },
            updatedAt: now,
          };
        });

        return {
          ...item,
          routines: nextRoutines,
          progressUpdatedAt: now,
          updatedAt: now,
        };
      });

      saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems).catch((error) =>
        console.error("[routine-target-adjust-save-error]", error)
      );
      console.log("[routine-target-adjusted]", { routineId, dateKey: today });
      return nextItems;
    });
  };

  const completeRoutineFromTodayMe = (itemId: string, routineId: string) => {
    const now = new Date().toISOString();
    setDailyTraces((currentItems) => {
      const nextItems = currentItems.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          routines: (item.routines ?? []).map((routine) =>
            routine.id === routineId
              ? {
                  ...routine,
                  active: false,
                  lifecycleStatus: "completed" as DreamRoutineLifecycleStatus,
                  completedAt: now,
                  updatedAt: now,
                }
              : routine
          ),
          updatedAt: now,
        };
      });
      saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems).catch((error) =>
        console.error("[today-me-routine-complete-save-error]", error)
      );
      console.log("[today-me-card-archived]", { sourceType: "routine", sourceId: routineId });
      return nextItems;
    });
  };

  const removeRoutineFromTodayMe = (itemId: string, routineId: string) => {
    const now = new Date().toISOString();
    setDailyTraces((currentItems) => {
      const nextItems = currentItems.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          routines: (item.routines ?? []).map((routine) =>
            routine.id === routineId
              ? {
                  ...routine,
                  archivedFromTodayMe: true,
                  updatedAt: now,
                }
              : routine
          ),
          updatedAt: now,
        };
      });
      saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems).catch((error) =>
        console.error("[today-me-routine-remove-save-error]", error)
      );
      console.log("[today-me-card-removed]", { sourceType: "routine", sourceId: routineId });
      return nextItems;
    });
  };

  const completeProjectFromTodayMe = (projectId: string) => {
    const now = new Date().toISOString();
    setProjects((currentProjects) => {
      const nextProjects = currentProjects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              status: "done" as DreamProjectStatus,
              completedAt: now,
              updatedAt: now,
            }
          : project
      );
      saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects).catch((error) =>
        console.error("[today-me-project-complete-save-error]", error)
      );
      console.log("[today-me-card-archived]", { sourceType: "project", sourceId: projectId });
      return nextProjects;
    });
  };

  const removeProjectFromTodayMe = (projectId: string) => {
    const now = new Date().toISOString();
    setProjects((currentProjects) => {
      const nextProjects = currentProjects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              archivedFromTodayMe: true,
              pinnedToTodayMe: false,
              updatedAt: now,
            }
          : project
      );
      saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects).catch((error) =>
        console.error("[today-me-project-remove-save-error]", error)
      );
      console.log("[today-me-card-removed]", { sourceType: "project", sourceId: projectId });
      return nextProjects;
    });
  };
  const completeProjectNextAction = (projectId: string) => {
    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());

    setProjects((currentProjects) => {
      const nextProjects = currentProjects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        const action = project.nextAction?.trim() || "다음 행동";
        return {
          ...project,
          dailyActionRecords: {
            ...(project.dailyActionRecords ?? {}),
            [today]: {
              action,
              completed: true,
              source: "quick_check" as const,
              createdAt: project.dailyActionRecords?.[today]?.createdAt ?? now,
              updatedAt: now,
            },
          },
          updatedAt: now,
        };
      });

      saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects).catch((error) =>
        console.error("[today-me-project-action-save-error]", error)
      );
      console.log("[today-me-project-action-completed]", { id: projectId, dateKey: today });
      return nextProjects;
    });
  };

  const getActiveTodayMeCardCount = (nextProjects: NoieProject[] = projects) => {
    const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(dailyTraces), dreamTorchId);
    const dreamFragments = getDreamFragments(dailyTraces).filter((piece) => piece.id !== torchPiece?.id);
    return getVisibleTodayMeCards(torchPiece, dreamFragments, nextProjects, getLocalDateString(new Date())).length;
  };

  const cancelProjectNextActionToday = (projectId: string) => {
    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());
    setProjects((currentProjects) => {
      const nextProjects = currentProjects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        const nextDailyActionRecords = { ...(project.dailyActionRecords ?? {}) };
        delete nextDailyActionRecords[today];
        return {
          ...project,
          dailyActionRecords: nextDailyActionRecords,
          updatedAt: now,
        };
      });
      saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects).catch((error) =>
        console.error("[today-me-project-action-cancel-save-error]", error)
      );
      console.log("[today-me-project-action-cancelled]", { id: projectId, dateKey: today });
      return nextProjects;
    });
  };

  const handleStartProjectInTodayMe = async (input: StartProjectInput) => {
    if (isStartingProject) {
      return false;
    }

    const title = extractProjectTitle(input.title, input.originalText);
    if (!title) {
      setTodayMeFeedback("프로젝트로 시작할 내용을 찾지 못했어요.");
      return false;
    }

    setIsStartingProject(true);
    try {
      const now = new Date().toISOString();
      const safeProjects = Array.isArray(projects) ? projects : [];
      const semanticKey = normalizeMemoryInput(title);
      const existingProject = safeProjects.find((project) => {
        const candidateKey = normalizeMemoryInput(project.title || project.goal || project.originalText || "");
        return candidateKey.length > 0 && candidateKey === semanticKey;
      });
      const activeCardCount = getActiveTodayMeCardCount(safeProjects);

      if (existingProject) {
        if (existingProject.status === "done") {
          setTodayMeFeedback("완료된 비슷한 프로젝트가 있어요. 프로젝트 화면에서 확인해 주세요.");
          return false;
        }

        if (activeCardCount >= MAX_TODAY_ME_CARDS && !isActiveTodayMeProject(existingProject)) {
          setTodayMeFeedback("오늘의 나는 네 가지에만 집중할 수 있어요. 기존 카드를 완료하거나 정리한 뒤 추가해보세요.");
          return false;
        }

        const nextProjects = safeProjects.map((project) =>
          project.id === existingProject.id
            ? {
                ...project,
                isArchived: false,
                pinnedToTodayMe: true,
                archivedFromTodayMe: false,
                todayMeOrder: typeof project.todayMeOrder === "number" ? project.todayMeOrder : getNextTodayMeOrder(safeProjects),
                relatedDreamTorchId: project.relatedDreamTorchId ?? input.relatedDreamTorchId ?? undefined,
                relatedDreamFragmentId: project.relatedDreamFragmentId ?? input.relatedDreamFragmentId ?? undefined,
                sourceDreamFragmentId: project.sourceDreamFragmentId ?? input.relatedDreamFragmentId ?? undefined,
                updatedAt: now,
              }
            : project
        );
        setProjects(nextProjects);
        await saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects);
        setTodayMeFeedback("이미 비슷한 프로젝트가 있어서 오늘의 나에 연결했어요.");
        return true;
      }

      if (activeCardCount >= MAX_TODAY_ME_CARDS) {
        setTodayMeFeedback("오늘의 나는 네 가지에만 집중할 수 있어요. 기존 카드를 완료하거나 정리한 뒤 추가해보세요.");
        return false;
      }

      const newProject: NoieProject = {
        id: createId("project"),
        title,
        goal: input.originalText?.trim() || title,
        description: input.source === "dream_fragment" ? "꿈의 파편에서 시작된 프로젝트입니다." : undefined,
        status: "planning",
        sourceDreamFragmentId: input.relatedDreamFragmentId ?? undefined,
        sourceMemoryId: input.relatedDreamFragmentId ?? undefined,
        relatedDreamTorchId: input.relatedDreamTorchId ?? undefined,
        relatedDreamFragmentId: input.relatedDreamFragmentId ?? undefined,
        fromDreamFragment: input.source === "dream_fragment",
        nextAction: input.nextAction ?? "",
        pinnedToTodayMe: true,
        todayMeOrder: getNextTodayMeOrder(safeProjects),
        archivedFromTodayMe: false,
        dailyActionRecords: {},
        originalText: input.originalText?.trim() || title,
        createdAt: now,
        updatedAt: now,
      };
      const nextProjects = [newProject, ...safeProjects];
      setProjects(nextProjects);
      await saveJsonValue(PROJECTS_STORAGE_KEY, nextProjects);
      console.log("[today-me-project-start]", { source: input.source, title, nextCount: nextProjects.length });
      console.log("[today-me-project-visible]", { projectId: newProject.id, pinnedToTodayMe: newProject.pinnedToTodayMe });
      setTodayMeFeedback("오늘의 나에서 프로젝트를 시작했어요.");
      return true;
    } catch (error) {
      console.error("[today-me-project-save-error]", error);
      setTodayMeFeedback("프로젝트를 저장하지 못했어요. 다시 시도해 주세요.");
      return false;
    } finally {
      setIsStartingProject(false);
    }
  };

  const handleSelectGoalDuration = async (itemId: string, months: GoalDurationMonths) => {
    if (isSavingGoalDuration) {
      return;
    }

    const torchPiece = dailyTraces.find((item) => item.id === itemId);
    if (!torchPiece) {
      setTodayMeFeedback("먼저 꿈의 횃불을 밝혀주세요.");
      return;
    }

    setIsSavingGoalDuration(true);
    try {
      const now = new Date().toISOString();
      const startDate = isValidDateKey(torchPiece.goalStartDate) ? String(torchPiece.goalStartDate) : getLocalDateString(new Date());
      const targetDate = addMonthsToLocalDate(startDate, months);
      const nextItems = dailyTraces.map((item) =>
        item.id === itemId
          ? {
              ...item,
              goalDurationMonths: months,
              goalStartDate: startDate,
              goalTargetDate: targetDate,
              progressUpdatedAt: now,
              updatedAt: now,
            }
          : item
      );
      setDailyTraces(nextItems);
      await saveJsonValue(DAILY_TRACES_STORAGE_KEY, nextItems);
      console.log("[goal-duration-selected]", { months, startDate, targetDate });
      setTodayMeFeedback(`${months}개월 목표 기간을 저장했어요.`);
    } catch (error) {
      console.error("[goal-duration-save-error]", error);
      setTodayMeFeedback("목표 기간을 저장하지 못했어요. 다시 눌러주세요.");
    } finally {
      setIsSavingGoalDuration(false);
    }
  };

  const startProjectFromDreamFragment = async (fragmentId: string) => {
    const fragment = dailyTraces.find((item) => item.id === fragmentId);
    if (!fragment) {
      setTodayMeFeedback("프로젝트로 시작할 내용을 찾지 못했어요.");
      return;
    }

    const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(dailyTraces), dreamTorchId);
    const started = await handleStartProjectInTodayMe({
      title: extractProjectTitle(fragment.title, fragment),
      originalText: getMemoryInputText(fragment) || fragment.title,
      relatedDreamTorchId: torchPiece?.id ?? null,
      relatedDreamFragmentId: fragment.id,
      nextAction: fragment.nextAction ?? "",
      source: "dream_fragment",
    });

    if (!started) {
      return;
    }

    const now = new Date().toISOString();
    setDailyTraces((currentItems) =>
      currentItems.map((item) =>
        item.id === fragment.id
          ? {
              ...item,
              relatedDreamTorchId: torchPiece?.id ?? item.relatedDreamTorchId,
              projectStatus: "planning",
              projectLinkNotice: "꿈의 파편에서 시작된 프로젝트예요.",
              updatedAt: now,
            }
          : item
      )
    );
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
              {screenMode === "dreamVault" ? null : (
                <Text style={styles.topBarSubtitle}>
                  {screenMode === "flow"
                    ? "감정 흐름 보기"
                    : screenMode === "dailyTrace"
                    ? "하루의 흔적"
                    : screenMode === "projectCreate"
                    ? "새 프로젝트"
                    : screenMode === "project"
                    ? activeProject?.title ?? "프로젝트"
                    : `감정 분석 채팅 · ${activeSession?.title ?? "새 채팅"}`}
                </Text>
              )}
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
              projects={projects}
              dreamTorchId={dreamTorchId}
              onPinDreamTorch={pinDreamTorch}
              onHideFromDream={hideFromDreamVault}
              onStartProjectFromFragment={startProjectFromDreamFragment}
              onStartProjectInTodayMe={handleStartProjectInTodayMe}
              onUpdateDreamTorchPlan={updateDreamTorchPlan}
              onSelectGoalDuration={handleSelectGoalDuration}
              onRecordDreamRoutine={recordDreamRoutineQuick}
              onCancelDreamRoutineToday={cancelRoutineTodayRecord}
              onCompleteProjectNextAction={completeProjectNextAction}
              onCancelProjectNextActionToday={cancelProjectNextActionToday}
              onAdjustRoutineTodayTarget={adjustRoutineTodayTarget}
              onAddRoutineToTodayMe={addRoutineToTodayMe}
              onCompleteRoutineFromTodayMe={completeRoutineFromTodayMe}
              onCompleteProjectFromTodayMe={completeProjectFromTodayMe}
              onRemoveRoutineFromTodayMe={removeRoutineFromTodayMe}
              onRemoveProjectFromTodayMe={removeProjectFromTodayMe}
              todayMeFeedback={todayMeFeedback}
              isStartingProject={isStartingProject}
              isSavingGoalDuration={isSavingGoalDuration}
              onOpenProject={openProject}
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
              dailyLongRecords={dailyLongRecords}
              selectedTraceDate={selectedTraceDate}
              calendarMonth={calendarMonth}
              onSelectTraceDate={setSelectedTraceDate}
              onChangeCalendarMonth={setCalendarMonth}
              onToggleDailyTraceDone={toggleDailyTraceDone}
              onDeleteDailyTraceGoal={deleteDailyTraceGoal}
              onAddDailyTraceItem={addManualDailyTraceItem}
              onSaveDailyLongRecord={saveDailyLongRecord}
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
              dailyTraces={dailyTraces}
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
              onToggleSaveDecisionView={toggleSaveDecisionView}
              onConfirmDailyTrace={confirmDailyTrace}
              onDismissDailyTrace={dismissDailyTrace}
              savingDailyTraceMessageIds={savingDailyTraceMessageIds}
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
  onToggleSaveDecisionView: (messageId: string) => void;
  onConfirmDailyTrace: (messageId: string, dreamRole?: DreamRole) => void;
  onDismissDailyTrace: (messageId: string) => void;
  savingDailyTraceMessageIds: string[];
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
  onToggleSaveDecisionView,
  onConfirmDailyTrace,
  onDismissDailyTrace,
  savingDailyTraceMessageIds,
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
              onToggleSaveDecisionView={onToggleSaveDecisionView}
              onConfirmDailyTrace={onConfirmDailyTrace}
              onDismissDailyTrace={onDismissDailyTrace}
              isSavingDailyTrace={savingDailyTraceMessageIds.includes(message.id)}
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
  dailyTraces,
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
  dailyTraces: DailyTraceItem[];
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
  const sourceFragment = dailyTraces.find(
    (item) =>
      item.id === project.sourceDreamFragmentId ||
      item.id === project.sourceMemoryId
  );
  const relatedDream = project.relatedDreamTorchId
    ? dailyTraces.find((item) => item.id === project.relatedDreamTorchId)
    : undefined;

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
            {project.fromDreamFragment ? (
              <View style={styles.projectOriginBox}>
                <Text style={styles.projectOriginText}>꿈의 파편에서 시작됨</Text>
                {relatedDream ? (
                  <Text style={styles.projectOriginText}>
                    연결된 꿈: {getMemoryInputText(relatedDream) || relatedDream.title}
                  </Text>
                ) : null}
                {sourceFragment ? (
                  <Text style={styles.projectOriginText}>
                    시작 파편: {getMemoryInputText(sourceFragment) || sourceFragment.title}
                  </Text>
                ) : null}
              </View>
            ) : null}
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
  onToggleSaveDecisionView: (messageId: string) => void;
  onConfirmDailyTrace: (messageId: string, dreamRole?: DreamRole) => void;
  onDismissDailyTrace: (messageId: string) => void;
  isSavingDailyTrace: boolean;
};

function ChatBubble({
  message,
  onToggleAdminView,
  onToggleSaveDecisionView,
  onConfirmDailyTrace,
  onDismissDailyTrace,
  isSavingDailyTrace,
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
            onToggleSaveDecisionView={onToggleSaveDecisionView}
          />
        ) : null}

        {!isUser && message.dailyTraceCandidate ? (
          <DailyTraceCandidateCard
            message={message}
            onConfirm={onConfirmDailyTrace}
            onDismiss={onDismissDailyTrace}
            isSaving={isSavingDailyTrace}
          />
        ) : null}
      </View>
    </View>
  );
}

type AnalysisCardProps = {
  message: ChatMessage;
  onToggleAdminView: (messageId: string) => void;
  onToggleSaveDecisionView: (messageId: string) => void;
};

function AnalysisCard({ message, onToggleAdminView, onToggleSaveDecisionView }: AnalysisCardProps) {
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
        style={styles.saveDecisionToggle}
        onPress={() => onToggleSaveDecisionView(message.id)}
        activeOpacity={0.85}
      >
        <Text style={styles.saveDecisionToggleText}>
          {message.showSaveDecisionView ? "저장 판단 접기" : "저장 판단 보기"}
        </Text>
      </TouchableOpacity>

      {message.showSaveDecisionView ? (
        <SaveDecisionDebugCard decision={analysis.save_decision} />
      ) : null}
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

function SaveDecisionDebugCard({ decision }: { decision?: SaveDecision }) {
  if (!decision) {
    return (
      <View style={styles.saveDecisionCard}>
        <Text style={styles.saveDecisionTitle}>저장 판단</Text>
        <Text style={styles.saveDecisionEmpty}>저장 판단 정보 없음</Text>
      </View>
    );
  }

  const rows: Array<[string, string]> = [
    ["memoryType", formatSaveDecisionValue(decision.memoryType)],
    ["savePolicy", formatSaveDecisionValue(decision.savePolicy)],
    ["saveTargets", formatSaveDecisionValue(decision.saveTargets)],
    ["subjectScope", formatSaveDecisionValue(decision.subjectScope)],
    ["selfRelevance", formatSaveDecisionValue(decision.selfRelevance)],
    ["shouldStore", formatSaveDecisionValue(decision.shouldStore)],
    ["uiType", formatSaveDecisionValue(decision.uiType)],
    ["askText", formatSaveDecisionValue(decision.askText)],
    ["reason", formatSaveDecisionValue(decision.reason)],
    ["importance", formatSaveDecisionValue(decision.importance)],
    ["confidence", formatSaveDecisionValue(decision.confidence)],
    ["intentCategory", formatSaveDecisionValue(decision.intentCategory)],
    ["eventTense", formatSaveDecisionValue(decision.eventTense)],
  ];

  return (
    <View style={styles.saveDecisionCard}>
      <Text style={styles.saveDecisionTitle}>저장 판단</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.saveDecisionRow}>
          <Text style={styles.saveDecisionKey}>{label}</Text>
          <Text style={styles.saveDecisionValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function formatSaveDecisionValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }

  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function shouldShowDreamChoiceButtons(
  routingResult: NoieSaveRoutingResult | undefined,
  isDreamOrGoal: boolean
) {
  return (
    routingResult?.route === "dream_torch" ||
    routingResult?.route === "dream_fragment" ||
    (isDreamOrGoal && !routingResult)
  );
}

function DailyTraceCandidateCard({
  message,
  onConfirm,
  onDismiss,
  isSaving,
}: {
  message: ChatMessage;
  onConfirm: (messageId: string, dreamRole?: DreamRole, action?: "today" | "tomorrow" | "default" | "archive" | "continue" | "open_calendar") => void;
  onDismiss: (messageId: string) => void;
  isSaving: boolean;
}) {
  const candidate = message.dailyTraceCandidate;
  const memoryPolicy = message.dailyMemoryPolicy;
  const routingResult = (message as RoutedChatMessage).saveRoutingResult;

  if (!candidate || (!routingResult && shouldHideSaveUi(message.analysis?.save_decision, memoryPolicy))) {
    return null;
  }

  const isAdded = message.dailyTraceStatus === "added";
  const isDuplicate = message.dailyTraceStatus === "duplicate";
  const isDismissed = message.dailyTraceStatus === "dismissed";
  const memoryType = memoryPolicy?.type;
  const isDreamOrGoal = isDreamOrGoalType(memoryType);
  const questionText = message.dailyTraceNotice ?? getPendingMemoryNotice(
    memoryPolicy ?? buildMemorySavePolicy("none"),
    message.dreamSavePromptKind,
    routingResult
  );
  const isRoutineCandidate = routingResult?.route === "routine_create";
  const isProjectCandidate = routingResult?.route === "project_create";
  const isRoutineAdjustment = routingResult?.route === "routine_adjustment_intent" || routingResult?.route === "routine_adjustment_confirm";
  const showDreamChoiceButtons = shouldShowDreamChoiceButtons(routingResult, isDreamOrGoal);
  const canRespond = !isAdded && !isDuplicate && !isDismissed;
  const noieDestination = getNoieDestination(routingResult);
  const noieSuggestionAction = getNoieSuggestionAction(routingResult);

  return (
    <View
      style={styles.traceCandidateCard}
      accessibilityLabel={`save-suggestion-${noieDestination}-${noieSuggestionAction}`}
    >
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
          {routingResult?.route === "life_schedule_date_request" ? (
            <>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, undefined, "today")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>오늘</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, undefined, "tomorrow")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>내일</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.traceCancelButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, undefined, "open_calendar")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceCancelButtonText}>날짜 선택</Text>
              </TouchableOpacity>
            </>
          ) : isRoutineCandidate ? (
            <>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id)}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>
                  {isSaving ? "저장 중..." : "오늘의 나에 담기"}
                </Text>
              </TouchableOpacity>
            </>
          ) : isProjectCandidate ? (
            <TouchableOpacity
              style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
              onPress={() => onConfirm(message.id)}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              <Text style={styles.traceConfirmButtonText}>
                {isSaving ? "저장 중..." : "오늘의 나에 담기"}
              </Text>
            </TouchableOpacity>
          ) : isRoutineAdjustment ? (
            <>
              {routingResult.route === "routine_adjustment_confirm" ? (
                <TouchableOpacity
                  style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                  onPress={() => onConfirm(message.id, undefined, "default")}
                  disabled={isSaving}
                  activeOpacity={0.85}
                >
                  <Text style={styles.traceConfirmButtonText}>{isSaving ? "저장 중..." : "바꾸기"}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : routingResult?.route === "dream_fragment_rename" ||
            routingResult?.route === "dream_fragment_next_action_update" ||
            routingResult?.route === "life_schedule_reminder_update" ? (
            <TouchableOpacity
              style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
              onPress={() => onConfirm(message.id)}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              <Text style={styles.traceConfirmButtonText}>{isSaving ? "저장 중..." : "바꾸기"}</Text>
            </TouchableOpacity>
          ) : routingResult?.route === "dream_fragment_complete" ? (
            <>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id)}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>{isSaving ? "저장 중..." : "완료"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.traceCancelButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onDismiss(message.id)}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceCancelButtonText}>아직</Text>
              </TouchableOpacity>
            </>
          ) : routingResult?.route === "life_schedule_cancel" ? (
            <>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id)}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>{isSaving ? "저장 중..." : "취소하기"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.traceCancelButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onDismiss(message.id)}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceCancelButtonText}>유지하기</Text>
              </TouchableOpacity>
            </>
          ) : routingResult?.route === "completed_project" ? (
            <>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, undefined, "archive")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>완료로 보관</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.traceCancelButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, undefined, "continue")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceCancelButtonText}>계속 진행</Text>
              </TouchableOpacity>
            </>
          ) : showDreamChoiceButtons ? (
            <>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, "torch")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>
                  {isSaving ? "저장 중..." : "꿈의 횃불로 밝히기"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, "fragment")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>
                  {isSaving ? "저장 중..." : "꿈의 파편으로 남기기"}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
              onPress={() => onConfirm(message.id)}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              <Text style={styles.traceConfirmButtonText}>
                {isSaving ? "저장 중..." : getConfirmButtonLabel(memoryType, candidate.type, routingResult)}
              </Text>
            </TouchableOpacity>
          )}
          {routingResult?.route !== "dream_fragment_complete" && routingResult?.route !== "life_schedule_cancel" ? (
            <TouchableOpacity
              style={[styles.traceCancelButton, isSaving && styles.traceConfirmButtonDisabled]}
              onPress={() => onDismiss(message.id)}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              <Text style={styles.traceCancelButtonText}>{isRoutineAdjustment ? "취소" : "안 할래"}</Text>
            </TouchableOpacity>
          ) : null}
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
  projects,
  dreamTorchId,
  onPinDreamTorch,
  onHideFromDream,
  onStartProjectFromFragment,
  onStartProjectInTodayMe,
  onUpdateDreamTorchPlan,
  onSelectGoalDuration,
  onRecordDreamRoutine,
  onCancelDreamRoutineToday,
  onOpenProject,
  onCompleteProjectNextAction,
  onCancelProjectNextActionToday,
  onAdjustRoutineTodayTarget,
  onAddRoutineToTodayMe,
  onCompleteRoutineFromTodayMe,
  onCompleteProjectFromTodayMe,
  onRemoveRoutineFromTodayMe,
  onRemoveProjectFromTodayMe,
  todayMeFeedback,
  isStartingProject,
  isSavingGoalDuration,
  onBackToChat,
}: {
  dailyTraces: DailyTraceItem[];
  projects: NoieProject[];
  dreamTorchId: string | null;
  onPinDreamTorch: (itemId: string) => void;
  onHideFromDream: (itemId: string) => void;
  onStartProjectFromFragment: (itemId: string) => void;
  onStartProjectInTodayMe: (input: StartProjectInput) => Promise<boolean>;
  onUpdateDreamTorchPlan: (itemId: string, values: Partial<DailyTraceItem>) => void;
  onSelectGoalDuration: (itemId: string, months: GoalDurationMonths) => Promise<void>;
  onRecordDreamRoutine: (itemId: string, routineId: string, score: DreamRoutineQuickScore, value?: number) => void;
  onCancelDreamRoutineToday: (itemId: string, routineId: string) => void;
  onCompleteProjectNextAction: (projectId: string) => void;
  onCancelProjectNextActionToday: (projectId: string) => void;
  onAdjustRoutineTodayTarget: (itemId: string, routineId: string, delta: number) => void;
  onAddRoutineToTodayMe: (input: { title: string; targetValue: number }) => Promise<boolean>;
  onCompleteRoutineFromTodayMe: (itemId: string, routineId: string) => void;
  onCompleteProjectFromTodayMe: (projectId: string) => void;
  onRemoveRoutineFromTodayMe: (itemId: string, routineId: string) => void;
  onRemoveProjectFromTodayMe: (projectId: string) => void;
  todayMeFeedback: string;
  isStartingProject: boolean;
  isSavingGoalDuration: boolean;
  onOpenProject: (projectId: string) => void;
  onBackToChat: () => void;
}) {
  const [isCompletedDreamFragmentsOpen, setIsCompletedDreamFragmentsOpen] = useState(false);
  const dreamTorchCandidates = getDreamTorchCandidates(dailyTraces);
  const torchPiece = selectDreamTorchPiece(dreamTorchCandidates, dreamTorchId);
  const dreamFragments = getDreamFragments(dailyTraces).filter(
    (piece) => piece.id !== torchPiece?.id
  );
  const activeDreamFragments = dreamFragments.filter((piece) => piece.projectStatus !== "done" && !getCompletedProjectForFragment(piece, projects));
  const completedDreamFragments = dreamFragments
    .map((piece) => ({ piece, project: getCompletedProjectForFragment(piece, projects) }))
    .filter((item) => item.piece.projectStatus === "done" || Boolean(item.project));
  const todayMeProjects = getTodayMeProjects(torchPiece, dreamFragments, projects);
  const dreamProjectSummary = getDreamProjectSummary(todayMeProjects, torchPiece, projects);
  const todayKey = getLocalDateString(new Date());
  const todayMeCards = getVisibleTodayMeCards(torchPiece, dreamFragments, projects, todayKey);

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

      <DreamProjectSummaryCard summary={dreamProjectSummary} />

      {!torchPiece && dreamFragments.length === 0 ? (
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
            {torchPiece ? (
              <DreamTorchSimplePanel
                piece={torchPiece}
                todayMeCards={todayMeCards}
                onSelectGoalDuration={onSelectGoalDuration}
                isSavingGoalDuration={isSavingGoalDuration}
                onRecordDreamRoutine={onRecordDreamRoutine}
                onCompleteProjectNextAction={onCompleteProjectNextAction}
              />
            ) : null}
          </View>

          <View style={styles.flowCard}>
            <Text style={styles.flowCardTitle}>꿈의 파편</Text>
            {activeDreamFragments.length > 0 ? (
              activeDreamFragments.map((piece) => (
                <DreamPieceCard
                  key={piece.id}
                  piece={piece}
                  onPinDreamTorch={onPinDreamTorch}
                  onHideFromDream={onHideFromDream}
                  projects={projects}
                  torchPiece={torchPiece}
                  onStartProjectFromFragment={onStartProjectFromFragment}
                  onUpdateDreamTorchPlan={onUpdateDreamTorchPlan}
                  onRecordDreamRoutine={onRecordDreamRoutine}
                  onOpenProject={onOpenProject}
                  onCompleteProjectFromTodayMe={onCompleteProjectFromTodayMe}
                />
              ))
            ) : (
              <View style={styles.flowEmptyBox}>
                <Text style={styles.flowEmptyText}>
                  {dreamFragments.length > 0
                    ? "진행 중인 꿈의 파편이 없어요."
                    : "아직 꿈의 파편이 없어요.\n만들고 싶은 프로젝트나 하위 목표를 말하면 여기에 모여요."}
                </Text>
                {dreamFragments.length === 0 ? (
                  <Text style={styles.flowEmptyExampleText}>예: noie를 완성하고 싶어{"\n"}예: 포트폴리오를 만들고 싶어{"\n"}예: 앱을 출시하고 싶어</Text>
                ) : null}
              </View>
            )}
          </View>

          {completedDreamFragments.length > 0 ? (
            <View style={styles.completedDreamFragmentsBox}>
              <TouchableOpacity
                style={styles.completedDreamFragmentsHeader}
                onPress={() => setIsCompletedDreamFragmentsOpen((value) => !value)}
                activeOpacity={0.85}
              >
                <Text style={styles.completedDreamFragmentsTitle}>
                  ⭐ 지금까지 완료한 꿈의 파편 {completedDreamFragments.length}개
                </Text>
                <Text style={styles.completedDreamFragmentsToggle}>
                  {isCompletedDreamFragmentsOpen ? "︿" : "〉"}
                </Text>
              </TouchableOpacity>
              {isCompletedDreamFragmentsOpen ? (
                <View style={styles.completedDreamFragmentsList}>
                  {completedDreamFragments.map(({ piece, project }) => (
                    <View key={`completed-dream-fragment-${piece.id}`} style={styles.completedDreamFragmentItem}>
                      <Text style={styles.completedDreamFragmentTitle}>
                        ⭐ {getMemoryInputText(piece) || piece.title}
                      </Text>
                      <Text style={styles.completedDreamFragmentMeta}>
                        {project ? getCompletedDreamFragmentMeta(project) : `완료 · ${formatDateDot((piece as DailyTraceItem & { completedAt?: string }).completedAt ?? piece.updatedAt ?? piece.createdAt)}`}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      <TodayMeSection
        torchPiece={torchPiece}
        projects={todayMeProjects}
        dreamFragments={dreamFragments}
        onAdjustRoutineTodayTarget={onAdjustRoutineTodayTarget}
        onAddRoutineToTodayMe={onAddRoutineToTodayMe}
        onRemoveRoutineFromTodayMe={onRemoveRoutineFromTodayMe}
        externalFeedback={todayMeFeedback}
        isStartingProject={isStartingProject}
      />
    </ScrollView>
  );
}


function CompletedTodayMeCardsSection({
  torchPiece,
  projects,
  dailyTraces,
}: {
  torchPiece?: DailyTraceItem;
  projects: NoieProject[];
  dailyTraces: DailyTraceItem[];
}) {
  const completedRoutines = (torchPiece?.routines ?? []).filter(
    (routine) => routine.lifecycleStatus === "completed" || Boolean(routine.completedAt)
  );
  const completedProjects = projects.filter(
    (project) => project.status === "done" || Boolean(project.completedAt)
  );
  const completedActions = dailyTraces.filter(isCompletedActionTrace);
  const completedCount = completedRoutines.length + completedProjects.length + completedActions.length;

  return (
    <View style={styles.flowCard}>
      <Text style={styles.flowCardTitle}>지금까지 완료한 카드</Text>
      {completedCount === 0 ? (
        <View style={styles.flowEmptyBox}>
          <Text style={styles.flowEmptyText}>아직 완료한 카드가 없어요.</Text>
        </View>
      ) : (
        <View style={styles.todayMeGroup}>
          {completedRoutines.map((routine) => (
            <View key={`completed-routine-${routine.id}`} style={styles.todayMeItem}>
              <Text style={styles.todayMeTypeLabel}>반복 목표</Text>
              <Text style={styles.todayMeTitle}>{routine.title}</Text>
              <Text style={styles.todayMeStatus}>완료로 보관됨</Text>
            </View>
          ))}
          {completedProjects.map((project) => (
            <View key={`completed-project-${project.id}`} style={styles.todayMeItem}>
              <Text style={styles.todayMeTypeLabel}>프로젝트</Text>
              <Text style={styles.todayMeTitle}>{project.title}</Text>
              <Text style={styles.todayMeStatus}>완료로 보관됨</Text>
            </View>
          ))}
          {completedActions.map((action) => (
            <View key={`completed-action-${action.id}`} style={styles.todayMeItem}>
              <Text style={styles.todayMeTypeLabel}>완료한 행동</Text>
              <Text style={styles.todayMeTitle}>{getCompletedActionDisplayText(action)}</Text>
              <Text style={styles.todayMeStatus}>완료로 보관됨</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function isCompletedActionTrace(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { sourceType?: string; category?: string };
  return (
    typedItem.sourceType === "completed_action" ||
    typedItem.category === "completed_action" ||
    (item.memoryType === "achievement" && item.displayCategory === "완료한 행동")
  );
}

function getCompletedActionDisplayText(item: DailyTraceItem) {
  return getMeaningfulDailyPieceText(item) || item.title;
}

type TodayMeCard =
  | { cardType: "routine"; id: string; routine: DreamRoutine }
  | { cardType: "project"; id: string; project: NoieProject };

type TodayMeRecommendation = {
  type: "routine" | "project";
  title: string;
  reason: string;
  sourceDreamFragmentId?: string;
  semanticKey: string;
};

type TodayMeSectionProps = {
  torchPiece?: DailyTraceItem;
  projects: NoieProject[];
  dreamFragments: DailyTraceItem[];
  onAdjustRoutineTodayTarget: (itemId: string, routineId: string, delta: number) => void;
  onAddRoutineToTodayMe: (input: { title: string; targetValue: number }) => Promise<boolean>;
  onRemoveRoutineFromTodayMe: (itemId: string, routineId: string) => void;
  externalFeedback: string;
  isStartingProject: boolean;
};

type TodayMeDeleteTarget =
  | { type: "routine"; itemId: string; id: string; title: string };

function TodayMeSection({
  torchPiece,
  projects,
  dreamFragments,
  onAdjustRoutineTodayTarget,
  onAddRoutineToTodayMe,
  onRemoveRoutineFromTodayMe,
  externalFeedback,
  isStartingProject,
}: TodayMeSectionProps) {
  const [dismissedRecommendationKeys, setDismissedRecommendationKeys] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<TodayMeDeleteTarget | null>(null);
  const [isRoutineAddOpen, setIsRoutineAddOpen] = useState(false);
  const [routineAddTitle, setRoutineAddTitle] = useState("");
  const [routineAddMinutes, setRoutineAddMinutes] = useState(30);
  const todayKey = getLocalDateString(new Date());
  const activeSeason = torchPiece ? getActiveDreamSeason(torchPiece) : undefined;
  const routines = torchPiece ? getActiveDreamRoutines(torchPiece, activeSeason) : [];
  const visibleCards = getVisibleTodayMeCards(torchPiece, dreamFragments, projects, todayKey);
  const visibleRoutineCards = visibleCards.filter((card): card is Extract<TodayMeCard, { cardType: "routine" }> => card.cardType === "routine");
  const recommendation = visibleRoutineCards.length < MAX_TODAY_ME_CARDS
    ? selectTodayMeRecommendation(torchPiece, dreamFragments, projects, visibleRoutineCards, dismissedRecommendationKeys)
    : undefined;
  const routineRecommendation = recommendation?.type === "routine" ? recommendation : undefined;
  const completedRoutineCount = routines.filter((routine) => isRoutineActionDoneToday(getTodayRoutineRecord(torchPiece, routine))).length;
  const partialRoutineCount = routines.filter((routine) => {
    const record = getTodayRoutineRecord(torchPiece, routine);
    return Boolean(record && !isRoutineActionDoneToday(record) && record.score > 0);
  }).length;
  const completedProjectActionCount = projects.filter((project) => isProjectActionDone(project, todayKey)).length;
  const feedback = getTodayMeFeedback(routines.length, completedRoutineCount, partialRoutineCount, projects.length, completedProjectActionCount);

  const confirmDeleteTarget = () => {
    if (!deleteTarget) {
      return;
    }
    onRemoveRoutineFromTodayMe(deleteTarget.itemId, deleteTarget.id);
    setDeleteTarget(null);
  };

  const saveRoutineAdd = async () => {
    const saved = await onAddRoutineToTodayMe({
      title: routineAddTitle,
      targetValue: routineAddMinutes,
    });
    if (saved) {
      setRoutineAddTitle("");
      setRoutineAddMinutes(30);
      setIsRoutineAddOpen(false);
    }
  };

  const openRoutineRecommendation = (recommendation: TodayMeRecommendation) => {
    setRoutineAddTitle(recommendation.title);
    setRoutineAddMinutes(30);
    setIsRoutineAddOpen(true);
  };

  console.log("[today-me-cards]", { activeCount: visibleRoutineCards.length });
  console.log("[today-me-recommendation]", { hasRecommendation: Boolean(recommendation), type: recommendation?.type });

  return (
    <View style={styles.flowCard}>
      <View style={styles.todayMeHeaderRow}>
        <View style={styles.todayMeHeaderText}>
          <Text style={styles.flowCardTitle}>오늘의 나</Text>
          <Text style={styles.todayMeSubtitle}>오늘 이어갈 반복 목표 {visibleRoutineCards.length}개</Text>
        </View>
        <TouchableOpacity
          style={[styles.todayMeAddButton, visibleRoutineCards.length >= MAX_TODAY_ME_CARDS && styles.todayMeButtonDone]}
          disabled={visibleRoutineCards.length >= MAX_TODAY_ME_CARDS}
          onPress={() => setIsRoutineAddOpen((value) => !value)}
          activeOpacity={0.85}
        >
          <Text style={styles.todayMeAddButtonText}>＋</Text>
        </TouchableOpacity>
      </View>
      {visibleRoutineCards.length >= MAX_TODAY_ME_CARDS ? (
        <Text style={styles.todayMeEmptyLine}>오늘의 나는 네 가지에만 집중할 수 있어요.</Text>
      ) : null}

      {isRoutineAddOpen && visibleRoutineCards.length < MAX_TODAY_ME_CARDS ? (
        <View style={styles.todayMeDetailBox}>
          <Text style={styles.todayMeTypeLabel}>반복 목표 추가</Text>
          <TextInput
            style={styles.todayMeInput}
            value={routineAddTitle}
            onChangeText={setRoutineAddTitle}
            placeholder="반복 목표 이름"
            placeholderTextColor="#777"
          />
          <Text style={styles.todayMeMeta}>목표 시간</Text>
          <View style={styles.todayMeTimeAdjustRow}>
            <TouchableOpacity
              style={styles.todayMeArrowButton}
              onPress={() => setRoutineAddMinutes((value) => Math.max(30, value - 30))}
              disabled={routineAddMinutes <= 30}
              activeOpacity={0.85}
            >
              <Text style={styles.todayMeArrowButtonText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.todayMeTargetTimeText}>{formatRoutineTarget(routineAddMinutes, "분")}</Text>
            <TouchableOpacity
              style={styles.todayMeArrowButton}
              onPress={() => setRoutineAddMinutes((value) => value + 30)}
              activeOpacity={0.85}
            >
              <Text style={styles.todayMeArrowButtonText}>›</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.todayMeButton, !routineAddTitle.trim() && styles.todayMeButtonDone]}
            onPress={() => {
              void saveRoutineAdd();
            }}
            disabled={!routineAddTitle.trim()}
            activeOpacity={0.85}
          >
            <Text style={styles.todayMeButtonText}>저장</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {visibleRoutineCards.length === 0 ? (
        <View style={styles.flowEmptyBox}>
          <Text style={styles.flowEmptyText}>아직 오늘 이어갈 반복 목표가 없어요.</Text>
        </View>
      ) : (
        <View style={styles.todayMeGroup}>
          {visibleRoutineCards.map((card) => {
              const routine = card.routine;
              const record = getTodayRoutineRecord(torchPiece, routine);
              const isDone = isRoutineActionDoneToday(record);
              const effectiveTarget = getEffectiveRoutineTargetValue(routine, todayKey);
              const displayedTarget = Math.max(30, effectiveTarget || 30);
              const unit = routine.unit ?? "";
              const isDeleteConfirmOpen = deleteTarget?.type === "routine" && deleteTarget.id === routine.id;
              return (
                <View key={card.id} style={styles.todayMeItem}>
                  <View style={styles.todayMeCardHeader}>
                    <Text style={styles.todayMeTitle}>{routine.title}</Text>
                    <TouchableOpacity
                      style={styles.todayMeMoreButton}
                      onPress={() => torchPiece && setDeleteTarget({ type: "routine", itemId: torchPiece.id, id: routine.id, title: routine.title })}
                      disabled={!torchPiece}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.todayMeMoreButtonText}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.todayMeItemMain}>
                    <Text style={styles.todayMeMeta}>오늘 목표</Text>
                    <View style={styles.todayMeTimeAdjustRow}>
                      <TouchableOpacity
                        style={styles.todayMeArrowButton}
                        onPress={() => torchPiece && displayedTarget > 30 && onAdjustRoutineTodayTarget(torchPiece.id, routine.id, -30)}
                        disabled={!torchPiece || displayedTarget <= 30}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.todayMeArrowButtonText}>‹</Text>
                      </TouchableOpacity>
                      <Text style={styles.todayMeTargetTimeText}>{formatRoutineTarget(displayedTarget, unit)}</Text>
                      <TouchableOpacity
                        style={styles.todayMeArrowButton}
                        onPress={() => torchPiece && onAdjustRoutineTodayTarget(torchPiece.id, routine.id, 30)}
                        disabled={!torchPiece}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.todayMeArrowButtonText}>›</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.todayMeStatus}>
                      {isDone ? "🔥 오늘의 불씨를 밝혔어요" : "완료는 오늘의 불씨에서 해요"}
                    </Text>
                  </View>
                  {isDeleteConfirmOpen ? (
                    <View style={styles.todayMeDeleteConfirmBox}>
                      <Text style={styles.todayMeDeleteConfirmText}>이 반복 목표를 오늘의 나에서 삭제할까요?</Text>
                      <View style={styles.todayMeDeleteConfirmActions}>
                        <TouchableOpacity style={styles.todayMeDeleteConfirmButton} onPress={confirmDeleteTarget} activeOpacity={0.85}>
                          <Text style={styles.todayMeDeleteConfirmButtonText}>삭제</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.todayMeCancelConfirmButton} onPress={() => setDeleteTarget(null)} activeOpacity={0.85}>
                          <Text style={styles.todayMeCancelConfirmButtonText}>취소</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
          })}
        </View>
      )}

      {routineRecommendation ? (
        <View style={styles.todayMeRecommendationCard}>
          <Text style={styles.todayMeTypeLabel}>노이에의 제안</Text>
          <Text style={styles.todayMeTitle}>{routineRecommendation.title}을 반복 목표로 이어가 볼까요?</Text>
          <Text style={styles.todayMeMeta}>{routineRecommendation.reason}</Text>
          <TouchableOpacity
            style={styles.todayMeButton}
            onPress={() => openRoutineRecommendation(routineRecommendation)}
            activeOpacity={0.85}
          >
            <Text style={styles.todayMeButtonText}>오늘의 나에 담기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.todayMeSecondaryButton} onPress={() => setDismissedRecommendationKeys((keys) => [...keys, routineRecommendation.semanticKey])} activeOpacity={0.85}>
            <Text style={styles.todayMeSecondaryButtonText}>지금은 괜찮아요</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={styles.todayMeFeedback}>{externalFeedback || feedback}</Text>
    </View>
  );
}
type DreamProjectSummary = DreamProgressBreakdown & {
  progressPercent: number;
  linkedProjectCount: number;
  doneProjectCount: number;
};

function DreamProjectSummaryCard({ summary }: { summary: DreamProjectSummary }) {
  const [isProgressDetailsOpen, setIsProgressDetailsOpen] = useState(false);

  return (
    <View style={styles.dreamProjectSummaryCard}>
      <Text style={styles.dreamProjectSummaryTitle}>전체 진행률</Text>
      <Text style={styles.dreamProjectSummaryPercent}>{summary.progressPercent}%</Text>
      <View style={styles.dreamProjectSummaryTrack}>
        <View style={[styles.dreamProjectSummaryFill, { width: `${summary.progressPercent}%` }]} />
      </View>
      <Text style={styles.dreamProjectSummaryNext}>꾸준함 {summary.consistencyScore}%</Text>
      <View style={styles.consistencyStatusRow}>
        {summary.consistencyDays.map((day) => (
          <Text
            key={day.dateKey}
            style={[
              styles.consistencyStatusSymbol,
              day.status === "complete" && styles.consistencyStatusSymbolComplete,
            ]}
          >
            {getConsistencyStatusSymbol(day.status)}
          </Text>
        ))}
      </View>
      <View style={styles.consistencyWeekdayRow}>
        {summary.consistencyDays.map((day) => (
          <Text key={`weekday-${day.dateKey}`} style={styles.consistencyWeekdayText}>
            {getConsistencyWeekdayLabel(day.dateKey)}
          </Text>
        ))}
      </View>
      <Text style={styles.dreamProjectSummaryNext}>
        다음 이정표: {summary.nextMilestone?.title ?? "마일스톤을 추가하면 다음 이정표를 안내할 수 있어요."}
      </Text>
      <TouchableOpacity
        style={styles.dreamPieceActionButtonMuted}
        onPress={() => setIsProgressDetailsOpen((value) => !value)}
        activeOpacity={0.85}
      >
        <Text style={styles.dreamPieceActionTextMuted}>
          {isProgressDetailsOpen ? "진행률 근거 접기" : "진행률 근거 보기"}
        </Text>
      </TouchableOpacity>

      {isProgressDetailsOpen ? (
        <View style={styles.dreamProgressDetailsBox}>
          <Text style={styles.dreamPlanHint}>반복 목표 누적 수행: {summary.cumulativeRoutineProgress}%</Text>
          <Text style={styles.dreamPlanHint}>완료 단계: {summary.milestoneProgress}%</Text>
          <Text style={styles.dreamPlanHint}>목표 기간: {summary.goalDurationMonths ? `${summary.goalDurationMonths}개월` : "-"}</Text>
          <Text style={styles.dreamPlanHint}>기간: {summary.goalStartDate && summary.goalTargetDate ? `${formatDateDot(summary.goalStartDate)} ~ ${formatDateDot(summary.goalTargetDate)}` : "-"}</Text>
          <Text style={styles.dreamPlanHint}>최종 진행률: {summary.progressPercent}%</Text>
          <Text style={styles.dreamPlanHint}>오늘의 나 프로젝트 {summary.linkedProjectCount}개 · 완료된 프로젝트 {summary.doneProjectCount}개</Text>
        </View>
      ) : null}
    </View>
  );
}

function DreamTorchSimplePanel({
  piece,
  todayMeCards,
  onSelectGoalDuration,
  isSavingGoalDuration,
  onRecordDreamRoutine,
  onCompleteProjectNextAction,
}: {
  piece: DailyTraceItem;
  todayMeCards: TodayMeCard[];
  onSelectGoalDuration: (itemId: string, months: GoalDurationMonths) => Promise<void>;
  isSavingGoalDuration: boolean;
  onRecordDreamRoutine: (itemId: string, routineId: string, score: DreamRoutineQuickScore, value?: number) => void;
  onCompleteProjectNextAction: (projectId: string) => void;
}) {
  const selectedMonths = getSelectedGoalDuration(piece);
  const todayKey = getLocalDateString(new Date());
  const fireRoutines = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "routine" }> => card.cardType === "routine");
  const fireProjects = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "project" }> => card.cardType === "project");
  const displayText = getMemoryInputText(piece) || piece.title;
  const ddayLabel = getDreamDdayLabel(piece);
  const completedRoutineCount = fireRoutines.filter(
    ({ routine }) => isRoutineActionDoneToday(getTodayRoutineRecord(piece, routine))
  ).length;
  const completedProjectCount = fireProjects.filter(({ project }) => isProjectActionDone(project, todayKey)).length;
  const totalFireCount = todayMeCards.length;
  const completedFireCount = completedRoutineCount + completedProjectCount;
  const isAllDoneToday = totalFireCount > 0 && completedFireCount === totalFireCount;

  return (
    <View style={styles.dreamTorchSimplePanel}>
      <Text style={styles.flowCardTitle}>꿈의 횃불</Text>
      <View style={styles.dreamTorchGoalRow}>
        <Text style={styles.dreamTorchGoalText}>{displayText}</Text>
        {ddayLabel ? <Text style={styles.dreamTorchDdayText}>{ddayLabel}</Text> : null}
      </View>

      <View style={styles.dreamTorchSection}>
        <Text style={styles.dreamTorchSectionTitle}>목표 기간</Text>
        <View style={styles.goalDurationButtonRow}>
          {([3, 6, 12] as GoalDurationMonths[]).map((months) => {
            const isSelected = selectedMonths === months;
            return (
              <TouchableOpacity
                key={months}
                style={[
                  styles.goalDurationButton,
                  isSelected && styles.goalDurationButtonSelected,
                  isSavingGoalDuration && styles.traceConfirmButtonDisabled,
                ]}
                onPress={() => {
                  void onSelectGoalDuration(piece.id, months);
                }}
                disabled={isSavingGoalDuration}
                activeOpacity={0.85}
              >
                <Text style={[styles.goalDurationButtonText, isSelected && styles.goalDurationButtonTextSelected]}>
                  {isSavingGoalDuration && isSelected ? "저장 중..." : `${months}개월`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.dreamTorchSection}>
        <View style={styles.dreamTorchFireHeader}>
          <Text style={styles.dreamTorchSectionTitle}>
            {isAllDoneToday ? "오늘의 불씨를 모두 켰어요 🔥" : "오늘의 불씨"}
          </Text>
          <Text style={styles.dreamTorchCountText}>{completedFireCount} / {totalFireCount}</Text>
        </View>
        {totalFireCount > 0 ? (
          <View style={styles.dreamTorchRoutineList}>
            {fireRoutines.map(({ routine }, index) => {
              const record = getTodayRoutineRecord(piece, routine);
              const isDone = isRoutineActionDoneToday(record);
              const targetValue = getEffectiveRoutineTargetValue(routine, todayKey);
              const routineTargetText =
                targetValue > 0 ? `오늘 목표 · ${formatRoutineTarget(targetValue, routine.unit)}` : formatRoutineMeta(routine);
              const showDivider = index < totalFireCount - 1;

              return (
                <View key={routine.id}>
                  <View style={styles.dreamTorchRoutineRow}>
                    <View style={styles.dreamTorchRoutineTextBlock}>
                      <Text style={styles.dreamTorchRoutineTitle}>{isDone ? `🔥 ${routine.title}` : routine.title}</Text>
                      <Text style={styles.dreamTorchRoutineMeta}>
                        {isDone ? "오늘 행동했어요" : routineTargetText}
                      </Text>
                    </View>
                    {!isDone ? (
                      <View style={styles.dreamTorchFireActionRow}>
                      <TouchableOpacity
                        style={styles.dreamTorchCompleteButton}
                        onPress={() => onRecordDreamRoutine(piece.id, routine.id, 1)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.dreamTorchCompleteButtonText}>완료</Text>
                      </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                  {showDivider ? <View style={styles.dreamTorchRoutineDivider} /> : null}
                </View>
              );
            })}
            {fireProjects.map(({ project }, index) => {
              const isDone = isProjectActionDone(project, todayKey);
              const actionText = project.nextAction?.trim() || "다음 행동";

              return (
                <View key={`project-fire-${project.id}`}>
                  <View style={styles.dreamTorchRoutineRow}>
                    <View style={styles.dreamTorchRoutineTextBlock}>
                      <Text style={styles.dreamTorchRoutineTitle}>{isDone ? `🔥 ${actionText}` : actionText}</Text>
                      <Text style={styles.dreamTorchRoutineMeta}>
                        {isDone ? "오늘 행동했어요" : `프로젝트 · ${project.title}`}
                      </Text>
                    </View>
                    {!isDone ? (
                      <View style={styles.dreamTorchFireActionRow}>
                      <TouchableOpacity
                        style={styles.dreamTorchCompleteButton}
                        onPress={() => onCompleteProjectNextAction(project.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.dreamTorchCompleteButtonText}>완료</Text>
                      </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                  {fireRoutines.length + index < totalFireCount - 1 ? <View style={styles.dreamTorchRoutineDivider} /> : null}
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.dreamTorchEmptyText}>오늘 켤 불씨가 아직 없어요.</Text>
        )}
      </View>
    </View>
  );
}

function getDreamDdayLabel(piece: DailyTraceItem) {
  const selectedDuration = normalizeGoalDurationMonths(getSelectedGoalDuration(piece) ?? piece.goalDurationMonths);
  const startDateKey = getDreamStartDateKey(piece);
  const targetDateKey = getDreamTargetDateKey(piece, startDateKey, selectedDuration);
  const targetDate = parseDateOnly(targetDateKey);
  const today = parseDateOnly(getLocalDateString(new Date()));

  if (!targetDate || !today) {
    return "";
  }

  const diffDays = Math.ceil((targetDate.getTime() - today.getTime()) / 86400000);
  if (diffDays > 0) {
    return `D-${diffDays}`;
  }
  if (diffDays === 0) {
    return "D-DAY";
  }
  return "기간 종료";
}

function GoalDurationSelector({
  piece,
  onSelectGoalDuration,
  isSaving,
}: {
  piece: DailyTraceItem;
  onSelectGoalDuration: (itemId: string, months: GoalDurationMonths) => Promise<void>;
  isSaving: boolean;
}) {
  const selectedMonths = getSelectedGoalDuration(piece);
  const startDate = isValidDateKey(piece.goalStartDate) ? String(piece.goalStartDate) : "";
  const targetDate = isValidDateKey(piece.goalTargetDate) ? String(piece.goalTargetDate) : "";

  return (
    <View style={styles.flowCard}>
      <Text style={styles.flowCardTitle}>목표 기간</Text>
      <View style={styles.goalDurationButtonRow}>
        {([3, 6, 12] as GoalDurationMonths[]).map((months) => {
          const isSelected = selectedMonths === months;
          return (
            <TouchableOpacity
              key={months}
              style={[
                styles.goalDurationButton,
                isSelected && styles.goalDurationButtonSelected,
                isSaving && styles.traceConfirmButtonDisabled,
              ]}
              onPress={() => {
                void onSelectGoalDuration(piece.id, months);
              }}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              <Text style={[styles.goalDurationButtonText, isSelected && styles.goalDurationButtonTextSelected]}>
                {isSaving && isSelected ? "저장 중..." : `${months}개월`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.dreamPlanHint}>
        {selectedMonths ? getGoalDurationMessage(selectedMonths) : "목표 기간을 선택하면 같은 수행 기록도 기간에 맞춰 천천히 누적돼요."}
      </Text>
      {startDate && targetDate ? (
        <Text style={styles.dreamPlanHint}>{formatDateDot(startDate)} ~ {formatDateDot(targetDate)}</Text>
      ) : null}
    </View>
  );
}
function DreamPieceCard({
  piece,
  isTorch = false,
  onPinDreamTorch,
  onHideFromDream,
  projects,
  torchPiece,
  onStartProjectFromFragment,
  onUpdateDreamTorchPlan,
  onRecordDreamRoutine,
  onOpenProject,
  onCompleteProjectFromTodayMe,
}: {
  piece: DailyTraceItem;
  isTorch?: boolean;
  onPinDreamTorch: (itemId: string) => void;
  onHideFromDream: (itemId: string) => void;
  projects: NoieProject[];
  torchPiece?: DailyTraceItem;
  onStartProjectFromFragment: (itemId: string) => void;
  onUpdateDreamTorchPlan: (itemId: string, values: Partial<DailyTraceItem>) => void;
  onRecordDreamRoutine: (itemId: string, routineId: string, score: DreamRoutineQuickScore, value?: number) => void;
  onOpenProject: (projectId: string) => void;
  onCompleteProjectFromTodayMe: (projectId: string) => void;
}) {
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isCompleteConfirmOpen, setIsCompleteConfirmOpen] = useState(false);
  const linkedProjects = getLinkedProjectsForFragment(piece, projects);
  const completedProject = getCompletedProjectForFragment(piece, projects);
  const linkedProject = completedProject ?? linkedProjects.find((project) => project.status !== "done" && !project.completedAt);
  const state = getDreamFragmentCardState(linkedProject);
  const displayText = getMemoryInputText(piece) || piece.title;
  const memoText = piece.memo?.trim() ?? "";
  const shouldShowMemo =
    memoText.length > 0 && normalizeMemoryInput(memoText) !== normalizeMemoryInput(displayText);

  return (
    <View style={styles.traceListItem}>
      <View style={styles.traceListTextBlock}>
        <Text style={styles.traceItemTitle}>{state.icon} {displayText}</Text>
        {shouldShowMemo ? <Text style={styles.traceItemMemo}>{memoText}</Text> : null}
        <Text style={styles.dreamPieceStatusText}>{state.label}</Text>

        {isTorch ? (
          <DreamTorchPlanPanel
            piece={piece}
            projects={projects}
            onUpdatePlan={onUpdateDreamTorchPlan}
            onRecordRoutine={onRecordDreamRoutine}
          />
        ) : null}

        <View style={styles.dreamPieceActions}>
          {!isTorch ? (
            <>
              {state.kind === "none" ? (
                <TouchableOpacity
                  style={styles.dreamPieceActionButton}
                  onPress={() => onStartProjectFromFragment(piece.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.dreamPieceActionText}>프로젝트 시작</Text>
                </TouchableOpacity>
              ) : null}
              {state.kind === "progress" && linkedProject ? (
                <TouchableOpacity
                  style={styles.dreamPieceActionButton}
                  onPress={() => onOpenProject(linkedProject.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.dreamPieceActionText}>이어가기</Text>
                </TouchableOpacity>
              ) : null}
              {state.kind === "progress" && linkedProject ? (
                <TouchableOpacity
                  style={styles.dreamPieceActionButtonMuted}
                  onPress={() => setIsCompleteConfirmOpen(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.dreamPieceActionTextMuted}>완료</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
          {!isTorch ? (
            <TouchableOpacity
              style={styles.dreamPieceActionButtonMuted}
              onPress={() => setIsMoreMenuOpen((value) => !value)}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceActionTextMuted}>⋯</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {isMoreMenuOpen && !isTorch ? (
          <View style={styles.dreamPieceMoreMenu}>
            <TouchableOpacity
              style={styles.dreamPieceMoreMenuItem}
              onPress={() => {
                setIsMoreMenuOpen(false);
                onPinDreamTorch(piece.id);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceMoreMenuText}>꿈의 횃불로 밝히기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dreamPieceMoreMenuItem}
              onPress={() => {
                setIsMoreMenuOpen(false);
                setIsDeleteConfirmOpen(true);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceMoreMenuText}>삭제</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isCompleteConfirmOpen && linkedProject ? (
          <View style={styles.dreamPieceCompleteConfirmBox}>
            <Text style={styles.dreamPieceCompleteConfirmText}>이 꿈의 파편을 완성할까요?</Text>
            <View style={styles.dreamPieceActions}>
              <TouchableOpacity
                style={styles.dreamPieceCompleteButton}
                onPress={() => {
                  setIsCompleteConfirmOpen(false);
                  onCompleteProjectFromTodayMe(linkedProject.id);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceCompleteButtonText}>완료하기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dreamPieceActionButtonMuted}
                onPress={() => setIsCompleteConfirmOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceActionTextMuted}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {isDeleteConfirmOpen ? (
          <View style={styles.dreamPieceDeleteConfirmBox}>
            <Text style={styles.dreamPieceDeleteConfirmText}>이 꿈의 파편을 삭제할까요?</Text>
            <View style={styles.dreamPieceActions}>
              <TouchableOpacity
                style={styles.dreamPieceDeleteButton}
                onPress={() => {
                  setIsDeleteConfirmOpen(false);
                  onHideFromDream(piece.id);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceDeleteButtonText}>삭제</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dreamPieceActionButtonMuted}
                onPress={() => setIsDeleteConfirmOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceActionTextMuted}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

type DreamProgressBreakdown = {
  executionProgress: number;
  timeProgress: number;
  baseProgress: number;
  paceBonus: number;
  baseExecutionProgress: number;
  elapsedPeriodPercent: number;
  periodAdjustment: number;
  hasExecutionData: boolean;
  goalDurationMonths?: GoalDurationMonths | null;
  goalStartDate?: string;
  goalTargetDate?: string;
  milestoneProgress: number;
  cumulativeRoutineProgress: number;
  recent28DayPace: number;
  projectProgress: number;
  evidenceProgress: number;
  reliability: "낮음" | "보통" | "높음";
  reliabilityReason: string;
  nextMilestone?: DreamMilestone;
  activeSeason?: DreamSeason;
  milestoneWeightTotal: number;
  routineWeight: number;
  milestoneWeight: number;
  consistencyScore: number;
  consistencyDays: ConsistencyDay[];
};

type RoutineScheduleBucket = {
  routineId: string;
  bucketKey: string;
  bucketType: "day" | "week";
  startDateKey: string;
  endDateKey: string;
};

type ProgressWeights = {
  routineWeight: number;
  milestoneWeight: number;
};

type ConsistencyDay = {
  dateKey: string;
  ratio: number;
  status: "complete" | "partial" | "missed" | "neutral";
};

function DreamTorchPlanPanel({
  piece,
  projects,
  onUpdatePlan,
  onRecordRoutine,
}: {
  piece: DailyTraceItem;
  projects: NoieProject[];
  onUpdatePlan: (itemId: string, values: Partial<DailyTraceItem>) => void;
  onRecordRoutine: (itemId: string, routineId: string, score: DreamRoutineQuickScore, value?: number) => void;
}) {
  const activeSeason = getActiveDreamSeason(piece);
  const linkedProjects = getProjectsRelatedToDream(piece, projects);
  const progress = calculateDreamProgress(piece, linkedProjects);
  const activeRoutines = getActiveDreamRoutines(piece, progress.activeSeason);

  return (
    <View style={styles.dreamPlanBox}>
      <Text style={styles.dreamPlanTitle}>꿈의 실행 기록</Text>
      <Text style={styles.dreamPlanHint}>
        목표 기간: {piece.goalStartDate && piece.goalTargetDate ? `${formatDateDot(piece.goalStartDate)} ~ ${formatDateDot(piece.goalTargetDate)}` : "아래 기간 버튼에서 선택할 수 있어요."}
      </Text>
      {activeSeason?.title ? (
        <Text style={styles.dreamPlanHint}>
          현재 시즌: {activeSeason.title}
        </Text>
      ) : null}
      {activeRoutines.length > 0 ? (
        <View style={styles.dreamRoutineList}>
          <Text style={styles.dreamPlanSubtitle}>오늘 꿈에 얼마나 불을 보탰나요?</Text>
          {activeRoutines.map((routine) => (
            <View key={routine.id} style={styles.dreamRoutineRow}>
              <Text style={styles.dreamRoutineTitle}>{routine.title}</Text>
              <View style={styles.dreamRoutineActions}>
                <TouchableOpacity style={styles.dreamRoutineButton} onPress={() => onRecordRoutine(piece.id, routine.id, 0)}><Text style={styles.dreamRoutineButtonText}>아직</Text></TouchableOpacity>
                <TouchableOpacity style={styles.dreamRoutineButton} onPress={() => onRecordRoutine(piece.id, routine.id, 0.5)}><Text style={styles.dreamRoutineButtonText}>조금</Text></TouchableOpacity>
                <TouchableOpacity style={styles.dreamRoutineButton} onPress={() => onRecordRoutine(piece.id, routine.id, 1)}><Text style={styles.dreamRoutineButtonText}>완료</Text></TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type ResumeMaterial = {
  goal: string;
  problem: string;
  action: string;
  tech: string;
  learning: string;
  nextImprovement: string;
};

function splitLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getCompletionCriterionTitle(criterion: string | DreamCompletionCriterion) {
  return typeof criterion === "string" ? criterion : criterion.title;
}

function getCompletionCriteriaTitles(piece: DailyTraceItem) {
  return (piece.completionCriteria ?? [])
    .map(getCompletionCriterionTitle)
    .map((title) => title.trim())
    .filter(Boolean);
}

function buildCompletionCriteria(
  text: string,
  previousCriteria: Array<string | DreamCompletionCriterion> = []
): DreamCompletionCriterion[] {
  const previousByTitle = new Map<string, DreamCompletionCriterion>();
  previousCriteria.forEach((criterion) => {
    if (typeof criterion === "string") {
      return;
    }
    previousByTitle.set(normalizeMemoryInput(criterion.title), criterion);
  });

  return splitLines(text).map((title) => {
    const previous = previousByTitle.get(normalizeMemoryInput(title));
    return {
      id: previous?.id ?? createId("criterion"),
      title,
      completed: previous?.completed,
      completedAt: previous?.completedAt,
      relatedMilestoneId: previous?.relatedMilestoneId,
      evidenceIds: previous?.evidenceIds,
    };
  });
}

function upsertDreamRoutineRecord(records: DreamRoutineRecord[], nextRecord: DreamRoutineRecord) {
  return [
    ...records.filter(
      (record) => !(record.routineId === nextRecord.routineId && record.date === nextRecord.date)
    ),
    nextRecord,
  ].sort((left, right) => right.date.localeCompare(left.date));
}

function normalizeSingleSeason(seasons?: DreamSeason[]) {
  if (!Array.isArray(seasons) || seasons.length === 0) {
    return [];
  }

  const selectedSeason =
    seasons.find((season) => season.status === "active") ?? seasons[0];

  return [
    {
      ...selectedSeason,
      status: "active" as DreamSeasonStatus,
    },
  ];
}

function getActiveDreamSeason(piece: DailyTraceItem) {
  if (piece.currentSeason) {
    return { ...piece.currentSeason, status: "active" as DreamSeasonStatus };
  }

  const seasons = normalizeSingleSeason(piece.seasons);
  return seasons.find((season) => season.id === piece.activeSeasonId) ?? seasons[0];
}

function getActiveDreamRoutines(piece: DailyTraceItem, activeSeason?: DreamSeason) {
  return (piece.routines ?? []).filter((routine) => {
    if (!isRoutineVisibleInTodayMe(routine)) {
      return false;
    }

    return !activeSeason || !routine.relatedSeasonId || routine.relatedSeasonId === activeSeason.id;
  });
}

function getProjectsRelatedToDream(piece: DailyTraceItem, projects: NoieProject[]) {
  return projects.filter((project) => {
    return (
      project.relatedDreamTorchId === piece.id ||
      project.sourceDreamFragmentId === piece.id ||
      project.sourceMemoryId === piece.id
    );
  });
}

function calculateDreamProgress(piece: DailyTraceItem, _projects: NoieProject[]): DreamProgressBreakdown {
  const activeSeason = getActiveDreamSeason(piece);
  const milestones = (piece.milestones ?? []).filter(
    (milestone) => !activeSeason || !milestone.relatedSeasonId || milestone.relatedSeasonId === activeSeason.id
  );
  const activeRoutines = getActiveDreamRoutines(piece, activeSeason);
  const selectedDuration = normalizeGoalDurationMonths(getSelectedGoalDuration(piece) ?? piece.goalDurationMonths);
  const goalStartDate = getDreamStartDateKey(piece);
  const goalTargetDate = getDreamTargetDateKey(piece, goalStartDate, selectedDuration);
  const routineAccumulationRatio = calculateRoutineAccumulationRatio({
    routines: activeRoutines,
    routineRecords: piece.routineRecords ?? [],
    startDateKey: goalStartDate,
    targetDateKey: goalTargetDate,
  });
  const milestoneProgressRatio = calculateMilestoneProgressRatio(milestones);
  const weights = resolveProgressWeights({
    hasRoutines: activeRoutines.length > 0,
    hasMilestones: milestones.length > 0,
  });
  const executionProgress = calculateOverallDreamProgress({
    routineAccumulationRatio,
    milestoneProgressRatio,
    hasRoutines: activeRoutines.length > 0,
    hasMilestones: milestones.length > 0,
  });
  const consistency = calculateConsistencyScore(activeRoutines, piece.routineRecords ?? []);
  const cumulativeRoutineProgress = Math.round(clampRatio(routineAccumulationRatio) * 100);
  const milestoneProgress = Math.round(clampRatio(milestoneProgressRatio) * 100);
  const hasExecutionData =
    activeRoutines.length > 0 ||
    milestones.length > 0 ||
    (piece.routineRecords ?? []).length > 0;

  return {
    executionProgress,
    timeProgress: 0,
    baseProgress: executionProgress,
    paceBonus: 0,
    baseExecutionProgress: executionProgress,
    elapsedPeriodPercent: 0,
    periodAdjustment: 0,
    hasExecutionData,
    goalDurationMonths: selectedDuration,
    goalStartDate,
    goalTargetDate,
    milestoneProgress,
    cumulativeRoutineProgress,
    recent28DayPace: consistency.score,
    projectProgress: 0,
    evidenceProgress: 0,
    reliability: hasExecutionData ? "높음" : "낮음",
    reliabilityReason: hasExecutionData
      ? "반복 목표와 완료 단계 원본 데이터로 계산했어요."
      : "반복 목표와 완료 단계가 아직 없어요.",
    nextMilestone: selectNextDreamMilestone(milestones),
    activeSeason,
    milestoneWeightTotal: milestones.length,
    routineWeight: weights.routineWeight,
    milestoneWeight: weights.milestoneWeight,
    consistencyScore: consistency.score,
    consistencyDays: consistency.days,
  };
}

function normalizeGoalDurationMonths(value: unknown): GoalDurationMonths {
  if (value === 3 || value === "3" || value === "3months" || value === "3개월") {
    return 3;
  }
  if (value === 12 || value === "12" || value === "12months" || value === "12개월") {
    return 12;
  }
  return 6;
}

function addMonthsSafe(sourceDate: Date, months: number): Date {
  const result = new Date(sourceDate);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const finalDayOfMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, finalDayOfMonth));
  return result;
}

function getDreamStartDateKey(piece: DailyTraceItem) {
  const typedPiece = piece as DailyTraceItem & {
    journeyStartedAt?: string;
    dreamStartedAt?: string;
  };
  const candidates = [
    typedPiece.journeyStartedAt,
    typedPiece.dreamStartedAt,
    piece.goalStartDate,
    piece.createdAt,
    piece.date,
  ];
  const selected = candidates.find((value) => Boolean(parseDateOnly(value)));
  return selected ? getLocalDateString(parseDateOnly(selected) ?? new Date()) : getLocalDateString(new Date());
}

function getDreamTargetDateKey(
  piece: DailyTraceItem,
  startDateKey: string,
  durationMonths: GoalDurationMonths
) {
  if (isValidDateKey(piece.goalTargetDate)) {
    return String(piece.goalTargetDate);
  }
  const startDate = parseDateOnly(startDateKey) ?? new Date();
  return getLocalDateString(addMonthsSafe(startDate, durationMonths));
}

function calculateMilestoneProgressRatio(milestones: DreamMilestone[]) {
  if (milestones.length === 0) {
    return 0;
  }
  const completedCount = milestones.filter(
    (milestone) => milestone.status === "done" || Boolean(milestone.completedAt)
  ).length;
  return clampRatio(completedCount / milestones.length);
}

function getDailyRoutineCompletionRatio(
  routine: DreamRoutine,
  dateKey: string,
  records: DreamRoutineRecord[]
) {
  if (routine.pausedDates?.includes(dateKey)) {
    return 0;
  }
  const targetValue = getEffectiveRoutineTargetValue(routine, dateKey);
  const record = findRoutineRecord(records, routine.id, dateKey);
  const actualValue = getRoutineRecordActualValue(record);

  if (targetValue > 0) {
    return clampRatio(actualValue / targetValue);
  }
  if (record?.score) {
    return clampRatio(record.score);
  }
  return 0;
}

function getWeeklyRoutineCompletionRatio(
  routine: DreamRoutine,
  weekStartDateKey: string,
  weekEndDateKey: string,
  records: DreamRoutineRecord[]
) {
  const weeklyTargetValue = safeNumber(routine.weeklyTargetCount) || safeNumber(routine.targetValue) || 1;
  if (weeklyTargetValue <= 0) {
    return 0;
  }
  const actualWeeklyValue = records
    .filter(
      (record) =>
        record.routineId === routine.id &&
        record.date >= weekStartDateKey &&
        record.date <= weekEndDateKey
    )
    .reduce((sum, record) => {
      const value = getRoutineRecordActualValue(record);
      return sum + (value > 0 ? value : record.score > 0 ? 1 : 0);
    }, 0);

  return clampRatio(actualWeeklyValue / weeklyTargetValue);
}

function buildRoutineScheduleBuckets(
  routines: DreamRoutine[],
  startDateKey: string,
  targetDateKey: string
): RoutineScheduleBucket[] {
  const startDate = parseDateOnly(startDateKey);
  const targetDate = parseDateOnly(targetDateKey);
  if (!startDate || !targetDate || targetDate < startDate) {
    return [];
  }
  const buckets: RoutineScheduleBucket[] = [];

  routines.forEach((routine) => {
    const routineStartDate = maxDateLocal(startDate, parseDateOnly(routine.createdAt));
    if (!routineStartDate || routineStartDate > targetDate) {
      return;
    }
    if (routine.repeatType === "weekly") {
      let weekStart = new Date(routineStartDate);
      while (weekStart <= targetDate) {
        const weekEnd = minDateLocal(addDaysLocal(weekStart, 6), targetDate);
        buckets.push({
          routineId: routine.id,
          bucketKey: `${routine.id}:${getLocalDateString(weekStart)}`,
          bucketType: "week",
          startDateKey: getLocalDateString(weekStart),
          endDateKey: getLocalDateString(weekEnd),
        });
        weekStart = addDaysLocal(weekStart, 7);
      }
      return;
    }

    enumerateDateKeys(routineStartDate, targetDate).forEach((dateKey) => {
      if (routine.pausedDates?.includes(dateKey)) {
        return;
      }
      buckets.push({
        routineId: routine.id,
        bucketKey: `${routine.id}:${dateKey}`,
        bucketType: "day",
        startDateKey: dateKey,
        endDateKey: dateKey,
      });
    });
  });

  return buckets;
}

function calculateRoutineAccumulationRatio({
  routines,
  routineRecords,
  startDateKey,
  targetDateKey,
}: {
  routines: DreamRoutine[];
  routineRecords: DreamRoutineRecord[];
  startDateKey: string;
  targetDateKey: string;
}) {
  const buckets = buildRoutineScheduleBuckets(routines, startDateKey, targetDateKey);
  if (buckets.length === 0) {
    return 0;
  }
  let earnedScore = 0;
  buckets.forEach((bucket) => {
    const routine = routines.find((item) => item.id === bucket.routineId);
    if (!routine) {
      return;
    }
    earnedScore += bucket.bucketType === "week"
      ? getWeeklyRoutineCompletionRatio(routine, bucket.startDateKey, bucket.endDateKey, routineRecords)
      : getDailyRoutineCompletionRatio(routine, bucket.startDateKey, routineRecords);
  });

  return clampRatio(earnedScore / buckets.length);
}

function resolveProgressWeights({
  hasRoutines,
  hasMilestones,
}: {
  hasRoutines: boolean;
  hasMilestones: boolean;
}): ProgressWeights {
  if (hasRoutines && hasMilestones) {
    return { routineWeight: 70, milestoneWeight: 30 };
  }
  if (hasRoutines) {
    return { routineWeight: 100, milestoneWeight: 0 };
  }
  if (hasMilestones) {
    return { routineWeight: 0, milestoneWeight: 100 };
  }
  return { routineWeight: 0, milestoneWeight: 0 };
}

function calculateOverallDreamProgress({
  routineAccumulationRatio,
  milestoneProgressRatio,
  hasRoutines,
  hasMilestones,
}: {
  routineAccumulationRatio: number;
  milestoneProgressRatio: number;
  hasRoutines: boolean;
  hasMilestones: boolean;
}) {
  const weights = resolveProgressWeights({ hasRoutines, hasMilestones });
  const routineContribution = clampRatio(routineAccumulationRatio) * weights.routineWeight;
  const milestoneContribution = clampRatio(milestoneProgressRatio) * weights.milestoneWeight;

  return roundProgressPercent(routineContribution + milestoneContribution);
}

function calculateConsistencyScore(
  routines: DreamRoutine[],
  routineRecords: DreamRoutineRecord[]
) {
  const today = parseDateOnly(getLocalDateString(new Date())) ?? new Date();
  const startDate = addDaysLocal(today, -6);
  const dateKeys = enumerateDateKeys(startDate, today);
  const days: ConsistencyDay[] = dateKeys.map((dateKey) => {
    const scheduledRoutines = routines.filter(
      (routine) =>
        routine.repeatType !== "weekly" &&
        !routine.pausedDates?.includes(dateKey) &&
        isRoutineActiveOnDate(routine, dateKey)
    );
    if (scheduledRoutines.length === 0) {
      return { dateKey, ratio: 0, status: "neutral" };
    }
    const ratio =
      scheduledRoutines.reduce(
        (sum, routine) => sum + getDailyRoutineCompletionRatio(routine, dateKey, routineRecords),
        0
      ) / scheduledRoutines.length;
    return {
      dateKey,
      ratio,
      status: ratio >= 0.8 ? "complete" : ratio > 0 ? "partial" : "missed",
    };
  });
  const scoredDays = days.filter((day) => day.status !== "neutral");
  const score =
    scoredDays.length > 0
      ? Math.round((scoredDays.reduce((sum, day) => sum + day.ratio, 0) / scoredDays.length) * 100)
      : 0;

  return { score: clampPercent(score), days };
}

function buildNeutralConsistencyDays() {
  const today = parseDateOnly(getLocalDateString(new Date())) ?? new Date();
  return enumerateDateKeys(addDaysLocal(today, -6), today).map((dateKey) => ({
    dateKey,
    ratio: 0,
    status: "neutral" as const,
  }));
}

function getConsistencyStatusSymbol(status: ConsistencyDay["status"]) {
  if (status === "complete") {
    return "🔥";
  }
  if (status === "partial") {
    return "◐";
  }
  if (status === "missed") {
    return "○";
  }
  return "·";
}

function getConsistencyWeekdayLabel(dateKey: string) {
  const date = parseDateOnly(dateKey);
  if (!date) {
    return "";
  }
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}

function isRoutineActiveOnDate(routine: DreamRoutine, dateKey: string) {
  const createdDateKey = getLocalDateString(parseDateOnly(routine.createdAt) ?? new Date());
  return dateKey >= createdDateKey;
}

function selectNextDreamMilestone(milestones: DreamMilestone[]) {
  const priorityScore: Record<DreamMilestonePriority, number> = { high: 0, medium: 1, low: 2 };
  return [...milestones]
    .filter((milestone) => milestone.status !== "done")
    .sort((left, right) => {
      const priorityDiff = priorityScore[left.priority] - priorityScore[right.priority];
      return priorityDiff !== 0 ? priorityDiff : left.createdAt.localeCompare(right.createdAt);
    })[0];
}

function findRoutineRecord(
  records: DreamRoutineRecord[],
  routineId: string,
  dateKey: string
) {
  return records.find((record) => record.routineId === routineId && record.date === dateKey);
}

function getRoutineRecordActualValue(record?: DreamRoutineRecord) {
  if (!record) {
    return 0;
  }
  const recordWithActual = record as DreamRoutineRecord & {
    actualValue?: number;
    amount?: number;
    completed?: boolean;
  };
  const actualValue =
    safeNumber(recordWithActual.actualValue) ||
    safeNumber(recordWithActual.amount) ||
    safeNumber(record.value);
  if (actualValue > 0) {
    return actualValue;
  }
  if (recordWithActual.completed) {
    return 1;
  }
  return clampRatio(record.score);
}

function isRoutineActionDoneToday(record?: DreamRoutineRecord) {
  return Boolean(record && (getRoutineRecordActualValue(record) > 0 || record.score > 0));
}

function convertRoutineRecordValueToRoutineUnit(
  value: number,
  sourceUnit?: string | null,
  targetUnit?: string | null
) {
  const safeValue = safeNumber(value);
  if (safeValue <= 0) {
    return 0;
  }
  if (sourceUnit === "시간" && targetUnit === "분") {
    return safeValue * 60;
  }
  if (sourceUnit === "분" && targetUnit === "시간") {
    return safeValue / 60;
  }
  return safeValue;
}

function safeNumber(value: unknown) {
  const numberValue = typeof value === "number" || typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function roundProgressPercent(value: number) {
  return Math.round(clampPercent(value) * 10) / 10;
}

function addDaysLocal(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function maxDateLocal(left: Date, right: Date | null) {
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

function minDateLocal(left: Date, right: Date | null) {
  if (!right) {
    return left;
  }
  return left < right ? left : right;
}

function formatProgressValue(value: number) {
  return Number.isFinite(value) ? `${value}%` : "-";
}











function getRoutineUpdatedAt(routine: DreamRoutine) {
  return routine.updatedAt ?? routine.createdAt;
}

function getRoutineStep(routine: DreamRoutine) {
  if (routine.recordType === "check") {
    return 1;
  }
  const target = safeNumber(routine.targetValue);
  return target >= 5 ? 0.5 : 1;
}

function roundRoutineTarget(value: number) {
  return Math.round(value * 10) / 10;
}

function getEffectiveRoutineTargetValue(routine: DreamRoutine, dateKey: string) {
  const dailyTarget = routine.dailySettings?.[dateKey]?.targetValue;
  if (typeof dailyTarget === "number" && Number.isFinite(dailyTarget)) {
    return dailyTarget;
  }
  return safeNumber(routine.targetValue);
}

function getEffectiveRoutineMinimumValue(routine: DreamRoutine, dateKey: string) {
  const dailyMinimum = routine.dailySettings?.[dateKey]?.minimumValue;
  if (typeof dailyMinimum === "number" && Number.isFinite(dailyMinimum)) {
    return dailyMinimum;
  }
  return safeNumber(routine.minimumValue);
}

function formatRoutineTarget(value: number, unit?: string) {
  if (value <= 0) {
    return "체크";
  }
  return formatRoutineTargetForDisplay(value, unit);
}

function formatRoutineTargetForDisplay(value: number, unit?: string) {
  if (unit === "분" && value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  }
  return `${value}${unit ?? ""}`;
}

function buildTodayMeCards(
  routines: DreamRoutine[],
  projects: NoieProject[],
  torchPiece: DailyTraceItem | undefined,
  todayKey: string
): TodayMeCard[] {
  const routineCards: TodayMeCard[] = routines
    .filter((routine) => isActiveTodayMeRoutine(routine))
    .map((routine) => ({ cardType: "routine" as const, id: `routine-${routine.id}`, routine }));
  const projectCards: TodayMeCard[] = projects
    .filter((project) => isActiveTodayMeProject(project) && Boolean(project.nextAction?.trim()))
    .map((project) => ({ cardType: "project" as const, id: `project-${project.id}`, project }));

  return [...routineCards, ...projectCards].sort((left, right) => {
    const leftOrder = getTodayMeCardOrder(left, torchPiece, todayKey);
    const rightOrder = getTodayMeCardOrder(right, torchPiece, todayKey);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return getTodayMeCardUpdatedAt(right).localeCompare(getTodayMeCardUpdatedAt(left));
  });
}

function getVisibleTodayMeCards(
  torchPiece: DailyTraceItem | undefined,
  dreamFragments: DailyTraceItem[],
  projects: NoieProject[],
  todayKey: string
) {
  const activeSeason = torchPiece ? getActiveDreamSeason(torchPiece) : undefined;
  const routines = torchPiece ? getActiveDreamRoutines(torchPiece, activeSeason) : [];
  const todayMeProjects = getTodayMeProjects(torchPiece, dreamFragments, projects);
  return buildTodayMeCards(routines, todayMeProjects, torchPiece, todayKey).slice(0, MAX_TODAY_ME_CARDS);
}

function isActiveTodayMeRoutine(routine: DreamRoutine) {
  return isRoutineVisibleInTodayMe(routine);
}

function isRoutineVisibleInTodayMe(routine: DreamRoutine) {
  return isRoutineAvailableForTodayMe(routine);
}

function isRoutineAvailableForTodayMe(routine: DreamRoutine) {
  const typedRoutine = routine as DreamRoutine & {
    deletedAt?: string | null;
    hidden?: boolean;
    status?: string;
  };
  return (
    typedRoutine.deletedAt == null &&
    typedRoutine.hidden !== true &&
    typedRoutine.status !== "deleted" &&
    typedRoutine.status !== "hidden" &&
    routine.lifecycleStatus !== "completed" &&
    routine.lifecycleStatus !== "archived" &&
    routine.archivedFromTodayMe !== true
  );
}



function getTodayMeCardOrder(card: TodayMeCard, torchPiece: DailyTraceItem | undefined, todayKey: string) {
  const pinnedOrder = card.cardType === "routine" ? card.routine.todayMeOrder : card.project.todayMeOrder;
  if (typeof pinnedOrder === "number") {
    return pinnedOrder;
  }
  if (card.cardType === "routine") {
    return getTodayRoutineRecord(torchPiece, card.routine) ? 30 : 10;
  }
  return card.project.nextAction?.trim() ? 20 : 40;
}

function getTodayMeCardUpdatedAt(card: TodayMeCard) {
  return card.cardType === "routine" ? getRoutineUpdatedAt(card.routine) : card.project.updatedAt;
}

function selectTodayMeRecommendation(
  torchPiece: DailyTraceItem | undefined,
  dreamFragments: DailyTraceItem[],
  projects: NoieProject[],
  activeCards: TodayMeCard[],
  dismissedKeys: string[]
): TodayMeRecommendation | undefined {
  const activeKeys = new Set(
    activeCards.map((card) => normalizeMemoryInput(card.cardType === "routine" ? card.routine.title : card.project.title))
  );
  const activeRoutineKeys = new Set(
    (torchPiece?.routines ?? [])
      .filter(isActiveTodayMeRoutine)
      .map((routine) => normalizeMemoryInput(routine.title))
  );

  for (const fragment of dreamFragments) {
    if (getCompletedProjectForFragment(fragment, projects)) {
      continue;
    }
    const text = getMemoryInputText(fragment) || fragment.title;
    const recommendationTitle = makeRoutineRecommendationTitle(text);
    if (!recommendationTitle) {
      continue;
    }
    const recommendationKey = normalizeMemoryInput(recommendationTitle);
    const sourceKey = normalizeMemoryInput(text);
    if (
      !recommendationKey ||
      activeKeys.has(recommendationKey) ||
      activeRoutineKeys.has(recommendationKey) ||
      dismissedKeys.includes(recommendationKey) ||
      dismissedKeys.includes(sourceKey)
    ) {
      continue;
    }

    return {
      type: "routine",
      title: recommendationTitle,
      reason: sourceKey === recommendationKey
        ? "반복해서 이어갈 수 있는 행동이에요."
        : `‘${makeMemoryTitle(text)}’를 위한 반복 행동이에요.`,
      sourceDreamFragmentId: fragment.id,
      semanticKey: recommendationKey,
    };
  }

  return undefined;
}

function makeRoutineRecommendationTitle(text: string) {
  const title = makeMemoryTitle(text);
  if (isRepeatableActionTitle(title)) {
    return title;
  }

  if (!isResultGoalTitle(title) && !hasRoutineRepeatSignal(text)) {
    return undefined;
  }

  return convertResultGoalToRoutineTitle(title);
}

function isResultGoalTitle(title: string) {
  return /(따기|합격하기|완성하기|만들기|열기|출시하기|취업하기|달성하기)$/.test(title);
}

function isRepeatableActionTitle(title: string) {
  return /(공부하기|연습하기|운동하기|읽기|쓰기|복습하기|정리하기|훈련하기|작업하기)$/.test(title);
}

function hasRoutineRepeatSignal(text: string) {
  return /매일|매주|주\s*\d+\s*회|\d+(?:\.\d+)?\s*(분|시간|회|개|페이지|세트|장)\s*씩|꾸준히|반복해서/.test(text);
}

function convertResultGoalToRoutineTitle(title: string) {
  if (/자격증.*(따기|취득하기)$/.test(title)) {
    return title.replace(/(따기|취득하기)$/g, "공부하기");
  }
  if (/시험.*합격하기$/.test(title)) {
    return title.replace(/합격하기$/g, "공부하기");
  }
  if (/헤어.*기술.*익히기$/.test(title)) {
    return title.replace(/익히기$/g, "연습하기");
  }
  if (/포트폴리오.*완성하기$/.test(title)) {
    return title.replace(/완성하기$/g, "작업하기");
  }
  return undefined;
}
function getTodayRoutineRecord(piece: DailyTraceItem | undefined, routine: DreamRoutine) {
  const todayKey = getLocalDateString(new Date());
  return (piece?.routineRecords ?? [])
    .filter((record) => record.routineId === routine.id && record.date === todayKey)
    .sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt))[0];
}

function formatRoutineMeta(routine: DreamRoutine) {
  if (routine.recordType === "check") {
    return routine.repeatType === "weekly" ? `주 ${routine.weeklyTargetCount ?? 1}회` : "매일 확인";
  }

  const target = routine.targetValue ? `목표 ${routine.targetValue}${routine.unit ?? ""}` : "목표 수치 미설정";
  const minimum = routine.minimumValue ? `최소 ${routine.minimumValue}${routine.unit ?? ""}` : "최소 기준 없음";
  return `${target} · ${minimum}`;
}

function calculateRoutineScore(routine: DreamRoutine, value: number, dateKey?: string): DreamRoutineQuickScore {
  if (routine.recordType === "check") {
    return 1;
  }

  const targetValue = safeNumber(routine.targetValue);
  const minimumValue = safeNumber(routine.minimumValue);
  if (targetValue > 0 && value >= targetValue) {
    return 1;
  }
  if (minimumValue > 0 && value >= minimumValue) {
    return 0.5;
  }
  return 0;
}

function getTodayMeFeedback(
  routineCount: number,
  completedRoutineCount: number,
  partialRoutineCount: number,
  projectCount: number,
  completedProjectActionCount: number
) {
  if (routineCount === 0 && projectCount === 0) {
    return "오늘은 아직 불씨가 남아 있어요.";
  }
  if (routineCount > 0 && completedRoutineCount === routineCount) {
    return "오늘의 나를 모두 채웠어요. 꿈에 불을 보탰어요.";
  }
  if (completedRoutineCount > 0 || partialRoutineCount > 0) {
    return "오늘 기록도 꿈으로 가는 과정이에요.";
  }
  if (completedProjectActionCount > 0) {
    return "오늘의 한 걸음이 프로젝트에 옮겨졌어요.";
  }
  return "오늘은 아직 불씨가 남아 있어요.";
}

function isProjectActionDone(project: NoieProject, dateKey: string) {
  return project.dailyActionRecords?.[dateKey]?.completed === true;
}

function getProjectRelatedDreamText(
  project: NoieProject,
  dreamFragments: DailyTraceItem[],
  torchPiece?: DailyTraceItem
) {
  const relatedFragment = dreamFragments.find(
    (fragment) =>
      fragment.id === project.sourceDreamFragmentId ||
      fragment.id === project.sourceMemoryId ||
      fragment.id === project.relatedDreamFragmentId
  );
  const relatedDream = relatedFragment ?? (project.relatedDreamTorchId === torchPiece?.id ? torchPiece : undefined);
  return relatedDream ? getMemoryInputText(relatedDream) || relatedDream.title : "";
}



function extractProjectTitle(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const candidate =
        item.title ??
        item.normalizedText ??
        item.text ??
        item.originalText ??
        item.content;

      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return "";
}














function getEmptyDreamProgressBreakdown(): DreamProgressBreakdown {
  return {
    executionProgress: 0,
    timeProgress: 0,
    baseProgress: 0,
    paceBonus: 0,
    baseExecutionProgress: 0,
    elapsedPeriodPercent: 0,
    periodAdjustment: 0,
    hasExecutionData: false,
    goalDurationMonths: null,
    goalStartDate: "",
    goalTargetDate: "",
    milestoneProgress: 0,
    cumulativeRoutineProgress: 0,
    recent28DayPace: 0,
    projectProgress: 0,
    evidenceProgress: 0,
    reliability: "낮음",
    reliabilityReason: "목표 계획이 아직 설정되지 않았어요.",
    milestoneWeightTotal: 0,
    routineWeight: 0,
    milestoneWeight: 0,
    consistencyScore: 0,
    consistencyDays: buildNeutralConsistencyDays(),
  };
}

function getDreamProjectSummary(projects: NoieProject[], torchPiece?: DailyTraceItem, allProjects: NoieProject[] = projects): DreamProjectSummary {
  const progress = torchPiece
    ? calculateDreamProgress(torchPiece, getProjectsRelatedToDream(torchPiece, allProjects))
    : getEmptyDreamProgressBreakdown();

  return {
    ...progress,
    progressPercent: progress.executionProgress,
    linkedProjectCount: projects.length,
    doneProjectCount: projects.filter((project) => project.status === "done").length,
  };
}

function formatDreamProjectStatus(status?: DreamProjectStatus) {
  const labelMap: Record<DreamProjectStatus, string> = {
    idea: "아이디어",
    planning: "계획 중",
    in_progress: "진행 중",
    review: "검토 중",
    done: "완료",
  };

  return status ? labelMap[status] : "아이디어";
}

function isProjectLinkedToFragment(project: NoieProject, fragment: DailyTraceItem) {
  return (
    project.id === fragment.linkedProjectId ||
    project.sourceDreamFragmentId === fragment.id ||
    project.sourceMemoryId === fragment.id ||
    project.relatedDreamFragmentId === fragment.id
  );
}

function getLinkedProjectsForFragment(
  piece: DailyTraceItem,
  projects: NoieProject[]
) {
  return projects.filter((project) => !project.isArchived && isProjectLinkedToFragment(project, piece));
}

function getCompletedProjectForFragment(
  piece: DailyTraceItem,
  projects: NoieProject[]
) {
  return getLinkedProjectsForFragment(piece, projects).find(
    (project) => project.status === "done" || Boolean(project.completedAt)
  );
}

function getLinkedProjectForFragment(
  piece: DailyTraceItem,
  projects: NoieProject[]
) {
  return getLinkedProjectsForFragment(piece, projects)[0];
}

function getDreamFragmentCardState(project?: NoieProject) {
  if (!project) {
    return {
      kind: "none" as const,
      icon: "✦",
      label: "아직 시작하지 않은 꿈",
    };
  }

  if (project.status === "done" || project.completedAt) {
    return {
      kind: "completed" as const,
      icon: "⭐",
      label: "프로젝트를 완료했어요",
    };
  }

  return {
    kind: "progress" as const,
    icon: "🔥",
    label: "프로젝트가 진행 중이에요",
  };
}

function getCompletedDreamFragmentMeta(project: NoieProject) {
  if (!project.completedAt) {
    return "완료";
  }
  return `완료 · ${formatDateDot(project.completedAt)}`;
}



function getDreamFragmentJudgement(
  piece: DailyTraceItem,
  isLinkedProject: boolean
) {
  if (piece.projectStatus === "done") {
    return "완료된 프로젝트로 표시되어 있어요.";
  }

  if (isLinkedProject && piece.nextAction?.trim()) {
    return "프로젝트로 연결되어 있고, 다음 행동이 정해져 있어요.";
  }

  if (isLinkedProject) {
    return "꿈의 파편에서 시작된 프로젝트예요.";
  }

  return "아직 프로젝트로 시작되기 전의 꿈의 파편이에요.";
}

function buildResumeMaterial(
  piece: DailyTraceItem,
  linkedProject?: NoieProject
): ResumeMaterial {
  const goal =
    linkedProject?.goal ||
    getMemoryInputText(piece) ||
    piece.title ||
    "정리된 목표가 아직 부족해요.";
  const sourceText = getMemoryInputText(piece);
  const nextAction = piece.nextAction || linkedProject?.nextAction;

  return {
    goal,
    problem: "문제 상황은 아직 대화에서 충분히 드러나지 않았어요.",
    action: linkedProject
      ? "꿈의 파편을 프로젝트로 연결했어요."
      : "아직 프로젝트로 시작되기 전이에요.",
    tech: extractTechnologiesFromText(sourceText || goal),
    learning: "배운 점은 프로젝트 진행 기록이 더 쌓이면 정리할 수 있어요.",
    nextImprovement: nextAction || "다음 보완점은 아직 정해지지 않았어요.",
  };
}

function extractTechnologiesFromText(text: string) {
  const techKeywords = [
    "AI",
    "React Native",
    "Expo",
    "TypeScript",
    "FastAPI",
    "Python",
    "OpenAI",
    "Supabase",
    "백엔드",
    "프론트엔드",
    "앱",
  ];
  const normalizedText = text.toLowerCase();
  const matchedTech = techKeywords.filter((keyword) =>
    normalizedText.includes(keyword.toLowerCase())
  );

  return matchedTech.length > 0
    ? matchedTech.join(", ")
    : "사용 기술은 아직 충분히 드러나지 않았어요.";
}

function DreamProgressEvidenceCard({
  piece,
  progressPercent,
  linkedProject,
  relatedDream,
}: {
  piece: DailyTraceItem;
  progressPercent: number;
  linkedProject?: NoieProject;
  relatedDream?: DailyTraceItem;
}) {
  const rows: Array<[string, string]> = [
    ["project link", linkedProject ? "linked" : "-"],
    ["projectStatus", formatSaveDecisionValue(piece.projectStatus)],
    ["progressPercent", `${progressPercent}`],
    ["nextAction", formatSaveDecisionValue(piece.nextAction)],
    ["createdAt", formatSaveDecisionValue(piece.createdAt)],
    ["updatedAt", formatSaveDecisionValue(piece.updatedAt)],
    [
      "related dream",
      relatedDream
        ? getMemoryInputText(relatedDream) || relatedDream.title
        : "-",
    ],
    ["linked project", linkedProject?.title ?? "-"],
  ];

  return (
    <View style={styles.dreamEvidenceCard}>
      <Text style={styles.dreamEvidenceTitle}>진행 근거</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.dreamEvidenceRow}>
          <Text style={styles.dreamEvidenceKey}>{label}</Text>
          <Text style={styles.dreamEvidenceValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function ResumeMaterialCard({ material }: { material: ResumeMaterial }) {
  const rows: Array<[string, string]> = [
    ["1. 목표", material.goal],
    ["2. 문제 상황", material.problem],
    ["3. 내가 한 일", material.action],
    ["4. 사용 기술", material.tech],
    ["5. 배운 점", material.learning],
    ["6. 다음 보완점", material.nextImprovement],
  ];

  return (
    <View style={styles.resumeMaterialCard}>
      <Text style={styles.resumeMaterialTitle}>자소서 추천 재료</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.resumeMaterialSection}>
          <Text style={styles.resumeMaterialSectionTitle}>{label}</Text>
          <Text style={styles.resumeMaterialText}>{value}</Text>
        </View>
      ))}
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
                    {index + 1}. {getDayPieceText(piece)}
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
  dailyLongRecords,
  selectedTraceDate,
  calendarMonth,
  onSelectTraceDate,
  onChangeCalendarMonth,
  onToggleDailyTraceDone,
  onDeleteDailyTraceGoal: _onDeleteDailyTraceGoal,
  onAddDailyTraceItem,
  onSaveDailyLongRecord,
  onCleanupDuplicateMemories,
  cleanupMessage,
  onBackToChat,
}: {
  dailyTraces: DailyTraceItem[];
  dailyLongRecords: DailyLongRecord[];
  selectedTraceDate: string;
  calendarMonth: Date;
  onSelectTraceDate: (date: string) => void;
  onChangeCalendarMonth: (date: Date) => void;
  onToggleDailyTraceDone: (itemId: string, dateKey?: string) => void;
  onDeleteDailyTraceGoal: (itemId: string) => void;
  onAddDailyTraceItem: (input: {
    type: "todo" | "schedule" | "record";
    date: string;
    title: string;
    time?: string;
    endTime?: string;
    reminder?: string;
  }) => boolean;
  onSaveDailyLongRecord: (input: {
    dateKey: string;
    title?: string;
    body: string;
  }) => boolean;
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
            이번 주에 남긴 흔적이에요
          </Text>
        </View>
        <TouchableOpacity
          style={styles.backToChatButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.backToChatButtonText}>채팅</Text>
        </TouchableOpacity>
      </View>

      <DailyTraceCalendar
        items={dailyTraces}
        dailyLongRecords={dailyLongRecords}
        selectedDate={selectedTraceDate}
        calendarMonth={calendarMonth}
        onSelectDate={onSelectTraceDate}
        onChangeMonth={onChangeCalendarMonth}
        onToggleDone={onToggleDailyTraceDone}
        onAddItem={onAddDailyTraceItem}
        onSaveLongRecord={onSaveDailyLongRecord}
      />

      <TouchableOpacity
        style={styles.traceCleanupTextButton}
        onPress={onCleanupDuplicateMemories}
        activeOpacity={0.85}
      >
        <Text style={styles.traceCleanupTextButtonText}>중복 기록 정리</Text>
      </TouchableOpacity>
      {cleanupMessage ? (
        <Text style={styles.traceCandidateMemo}>{cleanupMessage}</Text>
      ) : null}
    </ScrollView>
  );
}

function DailyTraceCalendar({
  items,
  dailyLongRecords,
  selectedDate,
  calendarMonth,
  onSelectDate,
  onChangeMonth,
  onToggleDone,
  onAddItem,
  onSaveLongRecord,
}: {
  items: DailyTraceItem[];
  dailyLongRecords: DailyLongRecord[];
  selectedDate: string;
  calendarMonth: Date;
  onSelectDate: (date: string) => void;
  onChangeMonth: (date: Date) => void;
  onToggleDone: (itemId: string, dateKey?: string) => void;
  onAddItem: (input: {
    type: "todo" | "schedule" | "record";
    date: string;
    title: string;
    time?: string;
    endTime?: string;
    reminder?: string;
  }) => boolean;
  onSaveLongRecord: (input: {
    dateKey: string;
    title?: string;
    body: string;
  }) => boolean;
}) {
  const [isMonthCalendarOpen, setIsMonthCalendarOpen] = useState(false);
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [isLongRecordEditorOpen, setIsLongRecordEditorOpen] = useState(false);
  const [isLongRecordExpanded, setIsLongRecordExpanded] = useState(false);
  const [longRecordTitle, setLongRecordTitle] = useState("");
  const [longRecordBody, setLongRecordBody] = useState("");
  const [showAllUpcomingSchedules, setShowAllUpcomingSchedules] = useState(false);
  const [addMode, setAddMode] = useState<"todo" | "schedule" | "record" | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addTime, setAddTime] = useState("");
  const [addEndTime, setAddEndTime] = useState("");
  const [addReminder, setAddReminder] = useState("none");
  const monthCells = buildCalendarMonth(calendarMonth);
  const weekDates = useMemo(() => buildWeeklyTraceDates(selectedDate), [selectedDate]);
  const selectedItems = useMemo(
    () => getDailyTraceItemsForDate(items, selectedDate),
    [items, selectedDate]
  );
  const scheduledItems = selectedItems.filter((item) => isScheduledDailyTraceItemForDate(item, selectedDate));
  const remainingItems = selectedItems.filter((item) => !isScheduledDailyTraceItemForDate(item, selectedDate));
  const todayKey = getLocalDateString(new Date());
  const isSelectedToday = selectedDate === todayKey;
  const isSelectedFuture = isFutureDateKey(selectedDate, todayKey);
  const hasSelectedDayItems = scheduledItems.length > 0 || remainingItems.length > 0;
  const selectedLongRecord = dailyLongRecords.find((record) => record.dateKey === selectedDate);
  const upcomingSchedules = useMemo(
    () => buildUpcomingTraceSchedules(items, todayKey),
    [items, todayKey]
  );
  const displayedUpcomingSchedules = showAllUpcomingSchedules
    ? upcomingSchedules
    : upcomingSchedules.slice(0, 3);

  useEffect(() => {
    setIsLongRecordEditorOpen(false);
    setIsLongRecordExpanded(false);
  }, [selectedDate]);

  const selectTraceDate = (dateKey: string) => {
    onSelectDate(dateKey);
    const nextMonth = parseDateOnly(dateKey);
    if (nextMonth) {
      onChangeMonth(getMonthStart(nextMonth));
    }
  };

  const moveWeek = (dayDelta: number) => {
    const nextDate = shiftTraceDateKey(selectedDate, dayDelta);
    selectTraceDate(nextDate);
  };
  const openLongRecordEditor = () => {
    setLongRecordTitle(selectedLongRecord?.title ?? "");
    setLongRecordBody(selectedLongRecord?.body ?? "");
    setIsLongRecordEditorOpen(true);
  };
  const saveLongRecord = () => {
    const saved = onSaveLongRecord({
      dateKey: selectedDate,
      title: longRecordTitle,
      body: longRecordBody,
    });

    if (saved) {
      setIsLongRecordEditorOpen(false);
      setIsLongRecordExpanded(false);
    }
  };
  const resetAddForm = () => {
    setAddTitle("");
    setAddTime("");
    setAddEndTime("");
    setAddReminder("none");
    setAddMode(null);
  };
  const openAddMode = (mode: "todo" | "schedule" | "record") => {
    resetAddForm();
    setAddMode(mode);
  };
  const saveAddedItem = () => {
    if (isSelectedFuture && addMode === "record") {
      return;
    }

    if (addMode === "schedule" && addEndTime && addTime && addEndTime < addTime) {
      return;
    }

    const saved = onAddItem({
      type: addMode ?? "record",
      date: selectedDate,
      title: addTitle,
      time: addTime,
      endTime: addMode === "schedule" ? addEndTime : undefined,
      reminder: addReminder,
    });

    if (saved) {
      resetAddForm();
      setIsAddPanelOpen(false);
    }
  };
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dx) > 22 && Math.abs(gestureState.dy) < 16,
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dx > 42) {
            moveWeek(-7);
          } else if (gestureState.dx < -42) {
            moveWeek(7);
          }
        },
      }),
    [selectedDate]
  );

  return (
    <View style={styles.traceSurface}>
      <View style={styles.traceWeekHeader}>
        <TouchableOpacity
          style={styles.calendarNavButton}
          onPress={() => moveWeek(-7)}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarNavText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.traceMonthToggle}
          onPress={() => setIsMonthCalendarOpen((value) => !value)}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarMonthTitle}>
            {formatMonthTitle(calendarMonth)} {isMonthCalendarOpen ? "▴" : "▾"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.calendarNavButton}
          onPress={() => moveWeek(7)}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarNavText}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.traceConstellation} {...panResponder.panHandlers}>
        <View style={styles.traceWeekDateRow}>
          {weekDates.map((dateKey) => {
            const date = parseDateOnly(dateKey) ?? new Date();
            const isToday = dateKey === todayKey;
            return (
              <TouchableOpacity
                key={`date-${dateKey}`}
                style={styles.traceWeekDayButton}
                onPress={() => selectTraceDate(dateKey)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.traceWeekDateText,
                    isToday && styles.traceWeekDateTextToday,
                    dateKey === selectedDate && styles.traceWeekDateTextSelected,
                  ]}
                >
                  {date.getDate()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.traceStarRow}>
          {weekDates.map((dateKey, index) => (
            <React.Fragment key={`star-${dateKey}`}>
              <View style={styles.traceStarSlot}>
                <TouchableOpacity
                  style={styles.traceStarButton}
                  onPress={() => selectTraceDate(dateKey)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.traceStarSymbol,
                      dateKey === todayKey && dateKey !== selectedDate && styles.traceStarSymbolToday,
                      dateKey === selectedDate && styles.traceStarSymbolSelected,
                    ]}
                  >
                    {getTraceDaySymbol(items, dateKey, selectedDate)}
                  </Text>
                </TouchableOpacity>
                {dateKey === todayKey ? <Text style={styles.traceTodayLabel}>오늘</Text> : null}
              </View>
              {index < weekDates.length - 1 ? <View style={styles.traceStarLine} /> : null}
            </React.Fragment>
          ))}
        </View>
      </View>

      {isMonthCalendarOpen ? (
        <View style={styles.traceMonthPanel}>
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
              const dayItems = getDailyTraceItemsForDate(items, dateKey);
              const hasItems = dayItems.length > 0;

              return (
                <TouchableOpacity
                  key={dateKey}
                  style={[
                    styles.calendarDayCell,
                    !cell.isCurrentMonth && styles.calendarDayMuted,
                    isSelected && styles.calendarDaySelected,
                  ]}
                  onPress={() => {
                    selectTraceDate(dateKey);
                    setIsMonthCalendarOpen(false);
                  }}
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
        </View>
      ) : null}

      <View style={styles.traceDetail}>
        <View style={styles.traceDetailHeaderRow}>
          <Text style={styles.traceDateTitle}>{formatDailyTraceSelectedDate(selectedDate)}</Text>
          <View style={styles.traceHeaderActions}>
            {!isSelectedToday ? (
              <TouchableOpacity
                style={styles.traceTodayButton}
                onPress={() => selectTraceDate(todayKey)}
                activeOpacity={0.85}
              >
                <Text style={styles.traceTodayButtonText}>오늘로</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.traceAddButton}
              onPress={() => setIsAddPanelOpen((value) => !value)}
              activeOpacity={0.85}
            >
              <Text style={styles.traceAddButtonText}>+ 날짜에 남기기</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isAddPanelOpen ? (
          <View style={styles.traceAddPanel}>
            <Text style={styles.traceAddPanelTitle}>이 날짜에 무엇을 남길까요?</Text>
            <View style={styles.traceAddModeRow}>
              {([
                ["todo", "○ 할 일"],
                ["schedule", "▣ 일정"],
                ["record", "💬 기록"],
              ] as Array<["todo" | "schedule" | "record", string]>)
                .filter(([mode]) => !(isSelectedFuture && mode === "record"))
                .map(([mode, label]) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.traceAddModeButton, addMode === mode && styles.traceAddModeButtonActive]}
                  onPress={() => openAddMode(mode)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.traceAddModeText, addMode === mode && styles.traceAddModeTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {addMode ? (
              <View style={styles.traceAddForm}>
                <TextInput
                  style={styles.traceAddInput}
                  placeholder={addMode === "schedule" ? "일정 제목" : addMode === "todo" ? "제목" : "짧은 기록 내용"}
                  placeholderTextColor="#6b7280"
                  value={addTitle}
                  onChangeText={setAddTitle}
                />
                {addMode !== "record" ? (
                  <>
                    <TextInput
                      style={styles.traceAddInput}
                      placeholder={addMode === "schedule" ? "시작 시간 예: 08:30" : "예정 시간 예: 08:30"}
                      placeholderTextColor="#6b7280"
                      value={addTime}
                      onChangeText={setAddTime}
                    />
                    {addMode === "schedule" ? (
                      <TextInput
                        style={styles.traceAddInput}
                        placeholder="종료 시간 예: 09:30"
                        placeholderTextColor="#6b7280"
                        value={addEndTime}
                        onChangeText={setAddEndTime}
                      />
                    ) : null}
                    <View style={styles.traceReminderRow}>
                      {TRACE_REMINDER_OPTIONS.map((option) => (
                        <TouchableOpacity
                          key={option.value}
                          style={[
                            styles.traceReminderChip,
                            addReminder === option.value && styles.traceReminderChipActive,
                          ]}
                          onPress={() => setAddReminder(option.value)}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={[
                              styles.traceReminderChipText,
                              addReminder === option.value && styles.traceReminderChipTextActive,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
                <TouchableOpacity
                  style={[styles.traceAddSaveButton, !addTitle.trim() && styles.traceAddSaveButtonDisabled]}
                  onPress={saveAddedItem}
                  disabled={!addTitle.trim()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.traceAddSaveButtonText}>
                    {addMode === "record" ? "남기기" : "저장"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}

        {!hasSelectedDayItems ? (
          <Text style={styles.traceEmptyDayText}>{getEmptySelectedDayText(selectedDate, todayKey)}</Text>
        ) : (
          <>
            {scheduledItems.length > 0 ? (
              <>
                <Text style={styles.traceDetailTitle}>
                  {getTraceScheduleSectionTitle(selectedDate, todayKey)} · {scheduledItems.length}개
                </Text>
                <View style={styles.traceRecordList}>
                  {scheduledItems.map((item, index) => (
                    <DailyTraceScheduledRow
                      key={item.id}
                      item={item}
                      isLast={index === scheduledItems.length - 1}
                      dateKey={selectedDate}
                      onComplete={onToggleDone}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {remainingItems.length > 0 ? (
              <>
                <Text style={[styles.traceDetailTitle, scheduledItems.length > 0 && styles.traceRemainingTitle]}>
                  {getTraceRemainingSectionTitle(selectedDate, todayKey)} · {remainingItems.length}개
                </Text>
                <View style={styles.traceRecordList}>
                  {remainingItems.map((item, index) => (
                    <DailyTraceRecordRow
                      key={item.id}
                      item={item}
                      dateKey={selectedDate}
                      isLast={index === remainingItems.length - 1}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}

        <View style={styles.traceLongRecordBox}>
          <View style={styles.traceLongRecordHeader}>
            <Text style={styles.traceLongRecordTitle}>
              {getDailyLongRecordTitle(selectedDate, todayKey)}
            </Text>
            {!isSelectedFuture ? (
              <TouchableOpacity
                style={styles.traceLongRecordAction}
                onPress={openLongRecordEditor}
                activeOpacity={0.85}
              >
                <Text style={styles.traceLongRecordActionText}>
                  {selectedLongRecord ? "수정" : isSelectedToday ? "기록 쓰기" : "기록 남기기"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {isLongRecordEditorOpen ? (
            <View style={styles.traceLongRecordEditor}>
              <View style={styles.traceLongRecordEditorHeader}>
                <Text style={styles.traceLongRecordEditorTitle}>
                  {getDailyLongRecordTitle(selectedDate, todayKey)}
                </Text>
                <TouchableOpacity onPress={() => setIsLongRecordEditorOpen(false)} activeOpacity={0.85}>
                  <Text style={styles.traceLongRecordActionText}>닫기</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.traceLongRecordLabel}>제목 · 선택</Text>
              <TextInput
                style={styles.traceLongRecordInput}
                placeholder="제목"
                placeholderTextColor="#6b7280"
                value={longRecordTitle}
                onChangeText={setLongRecordTitle}
              />
              <Text style={styles.traceLongRecordLabel}>오늘의 이야기</Text>
              <TextInput
                style={[styles.traceLongRecordInput, styles.traceLongRecordBodyInput]}
                placeholder="오늘 남기고 싶은 이야기를 적어주세요"
                placeholderTextColor="#6b7280"
                value={longRecordBody}
                onChangeText={setLongRecordBody}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[
                  styles.traceLongRecordSaveButton,
                  !longRecordBody.trim() && styles.traceAddSaveButtonDisabled,
                ]}
                onPress={saveLongRecord}
                disabled={!longRecordBody.trim()}
                activeOpacity={0.85}
              >
                <Text style={styles.traceLongRecordSaveButtonText}>저장</Text>
              </TouchableOpacity>
            </View>
          ) : selectedLongRecord ? (
            <View style={styles.traceLongRecordContent}>
              {selectedLongRecord.title ? (
                <Text style={styles.traceLongRecordContentTitle}>{selectedLongRecord.title}</Text>
              ) : null}
              <Text
                style={styles.traceLongRecordBody}
                numberOfLines={isLongRecordExpanded ? undefined : 4}
              >
                {selectedLongRecord.body}
              </Text>
              {selectedLongRecord.body.length > 120 ? (
                <TouchableOpacity
                  style={styles.traceLongRecordMoreButton}
                  onPress={() => setIsLongRecordExpanded((value) => !value)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.traceLongRecordActionText}>
                    {isLongRecordExpanded ? "접기" : "더 보기"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.traceLongRecordSavedAt}>{formatTimeFromIso(selectedLongRecord.updatedAt)}</Text>
            </View>
          ) : (
            <View style={styles.traceLongRecordContent}>
              <Text style={styles.traceEmptySmallText}>
                {getEmptyLongRecordText(selectedDate, todayKey)}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.traceAdjacentRow}>
        <TouchableOpacity onPress={() => selectTraceDate(shiftTraceDateKey(selectedDate, -1))} activeOpacity={0.85}>
          <Text style={styles.traceAdjacentText}>‹ {formatShortTraceDate(shiftTraceDateKey(selectedDate, -1))}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => selectTraceDate(shiftTraceDateKey(selectedDate, 1))} activeOpacity={0.85}>
          <Text style={styles.traceAdjacentText}>{formatShortTraceDate(shiftTraceDateKey(selectedDate, 1))} ›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.traceUpcomingBox}>
        <View style={styles.traceLongRecordHeader}>
          <Text style={styles.traceLongRecordTitle}>다가오는 예정</Text>
          {upcomingSchedules.length > 3 ? (
            <TouchableOpacity
              style={styles.traceLongRecordAction}
              onPress={() => setShowAllUpcomingSchedules((value) => !value)}
              activeOpacity={0.85}
            >
              <Text style={styles.traceLongRecordActionText}>
                {showAllUpcomingSchedules ? "접기" : "전체 보기"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {upcomingSchedules.length === 0 ? (
          <View style={styles.traceUpcomingEmptyRow}>
            <Text style={styles.traceEmptySmallText}>아직 예정된 일이 없어요.</Text>
            <TouchableOpacity
              style={styles.traceLongRecordAction}
              onPress={() => {
                setIsAddPanelOpen(true);
                openAddMode("todo");
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.traceLongRecordActionText}>+ 남기기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.traceUpcomingTimeline}>
            {displayedUpcomingSchedules.map((schedule, index) => (
              <TouchableOpacity
                key={`${schedule.item.id}:${schedule.dateKey}`}
                style={[
                  styles.traceUpcomingRow,
                  index === displayedUpcomingSchedules.length - 1 && styles.traceRecordRowLast,
                ]}
                onPress={() => selectTraceDate(schedule.dateKey)}
                activeOpacity={0.85}
              >
                <Text style={styles.traceUpcomingDate}>
                  {index === 0 || displayedUpcomingSchedules[index - 1].dateKey !== schedule.dateKey
                    ? formatUpcomingTraceDate(schedule.dateKey, todayKey)
                    : ""}
                </Text>
                <Text style={styles.traceRecordTime}>{schedule.item.time ?? ""}</Text>
                <Text style={styles.traceTodoCompleteText}>○</Text>
                <View style={styles.traceRecordTextBlock}>
                  <Text style={styles.traceItemTitle}>{schedule.item.title}</Text>
                  {schedule.reminderLabel ? (
                    <Text style={styles.traceItemMemo}>🔔 {schedule.reminderLabel}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function buildWeeklyTraceDates(selectedDate: string) {
  const selected = parseDateOnly(selectedDate) ?? new Date();
  const weekStart = new Date(selected);
  weekStart.setDate(selected.getDate() - selected.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return getLocalDateString(date);
  });
}

const TRACE_REMINDER_OPTIONS = [
  { value: "none", label: "없음" },
  { value: "on_time", label: "시간에 맞춰" },
  { value: "10m", label: "10분 전" },
  { value: "30m", label: "30분 전" },
  { value: "1h", label: "1시간 전" },
];

function shiftTraceDateKey(dateKey: string, dayDelta: number) {
  const baseDate = parseDateOnly(dateKey) ?? new Date();
  return getLocalDateString(addDays(baseDate, dayDelta));
}

function getDailyTraceItemsForDate(items: DailyTraceItem[], dateKey: string) {
  const originalIndexById = new Map(items.map((item, index) => [item.id, index]));
  return dedupeMemories(items)
    .map((item, index) => ({
      item,
      index: originalIndexById.get(item.id) ?? index,
    }))
    .filter((item) => {
      const memoryPolicy = getMemoryPolicy(item.item);
      return (
        !isCancelledTraceItem(item.item) &&
        (item.item.date === dateKey || isLifeRepeatTraceActiveOnDate(item.item, dateKey)) &&
        shouldSaveToDailyTrace(memoryPolicy)
      );
    })
    .sort((left, right) => sortDailyTraceItemsForDisplay(left, right))
    .map(({ item }) => item);
}

function isLifeRepeatTraceActiveOnDate(item: DailyTraceItem, dateKey: string) {
  if (!isLifeRepeatTraceItem(item)) {
    return false;
  }

  return item.date <= dateKey;
}

function sortDailyTraceItemsForDisplay(
  left: { item: DailyTraceItem; index: number },
  right: { item: DailyTraceItem; index: number }
) {
  const leftTime = left.item.time;
  const rightTime = right.item.time;
  if (leftTime && rightTime && leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  if (leftTime && !rightTime) {
    return -1;
  }

  if (!leftTime && rightTime) {
    return 1;
  }

  return left.index - right.index;
}

function formatDailyTraceSelectedDate(dateKey: string) {
  const date = parseDateOnly(dateKey);
  if (!date) {
    return dateKey;
  }

  const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekdays[date.getDay()]}`;
}

function normalizeDailyLongRecords(records: DailyLongRecord[]) {
  const recordByDate = new Map<string, DailyLongRecord>();

  records.forEach((record) => {
    if (!record.dateKey || !record.body?.trim()) {
      return;
    }

    const normalizedRecord: DailyLongRecord = {
      id: record.id || createId("daily-long-record"),
      dateKey: record.dateKey,
      title: record.title?.trim() || undefined,
      body: record.body,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    };
    const existingRecord = recordByDate.get(record.dateKey);
    if (!existingRecord || normalizedRecord.updatedAt > existingRecord.updatedAt) {
      recordByDate.set(record.dateKey, normalizedRecord);
    }
  });

  return Array.from(recordByDate.values()).sort((left, right) =>
    left.dateKey.localeCompare(right.dateKey)
  );
}

function isFutureDateKey(dateKey: string, todayKey: string) {
  return dateKey > todayKey;
}

function getDailyLongRecordTitle(dateKey: string, todayKey: string) {
  const yesterdayKey = shiftTraceDateKey(todayKey, -1);
  if (dateKey === todayKey) {
    return "오늘의 기록";
  }

  if (dateKey === yesterdayKey) {
    return "어제의 기록";
  }

  return `${formatShortTraceDate(dateKey)}의 기록`;
}

function getEmptyLongRecordText(dateKey: string, todayKey: string) {
  if (dateKey > todayKey) {
    return "이날이 지나면 기록을 남길 수 있어요.";
  }

  if (dateKey === todayKey) {
    return "오늘 하루를 조금 더 길게 남겨보세요.";
  }

  return "이날의 기억을 조금 더 길게 남겨보세요.";
}

function getTraceScheduleSectionTitle(dateKey: string, todayKey: string) {
  return dateKey === todayKey ? "오늘 예정" : "그날의 예정";
}

function getTraceRemainingSectionTitle(dateKey: string, todayKey: string) {
  return dateKey === todayKey ? "남은 흔적" : "그날 남은 흔적";
}

function getTraceEmptyScheduleText(dateKey: string, todayKey: string) {
  return dateKey === todayKey ? "오늘 예정된 일은 없어요." : "그날 예정된 일은 없어요.";
}

function getEmptySelectedDayText(dateKey: string, todayKey: string) {
  if (dateKey > todayKey) {
    return "아직 예정된 일이 없어요.\n필요한 일정이나 할 일을 남겨보세요.";
  }

  if (dateKey === todayKey) {
    return "아직 오늘 남겨진 흔적이 없어요.\n작은 계획이나 있었던 일을 남겨보세요.";
  }

  return "이날에는 남겨진 흔적이 없어요.\n기억나는 일이 있다면 기록으로 남겨보세요.";
}

type UpcomingTraceSchedule = {
  item: DailyTraceItem;
  dateKey: string;
  reminderLabel: string;
};

function buildUpcomingTraceSchedules(items: DailyTraceItem[], todayKey: string): UpcomingTraceSchedule[] {
  const candidates: UpcomingTraceSchedule[] = [];

  dedupeMemories(items).forEach((item) => {
    const memoryPolicy = getMemoryPolicy(item);
    if (!shouldSaveToDailyTrace(memoryPolicy) || isCancelledTraceItem(item) || isCompletedTraceScheduleItem(item)) {
      return;
    }

    if (isLifeRepeatTraceItem(item)) {
      const nextRepeatDate = findNextLifeRepeatDate(item, todayKey);
      if (nextRepeatDate) {
        candidates.push({
          item,
          dateKey: nextRepeatDate,
          reminderLabel: getExistingReminderLabel(item),
        });
      }
      return;
    }

    if (!isScheduledDailyTraceItemForDate(item, item.date) || item.date < todayKey) {
      return;
    }

    if (item.date === todayKey && isTraceTimePastToday(item)) {
      return;
    }

    candidates.push({
      item,
      dateKey: item.date,
      reminderLabel: getExistingReminderLabel(item),
    });
  });

  return dedupeUpcomingTraceSchedules(candidates).sort(sortUpcomingTraceSchedules);
}

function findNextLifeRepeatDate(item: DailyTraceItem, todayKey: string) {
  const today = parseDateOnly(todayKey) ?? new Date();
  for (let offset = 0; offset <= 30; offset += 1) {
    const dateKey = getLocalDateString(addDays(today, offset));
    if (!isLifeRepeatTraceActiveOnDate(item, dateKey) || getLifeRepeatCompletedAt(item, dateKey)) {
      continue;
    }

    if (dateKey === todayKey && isTraceTimePastToday(item)) {
      continue;
    }

    return dateKey;
  }

  return "";
}

function dedupeUpcomingTraceSchedules(schedules: UpcomingTraceSchedule[]) {
  const scheduleByKey = new Map<string, UpcomingTraceSchedule>();
  schedules.forEach((schedule) => {
    const typedItem = schedule.item as DailyTraceItem & { sourceId?: string };
    const key = [
      schedule.dateKey,
      typedItem.sourceId || schedule.item.id,
      schedule.item.time ?? "",
      normalizeMemoryInput(schedule.item.title),
    ].join(":");
    if (!scheduleByKey.has(key)) {
      scheduleByKey.set(key, schedule);
    }
  });
  return Array.from(scheduleByKey.values());
}

function sortUpcomingTraceSchedules(left: UpcomingTraceSchedule, right: UpcomingTraceSchedule) {
  if (left.dateKey !== right.dateKey) {
    return left.dateKey.localeCompare(right.dateKey);
  }

  const leftTime = left.item.time ?? "99:99";
  const rightTime = right.item.time ?? "99:99";
  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  return left.item.createdAt.localeCompare(right.item.createdAt);
}

function isTraceTimePastToday(item: DailyTraceItem) {
  if (!item.time) {
    return false;
  }

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return item.time < currentTime;
}

function isCancelledTraceItem(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & {
    cancelledAt?: string;
    deletedAt?: string;
    isCancelled?: boolean;
    isDeleted?: boolean;
    status?: string;
  };

  return (
    typedItem.isCancelled === true ||
    typedItem.isDeleted === true ||
    Boolean(typedItem.cancelledAt) ||
    Boolean(typedItem.deletedAt) ||
    typedItem.status === "cancelled" ||
    typedItem.status === "deleted"
  );
}

function isCompletedTraceScheduleItem(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & {
    completed?: boolean;
    completedAt?: string;
    isDone?: boolean;
    status?: string;
  };

  return (
    typedItem.completed === true ||
    typedItem.isDone === true ||
    Boolean(typedItem.completedAt) ||
    typedItem.status === "done" ||
    typedItem.status === "completed"
  );
}

function getExistingReminderLabel(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { reminder?: string };
  if (!typedItem.reminder || typedItem.reminder === "none") {
    return "";
  }

  const option = TRACE_REMINDER_OPTIONS.find((candidate) => candidate.value === typedItem.reminder);
  return option?.label ?? "";
}

function formatUpcomingTraceDate(dateKey: string, todayKey: string) {
  if (dateKey === shiftTraceDateKey(todayKey, 1)) {
    return "내일";
  }

  const date = parseDateOnly(dateKey);
  const today = parseDateOnly(todayKey);
  if (!date || !today) {
    return dateKey;
  }

  if (date.getFullYear() !== today.getFullYear()) {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  }

  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function getTraceDaySymbol(
  items: DailyTraceItem[],
  dateKey: string,
  selectedDate: string
) {
  if (dateKey === selectedDate) {
    return "◉";
  }

  const dayItems = getDailyTraceItemsForDate(items, dateKey);
  if (dayItems.length === 0) {
    return "·";
  }

  const remainingItems = dayItems.filter((item) => !isScheduledDailyTraceItemForDate(item, dateKey));
  const scheduledItems = dayItems.filter((item) => isScheduledDailyTraceItemForDate(item, dateKey));

  if (remainingItems.some(isDreamFragmentTraceItem)) {
    return "✦";
  }

  if (remainingItems.length >= 2) {
    return "●";
  }

  if (remainingItems.length === 1) {
    return "•";
  }

  return scheduledItems.length > 0 ? "○" : "·";
}

function isScheduledDailyTraceItem(item: DailyTraceItem) {
  return isScheduledDailyTraceItemForDate(item, item.date);
}

function isScheduledDailyTraceItemForDate(item: DailyTraceItem, dateKey: string) {
  if (isLifeRepeatTraceItem(item)) {
    return !getLifeRepeatCompletedAt(item, dateKey);
  }

  return item.type === "schedule" || (item.type === "todo" && !item.isDone);
}

function isLifeRepeatTraceItem(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { recurrence?: string; sourceType?: string };
  return item.type === "todo" && typedItem.sourceType === "life_schedule_repeat" && Boolean(typedItem.recurrence);
}

function getLifeRepeatCompletedAt(item: DailyTraceItem, dateKey: string) {
  const typedItem = item as DailyTraceItem & { completedDates?: Record<string, string> };
  return typedItem.completedDates?.[dateKey];
}

function isDreamFragmentTraceItem(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { sourceDreamFragmentId?: string };

  return (
    item.dreamRole === "fragment" ||
    item.saveTargets?.includes("dream_fragment") ||
    Boolean(item.linkedProjectId && item.memoryType === "project") ||
    Boolean(typedItem.sourceDreamFragmentId)
  );
}

function getDailyTraceRowIcon(item: DailyTraceItem, dateKey?: string) {
  const typedItem = item as DailyTraceItem & { sourceId?: string; sourceType?: string };
  if (typedItem.sourceType === "routine_execution" || typedItem.sourceId?.startsWith("routine_execution:")) {
    return "🔥";
  }

  if (typedItem.sourceType === "dream_fragment_complete") {
    return "⭐";
  }

  if (isLifeRepeatTraceItem(item) && dateKey && getLifeRepeatCompletedAt(item, dateKey)) {
    return "✓";
  }

  if (item.type === "todo" && item.isDone) {
    return "✓";
  }

  if (isDreamFragmentTraceItem(item)) {
    return "✦";
  }

  if (item.memoryType === "daily_context" || item.sourceMessageId || item.type === "quote") {
    return "💬";
  }

  return "●";
}

function getDailyTraceRowMemo(item: DailyTraceItem, dateKey?: string) {
  if (isLifeRepeatTraceItem(item) && dateKey && getLifeRepeatCompletedAt(item, dateKey)) {
    return "생활 반복 완료";
  }

  if (item.type === "todo" && item.isDone) {
    return item.time ? `${item.time}에 예정했던 일` : "직접 완료";
  }

  return item.memo;
}

function getDailyTraceRowSource(item: DailyTraceItem, dateKey?: string) {
  const typedItem = item as DailyTraceItem & { sourceId?: string; sourceType?: string };
  if (typedItem.sourceType === "routine_execution" || typedItem.sourceId?.startsWith("routine_execution:")) {
    return "오늘의 불씨";
  }

  if (typedItem.sourceType === "dream_fragment_complete") {
    return "꿈의 파편";
  }

  if (isLifeRepeatTraceItem(item) && dateKey && getLifeRepeatCompletedAt(item, dateKey)) {
    return "생활 반복 완료";
  }

  if (item.type === "todo" && item.isDone) {
    return "직접 완료";
  }

  if (isDreamFragmentTraceItem(item)) {
    return "꿈의 파편";
  }

  if (typedItem.sourceType === "manual_record") {
    return "직접 기록";
  }

  if (item.memoryType === "daily_context" || item.sourceMessageId || item.type === "quote") {
    return "채팅";
  }

  return "";
}

function getDailyTraceDisplayTime(item: DailyTraceItem, dateKey?: string) {
  if (isLifeRepeatTraceItem(item) && dateKey) {
    const completedAt = getLifeRepeatCompletedAt(item, dateKey);
    return completedAt ? formatTimeFromIso(completedAt) : item.time ?? "";
  }

  const typedItem = item as DailyTraceItem & { completedAt?: string };
  if (item.type === "todo" && item.isDone && typedItem.completedAt) {
    return formatTimeFromIso(typedItem.completedAt);
  }

  return item.time ?? "";
}

function formatTimeFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatShortTraceDate(dateKey: string) {
  const date = parseDateOnly(dateKey);
  if (!date) {
    return dateKey;
  }

  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function getTraceReminderLabel(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { reminder?: string };
  const option = TRACE_REMINDER_OPTIONS.find((candidate) => candidate.value === typedItem.reminder);
  return option?.label ?? item.memo ?? "";
}

function DailyTraceScheduledRow({
  item,
  isLast,
  dateKey,
  onComplete,
}: {
  item: DailyTraceItem;
  isLast: boolean;
  dateKey: string;
  onComplete: (itemId: string, dateKey?: string) => void;
}) {
  const reminderLabel = getTraceReminderLabel(item);
  const repeatLabel = isLifeRepeatTraceItem(item) ? "매일 반복 · " : "";

  return (
    <View style={[styles.traceRecordRow, isLast && styles.traceRecordRowLast]}>
      <Text style={styles.traceRecordTime}>{item.time ?? ""}</Text>
      <TouchableOpacity
        style={styles.traceTodoCompleteButton}
        onPress={() => item.type === "todo" && onComplete(item.id, dateKey)}
        disabled={item.type !== "todo"}
        activeOpacity={0.85}
      >
        <Text style={styles.traceTodoCompleteText}>○</Text>
      </TouchableOpacity>
      <View style={styles.traceRecordTextBlock}>
        <Text style={styles.traceItemTitle}>{item.title}</Text>
        {reminderLabel && reminderLabel !== "없음" ? (
          <Text style={styles.traceItemMemo}>{repeatLabel}🔔 {reminderLabel}</Text>
        ) : null}
      </View>
    </View>
  );
}

function DailyTraceRecordRow({
  item,
  dateKey,
  isLast,
}: {
  item: DailyTraceItem;
  dateKey: string;
  isLast: boolean;
}) {
  const memo = getDailyTraceRowMemo(item, dateKey);
  const displayTime = getDailyTraceDisplayTime(item, dateKey);
  const source = getDailyTraceRowSource(item, dateKey);

  return (
    <View style={[styles.traceRecordRow, isLast && styles.traceRecordRowLast]}>
      <Text style={styles.traceRecordTime}>{displayTime}</Text>
      <Text style={styles.traceRecordIcon}>{getDailyTraceRowIcon(item, dateKey)}</Text>
      <View style={styles.traceRecordTextBlock}>
        <Text style={styles.traceItemTitle}>
          {item.title}
        </Text>
        {memo ? <Text style={styles.traceItemMemo}>{memo}</Text> : null}
        {source ? <Text style={styles.traceItemSource}>{source}</Text> : null}
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
        <Defs>
          <ClipPath id="emotionChartClip">
            <Rect
              x={paddingLeft}
              y={paddingTop}
              width={innerWidth}
              height={innerHeight}
            />
          </ClipPath>
        </Defs>
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
              <G clipPath="url(#emotionChartClip)">
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
              </G>
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
    text: sourceText,
    originalText: sourceText,
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

function resolvePrimarySaveRoute({
  userText,
  saveDecision,
  memoryPolicy,
  existingItems,
  dailyLongRecords,
  projects,
  pendingRoutineAdjustment,
  recentDreamReference,
}: {
  userText: string;
  saveDecision?: SaveDecision;
  memoryPolicy: MemorySavePolicy;
  existingItems: DailyTraceItem[];
  dailyLongRecords: DailyLongRecord[];
  projects: NoieProject[];
  pendingRoutineAdjustment: PendingRoutineAdjustment | null;
  recentDreamReference?: DailyTraceItem | null;
}): NoieSaveRoutingResult {
  const normalizedText = normalizeMemoryInput(userText);
  const routineCandidate = parseRoutineGoalCandidate(userText);
  const adjustmentValue = parseTargetValueWithUnit(userText);

  if (isOtherPersonOnlyText(userText, saveDecision)) {
    return {
      route: "none",
      title: "",
      originalText: userText,
      normalizedText,
      confidence: 0.98,
      isOtherPerson: true,
      reason: "다른 사람 이야기라 사용자 저장 제안을 만들지 않음",
    };
  }

  const dailyRecordCommand = findDailyRecordCommandRoute(userText, existingItems, dailyLongRecords);
  if (dailyRecordCommand) {
    return dailyRecordCommand;
  }

  const dreamFragmentNextActionUpdate = findDreamFragmentNextActionUpdateRoute(userText, existingItems);
  if (dreamFragmentNextActionUpdate) {
    return dreamFragmentNextActionUpdate;
  }

  const dreamFragmentRename = findDreamFragmentRenameRoute(userText, existingItems);
  if (dreamFragmentRename) {
    return dreamFragmentRename;
  }

  const routineAdjustment = findRoutineAdjustmentIntent(userText, existingItems);
  if (routineAdjustment) {
    return {
      route: adjustmentValue ? "routine_adjustment_confirm" : "routine_adjustment_intent",
      title: routineAdjustment.routineTitle,
      originalText: userText,
      normalizedText,
      confidence: adjustmentValue ? 0.96 : 0.9,
      targetValue: adjustmentValue?.targetValue ?? routineAdjustment.currentTargetValue,
      unit: adjustmentValue?.unit ?? routineAdjustment.currentUnit,
      matchedRoutineId: routineAdjustment.routineId,
      reason: adjustmentValue ? "기존 반복 목표 시간 조정 확인" : "기존 공부 반복 목표 시간 조정 의도",
    };
  }

  if (isNonCompletionRoutineText(userText)) {
    return {
      route: "none",
      title: "",
      originalText: userText,
      normalizedText,
      confidence: 0.96,
      reason: "부정 또는 미수행 표현이라 수행량 저장 제안을 만들지 않음",
    };
  }

  if (isAdditiveRoutineRecordText(userText) && !isExplicitAdditiveRoutineRecordRequest(userText)) {
    return {
      route: "none",
      title: "",
      originalText: userText,
      normalizedText,
      confidence: 0.94,
      reason: "추가 수행 언급만 있고 명시적 기록 요청이 없어 저장 제안을 만들지 않음",
    };
  }

  const dreamFragmentComplete = findDreamFragmentCompleteRoute(userText, existingItems);
  if (dreamFragmentComplete) {
    return dreamFragmentComplete;
  }

  const explicitTorchReference = findReferencedDreamForTorchRequest(userText, recentDreamReference, existingItems);
  if (explicitTorchReference) {
    return {
      route: "dream_torch",
      title: explicitTorchReference.title,
      originalText: userText,
      normalizedText: normalizeMemoryInput(explicitTorchReference.title),
      confidence: 0.96,
      matchedDailyTraceId: explicitTorchReference.id,
      reason: "최근 또는 기존 꿈 후보를 꿈의 횃불로 승격",
    };
  }

  const lifeScheduleMutation = findLifeScheduleMutationRoute(userText, existingItems);
  if (lifeScheduleMutation) {
    return lifeScheduleMutation;
  }

  const lifeScheduleRoute = findLifeScheduleRoute(userText);
  if (lifeScheduleRoute) {
    return lifeScheduleRoute;
  }

  if (pendingRoutineAdjustment) {
    return {
      route: adjustmentValue ? "routine_adjustment_confirm" : "routine_adjustment_intent",
      title: pendingRoutineAdjustment.routineTitle,
      originalText: userText,
      normalizedText,
      confidence: adjustmentValue ? 0.95 : 0.7,
      targetValue: adjustmentValue?.targetValue ?? null,
      unit: adjustmentValue?.unit ?? pendingRoutineAdjustment.currentUnit,
      matchedRoutineId: pendingRoutineAdjustment.routineId,
      reason: "반복 목표 조정 대화 진행 중",
    };
  }

  const routineRecord = findRoutineRecordRoute(userText, existingItems);
  if (routineRecord) {
    return routineRecord;
  }

  if (routineCandidate) {
    return {
      route: "routine_create",
      title: routineCandidate.title,
      originalText: userText,
      normalizedText: routineCandidate.title,
      confidence: 0.96,
      repeatType: routineCandidate.repeatType,
      targetValue: routineCandidate.targetValue,
      minimumValue: 0,
      unit: routineCandidate.unit,
      reason: "반복 표현과 수치가 있는 행동 목표",
    };
  }

  const completedProject = findCompletedProjectRoute(userText, projects);
  if (completedProject) {
    return completedProject;
  }

  const completedProjectAction = findCompletedProjectActionRoute(userText, projects);
  if (completedProjectAction) {
    return completedProjectAction;
  }

  if (isCompletedActionText(userText)) {
    return {
      route: "completed_action",
      title: makeCompletedActionTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.86,
      reason: "완료한 행동",
    };
  }

  if (isPlainDailyTraceText(userText)) {
    return {
      route: "daily_trace",
      title: makeMemoryTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.84,
      reason: "이미 일어난 하루의 행동 또는 사건",
    };
  }

  if (isProjectStartText(userText)) {
    const duplicateProject = findDuplicateProjectByText(userText, projects);
    return {
      route: "project_create",
      title: makeProjectTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: duplicateProject ? 0.98 : 0.86,
      matchedProjectId: duplicateProject?.id ?? null,
      reason: duplicateProject ? "이미 진행 중인 프로젝트" : "프로젝트 시작 의도",
    };
  }

  if (isImportantDayEventText(userText)) {
    return {
      route: "important_day_event",
      title: makeImportantDayEventTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.92,
      reason: "생활 단계 변화",
    };
  }

  if (memoryPolicy.type === "achievement") {
    return {
      route: "achievement",
      title: makeMemoryTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.84,
    };
  }

  if (isDailyIdeaText(userText)) {
    return {
      route: "daily_idea",
      title: makeMemoryTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.82,
      reason: "오늘 떠오른 단발성 아이디어",
    };
  }

  if (isDreamTorchCandidateText(userText, memoryPolicy) || isDreamFragmentText(userText)) {
    const referencedDream = findReferencedDreamForTorchRequest(userText, recentDreamReference, existingItems);
    return {
      route: "dream_torch",
      title: referencedDream?.title ?? makeMemoryTitle(userText),
      originalText: userText,
      normalizedText: referencedDream ? normalizeMemoryInput(referencedDream.title) : normalizedText,
      confidence: 0.9,
      matchedDailyTraceId: referencedDream?.id ?? null,
      reason: referencedDream ? "최근 꿈 후보를 꿈의 횃불로 승격" : "새로운 꿈 후보 선택",
    };
  }

  if (isDreamOrGoalType(memoryPolicy.type)) {
    const duplicateFragment = findDuplicateDreamFragment(existingItems, userText);
    return {
      route: "dream_torch",
      title: makeMemoryTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: duplicateFragment ? 0.99 : 0.88,
      reason: duplicateFragment ? "이미 저장된 꿈 후보" : "새로운 꿈 또는 중간 목표 후보 선택",
    };
  }

  if (memoryPolicy.type === "sensitive_event") {
    return {
      route: "sensitive_event",
      title: makeMemoryTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.86,
      isSensitive: true,
    };
  }

  return {
    route: memoryPolicy.shouldSave ? "none" : "none",
    title: "",
    originalText: userText,
    normalizedText,
    confidence: 0,
  };
}

function getMemoryPolicyForRoute(
  memoryPolicy: MemorySavePolicy,
  routingResult: NoieSaveRoutingResult
): MemorySavePolicy {
  if (routingResult.route === "routine_create") {
    return {
      type: "goal",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 88,
      label: "반복 목표",
      saveTargets: [],
    };
  }

  if (routingResult.route === "project_create") {
    return {
      type: "project",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 86,
      label: "오늘의 나 프로젝트",
      saveTargets: [],
    };
  }

  if (routingResult.route === "routine_record") {
    return {
      type: "achievement",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 72,
      label: "반복 목표 수행",
      saveTargets: ["daily_trace"],
    };
  }

  if (
    routingResult.route === "life_schedule_once" ||
    routingResult.route === "life_schedule_repeat" ||
    routingResult.route === "life_schedule_date_request" ||
    routingResult.route === "life_schedule_reminder_update" ||
    routingResult.route === "life_schedule_cancel"
  ) {
    return {
      type: "todo",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: routingResult.route === "life_schedule_repeat" ? "생활 반복 예정" : "생활 예정",
      saveTargets: ["daily_trace"],
    };
  }

  if (routingResult.route === "life_action_record") {
    return {
      type: "daily_context",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: "직접 기록",
      saveTargets: ["daily_trace"],
    };
  }

  if (routingResult.route === "dream_torch") {
    return {
      type: "dream",
      shouldSave: true,
      requiresConfirmation: true,
      importance: Math.max(memoryPolicy.importance, 95),
      label: "꿈의 횃불",
      saveTargets: ["dream_torch"],
      dreamRole: "torch",
    };
  }

  if (routingResult.route === "dream_fragment") {
    return {
      type: "project",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 96,
      label: "꿈의 파편",
      saveTargets: ["dream_fragment"],
      dreamRole: "fragment",
    };
  }

  if (
    routingResult.route === "dream_fragment_rename" ||
    routingResult.route === "dream_fragment_complete" ||
    routingResult.route === "dream_fragment_next_action_update"
  ) {
    return {
      type: "project",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 96,
      label: "꿈의 파편",
      saveTargets: [],
      dreamRole: "fragment",
    };
  }

  if (routingResult.route === "important_day_event") {
    return {
      type: "important_note",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 92,
      label: "오늘의 중요한 사건",
      saveTargets: ["daily_piece", "daily_trace"],
    };
  }

  if (routingResult.route === "daily_trace") {
    return {
      type: "daily_context",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: "하루의 흔적",
      saveTargets: ["daily_trace"],
    };
  }

  if (
    routingResult.route === "daily_long_record_create" ||
    routingResult.route === "daily_long_record_title_update" ||
    routingResult.route === "daily_long_record_append" ||
    routingResult.route === "daily_trace_update"
  ) {
    return {
      type: "daily_context",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: "날짜별 기록",
      saveTargets: [],
    };
  }

  if (routingResult.route === "daily_idea") {
    return {
      type: "idea",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 72,
      label: "오늘의 아이디어",
      saveTargets: ["daily_piece", "daily_trace"],
    };
  }

  if (routingResult.route === "completed_action" || routingResult.route === "completed_project") {
    return {
      type: "achievement",
      shouldSave: true,
      requiresConfirmation: true,
      importance: routingResult.route === "completed_project" ? 94 : 84,
      label: routingResult.route === "completed_project" ? "완료한 프로젝트" : "완료한 행동",
      saveTargets: ["daily_piece", "daily_trace"],
    };
  }

  if (routingResult.route === "routine_adjustment_intent" || routingResult.route === "routine_adjustment_confirm") {
    return {
      type: "none",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 0,
      label: "반복 목표 조정",
      saveTargets: [],
    };
  }

  if (routingResult.route === "life_schedule_missing_date") {
    return buildMemorySavePolicy("none");
  }

  if (routingResult.route === "none" || routingResult.isOtherPerson) {
    return buildMemorySavePolicy("none");
  }

  return memoryPolicy;
}

function getNoieDestination(routingResult?: NoieSaveRoutingResult): NoieDestination {
  switch (routingResult?.route) {
    case "dream_torch":
      return "dream_torch";
    case "dream_fragment":
    case "dream_fragment_rename":
    case "dream_fragment_complete":
    case "dream_fragment_next_action_update":
      return "dream_fragment";
    case "routine_create":
      return "today_me_routine";
    case "project_create":
      return "today_me_project";
    case "routine_record":
      return "routine_execution";
    case "life_schedule_once":
    case "life_schedule_repeat":
    case "life_schedule_date_request":
    case "life_schedule_missing_date":
    case "life_schedule_reminder_update":
    case "life_schedule_cancel":
      return "life_schedule";
    case "life_action_record":
    case "daily_long_record_create":
    case "daily_long_record_title_update":
    case "daily_long_record_append":
    case "daily_trace_update":
      return "daily_trace";
    case "routine_adjustment_intent":
    case "routine_adjustment_confirm":
      return "routine_update";
    case "important_day_event":
    case "daily_trace":
    case "daily_long_record_create":
    case "daily_long_record_title_update":
    case "daily_long_record_append":
    case "daily_trace_update":
    case "daily_idea":
    case "sensitive_event":
    case "achievement":
      return "daily_trace";
    case "completed_action":
      return "completed_action";
    case "completed_project":
      return "completed_project";
    default:
      return "none";
  }
}

function getNoieSuggestionAction(routingResult?: NoieSaveRoutingResult): NoieSuggestionAction {
  switch (routingResult?.route) {
    case "dream_torch":
      return "set_dream_torch";
    case "dream_fragment":
      return "save_dream_fragment";
    case "dream_fragment_rename":
    case "dream_fragment_next_action_update":
      return "update_routine";
    case "dream_fragment_complete":
      return "complete_project";
    case "routine_create":
      return "create_routine";
    case "project_create":
      return "create_project";
    case "routine_record":
      return "record_routine_execution";
    case "life_schedule_once":
    case "life_schedule_repeat":
    case "life_schedule_reminder_update":
      return "save_life_schedule";
    case "life_schedule_cancel":
      return "end_routine";
    case "life_schedule_date_request":
    case "life_schedule_missing_date":
      return "select_schedule_date";
    case "life_action_record":
      return "record_life_action";
    case "routine_adjustment_intent":
    case "routine_adjustment_confirm":
      return "update_routine";
    case "important_day_event":
    case "daily_trace":
    case "daily_idea":
    case "sensitive_event":
    case "achievement":
      return "record_daily_trace";
    case "completed_action":
      return "complete_action";
    case "completed_project":
      return "complete_project";
    default:
      return "none";
  }
}

function isOtherPersonOnlyText(text: string, decision?: SaveDecision) {
  if (decision?.subjectScope === "other_person" && decision.selfRelevance === "none") {
    return true;
  }
  return /^(지민|친구|동생|형|누나|언니|엄마|아빠|선배|후배|동기|그|그녀|걔|쟤|[가-힣]{2,4})(은|는|이|가)\s/.test(text.trim()) &&
    !/나한테|나에게|내가|나는|난|우리|같이|도와줘야|도와줄/.test(text);
}

function findRecentDreamReference(messages: ChatMessage[], items: DailyTraceItem[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as RoutedChatMessage;
    const routingResult = message.saveRoutingResult;
    if (
      message.dailyTraceCandidate &&
      (routingResult?.route === "dream_torch" || routingResult?.route === "dream_fragment")
    ) {
      const candidateText =
        routingResult.originalText ||
        message.dailyTraceCandidate.memo ||
        message.dailyTraceCandidate.title;
      const existingItem = findSingleDreamFragmentByTitle(items, message.dailyTraceCandidate.title) ??
        findSingleDreamFragmentByTitle(items, candidateText);
      if (existingItem) {
        return existingItem;
      }
      return {
        id: "",
        type: "goal" as DailyTraceItemType,
        date: message.dailyTraceCandidate.date || getLocalDateString(new Date()),
        title: makeMemoryTitle(candidateText),
        memo: candidateText,
        text: candidateText,
        sourceText: candidateText,
        memoryType: "project" as MemorySavePolicyType,
        saveTargets: ["dream_fragment"] as SaveDecision["saveTargets"],
        dreamRole: "fragment" as DreamRole,
        createdAt: message.createdAt,
      } as DailyTraceItem;
    }
  }

  return undefined;
}

function isExplicitTorchReferenceText(text: string) {
  return /(?:이걸|이\s*목표를|방금\s*말한\s*걸|방금\s*그거|그걸).*(꿈의\s*)?횃불|(?:꿈의\s*)?횃불로\s*밝혀/.test(text);
}

function findReferencedDreamForTorchRequest(
  text: string,
  recentDreamReference: DailyTraceItem | null | undefined,
  items: DailyTraceItem[]
) {
  if (!isExplicitTorchReferenceText(text)) {
    return null;
  }

  if (recentDreamReference?.id) {
    return recentDreamReference;
  }

  if (recentDreamReference) {
    const existingItem = findSingleDreamFragmentByTitle(items, recentDreamReference.title) ??
      findSingleDreamFragmentByTitle(items, getMemoryInputText(recentDreamReference));
    return existingItem ?? recentDreamReference;
  }

  return null;
}

function normalizeDreamTitleForLookup(text: string) {
  return cleanDreamFragmentCommandText(text)
    .replace(/꿈의\s*파편|꿈\s*파편|이름|제목/g, " ")
    .split(/\s+/)
    .map((word) => stripTrailingKoreanParticles(word))
    .join("")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

function cleanDreamFragmentCommandText(text: string) {
  return text
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .replace(/[.!。…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDreamFragmentNextText(text: string) {
  return cleanDreamFragmentCommandText(text)
    .replace(/\s*(?:으로|로)\s*(?:바꿔줘|바꿔|변경해줘|변경|수정해줘|수정)\s*$/g, "")
    .replace(/\s*(?:바꿔줘|바꿔|변경해줘|변경|수정해줘|수정)\s*$/g, "")
    .replace(/\s*(?:으로|로)\s*$/g, "")
    .replace(/[.!。…]+$/g, "")
    .trim();
}

function findDreamFragmentMatchesByTitle(items: DailyTraceItem[], title: string) {
  const fragments = getDreamFragments(items).filter((item) => item.projectStatus !== "done");
  const target = title.trim();
  const targetKey = normalizeDreamTitleForLookup(target);
  if (!targetKey) {
    return [];
  }

  const exact = fragments.filter((item) => item.title.trim() === target);
  if (exact.length > 0) {
    return exact;
  }

  const normalized = fragments.filter((item) => normalizeDreamTitleForLookup(item.title) === targetKey);
  if (normalized.length > 0) {
    return normalized;
  }

  const partial = fragments.filter((item) => {
    const itemKey = normalizeDreamTitleForLookup(item.title);
    return itemKey.includes(targetKey) || targetKey.includes(itemKey);
  });
  return partial.length === 1 ? partial : [];
}

function findSingleDreamFragmentByTitle(items: DailyTraceItem[], title: string) {
  const matches = findDreamFragmentMatchesByTitle(items, title);
  return matches.length === 1 ? matches[0] : undefined;
}

function findDreamFragmentNextActionUpdateRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  if (!/다음\s*(할\s*일|행동)/.test(text) || !/바꿔|수정|변경/.test(text)) {
    return null;
  }

  const match = text.match(/^(.+?)의\s*다음\s*(?:할\s*일|행동)을\s*(.+)$/);
  if (!match) {
    return null;
  }

  const previousTitle = cleanDreamFragmentCommandText(match[1]);
  const nextAction = cleanDreamFragmentNextText(match[2]);
  const matched = findSingleDreamFragmentByTitle(items, previousTitle);
  if (!matched || !nextAction) {
    return null;
  }

  return {
    route: "dream_fragment_next_action_update",
    title: matched.title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.98,
    matchedDailyTraceId: matched.id,
    previousTitle: matched.title,
    nextAction,
    reason: "기존 꿈의 파편 다음 할 일 수정",
  };
}

function findDreamFragmentRenameRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  if (!/바꿔|수정|변경/.test(text) || !/꿈의\s*파편/.test(text)) {
    return null;
  }

  const match = text.match(/^(.+?)(?:라는|이라고)?\s*꿈의\s*파편\s*이름을\s*(.+)$/);
  if (!match) {
    return null;
  }

  const previousTitle = cleanDreamFragmentCommandText(match[1]);
  const nextTitle = cleanDreamFragmentNextText(match[2]);
  const matched = findSingleDreamFragmentByTitle(items, previousTitle);
  if (!matched || !nextTitle) {
    return null;
  }

  return {
    route: "dream_fragment_rename",
    title: matched.title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.97,
    matchedDailyTraceId: matched.id,
    previousTitle: matched.title,
    nextTitle,
    reason: "기존 꿈의 파편 이름 수정",
  };
}

function findDreamFragmentCompleteRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  if (!/완료했|완료\s*했|끝냈|달성했|마쳤|완성했/.test(text)) {
    return null;
  }

  const match = text.match(/^(?:오늘|방금)?\s*(.+?)(?:을|를)?\s*(?:완료했어|완료\s*했어|끝냈어|달성했어|마쳤어|완성했어|완료했다|끝냈다|달성했다|마쳤다|완성했다)/);
  const titleText = cleanDreamFragmentCommandText(match?.[1] ?? text);
  const matched = findSingleDreamFragmentByTitle(items, titleText || text);
  if (!matched) {
    return null;
  }

  return {
    route: "dream_fragment_complete",
    title: matched.title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.98,
    matchedDailyTraceId: matched.id,
    reason: "기존 꿈의 파편 완료",
  };
}

function isNonCompletionRoutineText(text: string) {
  return /못\s*했어|못했어|안\s*했어|안했어|하지\s*못했어|못\s*끝냈어|완료하지\s*못했어|실패했어|건너뛰었어|쉬었어/.test(text);
}

function isAdditiveRoutineRecordText(text: string) {
  return /더\s*했어|더\s*했다|추가로\s*했어/.test(text);
}

function isExplicitAdditiveRoutineRecordRequest(text: string) {
  return isAdditiveRoutineRecordText(text) && /기록해줘|기록해|남겨줘|저장해줘|저장해/.test(text);
}

function findLifeScheduleRoute(text: string): NoieSaveRoutingResult | null {
  const normalizedText = normalizeMemoryInput(text);
  const parsedRange = parseKoreanClockTimeRange(text);
  const parsedTime = parsedRange?.start ?? parseKoreanClockTime(text);
  const parsedDate = parseRelativeScheduleDate(text);
  const isRepeat = /매일|매주|평일마다|주말마다|아침마다|저녁마다|밤마다/.test(text);
  const isPastAction = /일어났|먹었|다녀왔|갔다왔|갔다\s*왔|끝냈|했어|했다/.test(text);
  const isFutureSchedule = /해야\s*해|해야해|해야\s*돼|해야돼|일어나야|먹어야|가야\s*해|갈\s*거야|일어날래|잘래|먹을래|버릴래|챙길래/.test(text);

  if (!parsedTime || !isLifeScheduleText(text) || isGrowthRoutineText(text)) {
    return null;
  }

  const scheduleTitle = makeLifeScheduleTitle(text);
  if (isPastAction) {
    const dateKey = parsedDate?.dateKey ?? getLocalDateString(new Date());
    return {
      route: "life_action_record",
      title: makeLifeActionRecordTitle(scheduleTitle),
      originalText: text,
      normalizedText,
      confidence: 0.94,
      scheduledDate: dateKey,
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      reason: "이미 실제로 한 생활 행동",
    };
  }

  if (isRepeat) {
    return {
      route: "life_schedule_repeat",
      title: scheduleTitle,
      originalText: text,
      normalizedText,
      confidence: 0.93,
      scheduledDate: getLocalDateString(new Date()),
      recurrence: /매주/.test(text) ? "weekly" : "daily",
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      endTime: parsedRange?.end.time ?? null,
      endDisplayUnit: parsedRange?.end.label ?? null,
      reason: "생활 반복 예정",
    };
  }

  if (parsedDate && isFutureSchedule) {
    return {
      route: "life_schedule_once",
      title: scheduleTitle,
      originalText: text,
      normalizedText,
      confidence: 0.92,
      scheduledDate: parsedDate.dateKey,
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      endTime: parsedRange?.end.time ?? null,
      endDisplayUnit: parsedRange?.end.label ?? null,
      reason: "날짜가 있는 한 번짜리 예정",
    };
  }

  if (isFutureSchedule) {
    return {
      route: "life_schedule_missing_date",
      title: scheduleTitle,
      originalText: text,
      normalizedText,
      confidence: 0.88,
      needsDateSelection: false,
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      reason: "시간은 있지만 날짜가 없는 예정",
    };
  }

  return null;
}

function findLifeScheduleMutationRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  const reminder = parseLifeScheduleReminderRequest(text);
  if (reminder) {
    const matched = findSingleMatchingLifeSchedule(text, items);
    if (!matched) {
      return {
        route: "none",
        title: "",
        originalText: text,
        normalizedText: normalizeMemoryInput(text),
        confidence: 0.9,
        reason: "수정할 일정을 찾지 못함",
      };
    }
    const previousReminder = getExistingReminderLabel(matched) || "시간에 맞춰";
    return {
      route: "life_schedule_reminder_update",
      title: matched.title,
      originalText: text,
      normalizedText: normalizeMemoryInput(text),
      confidence: 0.96,
      scheduledDate: matched.date,
      displayUnit: matched.time,
      matchedDailyTraceId: matched.id,
      previousTitle: previousReminder,
      reminder: reminder.value,
      unit: reminder.label,
      reason: "기존 일정 알림 수정",
    };
  }

  if (/취소해줘|취소해|삭제해줘|삭제해|지워줘|지워/.test(text) && /일정|예약|가는\s*일/.test(text)) {
    const matched = findSingleMatchingLifeSchedule(text, items);
    if (!matched) {
      return {
        route: "none",
        title: "",
        originalText: text,
        normalizedText: normalizeMemoryInput(text),
        confidence: 0.9,
        reason: "취소할 일정을 찾지 못함",
      };
    }
    return {
      route: "life_schedule_cancel",
      title: matched.title,
      originalText: text,
      normalizedText: normalizeMemoryInput(text),
      confidence: 0.96,
      scheduledDate: matched.date,
      displayUnit: matched.time,
      matchedDailyTraceId: matched.id,
      reason: "기존 일정 취소",
    };
  }

  return null;
}

function parseLifeScheduleReminderRequest(text: string) {
  if (!/알려줘|알림|리마인드/.test(text) || !/(전|전에|맞춰)/.test(text)) {
    return null;
  }
  const minuteMatch = text.match(/(\d+)\s*분\s*전/);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (minutes === 10 || minutes === 30) {
      return { value: `${minutes}m`, label: `${minutes}분 전` };
    }
  }
  const hourMatch = text.match(/(\d+)\s*시간\s*전/);
  if (hourMatch && Number(hourMatch[1]) === 1) {
    return { value: "1h", label: "1시간 전" };
  }
  if (/시간에\s*맞춰|정각|바로/.test(text)) {
    return { value: "on_time", label: "시간에 맞춰" };
  }
  return null;
}

function findSingleMatchingLifeSchedule(text: string, items: DailyTraceItem[]) {
  const todayKey = getLocalDateString(new Date());
  const parsedDate = parseRelativeScheduleDate(text);
  const parsedTime = parseKoreanClockTime(text);
  const dateKey = parsedDate?.dateKey;
  const textKey = normalizeScheduleSearchText(text);
  const candidates = dedupeMemories(items)
    .filter((item) => {
      if (isCancelledTraceItem(item) || isCompletedTraceScheduleItem(item) || !isScheduledDailyTraceItemForDate(item, item.date)) {
        return false;
      }
      if (isLifeRepeatTraceItem(item)) {
        return false;
      }
      if (dateKey && item.date !== dateKey) {
        return false;
      }
      if (!dateKey && item.date < todayKey) {
        return false;
      }
      return true;
    })
    .map((item) => {
      let score = 0;
      const titleKey = normalizeScheduleSearchText(item.title);
      if (dateKey && item.date === dateKey) {
        score += 4;
      }
      if (parsedTime?.time && item.time === parsedTime.time) {
        score += 3;
      }
      if (titleKey && textKey.includes(titleKey)) {
        score += 4;
      } else if (hasScheduleKeywordOverlap(textKey, titleKey)) {
        score += 3;
      }
      return { item, score };
    })
    .filter((candidate) => candidate.score >= 3)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 1 || (candidates[0] && candidates[0].score > (candidates[1]?.score ?? 0))) {
    return candidates[0].item;
  }
  return null;
}

function normalizeScheduleSearchText(text: string) {
  return text
    .replace(/오늘|내일|모레|다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/g, " ")
    .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?/g, " ")
    .replace(/\d+\s*(분|시간)\s*전/g, " ")
    .replace(/일정|예약|가는\s*일|알려줘|취소해줘|취소해|삭제해줘|삭제해|지워줘|지워|전에/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasScheduleKeywordOverlap(textKey: string, titleKey: string) {
  const textTokens = new Set(textKey.split(/\s+/).map(stripTrailingKoreanParticles).filter((token) => token.length >= 2));
  return titleKey
    .split(/\s+/)
    .map(stripTrailingKoreanParticles)
    .filter((token) => token.length >= 2)
    .some((token) => textTokens.has(token));
}

function getReminderLabelByValue(value: string) {
  return TRACE_REMINDER_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

function parseKoreanClockTimeRange(text: string) {
  const match = text.match(/(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?\s*부터\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?\s*까지/);
  if (!match) {
    return null;
  }

  const startMarker = match[1] ?? "";
  const endMarker = match[4] ?? startMarker;
  const start = buildKoreanClockTime(startMarker, match[2], match[3]);
  const end = buildKoreanClockTime(endMarker, match[5], match[6]);
  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function parseKoreanClockTime(text: string) {
  const match = text.match(/(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?/);
  if (!match) {
    return null;
  }

  return buildKoreanClockTime(match[1] ?? "", match[2], match[3]);
}

function buildKoreanClockTime(marker: string, hourText: string, minuteText?: string) {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if ((marker === "오후" || marker === "저녁" || marker === "밤") && hour < 12) {
    hour += 12;
  }
  if ((marker === "오전" || marker === "아침" || marker === "새벽") && hour === 12) {
    hour = 0;
  }

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const labelHour = hour >= 12 ? hour - 12 || 12 : hour || 12;
  const period = hour >= 12 ? "오후" : "오전";
  return {
    time,
    label: `${period} ${labelHour}:${String(minute).padStart(2, "0")}`,
  };
}

function parseRelativeScheduleDate(text: string) {
  const today = new Date();
  const offset = /모레/.test(text) ? 2 : /내일/.test(text) ? 1 : /오늘/.test(text) ? 0 : null;
  if (offset !== null) {
    return {
      dateKey: getLocalDateString(addDays(today, offset)),
      label: offset === 0 ? "오늘" : offset === 1 ? "내일" : "모레",
    };
  }

  const nextWeekday = parseNextWeekdayScheduleDate(text, today);
  if (nextWeekday) {
    return nextWeekday;
  }

  return null;
}

function parseNextWeekdayScheduleDate(text: string, today: Date) {
  const match = text.match(/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/);
  if (!match) {
    return null;
  }

  const weekdayMap: Record<string, number> = {
    일요일: 0,
    일: 0,
    월요일: 1,
    월: 1,
    화요일: 2,
    화: 2,
    수요일: 3,
    수: 3,
    목요일: 4,
    목: 4,
    금요일: 5,
    금: 5,
    토요일: 6,
    토: 6,
  };
  const targetDay = weekdayMap[match[1]];
  const thisWeekStart = addDays(today, -today.getDay());
  const targetDate = addDays(thisWeekStart, 7 + targetDay);
  return {
    dateKey: getLocalDateString(targetDate),
    label: `다음 주 ${match[1].length === 1 ? `${match[1]}요일` : match[1]}`,
  };
}

function isLifeScheduleText(text: string) {
  return /일어나|기상|자기|잠자|취침|약\s*먹|약\s*복용|병원|쓰레기|분리수거|청소|빨래|설거지|밥\s*먹|식사|출근|등교|예약|미용실/.test(text);
}

function isGrowthRoutineText(text: string) {
  return /공부|연습|운동|훈련|복습|기술|자격증|코딩|미용사/.test(text);
}

function makeLifeScheduleTitle(text: string) {
  if (/일어나|기상/.test(text)) {
    return "일어나기";
  }
  if (/자기|잠자|취침/.test(text)) {
    return "자기";
  }
  if (/약\s*먹|약\s*복용/.test(text)) {
    return "약 먹기";
  }
  if (/쓰레기|분리수거/.test(text)) {
    return "쓰레기 버리기";
  }
  if (/병원/.test(text)) {
    return "병원 가기";
  }
  if (/미용실/.test(text) && /예약/.test(text)) {
    return "미용실 예약";
  }
  return normalizeRoutineTitle(text)
    .replace(/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/g, "")
    .replace(/오늘|내일|모레/g, "")
    .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?\s*부터\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?\s*까지/g, "")
    .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?에/g, "")
    .replace(/해야\s*해|해야해|해야\s*돼|해야돼|일어날래|할래|갈\s*거야/g, "")
    .trim() || makeMemoryTitle(text);
}

function makeLifeActionRecordTitle(title: string) {
  if (title === "일어나기") {
    return "일어남";
  }
  if (title.endsWith("기")) {
    return `${title.slice(0, -1)}ㅁ`;
  }
  return title;
}

function parseRoutineGoalCandidate(text: string): Pick<NoieSaveRoutingResult, "title" | "repeatType" | "targetValue" | "unit"> | null {
  const normalizedText = text.trim();
  const hasRepeat = /매일|매주|주\s*\d+\s*회|하루에|매일마다|아침마다|저녁마다|꾸준히|반복해서|\d+(?:\.\d+)?\s*(분|시간|회|개|페이지|세트|장)\s*씩/.test(normalizedText);
  const hasIntent = /할래|그릴래|읽을래|운동할래|공부할래|하려고\s*해|하기로\s*했|목표로\s*할래|습관으로\s*만들|꾸준히\s*할\s*거야|할\s*거야/.test(normalizedText);
  const durationTarget = parseDurationValueWithUnit(normalizedText);
  const targetMatch = durationTarget ? null : normalizedText.match(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트|장)\s*씩?/);
  if (!hasRepeat || !hasIntent) {
    return null;
  }
  const targetValue = durationTarget?.targetValue ?? (targetMatch ? Number(targetMatch[1]) : undefined);
  if (targetMatch && !Number.isFinite(targetValue)) {
    return null;
  }
  const unit = durationTarget?.unit ?? targetMatch?.[2];
  const repeatType = /주\s*\d+\s*회|매주/.test(normalizedText) ? "weekly" : "daily";
  return {
    title: normalizeRoutineTitle(normalizedText),
    repeatType,
    targetValue,
    unit,
  };
}

function normalizeRoutineTitle(text: string) {
  let title = text
    .replace(/매일마다|매일|매주|주\s*\d+\s*회|하루에|아침마다|저녁마다|꾸준히|반복해서/g, "")
    .replace(/\d+(?:\.\d+)?\s*(시간|분|회|개|페이지|세트|장)\s*씩?/g, "")
    .replace(/공부할래|공부하려고\s*해|연습할래|해볼래|시작할래|하고\s*싶어|할래|하려고\s*해|하기로\s*했어|목표로\s*할래|습관으로\s*만들래|꾸준히\s*할\s*거야|할\s*거야/g, "")
    .replace(/씩/g, " ")
    .trim();
  title = stripTrailingKoreanParticles(title);
  title = title.replace(/잡는\s*연습/g, "잡기 연습");
  if (/파이썬/.test(text) && /공부/.test(text)) {
    return "파이썬 공부하기";
  }
  if (/영어/.test(text) && /공부/.test(text)) {
    return "영어 공부";
  }
  if (/코딩/.test(text) && /공부/.test(text)) {
    return "코딩 공부";
  }
  if (/제과\s*이론/.test(text) && /공부/.test(text)) {
    return "제과 이론 공부";
  }
  if (/헤어\s*컬러\s*이론/.test(text) && /공부/.test(text)) {
    return "헤어 컬러 이론 공부";
  }
  if (/공부/.test(text) && title && !/공부$|공부하기$/.test(title)) {
    return `${title.replace(/\s+/g, " ")} 공부`;
  }
  if (/연습/.test(text) && title && !/연습$|연습하기$/.test(title)) {
    return `${title.replace(/\s+/g, " ")} 연습`;
  }
  if (/운동/.test(text)) {
    return "운동";
  }
  if (/공부$|연습$|운동$/.test(title)) {
    return title.replace(/\s+/g, " ");
  }
  if (!/기$/.test(title)) {
    title = `${title || makeMemoryTitle(text)}하기`;
  }
  return title.replace(/\s+/g, " ");
}

function stripTrailingKoreanParticles(text: string) {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^(.+?)(을|를|은|는|이|가|도|만)$/u, "$1"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function repairRoutineTitlesFromOriginalText(items: DailyTraceItem[]) {
  let changed = false;
  const repairedItems = items.map((item) => {
    const itemSourceText = getMemoryInputText(item) || item.originalText || item.text || item.sourceText || "";
    if (!(item.routines ?? []).length) {
      return item;
    }
    const repairedRoutines = (item.routines ?? []).map((routine) => {
      const titleKey = normalizeMemoryInput(routine.title);
      if (!/^(가위\s*)?위\s*잡\s*연습(하기)?$|^가위\s*잡\s*연습(하기)?$/.test(titleKey)) {
        return routine;
      }
      const routineSource = routine as DreamRoutine & { originalText?: string; sourceText?: string; text?: string };
      const sourceText = routineSource.originalText || routineSource.sourceText || routineSource.text || itemSourceText;
      if (!/가위.*연습/.test(sourceText)) {
        return routine;
      }
      const repairedTitle = normalizeRoutineTitle(sourceText);
      if (!repairedTitle || repairedTitle === routine.title) {
        return routine;
      }
      changed = true;
      return {
        ...routine,
        title: repairedTitle,
      };
    });
    return repairedRoutines === item.routines
      ? item
      : {
          ...item,
          routines: repairedRoutines,
        };
  });

  return changed ? repairedItems : items;
}

function isLegacyRoutineExecutionTrace(
  item: DailyTraceItem,
  routineTitle: string,
  dateKey: string,
  currentSourceId: string
) {
  const typedItem = item as DailyTraceItem & { sourceId?: string; sourceType?: string };
  if (typedItem.sourceId === currentSourceId) {
    return false;
  }
  if (item.date !== dateKey || item.displayCategory !== "반복 목표 수행") {
    return false;
  }
  const itemTitle = normalizeMemoryInput(item.title);
  const routineKey = normalizeMemoryInput(routineTitle).replace(/하기$/g, "");
  return routineKey.length > 0 && itemTitle.includes(routineKey);
}

function isRoutineRecordText(text: string) {
  const hasRecordEditIntent = /기록해줘|기록해|기록을|수정해줘|수정해|바꿔줘|바꿔|변경해줘|변경해/.test(text);
  const hasValue = /(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/.test(text);
  if (isActualRoutineExecutionText(text)) {
    return true;
  }
  if (hasRecordEditIntent && hasValue) {
    return true;
  }
  return /오늘|어제|방금/.test(text) && /했어|했다|완료했|끝냈|공부했|운동했|했는데|기록|남겨|바꿔|수정|변경/.test(text);
}

function isActualRoutineExecutionText(text: string) {
  if (isNonCompletionRoutineText(text)) {
    return false;
  }
  if (/목표\s*(시간|수행량|량)?|바꿔줘|바꿔|수정해줘|수정해|변경해줘|변경해|조절|조정/.test(text)) {
    return false;
  }
  return (
    /오늘|어제|방금|아까/.test(text) &&
    /했어|했다|끝냈어|끝냈다|완료했어|완료했다/.test(text) &&
    /(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/.test(text)
  );
}

function isPlainDailyTraceText(text: string) {
  const normalizedText = text.trim();
  if (/되고\s*싶|만들고\s*싶|완성하고\s*싶|할래|시작할래|목표|꿈/.test(normalizedText)) {
    return false;
  }
  return /오늘|어제|방금|아까/.test(normalizedText) && /했어|했다|다녀왔|받았|만났|생겼|떠올랐|겪었|봤어|들었어|공부했|운동했/.test(normalizedText);
}

function findDailyRecordCommandRoute(
  text: string,
  dailyTraces: DailyTraceItem[],
  dailyLongRecords: DailyLongRecord[]
): NoieSaveRoutingResult | null {
  const todayKey = getLocalDateString(new Date());
  const dateKey = getRecordCommandDateKey(text, todayKey);

  const titleUpdate = findDailyLongRecordTitleUpdateRoute(text, dailyLongRecords, dateKey);
  if (titleUpdate) {
    return titleUpdate;
  }

  const appendRoute = findDailyLongRecordAppendRoute(text, dateKey);
  if (appendRoute) {
    return appendRoute;
  }

  const lineUpdate = findRecentDailyTraceLineUpdateRoute(text, dailyTraces, todayKey);
  if (lineUpdate) {
    return lineUpdate;
  }

  const longRecordCreate = findDailyLongRecordCreateRoute(text, dateKey);
  if (longRecordCreate) {
    return longRecordCreate;
  }

  const oneLineRecord = findOneLineDailyTraceCreateRoute(text, dateKey);
  if (oneLineRecord) {
    return oneLineRecord;
  }

  const datedActionTrace = findDatedActionDailyTraceRoute(text, dateKey);
  if (datedActionTrace) {
    return datedActionTrace;
  }

  return null;
}

function getRecordCommandDateKey(text: string, todayKey: string) {
  if (/어제/.test(text)) {
    return shiftTraceDateKey(todayKey, -1);
  }
  return todayKey;
}

function extractQuotedRecordText(text: string) {
  const quoteMatch = text.match(/[‘'“"](.+?)[’'”"]/);
  if (quoteMatch?.[1]?.trim()) {
    return quoteMatch[1].trim();
  }
  const koreanQuoteMatch = text.match(/‘(.+?)’|“(.+?)”/);
  if (koreanQuoteMatch?.[1]?.trim() || koreanQuoteMatch?.[2]?.trim()) {
    return (koreanQuoteMatch[1] ?? koreanQuoteMatch[2]).trim();
  }
  return "";
}

function cleanRecordCommandText(text: string) {
  return text
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .replace(/[.!。…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOneLineRecordText(text: string) {
  const quoted = extractQuotedRecordText(text);
  if (quoted) {
    return cleanRecordCommandText(quoted);
  }
  return cleanRecordCommandText(
    text
      .replace(/오늘|어제|방금|아까/g, " ")
      .replace(/한\s*줄\s*기록으로\s*남겨줘|한\s*줄\s*기록으로\s*남겨|한\s*줄\s*기록으로|기록으로\s*남겨줘|남겨줘/g, " ")
  ).replace(/다고$/g, "다");
}

function findDailyLongRecordTitleUpdateRoute(
  text: string,
  dailyLongRecords: DailyLongRecord[],
  dateKey: string
): NoieSaveRoutingResult | null {
  if (!/기록\s*제목을/.test(text) || !/바꿔|수정|변경/.test(text)) {
    return null;
  }
  const nextTitle = cleanRecordCommandText(extractQuotedRecordText(text) || text.replace(/^.*기록\s*제목을\s*/, "").replace(/(?:으로|로)\s*(?:바꿔줘|바꿔|수정해줘|수정|변경해줘|변경).*$/, ""));
  if (!nextTitle || !dailyLongRecords.some((record) => record.dateKey === dateKey)) {
    return null;
  }
  return {
    route: "daily_long_record_title_update",
    title: nextTitle,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.98,
    scheduledDate: dateKey,
    longRecordTitle: nextTitle,
    reason: "날짜별 긴 기록 제목 수정",
  };
}

function findDailyLongRecordAppendRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
  if (!/기록에\s*덧붙여줘|기록에\s*추가해줘|기록에\s*이어\s*써줘/.test(text)) {
    return null;
  }
  const body = cleanRecordCommandText(extractQuotedRecordText(text));
  if (!body) {
    return null;
  }
  return {
    route: "daily_long_record_append",
    title: "기록 덧붙이기",
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.96,
    scheduledDate: dateKey,
    longRecordBody: body,
    reason: "날짜별 긴 기록 본문 덧붙이기",
  };
}

function findDailyLongRecordCreateRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
  if (!/(오늘|어제)의\s*기록에/.test(text)) {
    return null;
  }
  const body = cleanRecordCommandText(extractQuotedRecordText(text));
  if (!body) {
    return null;
  }
  return {
    route: "daily_long_record_create",
    title: "날짜별 긴 기록",
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.97,
    scheduledDate: dateKey,
    longRecordBody: body,
    reason: "날짜별 긴 기록 새 저장",
  };
}

function findRecentDailyTraceLineUpdateRoute(
  text: string,
  dailyTraces: DailyTraceItem[],
  todayKey: string
): NoieSaveRoutingResult | null {
  if (!/방금\s*남긴\s*한\s*줄\s*기록을/.test(text) || !/수정|바꿔|변경/.test(text)) {
    return null;
  }
  const nextText = cleanRecordCommandText(extractQuotedRecordText(text));
  const recentTrace = findRecentOneLineDailyTrace(dailyTraces, todayKey);
  if (!nextText || !recentTrace) {
    return null;
  }
  return {
    route: "daily_trace_update",
    title: "방금 남긴 기록",
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.98,
    scheduledDate: recentTrace.date,
    matchedDailyTraceId: recentTrace.id,
    previousTitle: recentTrace.text ?? recentTrace.memo ?? recentTrace.title,
    nextTitle: nextText,
    reason: "최근 한 줄 기록 수정",
  };
}

function findRecentOneLineDailyTrace(dailyTraces: DailyTraceItem[], todayKey: string) {
  return [...dailyTraces]
    .filter((item) => {
      const typedItem = item as DailyTraceItem & { sourceType?: string };
      return (
        item.date === todayKey &&
        item.type === "record" &&
        typedItem.sourceType !== "routine_execution" &&
        typedItem.sourceType !== "dream_fragment_complete" &&
        !item.saveTargets?.includes("dream_fragment") &&
        !item.saveTargets?.includes("dream_torch")
      );
    })
    .sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt))[0];
}

function findOneLineDailyTraceCreateRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
  if (!/한\s*줄\s*기록으로/.test(text)) {
    return null;
  }
  const body = cleanOneLineRecordText(text);
  if (!body) {
    return null;
  }
  return {
    route: "daily_trace",
    title: body,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.94,
    scheduledDate: dateKey,
    reason: "한 줄 기록 새 저장",
  };
}

function findDatedActionDailyTraceRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
  if (!/어제/.test(text) || !/했어|했다|끝냈어|완료했어/.test(text)) {
    return null;
  }
  const duration = parseDurationValueWithUnit(text);
  if (!duration) {
    return null;
  }
  const title = cleanRecordCommandText(
    text
      .replace(/어제|오늘|방금|아까/g, " ")
      .replace(/\d+(?:\.\d+)?\s*(?:시간|분)(?:\s*반)?/g, " ")
      .replace(/했어|했다|끝냈어|완료했어|을|를/g, " ")
  );
  if (!title) {
    return null;
  }
  return {
    route: "daily_trace",
    title: `${title} · ${formatRoutineTarget(duration.targetValue, duration.unit)}`,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.93,
    scheduledDate: dateKey,
    reason: "날짜가 명시된 실제 행동 흔적",
  };
}

function findRoutineRecordRoute(
  text: string,
  items: DailyTraceItem[]
): NoieSaveRoutingResult | null {
  if (isNonCompletionRoutineText(text) || (isAdditiveRoutineRecordText(text) && !isExplicitAdditiveRoutineRecordRequest(text))) {
    return null;
  }
  if (!isRoutineRecordText(text)) {
    return null;
  }
  try {
    const parsed = parseRoutineRecordRequest(text);
    const matched = findMatchingActiveRoutineForRecord(text, parsed, items);
    if (!matched) {
      return null;
    }
    const targetUnit = matched.routine.unit ?? parsed.requestedUnit ?? parsed.observedUnit ?? "";
    const effectiveTargetValue = getEffectiveRoutineTargetValue(matched.routine, getLocalDateString(new Date()));
    const sourceValue =
      parsed.requestedValue ??
      parsed.observedValue ??
      (effectiveTargetValue > 0 ? effectiveTargetValue : /완료|끝냈|했어|했다/.test(text) ? 1 : 0);
    const sourceUnit = parsed.requestedUnit ?? parsed.observedUnit ?? targetUnit;
    const convertedValue = convertRoutineRecordValueToRoutineUnit(sourceValue, sourceUnit, targetUnit);
    const existingRecord = findRoutineRecord(matched.item.routineRecords ?? [], matched.routine.id, getLocalDateString(new Date()));
    const existingActualValue = parsed.isAdditiveRecord ? getRoutineRecordActualValue(existingRecord) : 0;
    const actualValue = convertedValue + existingActualValue;
    if (!Number.isFinite(actualValue) || actualValue <= 0) {
      return null;
    }

    return {
      route: "routine_record",
      title: matched.routine.title,
      originalText: text,
      normalizedText: normalizeMemoryInput(text),
      confidence: matched.confidence,
      matchedRoutineId: matched.routine.id,
      targetValue: getEffectiveRoutineTargetValue(matched.routine, getLocalDateString(new Date())),
      actualValue,
      actualUnit: targetUnit,
      displayValue: sourceValue,
      displayUnit: sourceUnit,
      unit: targetUnit,
      isExplicitOverride: parsed.isExplicitOverride,
      isAdditiveRecord: parsed.isAdditiveRecord,
      hasExistingRoutineRecord: Boolean(existingRecord),
      reason: parsed.isAdditiveRecord
        ? "명시적 반복 목표 수행량 누적 기록"
        : parsed.isExplicitOverride ? "명시적 반복 목표 수행 기록 수정" : "반복 목표 수행 기록",
    };
  } catch (error) {
    console.error("[routine-record-routing-error]", error);
    return null;
  }
}

function parseRoutineRecordRequest(text: string) {
  const duration = parseDurationValueWithUnit(text);
  const matches = duration
    ? [{
      value: duration.targetValue,
      unit: duration.unit,
      index: text.search(/\d+(?:\.\d+)?\s*시간/),
    }]
    : Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/g)).map((match) => ({
      value: Number(match[1]),
      unit: match[2],
      index: match.index ?? 0,
    })).filter((match) => Number.isFinite(match.value));
  const explicitMatch = text.match(/기록|남겨|바꿔|변경|수정|담아|적어/);
  const isExplicitOverride = Boolean(explicitMatch);
  const isAdditiveRecord = isExplicitAdditiveRoutineRecordRequest(text);
  const requestedMatch = isExplicitOverride
    ? [...matches].reverse().find((match) => match.index >= (explicitMatch?.index ?? 0)) ?? matches[matches.length - 1]
    : undefined;
  const observedMatch = matches.find((match) => match !== requestedMatch) ?? matches[0];
  const selectedMatch = requestedMatch ?? observedMatch;

  return {
    activityText: text
      .replace(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/g, " ")
      .replace(/오늘|어제|방금|했어|했다|했는데|했지만|완료했어|끝냈어|기록해줘|기록하기|남겨줘|바꿔줘|수정해줘|변경해줘|으로|로/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    observedValue: observedMatch?.value,
    observedUnit: observedMatch?.unit,
    requestedValue: requestedMatch?.value ?? selectedMatch?.value,
    requestedUnit: requestedMatch?.unit ?? selectedMatch?.unit,
    isExplicitOverride,
    isAdditiveRecord,
  };
}

function hasRoutineKeywordOverlap(textKey: string, routineKey: string) {
  const normalizeToken = (value: string) =>
    stripTrailingKoreanParticles(value)
      .replace(/하기$/g, "")
      .replace(/공부$/g, "")
      .trim();
  const textTokens = new Set(
    textKey
      .split(/\s+/)
      .map(normalizeToken)
      .filter((token) => token.length >= 2)
  );
  return routineKey
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 2)
    .some((token) => textTokens.has(token));
}

function findMatchingActiveRoutineForRecord(
  text: string,
  parsed: ReturnType<typeof parseRoutineRecordRequest>,
  items: DailyTraceItem[]
) {
  const routines = getActiveRoutineEntries(items);
  if (routines.length === 0) {
    return null;
  }
  const textKey = normalizeMemoryInput(`${text} ${parsed.activityText}`);
  const scored = routines
    .map(({ item, routine }) => {
      const titleKey = normalizeMemoryInput(routine.title);
      const compactTitleKey = titleKey.replace(/하기$/g, "");
      let score = 0;
      if (titleKey && textKey.includes(titleKey)) {
        score += 4;
      }
      if (compactTitleKey && textKey.includes(compactTitleKey)) {
        score += 3;
      }
      if (/운동|헬스|러닝|달리기|체력/.test(textKey) && /운동|헬스|러닝|달리기|체력/.test(titleKey)) {
        score += 2;
      }
      if (/파이썬|코딩|개발|공부|학습/.test(textKey) && /파이썬|코딩|개발|공부|학습/.test(titleKey)) {
        score += 2;
      }
      if (hasRoutineKeywordOverlap(textKey, titleKey)) {
        score += 3;
      }
      return { item, routine, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored[0]) {
    return { item: scored[0].item, routine: scored[0].routine, confidence: Math.min(0.98, 0.72 + scored[0].score * 0.05) };
  }
  if (routines.length === 1) {
    return { item: routines[0].item, routine: routines[0].routine, confidence: 0.62 };
  }
  return null;
}

function isProjectStartText(text: string) {
  const normalizedText = text.trim();
  if (/언젠가|나중에|되고\s*싶|완성하고\s*싶|만들고\s*싶|꿈|목표/.test(normalizedText) && !/시작할래|시작하려고|실제로\s*개발|프로젝트를\s*시작/.test(normalizedText)) {
    return false;
  }
  return /프로젝트.*시작할래|프로젝트를\s*시작|프로젝트\s*시작|MVP.*만들래|포트폴리오.*만들래|이력서.*완성할래|앱.*만들기\s*시작|실제로\s*개발할래|실제로\s*만들래/.test(normalizedText);
}

function makeProjectTitle(text: string) {
  return makeMemoryTitle(
    text
      .replace(/프로젝트를\s*시작할래|프로젝트\s*시작할래|프로젝트를\s*시작|시작할래|실제로\s*개발할래|실제로\s*만들래/g, "")
      .replace(/만들래/g, "만들기")
      .replace(/완성할래/g, "완성하기")
      .trim() || text
  );
}

function findDuplicateProjectByText(text: string, projects: NoieProject[]) {
  const projectKey = normalizeMemoryInput(makeProjectTitle(text));
  if (!projectKey) {
    return undefined;
  }
  return projects.find((project) => {
    if (project.status === "done" || project.isArchived || project.archivedFromTodayMe) {
      return false;
    }
    const titleKey = normalizeMemoryInput(project.title || project.goal || project.originalText || "");
    return titleKey === projectKey || titleKey.includes(projectKey) || projectKey.includes(titleKey);
  });
}

function findDuplicateProjectRoute(routingResult: NoieSaveRoutingResult, projects: NoieProject[]) {
  if (routingResult.matchedProjectId) {
    return projects.find((project) => project.id === routingResult.matchedProjectId);
  }
  return findDuplicateProjectByText(routingResult.originalText || routingResult.title, projects);
}

function isDreamTorchCandidateText(text: string, memoryPolicy: MemorySavePolicy) {
  if (isLifeDirectionDreamText(text)) {
    return true;
  }
  if (!isDreamOrGoalType(memoryPolicy.type) && !isCareerDreamText(text)) {
    return false;
  }
  const normalizedText = text.trim();
  if (isDreamFragmentText(normalizedText) || isDailyIdeaText(normalizedText) || parseRoutineGoalCandidate(normalizedText)) {
    return false;
  }
  return /가장\s*큰\s*목표|가장\s*중요한\s*꿈|대표\s*꿈|내\s*꿈|꿈이야|되는\s*게\s*꿈|장래희망|언젠가|장기적|진로|취직하고\s*싶|취업하고\s*싶|개발자가\s*되고|개발자로\s*취업|소방관이\s*되는|열고\s*싶/.test(normalizedText) &&
    (/되고\s*싶|되는\s*게\s*꿈|내\s*꿈|장래희망|취직하고\s*싶|취업하고\s*싶|열고\s*싶/.test(normalizedText) || isCareerDreamText(normalizedText));
}

function isCareerDreamText(text: string) {
  return /파티시에|개발자|인공지능\s*개발자|ai\s*개발자|요리사|의사|디자이너|헤어\s*디자이너|소방관|간호사|선생님|교사|변호사|작가|뤼튼|미용실/.test(text) &&
    /되고\s*싶|되는\s*게\s*꿈|내\s*꿈|장래희망|언젠가|취직하고\s*싶|취업하고\s*싶|열고\s*싶/.test(text);
}

function isLifeDirectionDreamText(text: string) {
  return (
    /되고\s*싶|되는\s*게\s*꿈|내\s*꿈|장래희망|언젠가|장기적인|만들고\s*싶|열고\s*싶|취직하고\s*싶|취업하고\s*싶|이루도록\s*돕/.test(text) &&
    (/파티시에|디자이너|개발자|의사|요리사|브랜드|AI|ai|인공지능|미용실|뤼튼|사람들의\s*감정|목표를\s*이루도록\s*돕|사람들에게\s*자신감을\s*주는/.test(text))
  );
}

function makeDreamChoicePromptTitle(text: string) {
  return text
    .replace(/언젠가/g, "")
    .replace(/나는|내\s*꿈은|내\s*꿈|장래희망/g, "")
    .replace(/되고\s*싶어/g, "되고 싶은")
    .replace(/되는\s*게\s*내\s*꿈이야|되는\s*게\s*꿈이야|꿈이야/g, "되는")
    .replace(/\s+/g, " ")
    .trim() || "이";
}

function isImportantDayEventText(text: string) {
  return /방학.*시작|개학.*시작|졸업|입학|이사(를)?\s*했|첫\s*출근|복학|새로운\s*학기\s*시작|여행\s*출발/.test(text);
}

function makeImportantDayEventTitle(text: string) {
  if (/방학/.test(text) && /시작/.test(text)) {
    return "방학 시작";
  }
  return makeMemoryTitle(text);
}

function parseTargetValueWithUnit(text: string) {
  const duration = parseDurationValueWithUnit(text);
  if (duration) {
    return duration;
  }

  const targetMatch = text.match(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/);
  if (!targetMatch) {
    return null;
  }
  const targetValue = Number(targetMatch[1]);
  if (!Number.isFinite(targetValue)) {
    return null;
  }
  return {
    targetValue,
    unit: targetMatch[2],
  };
}

function parseDurationValueWithUnit(text: string) {
  const hourMinuteMatch = text.match(/(\d+(?:\.\d+)?)\s*시간\s*(?:(\d+(?:\.\d+)?)\s*분|반)?/);
  if (!hourMinuteMatch) {
    return null;
  }

  const hours = Number(hourMinuteMatch[1]);
  const minutes = hourMinuteMatch[2] ? Number(hourMinuteMatch[2]) : /시간\s*반/.test(hourMinuteMatch[0]) ? 30 : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return {
    targetValue: hours * 60 + minutes,
    unit: "분",
  };
}

function getActiveRoutineEntries(items: DailyTraceItem[]) {
  return items.flatMap((item) =>
    (item.routines ?? [])
      .filter((routine) => isRoutineAvailableForTodayMe(routine))
      .map((routine) => ({ item, routine }))
  );
}

function findRoutineAdjustmentIntent(
  text: string,
  items: DailyTraceItem[]
): PendingRoutineAdjustment | null {
  const normalizedText = text.trim();
  if (isActualRoutineExecutionText(normalizedText)) {
    return null;
  }
  const wantsAdjustment = /바꾸고\s*싶|변경|조절|조정|늘리|줄이|줄이고|늘리고|목표.*바꿔|목표.*조정/.test(normalizedText);
  const targetDomain = /공부|학습|파이썬|코딩|영어|독서|운동|반복|목표|시간/.test(normalizedText);
  if (!wantsAdjustment || !targetDomain) {
    return null;
  }

  const routines = getActiveRoutineEntries(items);
  if (routines.length === 0) {
    return null;
  }

  const textKey = normalizeMemoryInput(normalizedText);
  const matchedRoutine =
    routines.find(({ routine }) => {
      const routineKey = normalizeMemoryInput(routine.title);
      return (
        textKey.includes(routineKey.replace(/하기$/g, "")) ||
        (/파이썬|코딩|공부|학습/.test(textKey) && /파이썬|코딩|공부|학습/.test(routineKey))
      );
    }) ?? (routines.length === 1 ? routines[0] : null);

  if (!matchedRoutine) {
    return null;
  }

  return {
    routineId: matchedRoutine.routine.id,
    routineTitle: matchedRoutine.routine.title,
    currentTargetValue: matchedRoutine.routine.targetValue ?? 0,
    currentUnit: matchedRoutine.routine.unit ?? "",
  };
}

function findCompletedProjectRoute(
  text: string,
  projects: NoieProject[]
): NoieSaveRoutingResult | null {
  if (!/프로젝트|전체\s*프로젝트/.test(text) || !/완료했|끝냈|마쳤|끝남|완성했|완료\s*처리|완료/.test(text)) {
    return null;
  }

  const normalizedText = normalizeMemoryInput(text);
  const activeProjects = projects.filter(
    (project) =>
      isActiveTodayMeProject(project) &&
      project.status !== "done" &&
      project.isArchived !== true &&
      project.archivedFromTodayMe !== true
  );
  const completionSubjectKey = normalizeProjectCompletionSubject(text);
  const matchedProject = activeProjects.find((project) => {
    const titleKey = normalizeMemoryInput(project.title);
    const goalKey = normalizeMemoryInput(project.goal);
    return (
      isProjectTextMatch(normalizedText, titleKey) ||
      isProjectTextMatch(normalizedText, goalKey) ||
      isProjectTextMatch(completionSubjectKey, titleKey) ||
      isProjectTextMatch(completionSubjectKey, goalKey)
    );
  });

  if (!matchedProject) {
    return null;
  }

  return {
    route: "completed_project",
    title: matchedProject.title,
    originalText: text,
    normalizedText,
    confidence: 0.9,
    matchedProjectId: matchedProject.id,
    reason: "진행 중인 프로젝트 완료 의도",
  };
}

function normalizeProjectCompletionSubject(text: string) {
  return normalizeMemoryInput(
    text
      .replace(/전체\s*프로젝트|프로젝트/g, " ")
      .replace(/완료\s*처리해줘|완료했어|완료|끝냈어|끝냄|마쳤어|끝남|완성했어/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function isProjectTextMatch(sourceKey: string, projectKey: string) {
  if (!sourceKey || !projectKey || projectKey.length < 2) {
    return false;
  }
  return sourceKey.includes(projectKey) || projectKey.includes(sourceKey);
}

function findCompletedProjectActionRoute(
  text: string,
  projects: NoieProject[]
): NoieSaveRoutingResult | null {
  if (!isCompletedActionText(text)) {
    return null;
  }

  const normalizedText = normalizeMemoryInput(text);
  const activeProjects = projects.filter(
    (project) =>
      project.status !== "done" &&
      project.isArchived !== true &&
      project.archivedFromTodayMe !== true &&
      Boolean(project.nextAction?.trim())
  );
  const matchedProject = activeProjects.find((project) => {
    const actionKey = normalizeMemoryInput(project.nextAction ?? "");
    const compactActionKey = actionKey.replace(/하기$|테스트$/g, "").trim();
    return (
      actionKey.length > 0 &&
      (normalizedText.includes(actionKey) ||
        (compactActionKey.length > 1 && normalizedText.includes(compactActionKey)))
    );
  });

  if (!matchedProject) {
    return null;
  }

  return {
    route: "completed_action",
    title: matchedProject.nextAction?.trim() || makeCompletedActionTitle(text),
    originalText: text,
    normalizedText,
    confidence: 0.88,
    matchedProjectId: matchedProject.id,
    matchedNextAction: matchedProject.nextAction?.trim() ?? null,
    reason: "프로젝트 다음 행동 완료",
  };
}

function isCompletedActionText(text: string) {
  return (
    /끝냈어|완료했어|완성했어|다\s*했어|마쳤어|성공적으로\s*끝냈|통과했어|해냈어/.test(text) &&
    !/프로젝트/.test(text)
  );
}

function makeCompletedActionTitle(text: string) {
  const title = text
    .replace(/오늘|끝냈어|완료했어|완성했어|다\s*했어|마쳤어|성공적으로\s*끝냈어|통과했어|해냈어/g, "")
    .trim();
  return title || makeMemoryTitle(text);
}

function isDailyIdeaText(text: string) {
  return (
    /아이디어.*생겼|아이디어가\s*떠올|추천\s*기능\s*아이디어|새로운.*아이디어/.test(text) &&
    !/만들고\s*싶|되고\s*싶|목표|꿈|장기/.test(text)
  );
}

function applyRoutingFieldsToDailyTrace(
  item: DailyTraceItem,
  routingResult?: NoieSaveRoutingResult
): DailyTraceItem {
  if (!routingResult) {
    return item;
  }

  const originalText = routingResult.originalText || item.originalText || item.text || item.title;

  if (routingResult.route === "important_day_event") {
    return {
      ...item,
      type: "record",
      title: routingResult.title || item.title,
      memo: item.memo || "오늘의 중요한 사건",
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "important_note",
      saveTargets: ["daily_piece", "daily_trace"],
      importance: Math.max(item.importance ?? 0, 94),
      displayCategory: "오늘의 중요한 사건",
      category: "important_day_event",
      priorityType: "top_two",
    } as DailyTraceItem;
  }

  if (routingResult.route === "daily_idea") {
    return {
      ...item,
      type: "quote",
      title: routingResult.title || item.title,
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "idea",
      saveTargets: ["daily_piece", "daily_trace"],
      importance: Math.max(item.importance ?? 0, 72),
      displayCategory: "오늘의 아이디어",
    };
  }

  if (routingResult.route === "daily_trace") {
    const title = routingResult.title || item.title;
    return {
      ...item,
      type: "record",
      date: routingResult.scheduledDate ?? item.date,
      title,
      memo: item.memo || "하루의 흔적",
      sourceText: originalText,
      text: title,
      originalText,
      memoryType: "daily_context",
      saveTargets: ["daily_trace"],
      importance: Math.max(item.importance ?? 0, 70),
      displayCategory: "하루의 흔적",
    };
  }

  if (routingResult.route === "life_schedule_once" || routingResult.route === "life_schedule_repeat") {
    const dateKey = routingResult.scheduledDate ?? item.date ?? getLocalDateString(new Date());
    const sourceKey = normalizeMemoryInput(`${routingResult.route}:${routingResult.title}:${routingResult.displayUnit ?? ""}`);
    return {
      ...item,
      type: "todo",
      date: dateKey,
      title: routingResult.title || item.title,
      memo: routingResult.route === "life_schedule_repeat" ? "매일 반복 · 🔔 시간에 맞춰" : "🔔 시간에 맞춰 알려주기",
      time: routingResult.displayUnit ?? item.time,
      endTime: routingResult.endTime ?? undefined,
      sourceText: originalText,
      text: originalText,
      originalText,
      isDone: false,
      memoryType: "todo",
      saveTargets: ["daily_trace"],
      importance: Math.max(item.importance ?? 0, 70),
      displayCategory: routingResult.route === "life_schedule_repeat" ? "생활 반복 예정" : "생활 예정",
      sourceType: routingResult.route,
      sourceId: `${routingResult.route}:${dateKey}:${sourceKey}`,
      reminder: routingResult.reminder ?? "on_time",
      recurrence: routingResult.route === "life_schedule_repeat" ? routingResult.recurrence ?? "daily" : undefined,
      completedDates: {},
    } as DailyTraceItem;
  }

  if (routingResult.route === "life_action_record") {
    const dateKey = routingResult.scheduledDate ?? item.date ?? getLocalDateString(new Date());
    const sourceKey = normalizeMemoryInput(`${routingResult.title}:${routingResult.displayUnit ?? ""}`);
    return {
      ...item,
      type: "record",
      date: dateKey,
      title: routingResult.title || item.title,
      memo: item.memo || "직접 기록",
      time: routingResult.displayUnit ?? item.time,
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "daily_context",
      saveTargets: ["daily_trace"],
      importance: Math.max(item.importance ?? 0, 70),
      displayCategory: "직접 기록",
      sourceType: "life_action_record",
      sourceId: `life_action_record:${dateKey}:${sourceKey}`,
    } as DailyTraceItem;
  }

  if (routingResult.route === "completed_action") {
    const completedActionKey = normalizeMemoryInput(routingResult.title || originalText);
    const dateKey = item.date || getLocalDateString(new Date());
    return {
      ...item,
      type: "record",
      title: routingResult.title || item.title,
      memo: item.memo || "완료한 행동",
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "achievement",
      saveTargets: ["daily_piece", "daily_trace"],
      importance: Math.max(item.importance ?? 0, 84),
      displayCategory: "완료한 행동",
      category: "completed_action",
      sourceType: "completed_action",
      sourceId: `completed_action:${dateKey}:${completedActionKey}`,
    } as DailyTraceItem;
  }

  return item;
}

function findDuplicateDreamFragment(items: DailyTraceItem[], text: string) {
  const targetKey = normalizeDreamFragmentKey(text);
  const targetMemoryKey = normalizeMemoryInput(text);
  return getDreamFragments(items).find((item) => {
    const candidates = [
      item.originalText,
      item.text,
      item.sourceText,
      item.memo,
      item.title,
      getMemorySemanticKey(item),
    ].filter((value): value is string => Boolean(value));
    return candidates.some((candidate) => {
      const candidateKey = normalizeDreamFragmentKey(candidate);
      return candidateKey === targetKey || normalizeMemoryInput(candidate) === targetMemoryKey;
    });
  });
}

function isDuplicateDreamFragmentRoute(routingResult: NoieSaveRoutingResult, items: DailyTraceItem[]) {
  return Boolean(findDuplicateDreamFragment(items, routingResult.originalText));
}

function normalizeRoutineKey(title: string, repeatType?: string, targetValue?: number, unit?: string) {
  return `${normalizeMemoryInput(title)}|${repeatType ?? ""}|${targetValue ?? ""}|${unit ?? ""}`;
}

function normalizeRoutineTitleKey(title: string) {
  return stripTrailingKoreanParticles(title)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isDuplicateRoutineRoute(routingResult: NoieSaveRoutingResult, items: DailyTraceItem[]) {
  if (routingResult.route !== "routine_create") {
    return false;
  }
  const targetTitleKey = normalizeRoutineTitleKey(routingResult.title);
  return items.some((item) =>
    (item.routines ?? []).some((routine) =>
      isRoutineAvailableForTodayMe(routine) &&
      normalizeRoutineTitleKey(routine.title) === targetTitleKey
    )
  );
}

function isDuplicateLifeScheduleRoute(routingResult: NoieSaveRoutingResult, items: DailyTraceItem[]) {
  if (routingResult.route !== "life_schedule_repeat") {
    return false;
  }

  const targetTitle = normalizeMemoryInput(routingResult.title);
  const targetTime = routingResult.displayUnit ?? "";
  return items.some((item) => {
    const typedItem = item as DailyTraceItem & { sourceType?: string; recurrence?: string };
    return (
      typedItem.sourceType === "life_schedule_repeat" &&
      normalizeMemoryInput(item.title) === targetTitle &&
      item.time === targetTime &&
      typedItem.recurrence === (routingResult.recurrence ?? "daily")
    );
  });
}

function repairRecentDreamFragmentLinks(items: DailyTraceItem[], nowIso: string) {
  const now = new Date();
  let changed = false;
  const nextItems = items.map((item) => {
    if (!isDreamFragmentDayPiece(item) || !item.createdAt || !getMemoryInputText(item)) {
      return item;
    }
    const createdAt = new Date(item.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return item;
    }
    const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / 86400000);
    if (ageDays < 0 || ageDays > 2) {
      return item;
    }
    const saveTargets = item.saveTargets ?? [];
    const nextTargets = Array.from(new Set([...saveTargets, "dream_fragment", "daily_piece", "daily_trace"] as SaveDecision["saveTargets"]));
    if (
      saveTargets.includes("daily_piece") &&
      saveTargets.includes("daily_trace") &&
      item.importance &&
      item.importance >= 96
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      saveTargets: nextTargets,
      importance: Math.max(item.importance ?? 0, 96),
      updatedAt: nowIso,
    };
  });

  return changed ? nextItems : items;
}

function getPendingMemoryNotice(
  memoryPolicy: MemorySavePolicy,
  dreamPromptKind?: DreamSavePromptKind,
  routingResult?: NoieSaveRoutingResult
) {
  if (routingResult?.route === "routine_create") {
    return `${routingResult.title.replace(/하기$/, "")}를 오늘의 나에 담을까요?`;
  }

  if (routingResult?.route === "project_create") {
    return `${routingResult.title}를 프로젝트로 시작할까요?`;
  }

  if (routingResult?.route === "routine_record") {
    const amountText = formatRoutineTarget(
      routingResult.displayValue ?? routingResult.actualValue ?? 0,
      routingResult.displayUnit ?? routingResult.actualUnit ?? routingResult.unit
    );
    if (routingResult.isAdditiveRecord) {
      return `기존 수행량에 ${amountText}을 더해 기록할까요?`;
    }
    return `오늘의 불씨로 완료할까요?\n\n${routingResult.title}\n실제 수행량 · ${amountText}`;
  }

  if (routingResult?.route === "routine_adjustment_intent") {
    return routingResult.targetValue
      ? `현재 ${routingResult.title} 목표는 ${formatRoutineTarget(routingResult.targetValue, routingResult.unit)}이에요.\n얼마로 바꾸고 싶나요?`
      : `${routingResult.title} 목표를 얼마로 바꾸고 싶나요?`;
  }

  if (routingResult?.route === "routine_adjustment_confirm") {
    return `${routingResult.title} 목표 시간을 바꿀까요?\n\n기존 목표\n→ ${formatRoutineTarget(routingResult.targetValue ?? 0, routingResult.unit)}`;
  }

  if (routingResult?.route === "life_schedule_date_request") {
    return `언제 ${routingResult.unit ?? ""}에 ${routingResult.title.replace(/기$/, "")}까요?`;
  }

  if (routingResult?.route === "life_schedule_once") {
    const timeText = routingResult.endDisplayUnit
      ? `${routingResult.unit ?? ""}–${stripKoreanTimePeriodIfSame(routingResult.endDisplayUnit, routingResult.unit)}`
      : routingResult.unit ?? "";
    return `${formatScheduleRouteDateLabel(routingResult)}\n${timeText}\n\n${routingResult.title}`;
  }

  if (routingResult?.route === "life_schedule_repeat") {
    return `하루의 흔적 반복에 남길까요?\n\n매일 ${routingResult.unit ?? ""}\n${routingResult.title}`;
  }

  if (routingResult?.route === "life_schedule_reminder_update") {
    return `${formatScheduleTitleForSentence(routingResult.title)} 일정의 알림을 바꿀까요?\n\n${routingResult.previousTitle ?? "시간에 맞춰"}\n→ ${routingResult.unit ?? ""}`;
  }

  if (routingResult?.route === "life_schedule_cancel") {
    return `${formatRelativeScheduleLabel(routingResult.scheduledDate)} ${routingResult.unit ?? ""} ${formatScheduleTitleForSentence(routingResult.title)} 일정을 취소할까요?`;
  }

  if (routingResult?.route === "life_action_record") {
    return `✓ ${routingResult.unit ?? ""}`;
  }

  if (routingResult?.route === "dream_fragment_rename") {
    return `꿈의 파편 이름을 바꿀까요?\n\n${routingResult.previousTitle ?? routingResult.title}\n→ ${routingResult.nextTitle ?? ""}`;
  }

  if (routingResult?.route === "dream_fragment_complete") {
    return `‘${routingResult.title}’를 완료할까요?`;
  }

  if (routingResult?.route === "dream_fragment_next_action_update") {
    return `다음 할 일을 바꿀까요?\n\n${routingResult.title}\n\n기존 다음 할 일\n→ ${routingResult.nextAction ?? ""}`;
  }

  if (routingResult?.route === "important_day_event") {
    return "오늘의 흔적으로 남길까요?";
  }

  if (routingResult?.route === "daily_trace") {
    const todayKey = getLocalDateString(new Date());
    return routingResult.scheduledDate && routingResult.scheduledDate === shiftTraceDateKey(todayKey, -1)
      ? "어제의 흔적에 남길까요?"
      : "오늘의 흔적에 남길까요?";
  }

  if (routingResult?.route === "daily_long_record_create") {
    const todayKey = getLocalDateString(new Date());
    const dateTitle = getDailyLongRecordTitle(routingResult.scheduledDate ?? todayKey, todayKey);
    return `${dateTitle}으로 남길까요?\n\n${routingResult.longRecordBody ?? ""}`;
  }

  if (routingResult?.route === "daily_long_record_title_update") {
    return `오늘의 기록 제목을 바꿀까요?\n\n${routingResult.longRecordTitle ?? ""}`;
  }

  if (routingResult?.route === "daily_long_record_append") {
    return `기록에 덧붙일까요?\n\n${routingResult.longRecordBody ?? ""}`;
  }

  if (routingResult?.route === "daily_trace_update") {
    return `방금 남긴 기록을 수정할까요?\n\n${routingResult.previousTitle ?? ""}\n→ ${routingResult.nextTitle ?? ""}`;
  }

  if (routingResult?.route === "daily_idea") {
    return "새로운 아이디어를 오늘의 흔적으로 남길까요?";
  }

  if (routingResult?.route === "completed_project") {
    return `${routingResult.title} 프로젝트를 완료할까요?`;
  }

  if (routingResult?.route === "completed_action") {
    return `${routingResult.title}을 완료한 행동으로 남길까요?`;
  }

  if (routingResult?.route === "dream_torch" || routingResult?.route === "dream_fragment") {
    return "이 꿈을 어디에 남길까요?";
  }

  if (isDreamOrGoalType(memoryPolicy.type)) {
    return "이 꿈을 어디에 남길까요?";
  }

  if (memoryPolicy.type === "relationship") {
    return "관계의 조각으로 저장할까요?";
  }

  if (memoryPolicy.type === "achievement") {
    return "이 성과를 오늘의 기록으로 남길까요?";
  }

  if (isDailyTraceConfirmType(memoryPolicy.type)) {
    return "하루의 흔적에 저장할까요?";
  }

  if (memoryPolicy.type === "sensitive_event") {
    return "최근 사건을 저장할까요?";
  }

  return "";
}

function formatScheduleRouteDateLabel(routingResult: NoieSaveRoutingResult) {
  if (/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/.test(routingResult.originalText)) {
    const match = routingResult.originalText.match(/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/);
    const weekday = match?.[1] ?? "";
    return `다음 주 ${weekday.length === 1 ? `${weekday}요일` : weekday}`;
  }
  return formatRelativeScheduleLabel(routingResult.scheduledDate);
}

function formatRelativeScheduleLabel(dateKey?: string | null) {
  const todayKey = getLocalDateString(new Date());
  if (dateKey === todayKey) {
    return "오늘";
  }
  if (dateKey === shiftTraceDateKey(todayKey, 1)) {
    return "내일";
  }
  if (dateKey === shiftTraceDateKey(todayKey, 2)) {
    return "모레";
  }
  return dateKey ?? "";
}

function stripKoreanTimePeriodIfSame(value?: string | null, previous?: string | null) {
  if (!value || !previous) {
    return value ?? "";
  }
  const previousPeriod = previous.match(/^(오전|오후)/)?.[1];
  if (previousPeriod && value.startsWith(previousPeriod)) {
    return value.replace(/^(오전|오후)\s*/, "");
  }
  return value;
}

function formatScheduleTitleForSentence(title: string) {
  if (title.endsWith(" 가기")) {
    return title.slice(0, -3);
  }
  if (title.endsWith("기")) {
    return title.slice(0, -1);
  }
  return title;
}

function getConfirmButtonLabel(
  memoryType: MemorySavePolicyType | undefined,
  candidateType: DailyTraceItemType,
  routingResult?: NoieSaveRoutingResult
) {
  if (routingResult?.route === "important_day_event") {
    return "남기기";
  }

  if (routingResult?.route === "daily_trace") {
    return "남기기";
  }

  if (routingResult?.route === "daily_long_record_create" || routingResult?.route === "daily_long_record_append") {
    return "남기기";
  }

  if (routingResult?.route === "daily_long_record_title_update") {
    return "바꾸기";
  }

  if (routingResult?.route === "daily_trace_update") {
    return "수정하기";
  }

  if (routingResult?.route === "life_schedule_repeat") {
    return "남기기";
  }

  if (routingResult?.route === "life_schedule_once") {
    return "저장하기";
  }

  if (routingResult?.route === "life_schedule_reminder_update") {
    return "바꾸기";
  }

  if (routingResult?.route === "life_action_record") {
    return "기록하기";
  }

  if (routingResult?.route === "routine_record") {
    return "완료";
  }

  if (routingResult?.route === "daily_idea") {
    return "남기기";
  }

  if (routingResult?.route === "completed_action") {
    return "완료한 행동으로 남기기";
  }

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

function normalizeDreamFragmentKey(text: string) {
  return normalizeMemoryInput(text)
    .replace(/노이에/g, "noie")
    .replace(/noie를/g, "noie")
    .replace(/noie을/g, "noie")
    .replace(/noie/g, "noie")
    .replace(/완성하고\s*싶/g, "완성")
    .replace(/완성하고싶/g, "완성")
    .replace(/만들고\s*싶/g, "만들기")
    .replace(/되고\s*싶/g, "되기")
    .replace(/\s+/g, "")
    .trim();
}

function hasDuplicateDreamFragment(items: DailyTraceItem[], text: string) {
  const targetKey = normalizeDreamFragmentKey(text);
  if (!targetKey) {
    return false;
  }

  return getDreamFragments(items).some((item) => {
    const itemText = getMemoryInputText(item);
    return normalizeDreamFragmentKey(itemText) === targetKey;
  });
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
  const torchDiff = Number(Boolean(right.pinnedAsDreamTorch)) - Number(Boolean(left.pinnedAsDreamTorch));

  if (torchDiff > 0) {
    return right;
  }

  if (torchDiff < 0) {
    return left;
  }

  const roleDiff = getDreamRolePriority(right) - getDreamRolePriority(left);
  if (roleDiff > 0) {
    return right;
  }

  if (roleDiff < 0) {
    return left;
  }

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
    return right;
  }

  if (createdAtDiff > 0) {
    return left;
  }

  return getMemoryNaturalScore(right) > getMemoryNaturalScore(left)
    ? right
    : left;
}

function getDreamRolePriority(memory: NoieMemory) {
  if (memory.pinnedAsDreamTorch || memory.dreamRole === "torch") {
    return 3;
  }

  if (memory.dreamRole === "fragment" || memory.saveTargets?.includes("dream_fragment")) {
    return 2;
  }

  return 0;
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

      const memoryPolicy = getMemoryPolicy(item);
      return (
        item.pinnedAsDreamTorch === true ||
        item.saveTargets?.includes("dream_torch") ||
        memoryPolicy.saveTargets?.includes("dream_torch") ||
        isDreamOrGoalType(memoryPolicy.type)
      );
    })
    .sort(sortDreamItemsByImportance);
}

function getDreamFragments(items: DailyTraceItem[]) {
  const forbiddenTypes: MemorySavePolicyType[] = [
    "sensitive_event",
    "todo",
    "task",
    "schedule",
    "relationship",
    "achievement",
    "daily_context",
    "none",
  ];
  const fragmentItems = items.filter((item) => {
    if (isHiddenFromDream(item)) {
      return false;
    }

    const memoryPolicy = getMemoryPolicy(item);
    if (forbiddenTypes.includes(memoryPolicy.type)) {
      return false;
    }

    const isFragmentTarget =
      item.saveTargets?.includes("dream_fragment") ||
      memoryPolicy.saveTargets?.includes("dream_fragment");
    const isFragmentRole =
      item.dreamRole === "fragment" || memoryPolicy.dreamRole === "fragment";

    return memoryPolicy.type === "project" || isFragmentTarget || isFragmentRole;
  });

  return dedupeMemories(fragmentItems).sort(sortDreamItemsByImportance);
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
    const targetDateKey = getDailyPieceEventDateKey(item);
    if (!targetDateKey) {
      return;
    }

    const targetGroup = piecesByDate.get(targetDateKey);
    if (!targetGroup) {
      return;
    }

    const memoryPolicy = getMemoryPolicy(item);

    if (!shouldSaveToDailyPieces(memoryPolicy) && !isDreamDayPiece(item)) {
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
  const leftImportantEvent = left.memoryPolicy.type === "important_note";
  const rightImportantEvent = right.memoryPolicy.type === "important_note";
  if (leftImportantEvent !== rightImportantEvent) {
    return leftImportantEvent ? -1 : 1;
  }

  const importanceDiff =
    right.memoryPolicy.importance - left.memoryPolicy.importance;
  if (importanceDiff !== 0) {
    return importanceDiff;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

function getDailyPieceEventDateKey(item: DailyTraceItem) {
  const timestamp = isDreamDayPiece(item)
    ? item.progressUpdatedAt || item.updatedAt || item.createdAt
    : item.createdAt;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return getLocalDateString(date);
}

function isDreamDayPiece(item: DailyPiece | DailyTraceItem) {
  return isDreamTorchDayPiece(item) || isDreamFragmentDayPiece(item);
}

function isDreamTorchDayPiece(item: DailyPiece | DailyTraceItem) {
  const memoryPolicy = getMemoryPolicy(item);
  return (
    item.pinnedAsDreamTorch === true ||
    item.dreamRole === "torch" ||
    item.saveTargets?.includes("dream_torch") ||
    memoryPolicy.saveTargets?.includes("dream_torch")
  );
}

function isDreamFragmentDayPiece(item: DailyPiece | DailyTraceItem) {
  const memoryPolicy = getMemoryPolicy(item);
  return (
    item.dreamRole === "fragment" ||
    item.saveTargets?.includes("dream_fragment") ||
    memoryPolicy.saveTargets?.includes("dream_fragment") ||
    Boolean((item as DailyTraceItem).linkedProjectId && item.memoryType === "project")
  );
}

function isImportantDayEventPiece(item: DailyPiece | DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { category?: string; priorityType?: string };
  return (
    typedItem.category === "important_day_event" ||
    typedItem.priorityType === "top_two" ||
    getMemoryPolicy(item).type === "important_note"
  );
}

function selectDailyPieceTop3(pieces: DailyPiece[]) {
  return selectTopDayPiecesForDate(dedupeDayPiecesForDisplay(pieces));
}

function selectTopDayPiecesForDate(pieces: DailyPiece[]) {
  const sortedPieces = [...pieces].sort(sortDailyPiecesByImportance);
  const dreamPieces = sortedPieces.filter(isDreamDayPiece);
  const normalPieces = sortedPieces.filter(
    (piece) =>
      !isDreamDayPiece(piece) &&
      isDailyLifeActionOrEventPiece(piece)
  );
  const selectedPieces: DailyPiece[] = [];

  for (const dreamPiece of dreamPieces) {
    if (selectedPieces.length >= 2) {
      break;
    }
    selectedPieces.push(dreamPiece);
  }

  if (normalPieces[0] && selectedPieces.length < 3) {
    selectedPieces.push(normalPieces[0]);
  }

  for (const piece of normalPieces.slice(1)) {
    if (selectedPieces.length >= 3) {
      break;
    }
    if (!selectedPieces.some((selected) => selected.id === piece.id)) {
      selectedPieces.push(piece);
    }
  }

  if (selectedPieces.length < 3) {
    const selectedIds = new Set(selectedPieces.map((piece) => piece.id));
    const fallbackPieces = sortedPieces.filter(
      (piece) => !selectedIds.has(piece.id) && !isDreamDayPiece(piece)
    );

    selectedPieces.push(...fallbackPieces.slice(0, 3 - selectedPieces.length));
  }

  return selectedPieces.slice(0, 3);
}

function isDailyLifeActionOrEventPiece(piece: DailyPiece) {
  const type = piece.memoryPolicy.type;
  return (
    type === "achievement" ||
    type === "important_note" ||
    type === "relationship" ||
    type === "idea" ||
    type === "note" ||
    type === "daily_context" ||
    type === "sensitive_event" ||
    isImportantDayEventPiece(piece)
  );
}

function dedupeDayPiecesForDisplay(pieces: DailyPiece[]) {
  const pieceMap = new Map<string, DailyPiece>();

  pieces.forEach((piece) => {
    const key = getDayPieceDisplayKey(piece);
    if (!key) {
      pieceMap.set(piece.id, piece);
      return;
    }
    const existingPiece = pieceMap.get(key);
    if (!existingPiece || compareDayPieceForDisplay(piece, existingPiece) < 0) {
      pieceMap.set(key, piece);
    }
  });

  return Array.from(pieceMap.values());
}

function getDayPieceDisplayKey(piece: DailyPiece) {
  const typedPiece = piece as DailyTraceItem & {
    sourceId?: string;
    sourceType?: string;
    routineId?: string;
    projectId?: string;
    action?: string;
    milestoneId?: string;
  };
  if (typedPiece.sourceId) {
    return `source:${typedPiece.sourceId}`;
  }
  if (typedPiece.routineId) {
    return `routine:${typedPiece.routineId}:${piece.date}`;
  }
  if (typedPiece.projectId && (typedPiece.action || typedPiece.milestoneId)) {
    return `project:${typedPiece.projectId}:${normalizeDayPieceText(typedPiece.action ?? typedPiece.milestoneId ?? "")}`;
  }
  const textKey = normalizeDayPieceText(getDayPieceText(piece));
  if (!textKey) {
    return "";
  }
  if (isDreamFragmentDayPiece(piece)) {
    return `dream:${normalizeDreamFragmentKey(textKey)}`;
  }
  if (isDreamTorchDayPiece(piece)) {
    return `dream_torch:${normalizeDreamFragmentKey(textKey)}`;
  }
  return `${piece.date}:${piece.memoryPolicy.type}:${textKey}`;
}

function getDayPieceText(piece: DailyPiece) {
  if (isDreamTorchDayPiece(piece)) {
    return summarizeDreamTorchDailyPiece(piece);
  }
  if (isDreamFragmentDayPiece(piece)) {
    return summarizeDreamFragmentDailyPiece(piece);
  }
  return getMeaningfulDailyPieceText(piece) || "";
}

function summarizeDreamTorchDailyPiece(piece: DailyPiece) {
  return summarizeDreamSubject(piece);
}

function summarizeDreamFragmentDailyPiece(piece: DailyPiece) {
  return summarizeDreamSubject(piece);
}

function summarizeDreamSubject(item: DailyTraceItem) {
  const rawText = getMeaningfulDailyPieceText(item) || item.title;
  return rawText
    .replace(/^나는\s*/g, "")
    .replace(/^내\s*꿈은\s*/g, "")
    .replace(/^내\s*목표는\s*/g, "")
    .replace(/꿈의\s*파편으로\s*남김$/g, "")
    .replace(/꿈을\s*횃불로\s*정함$/g, "")
    .replace(/장기\s*목표로\s*저장$/g, "")
    .replace(/완료한\s*행동$/g, "")
    .replace(/입니다$/g, "")
    .replace(/이에요$/g, "")
    .replace(/예요$/g, "")
    .replace(/따고\s*싶어$/g, "따기")
    .replace(/취득하고\s*싶어$/g, "취득하기")
    .replace(/하고\s*싶어$/g, "하기")
    .replace(/만들고\s*싶어$/g, "만들기")
    .replace(/되고\s*싶어$/g, "되기")
    .replace(/되는\s*게\s*꿈이야$/g, "되기")
    .replace(/되는\s*게\s*목표야$/g, "되기")
    .replace(/가\s*되기$/g, "되기")
    .replace(/\s+/g, " ")
    .trim();
}

function getMeaningfulDailyPieceText(item: DailyTraceItem & { normalizedText?: string; content?: string }) {
  const candidates = [
    item.title,
    item.originalText,
    item.text,
    item.sourceText,
    item.content,
    item.memo,
    item.normalizedText,
  ];
  const selected = candidates.find((value) => isMeaningfulDailyPieceDisplayText(value));
  if (!selected) {
    return "";
  }
  return cleanDailyPieceDisplayText(selected);
}

function isMeaningfulDailyPieceDisplayText(value?: string | null) {
  if (!value) {
    return false;
  }
  const normalizedValue = normalizeDayPieceText(value);
  if (!normalizedValue) {
    return false;
  }
  return !isGenericDailyPieceLabel(normalizedValue);
}

function isGenericDailyPieceLabel(normalizedText: string) {
  return [
    "완료한 행동",
    "오늘의 중요한 사건",
    "중요한 사건",
    "장기 목표",
    "목표",
    "아이디어",
    "프로젝트",
    "프로젝트 완료",
    "반복 목표",
    "오늘의 기록",
    "행동 완료",
    "기록",
  ].some((label) => normalizeDayPieceText(label) === normalizedText);
}

function cleanDailyPieceDisplayText(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/을\s*했어$/, "을 진행함")
    .replace(/를\s*했어$/, "를 진행함")
    .replace(/했어$/, "진행함")
    .replace(/을\s*끝냈어$/, " 완료")
    .replace(/를\s*끝냈어$/, " 완료")
    .replace(/끝냈어$/, "완료")
    .replace(/완료했어$/, "완료");
}

function normalizeDayPieceText(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .toLowerCase();
}

function compareDayPieceForDisplay(left: DailyPiece, right: DailyPiece) {
  return sortDailyPiecesByImportance(left, right);
}

function removeDuplicateDailyPieces(pieces: DailyPiece[]) {
  const pieceMap = new Map(pieces.map((piece) => [piece.id, piece]));

  const dedupedByMemory = dedupeMemories(pieces).map((memory) => {
    const existingPiece = pieceMap.get(memory.id);
    if (existingPiece) {
      return existingPiece;
    }

    return {
      ...memory,
      memoryPolicy: getMemoryPolicy(memory),
    };
  });

  return dedupeDayPiecesForDisplay(dedupedByMemory)
    .filter((piece) => Boolean(getDayPieceText(piece)));
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
  saveDecisionToggle: {
    alignSelf: "flex-start",
    borderColor: "#343434",
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  saveDecisionToggleText: {
    color: "#b8b8b8",
    fontSize: 12,
    fontWeight: "800",
  },
  saveDecisionCard: {
    backgroundColor: "#101010",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 10,
  },
  saveDecisionTitle: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
  },
  saveDecisionRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 2,
  },
  saveDecisionKey: {
    color: "#8f8f8f",
    flexShrink: 0,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    width: 112,
  },
  saveDecisionValue: {
    color: "#cbd5e1",
    flex: 1,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    lineHeight: 16,
  },
  saveDecisionEmpty: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 17,
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
  traceConfirmButtonDisabled: { opacity: 0.45 },
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
  projectOriginBox: {
    alignSelf: "flex-start",
    backgroundColor: "#151515",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  projectOriginText: {
    color: "#aeb4c0",
    fontSize: 12,
    lineHeight: 17,
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
  flowEmptyExampleText: {
    color: "#8f8f8f",
    fontSize: 12,
    lineHeight: 19,
    marginTop: 10,
    textAlign: "center",
  },
  todayMeHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  todayMeHeaderText: { flex: 1, minWidth: 180 },
  todayMeAddButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  todayMeAddButtonText: {
    color: "#f2f4f8",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 26,
  },
  todayMeTypeLabel: {
    color: "#8f8f8f",
    fontSize: 11,
    fontWeight: "900",
  },
  todayMeActionRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  todayMeTinyButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  todayMeTinyButtonText: {
    color: "#f2f4f8",
    fontSize: 18,
    fontWeight: "900",
  },
  todayMeTimeAdjustRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    paddingVertical: 10,
  },
  todayMeArrowButton: {
    alignItems: "center",
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  todayMeArrowButtonText: {
    color: "#d1d5db",
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 30,
  },
  todayMeTargetTimeText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    minWidth: 92,
    textAlign: "center",
  },
  todayMeRecommendationCard: {
    backgroundColor: "#101820",
    borderColor: "#26415f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 14,
    padding: 12,
  },  todayMeSubtitle: {
    color: "#aeb4c0",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  todayMeGroup: {
    gap: 8,
    marginTop: 14,
  },
  todayMeGroupTitle: {
    color: "#e5e7eb",
    fontSize: 13,
    fontWeight: "900",
  },
  todayMeItem: {
    backgroundColor: "#151515",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  todayMeCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  todayMeItemMain: {
    gap: 4,
  },
  todayMeMoreButton: {
    alignItems: "center",
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    height: 28,
    justifyContent: "center",
    width: 32,
  },
  todayMeMoreButtonText: {
    color: "#d1d5db",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  todayMeTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  todayMeMeta: {
    color: "#aeb4c0",
    fontSize: 12,
    lineHeight: 18,
  },
  todayMeStatus: {
    color: "#9cc7ff",
    fontSize: 12,
    fontWeight: "900",
  },
  todayMeButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#f2f4f8",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 12,
  },
  todayMeButtonDone: {
    opacity: 0.55,
  },
  todayMeButtonText: {
    color: "#050505",
    fontSize: 12,
    fontWeight: "900",
  },
  todayMeSecondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 11,
  },
  todayMeSecondaryButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "800",
  },
  todayMeDeleteButton: {
    alignItems: "center",
    borderColor: "#4b2a2a",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: "center",
    minHeight: 28,
    paddingHorizontal: 10,
  },
  todayMeDeleteButtonText: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "900",
  },
  todayMeDeleteConfirmBox: {
    backgroundColor: "#1b1111",
    borderColor: "#4b2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  todayMeDeleteConfirmText: {
    color: "#f5d0d0",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  todayMeDeleteConfirmActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  todayMeDeleteConfirmButton: {
    alignItems: "center",
    backgroundColor: "#ef4444",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  todayMeDeleteConfirmButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  todayMeCancelConfirmButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  todayMeCancelConfirmButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
  },
  todayMeDetailBox: {
    backgroundColor: "#0b0b0b",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  todayMeInput: {
    backgroundColor: "#171717",
    borderColor: "#333333",
    borderRadius: 8,
    borderWidth: 1,
    color: "#ffffff",
    fontSize: 14,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  todayMeEmptyLine: {
    color: "#8f8f8f",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  todayMeFeedback: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 14,
  },  dreamProjectSummaryCard: {
    backgroundColor: "#111111",
    borderColor: "#2f2f2f",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  dreamProjectSummaryHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  dreamProjectSummaryTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
  dreamProjectSummaryPercent: {
    color: "#e5e7eb",
    fontSize: 22,
    fontWeight: "900",
  },
  dreamProjectSummaryTrack: {
    backgroundColor: "#242424",
    borderRadius: 999,
    height: 9,
    overflow: "hidden",
  },
  dreamProjectSummaryFill: {
    backgroundColor: "#34d399",
    borderRadius: 999,
    height: 9,
  },
  dreamProjectSummaryNext: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 8,
  },
  consistencyStatusRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 4,
    marginTop: 8,
  },
  consistencyStatusSymbol: {
    color: "#d1d5db",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22,
    textAlign: "center",
    width: 24,
  },
  consistencyStatusSymbolComplete: {
    fontSize: 18,
  },
  consistencyWeekdayRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 4,
    marginTop: 2,
  },
  consistencyWeekdayText: {
    color: "#8f8f8f",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 15,
    textAlign: "center",
    width: 24,
  },
  dreamProjectSummaryNotice: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 6,
  },
  dreamProgressDetailsBox: {
    backgroundColor: "#0b0b0b",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginTop: 10,
    padding: 10,
  },  dreamProjectSummaryStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
  dreamProjectSummaryStat: {
    color: "#aeb4c0",
    fontSize: 12,
    fontWeight: "800",
  },
  goalDurationButtonRow: {
    flexDirection: "row",
    gap: 8,
  },
  goalDurationButton: {
    alignItems: "center",
    backgroundColor: "#151515",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  goalDurationButtonSelected: {
    backgroundColor: "#e5e7eb",
    borderColor: "#f9fafb",
  },
  goalDurationButtonText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "900",
  },
  goalDurationButtonTextSelected: {
    color: "#111111",
  },
  dreamTorchSimplePanel: {
    gap: 16,
  },
  dreamTorchGoalRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  dreamTorchGoalText: {
    color: "#f8fafc",
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 26,
  },
  dreamTorchDdayText: {
    color: "#fbbf24",
    flexShrink: 0,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 24,
  },
  dreamTorchSection: {
    gap: 10,
  },
  dreamTorchSectionTitle: {
    color: "#e5e7eb",
    fontSize: 14,
    fontWeight: "900",
  },
  dreamTorchFireHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  dreamTorchCountText: {
    color: "#aeb4c0",
    flexShrink: 0,
    fontSize: 13,
    fontWeight: "900",
  },
  dreamTorchRoutineList: {
    borderTopColor: "#2a2a2a",
    borderTopWidth: 1,
  },
  dreamTorchRoutineRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    paddingVertical: 12,
  },
  dreamTorchRoutineIconBox: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    width: 22,
  },
  dreamTorchRoutineIcon: {
    color: "#fbbf24",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 20,
  },
  dreamTorchRoutineTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  dreamTorchRoutineTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  dreamTorchRoutineMeta: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 2,
  },
  dreamTorchCompleteButton: {
    borderColor: "#4a5568",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dreamTorchFireActionRow: {
    flexDirection: "row",
    flexShrink: 0,
    gap: 6,
  },
  dreamTorchCompleteButtonText: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "900",
  },
  dreamTorchCancelButton: {
    borderColor: "#3a3a3a",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dreamTorchCancelButtonText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "900",
  },
  dreamTorchFireButtonDisabled: {
    opacity: 0.45,
  },
  dreamTorchRoutineDivider: {
    backgroundColor: "#2a2a2a",
    height: 1,
    marginLeft: 32,
  },
  dreamTorchEmptyText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  dreamPlanBox: {
    backgroundColor: "#141414",
    borderColor: "#2d2d2d",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    marginTop: 12,
    padding: 12,
  },
  dreamPlanTitle: { color: "#ffffff", fontSize: 15, fontWeight: "900" },
  dreamPlanSubtitle: { color: "#e5e7eb", fontSize: 13, fontWeight: "900" },
  dreamPlanHint: { color: "#aeb4c0", fontSize: 12, lineHeight: 18 },
  dreamPlanWarning: { color: "#fbbf24", fontSize: 12, fontWeight: "800", lineHeight: 18 },
  dreamProgressGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dreamProgressStat: {
    backgroundColor: "#0b0b0b",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 112,
    padding: 9,
  },
  dreamProgressStatLabel: { color: "#8f8f8f", fontSize: 11, fontWeight: "800" },
  dreamProgressStatValue: { color: "#f2f4f8", fontSize: 17, fontWeight: "900", marginTop: 4 },
  dreamRoutineList: { gap: 8 },
  dreamRoutineRow: {
    backgroundColor: "#101010",
    borderColor: "#292929",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  dreamRoutineTitle: { color: "#f2f4f8", fontSize: 13, fontWeight: "900" },
  dreamRoutineActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  dreamRoutineButton: {
    borderColor: "#3a3a3a",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dreamRoutineButtonText: { color: "#d1d5db", fontSize: 12, fontWeight: "900" },
  dreamPlanEditor: { gap: 8, marginTop: 4 },
  dreamPlanInput: {
    backgroundColor: "#0a0a0a",
    borderColor: "#333333",
    borderRadius: 8,
    borderWidth: 1,
    color: "#ffffff",
    fontSize: 13,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dreamPlanTextArea: { minHeight: 82, textAlignVertical: "top" },  dreamPieceDate: {
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
  dreamPieceStatusText: {
    color: "#aeb4c0",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 6,
  },
  dreamPieceMoreMenu: {
    backgroundColor: "#151515",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginTop: 8,
    padding: 8,
  },
  dreamPieceMoreMenuItem: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  dreamPieceMoreMenuText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "800",
  },
  dreamPieceDeleteConfirmBox: {
    backgroundColor: "#1b1111",
    borderColor: "#4b2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  dreamPieceDeleteConfirmText: {
    color: "#f5d0d0",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  dreamPieceCompleteConfirmBox: {
    backgroundColor: "#071b12",
    borderColor: "#1f7a4d",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  dreamPieceCompleteConfirmText: {
    color: "#bbf7d0",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  dreamPieceCompleteButton: {
    alignItems: "center",
    backgroundColor: "#16a34a",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  dreamPieceCompleteButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  dreamPieceDeleteButton: {
    alignItems: "center",
    backgroundColor: "#ef4444",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  dreamPieceDeleteButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  linkedProjectBox: {
    backgroundColor: "#151515",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 12,
    padding: 10,
  },
  linkedProjectSectionTitle: {
    color: "#f2f4f8",
    fontSize: 12,
    fontWeight: "900",
  },
  linkedProjectList: {
    gap: 8,
  },
  linkedProjectItem: {
    backgroundColor: "#0d0d0d",
    borderColor: "#242424",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  linkedProjectTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 19,
  },
  linkedProjectMeta: {
    color: "#aeb4c0",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  linkedProjectStatus: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "900",
  },
  unlinkedProjectFoldBox: {
    borderColor: "#262626",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 10,
  },
  unlinkedProjectFoldRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  unlinkedProjectFoldText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "800",
  },
  unlinkedProjectFoldAction: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
  },
  unlinkedProjectList: {
    gap: 6,
    marginTop: 8,
  },
  unlinkedProjectRow: {
    paddingVertical: 5,
  },
  unlinkedProjectTitle: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
  },
  completedDreamFragmentsBox: {
    borderColor: "#262626",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 10,
  },
  completedDreamFragmentsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  completedDreamFragmentsTitle: {
    color: "#f2f4f8",
    fontSize: 13,
    fontWeight: "900",
  },
  completedDreamFragmentsToggle: {
    color: "#d1d5db",
    fontSize: 14,
    fontWeight: "900",
  },
  completedDreamFragmentsList: {
    gap: 10,
    marginTop: 12,
  },
  completedDreamFragmentItem: {
    gap: 3,
  },
  completedDreamFragmentTitle: {
    color: "#f2f4f8",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 19,
  },
  completedDreamFragmentMeta: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    paddingLeft: 18,
  },
  dreamFragmentInfoBox: {
    backgroundColor: "#161616",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 10,
    gap: 4,
  },
  dreamFragmentProgress: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "900",
  },
  dreamFragmentJudgement: {
    color: "#aeb4c0",
    fontSize: 12,
    lineHeight: 18,
  },
  dreamFragmentNotice: {
    color: "#9cc7ff",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  dreamEvidenceCard: {
    backgroundColor: "#141414",
    borderColor: "#2f2f2f",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 10,
    gap: 6,
  },
  dreamEvidenceTitle: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 2,
  },
  dreamEvidenceRow: {
    flexDirection: "row",
    gap: 10,
  },
  dreamEvidenceKey: {
    color: "#8b8b8b",
    flexBasis: 110,
    fontSize: 11,
    fontWeight: "800",
  },
  dreamEvidenceValue: {
    color: "#d1d5db",
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  resumeMaterialCard: {
    backgroundColor: "#151515",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 10,
    gap: 8,
  },
  resumeMaterialTitle: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "900",
  },
  resumeMaterialSection: {
    gap: 2,
  },
  resumeMaterialSectionTitle: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "900",
  },
  resumeMaterialText: {
    color: "#d7d7d7",
    fontSize: 12,
    lineHeight: 18,
  },
  traceHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  traceSurface: {
    gap: 24,
  },
  traceWeekHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  traceMonthToggle: {
    alignItems: "center",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    marginHorizontal: 12,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  traceConstellation: {
    marginBottom: 2,
    minHeight: 62,
  },
  traceWeekDateRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  traceWeekDayButton: {
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  traceWeekDateText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
  },
  traceWeekDateTextToday: {
    color: "#f2f4f8",
  },
  traceWeekDateTextSelected: {
    color: "#ffffff",
    fontWeight: "900",
  },
  traceStarRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  traceStarSlot: {
    alignItems: "center",
    minHeight: 42,
    width: 30,
  },
  traceStarButton: {
    alignItems: "center",
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  traceStarSymbol: {
    color: "#d1d5db",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24,
    textAlign: "center",
  },
  traceStarSymbolSelected: {
    color: "#ffffff",
    fontSize: 20,
  },
  traceStarSymbolToday: {
    color: "#f2f4f8",
  },
  traceStarLine: {
    backgroundColor: "#2b2b2b",
    flex: 1,
    height: 1,
    marginBottom: 14,
  },
  traceTodayLabel: {
    color: "#8f8f8f",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
  },
  traceMonthPanel: {
    backgroundColor: "#0d0d0d",
    borderColor: "#1f1f1f",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: -8,
    marginBottom: 2,
    padding: 10,
  },
  calendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  calendarNavButton: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
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
    backgroundColor: "transparent",
    paddingVertical: 2,
  },
  traceDateTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 6,
  },
  traceDetailHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    marginBottom: 18,
  },
  traceHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 6,
  },
  traceTodayButton: {
    borderColor: "#303030",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  traceTodayButtonText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "900",
  },
  traceAddButton: {
    borderColor: "#303030",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  traceAddButtonText: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "900",
  },
  traceAddPanel: {
    backgroundColor: "#111111",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    marginBottom: 14,
    padding: 10,
  },
  traceAddPanelTitle: {
    color: "#f2f4f8",
    fontSize: 13,
    fontWeight: "900",
  },
  traceAddModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  traceAddModeButton: {
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  traceAddModeButtonActive: {
    backgroundColor: "#f2f4f8",
    borderColor: "#f2f4f8",
  },
  traceAddModeText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
  },
  traceAddModeTextActive: {
    color: "#050505",
  },
  traceAddForm: {
    gap: 8,
  },
  traceAddInput: {
    backgroundColor: "#0a0a0a",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    color: "#ffffff",
    fontSize: 13,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  traceReminderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  traceReminderChip: {
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  traceReminderChipActive: {
    backgroundColor: "#243b2f",
    borderColor: "#34d399",
  },
  traceReminderChipText: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "800",
  },
  traceReminderChipTextActive: {
    color: "#bbf7d0",
  },
  traceAddSaveButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 36,
  },
  traceAddSaveButtonDisabled: {
    opacity: 0.45,
  },
  traceAddSaveButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
  },
  traceDetailTitle: {
    color: "#e5e7eb",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 12,
  },
  traceRemainingTitle: {
    marginTop: 24,
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
  traceEmptySmallText: {
    color: "#a9a9a9",
    fontSize: 13,
    lineHeight: 20,
  },
  traceEmptyDayText: {
    color: "#a9a9a9",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 4,
  },
  traceRecordList: {
    marginTop: 2,
  },
  traceRecordRow: {
    alignItems: "flex-start",
    borderBottomColor: "#1c1c1c",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingVertical: 12,
  },
  traceRecordRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  traceRecordIcon: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    width: 22,
  },
  traceRecordTime: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 22,
    width: 42,
  },
  traceRecordTextBlock: {
    flex: 1,
  },
  traceTodoCompleteButton: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 22,
  },
  traceTodoCompleteText: {
    color: "#d1d5db",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 22,
  },
  traceItemSource: {
    color: "#777777",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  traceAdjacentRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
    minHeight: 38,
  },
  traceAdjacentText: {
    color: "#aeb4c0",
    fontSize: 13,
    fontWeight: "800",
  },
  traceLongRecordBox: {
    backgroundColor: "#111111",
    borderColor: "#202020",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 28,
    padding: 14,
  },
  traceLongRecordHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  traceLongRecordTitle: {
    color: "#ffffff",
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },
  traceLongRecordAction: {
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  traceLongRecordActionText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
  },
  traceLongRecordEditor: {
    gap: 8,
  },
  traceLongRecordEditorHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  traceLongRecordEditorTitle: {
    color: "#f2f4f8",
    fontSize: 13,
    fontWeight: "900",
  },
  traceLongRecordLabel: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "800",
  },
  traceLongRecordInput: {
    backgroundColor: "#0a0a0a",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    color: "#ffffff",
    fontSize: 13,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  traceLongRecordBodyInput: {
    minHeight: 112,
  },
  traceLongRecordSaveButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: "#f2f4f8",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 16,
  },
  traceLongRecordSaveButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
  },
  traceLongRecordContent: {
    gap: 8,
  },
  traceLongRecordContentTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  traceLongRecordBody: {
    color: "#d7d7d7",
    fontSize: 14,
    lineHeight: 21,
  },
  traceLongRecordMoreButton: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  traceLongRecordSavedAt: {
    alignSelf: "flex-end",
    color: "#777777",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  traceUpcomingBox: {
    marginTop: 4,
    paddingTop: 6,
  },
  traceUpcomingEmptyRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  traceUpcomingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    paddingBottom: 14,
  },
  traceUpcomingTimeline: {
    borderLeftColor: "#333333",
    borderLeftWidth: 1,
    marginLeft: 4,
    paddingLeft: 12,
  },
  traceUpcomingDate: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 22,
    width: 58,
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
  traceCleanupTextButton: {
    alignSelf: "center",
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  traceCleanupTextButtonText: {
    color: "#777777",
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
























































































































