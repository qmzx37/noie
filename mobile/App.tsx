import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  AnalysisSource,
  AnalyzeEmotionResponse,
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
  DreamMilestoneStatus,
  DreamProjectStatus,
  DreamRole,
  DreamRoutine,
  DreamRoutineDailySetting,
  DreamRoutineQuickScore,
  DreamRoutineRecord,
  DreamRoutineRecordType,
  DreamSavePromptKind,
  EmotionAxis,
  EmotionKey,
  EmotionLevel,
  EmotionRecord,
  EmotionSignals,
  GoalDurationMonths,
  MemorySavePolicy,
  MemorySavePolicyType,
  NoieMemory,
  NoieProject,
  NoieProjectMessage,
  NumericEmotionAxis,
  PrimaryAxis,
  ProjectEmotionAdminView,
  ProjectFormState,
  SaveDecision,
  SaveNoieMemoryResult,
  ScreenMode,
  StartProjectInput,
  WeeklyAverage
} from "./src/noie/types";
import {
  DEFAULT_FLOW_KEYS,
  EMOTION_KEYS,
  EMOTION_LABELS,
  MAX_FLOW_KEYS,
  MAX_TODAY_ME_CARDS,
  MAX_TODAY_ME_RECOMMENDATIONS,
  TRACE_CONFIRM_LABELS,
  TRACE_QUESTION_LABELS,
} from "./src/noie/constants";
import {
  TRACE_REMINDER_OPTIONS,
} from "./src/constants/appConstants";
import {
  NOIE_STORAGE_KEYS,
  STORAGE_KEYS,
} from "./src/constants/storageKeys";
import {
  DailyTraceCalendar,
  DailyTraceFrame,
} from "./src/features/traces/DailyTraceSection";
import {
  DreamFeature,
  type CompletedDreamFragmentDisplayItem,
  type DreamFragmentDisplayItem,
  type DreamTorchDisplayItem,
} from "./src/features/dreams/DreamFeature";
import {
  TodayMeSection,
  type TodayMeCard,
  type TodayMeRecommendation,
} from "./src/features/dreams/TodayMeSection";
import {
  getTodayMeFeedback,
  getTodayRoutineRecord,
  getVisibleTodayMeCards,
  isActiveTodayMeRoutine,
  selectTodayMeRecommendation as selectTodayMeRecommendationFromLogic,
} from "./src/features/dreams/todayMeLogic";
import {
  buildDreamSaveMemories,
  completeDreamFragment,
  promoteExistingDreamItemToTorch,
  renameDreamFragment,
  updateDreamFragmentNextAction,
} from "./src/features/dreams/dreamActions";
import {
  addRoutineToTorch,
  buildCompletedRoutineRecord as buildCompletedRoutineRecordAction,
  buildRoutineRecord,
  buildTodayMeRoutine,
  removeRoutineRecordFromItems,
  restoreTodayMeRoutineInTorch,
  updateRoutineDailyTargetForItem,
  updateRoutineRecordInItems,
  updateRoutineTargetInItems,
  updateRoutineTodayMeStateInItems,
} from "./src/features/dreams/routineActions";
import {
  ProjectCreateScreen,
  ProjectScreen,
} from "./src/features/projects/ProjectFeature";
import {
  archiveProjectInList,
  buildCompletedProjectTrace,
  buildProject,
  cancelProjectNextActionInList,
  completeProjectInList,
  completeProjectNextActionInList,
  reactivateTodayMeProjectInList,
  removeProjectFromTodayMeInList,
  updateProjectInList,
} from "./src/features/projects/projectActions";
import {
  ChatScreen,
  Sidebar,
} from "./src/features/chat/ChatFeature";
import { EmotionFlowFeature } from "./src/features/emotions/EmotionFlowFeature";
import type { DailyLongRecord } from "./src/features/traces/traceFeature";
import {
  buildWeeklyTraceDates,
  formatDailyTraceSelectedDate,
  formatShortTraceDate,
  formatTimeFromIso,
  formatUpcomingTraceDate,
  getDailyLongRecordTitle,
  getDailyTraceDisplayTime,
  getDailyTraceRowIcon,
  getDailyTraceRowMemo,
  getDailyTraceRowSource,
  getEmptyLongRecordText,
  getEmptySelectedDayText,
  getExistingReminderLabel,
  getLifeRepeatCompletedAt,
  getTraceEmptyScheduleText,
  getTraceReminderLabel,
  getTraceRemainingSectionTitle,
  getTraceScheduleSectionTitle,
  isCancelledTraceItem,
  isCompletedTraceScheduleItem,
  isDreamFragmentTraceItem,
  isFutureDateKey,
  isLifeRepeatTraceItem,
  isScheduledDailyTraceItem,
  isScheduledDailyTraceItemForDate,
  shiftTraceDateKey,
} from "./src/features/traces/traceFeature";
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
  calculateDreamProgress,
  getActiveDreamRoutines,
  getActiveDreamSeason,
  findRoutineRecord,
  getConsistencyStatusSymbol,
  getConsistencyWeekdayLabel,
  getDreamDdayLabel,
  getDreamProjectSummary,
  getEmptyDreamProgressBreakdown,
  getEffectiveRoutineMinimumValue,
  getEffectiveRoutineTargetValue,
  getProjectsRelatedToDream,
  getRoutineRecordActualValue,
  getRoutineRecordMeasuredValue,
  isRoutineAvailableForTodayMe,
  isRoutineActionDoneToday,
  safeNumber,
  type DreamProjectSummary,
} from "./src/features/dreams/dreamProgress";
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
import {
  extractDailyTraceCandidate as requestDailyTraceCandidate,
  generateTitle as requestGeneratedTitle,
  requestChatReply as requestNoieChatReply,
  requestProjectChatReply as requestNoieProjectChatReply,
} from "./src/noie/noieApi";

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
  targetGoalTitle?: string | null;
  previousDurationMinutes?: number | null;
  newDurationMinutes?: number | null;
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
    saveJsonValue(STORAGE_KEYS.dailyTraces, repairedItems).catch((error) =>
      console.log("[noie] 꿈의 파편 연결 복구 실패", error)
    );
  }, [dailyTraces, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    saveJsonValue(STORAGE_KEYS.sessions, sessions).catch(
      (error) => console.log("[noie] 채팅 저장 실패", error)
    );
    saveStringValue(STORAGE_KEYS.currentChatId, activeSessionId).catch(
      (error) => console.log("[noie] 현재 채팅 저장 실패", error)
    );
    saveJsonValue(STORAGE_KEYS.dailyTraces, dailyTraces).catch(
      (error) => console.log("[noie] 하루의 흔적 저장 실패", error)
    );
    saveJsonValue(STORAGE_KEYS.dailyLongRecords, dailyLongRecords).catch(
      (error) => console.log("[noie] 날짜별 긴 기록 저장 실패", error)
    );
    if (dreamTorchId) {
      saveStringValue(STORAGE_KEYS.dreamTorchId, dreamTorchId).catch(
        (error) => console.log("[noie] dream torch save failed", error)
      );
    } else {
      removeStorageValue(STORAGE_KEYS.dreamTorchId).catch((error) =>
        console.log("[noie] dream torch clear failed", error)
      );
    }
    saveJsonValue(STORAGE_KEYS.projects, projects).catch(
      (error) => console.log("[noie] 프로젝트 저장 실패", error)
    );
    saveJsonValue(STORAGE_KEYS.projectMessages, projectMessages).catch((error) => console.log("[noie] 프로젝트 메시지 저장 실패", error));
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
          loadStringValue(STORAGE_KEYS.sessions),
          loadStringValue(STORAGE_KEYS.currentChatId),
          loadStringValue(STORAGE_KEYS.dailyTraces),
          loadStringValue(STORAGE_KEYS.dailyLongRecords),
          loadStringValue(STORAGE_KEYS.dreamTorchId),
          loadStringValue(STORAGE_KEYS.projects),
          loadStringValue(STORAGE_KEYS.projectMessages),
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
          saveJsonValue(STORAGE_KEYS.dailyTraces, dedupedDailyTraces).catch((error) => console.log("[noie] 하루의 흔적 중복 정리 실패", error));
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
    const newProject = buildProject({
      id: createId("project"),
      title,
      goal,
      deadline: deadline || undefined,
      now,
    });

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
      updateProjectInList(
        currentProjects,
        projectId,
        { title, goal, deadline: deadline || undefined },
        new Date().toISOString()
      )
    );
  };

  const archiveProject = (projectId: string) => {
    setProjects((currentProjects) =>
      archiveProjectInList(currentProjects, projectId, new Date().toISOString())
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

    const earlyScheduleRoute = findFutureOneTimeScheduleRoute(trimmedText);

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
      const routingResult = earlyScheduleRoute ?? resolvePrimarySaveRoute({
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
      let resolvedTraceCandidate = routingResult.route === "none"
        ? null
        : resolveDailyTraceCandidate(
        trimmedText,
        traceCandidate,
        routedMemoryPolicy
      );
      if (
        !resolvedTraceCandidate &&
        (routingResult.route === "routine_adjustment_intent" ||
          routingResult.route === "routine_adjustment_confirm")
      ) {
        resolvedTraceCandidate = {
          type: "todo",
          date: getLocalDateString(new Date()),
          title: routingResult.title,
          memo: routingResult.originalText,
        };
      }
      if (resolvedTraceCandidate) {
        if (routingResult.route === "routine_create") {
          resolvedTraceCandidate.type = "goal";
          resolvedTraceCandidate.title = routingResult.title;
          resolvedTraceCandidate.memo = routingResult.targetValue
            ? `목표 시간 · ${formatRoutineTargetForDisplay(routingResult.targetValue, routingResult.unit)}`
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

      if (routingResult.route === "life_schedule_once" && dailyTraceStatus === "pending") {
        console.log("[SCHEDULE CONFIRM CARD]", {
          dateKey: routingResult.scheduledDate,
          startTime: routingResult.displayUnit,
          title: routingResult.title,
        });
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
    return requestNoieProjectChatReply({
      text,
      messages: toProjectChatHistory(messages),
      projectName: project.title,
      projectGoal: project.goal,
    });
  };

  const requestChatReply = async (text: string, messages: ChatMessage[]) => {
    return requestNoieChatReply(text, toChatHistory(messages));
  };

  const extractDailyTraceCandidate = async (text: string) => {
    try {
      const data = await requestDailyTraceCandidate(text, getLocalDateString(new Date()));
      if (
        !data ||
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
      const data = await requestGeneratedTitle(text);
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
      const savedDailyTraces = await loadStringValue(STORAGE_KEYS.dailyTraces);
      const parsedDailyTraces = savedDailyTraces
        ? (JSON.parse(savedDailyTraces) as DailyTraceItem[])
        : dailyTraces;

      return Array.isArray(parsedDailyTraces) ? parsedDailyTraces : dailyTraces;
    } catch (error) {
      console.log("[noie] 저장된 memories 읽기 실패", error);
      return dailyTraces;
    }
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
      options,
      { dedupeMemories, getMemorySemanticKey }
    );
    const savedItem = updatedMemories.find((item) => getMemorySemanticKey(item) === getMemorySemanticKey(newItem)) ?? newItem;
    const now = new Date().toISOString();

    await saveJsonValue(STORAGE_KEYS.dailyTraces, updatedMemories);
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
        const nextItems = promoteExistingDreamItemToTorch(dailyTraces, targetItem.id, now);
        setDailyTraces(nextItems);
        setDreamTorchId(targetItem.id);
        await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
        await saveStringValue(STORAGE_KEYS.dreamTorchId, targetItem.id);
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
      (routine) => normalizeRoutineTitleKey(routine.title) === routineKey
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

    console.log("[TODAY ME ROUTINE LOOKUP]", {
      title: routineTitle,
      found: Boolean(existingRoutine),
      active: existingRoutine ? isActiveTodayMeRoutine(existingRoutine) : false,
    });

    if (existingRoutine) {
      const nextTargetValue =
        typeof routingResult.targetValue === "number" && routingResult.targetValue > 0
          ? routingResult.targetValue
          : existingRoutine.targetValue;
      const nextTorch = restoreTodayMeRoutineInTorch(targetTorch, {
        routineId: existingRoutine.id,
        targetValue: nextTargetValue,
        unit: routingResult.unit,
        now,
      });
      const nextItems = torchPiece
        ? dailyTraces.map((item) => item.id === nextTorch.id ? nextTorch : item)
        : dedupeMemories([
            ...dailyTraces.map((item) =>
              item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
            ),
            nextTorch,
          ]);

      setDailyTraces(nextItems);
      await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
      if (!torchPiece) {
        setDreamTorchId(nextTorch.id);
      }

      console.log("[TODAY ME ROUTINE RESTORED]", {
        routineId: existingRoutine.id,
        targetValue: nextTargetValue,
      });

      updateSession(activeSession?.id ?? activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) =>
          item.id === message.id
            ? { ...item, dailyTraceStatus: "added", dailyTraceNotice: "기존 반복 목표를 오늘의 나에 다시 이어왔어요." }
            : item
        ),
        updatedAt: now,
      }));
      return;
    }

    const newRoutine = buildTodayMeRoutine({
      id: createId("routine"),
      title: routineTitle,
      recordType: "quantity",
      repeatType: routingResult.repeatType ?? "daily",
      targetValue: routingResult.targetValue ?? undefined,
      minimumValue: routingResult.minimumValue ?? 0,
      unit: routingResult.unit,
      now,
    });
    const nextTorch = addRoutineToTorch(targetTorch, newRoutine, now);
    const nextItems = torchPiece
      ? dailyTraces.map((item) => item.id === nextTorch.id ? nextTorch : item)
      : dedupeMemories([
          ...dailyTraces.map((item) =>
            item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
          ),
          nextTorch,
        ]);

    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
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
    const titleKey = normalizeRoutineTitleKey(routineTitle);
    const existingRoutine = (targetTorch.routines ?? []).find(
      (routine) => normalizeRoutineTitleKey(routine.title) === titleKey
    );

    console.log("[TODAY ME ROUTINE LOOKUP]", {
      title: routineTitle,
      found: Boolean(existingRoutine),
      active: existingRoutine ? isActiveTodayMeRoutine(existingRoutine) : false,
    });

    if (existingRoutine && isActiveTodayMeRoutine(existingRoutine)) {
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

    if (existingRoutine) {
      const nextTargetValue = Math.max(30, input.targetValue || existingRoutine.targetValue || 30);
      const nextTorch = restoreTodayMeRoutineInTorch(targetTorch, {
        routineId: existingRoutine.id,
        targetValue: nextTargetValue,
        now,
      });
      const nextItems = torchPiece
        ? dailyTraces.map((item) => item.id === nextTorch.id ? nextTorch : item)
        : dedupeMemories([
            ...dailyTraces.map((item) =>
              item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
            ),
            nextTorch,
          ]);

      setDailyTraces(nextItems);
      await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
      if (!torchPiece) {
        setDreamTorchId(nextTorch.id);
      }
      console.log("[TODAY ME ROUTINE RESTORED]", {
        routineId: existingRoutine.id,
        targetValue: nextTargetValue,
      });
      setTodayMeFeedback("기존 반복 목표를 오늘의 나에 다시 이어왔어요.");
      return true;
    }

    const newRoutine = buildTodayMeRoutine({
      id: createId("routine"),
      title: routineTitle,
      recordType: "quantity",
      repeatType: "daily",
      targetValue: Math.max(30, input.targetValue),
      minimumValue: 0,
      unit: "분",
      now,
    });
    const nextTorch = addRoutineToTorch(targetTorch, newRoutine, now);
    const nextItems = torchPiece
      ? dailyTraces.map((item) => item.id === nextTorch.id ? nextTorch : item)
      : dedupeMemories([
          ...dailyTraces.map((item) =>
            item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
          ),
          nextTorch,
        ]);

    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
    if (!torchPiece) {
      setDreamTorchId(nextTorch.id);
    }
    console.log("[TODAY ME ROUTINE CREATED]", {
      routineId: newRoutine.id,
      targetValue: newRoutine.targetValue,
    });
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
    const nextItems = updateRoutineTargetInItems(dailyTraces, {
      routineId: routingResult.matchedRoutineId,
      targetValue: routingResult.targetValue,
      minimumValue: 0,
      unit: routingResult.unit ?? undefined,
      dateKey: today,
      now,
      mode: applyMode,
    });
    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
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
    const nextProjects = completeProjectInList(
      projects,
      routingResult.matchedProjectId,
      now,
      { archiveFromTodayMe: true }
    );
    setProjects(nextProjects);
    await saveJsonValue(STORAGE_KEYS.projects, nextProjects);

    const today = getLocalDateString(new Date());
    const traceResult = buildCompletedProjectTrace({
      currentItems: dailyTraces,
      projectId: routingResult.matchedProjectId,
      title: routingResult.title,
      originalText: routingResult.originalText,
      todayKey: today,
      now,
      traceId: createId("trace"),
      completedTitle: `${routingResult.title} 프로젝트 완료`,
      completedMemo: "완료한 프로젝트",
      displayCategory: "완료한 프로젝트",
      saveNoieMemory,
    });
    if (traceResult.traceCreated) {
      setDailyTraces(traceResult.nextItems);
      await saveJsonValue(
        STORAGE_KEYS.dailyTraces,
        traceResult.nextItems
      );
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
    const nextItems = renameDreamFragment(
      dailyTraces,
      routingResult.matchedDailyTraceId,
      nextTitle,
      now
    );
    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);

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
    const result = completeDreamFragment({
      currentItems: dailyTraces,
      fragmentId: routingResult.matchedDailyTraceId,
      todayKey: today,
      now,
      originalText: routingResult.originalText,
      helpers: { createId },
    });
    if (!result.completedFragment) {
      return;
    }

    setDailyTraces(result.nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, result.nextItems);

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
    const nextItems = updateDreamFragmentNextAction(
      dailyTraces,
      routingResult.matchedDailyTraceId,
      nextAction,
      now
    );
    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);

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
    const nextProjects = completeProjectNextActionInList(
      projects,
      routingResult.matchedProjectId,
      today,
      completedAt,
      routingResult.title,
      routingResult.matchedNextAction ?? undefined
    );
    setProjects(nextProjects);
    await saveJsonValue(STORAGE_KEYS.projects, nextProjects);
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
      await saveJsonValue(STORAGE_KEYS.dailyTraces, nextDailyTraces);
      if (routingResult?.route === "life_schedule_once" && !saveResult.duplicate) {
        console.log("[SCHEDULE SAVED]", {
          id: newItem.id,
          dateKey: newItem.date,
          startTime: newItem.time,
          title: newItem.title,
        });
      }

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
      const savedDailyTraces = await loadStringValue(STORAGE_KEYS.dailyTraces);
      const parsedDailyTraces = savedDailyTraces
        ? (JSON.parse(savedDailyTraces) as DailyTraceItem[])
        : dailyTraces;
      const sourceMemories = Array.isArray(parsedDailyTraces)
        ? parsedDailyTraces
        : dailyTraces;
      const dedupedMemories = dedupeMemories(sourceMemories);

      await saveJsonValue(STORAGE_KEYS.dailyTraces, dedupedMemories);
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
    await saveJsonValue(STORAGE_KEYS.dailyLongRecords, nextRecords);
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
    await saveJsonValue(STORAGE_KEYS.dailyLongRecords, nextRecords);
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
    await saveJsonValue(STORAGE_KEYS.dailyLongRecords, nextRecords);
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
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);

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
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);

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

  const deleteScheduleById = async (scheduleId: string) => {
    const now = new Date().toISOString();
    let deletedTitle = "";
    let didDelete = false;
    const nextItems = dailyTraces.map((item) =>
      item.id === scheduleId
        ? {
            ...item,
            status: "cancelled",
            cancelledAt: now,
            updatedAt: now,
          }
        : item
    );
    const target = dailyTraces.find((item) => item.id === scheduleId);
    if (target) {
      deletedTitle = target.title;
      didDelete = true;
    }
    if (!didDelete) {
      return { didDelete: false, title: "" };
    }
    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
    setDailyTraceCleanupMessage(`${deletedTitle} 일정을 삭제했어요.`);
    return { didDelete, title: deletedTitle };
  };

  const cancelLifeSchedule = async (
    message: RoutedChatMessage,
    routingResult: NoieSaveRoutingResult
  ) => {
    if (!routingResult.matchedDailyTraceId) {
      return;
    }

    const now = new Date().toISOString();
    const result = await deleteScheduleById(routingResult.matchedDailyTraceId);

    updateSession(activeSession?.id ?? activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((item) =>
        item.id === message.id
          ? {
              ...item,
              dailyTraceStatus: result.didDelete ? "added" : "dismissed",
              dailyTraceNotice: result.didDelete ? "일정을 취소했어요." : "취소할 일정을 찾지 못했어요.",
            }
          : item
      ),
      updatedAt: now,
    }));
  };

  const skipLifeRepeatScheduleOnDate = async (itemId: string, dateKey: string) => {
    const now = new Date().toISOString();
    let title = "";
    let didUpdate = false;
    const nextItems = dailyTraces.map((item) => {
      if (item.id !== itemId || !isLifeRepeatTraceItem(item)) {
        return item;
      }
      const typedItem = item as DailyTraceItem & { excludedDateKeys?: string[] };
      const excludedDateKeys = Array.from(new Set([...(typedItem.excludedDateKeys ?? []), dateKey]));
      title = item.title;
      didUpdate = true;
      return {
        ...item,
        excludedDateKeys,
        updatedAt: now,
      } as DailyTraceItem;
    });
    if (!didUpdate) {
      return false;
    }
    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
    setDailyTraceCleanupMessage(`${formatShortTraceDate(dateKey)}의 ${title} 일정만 건너뛰었어요.`);
    return true;
  };

  const endLifeRepeatScheduleFromDate = async (itemId: string, dateKey: string) => {
    const now = new Date().toISOString();
    let title = "";
    let didUpdate = false;
    const nextItems = dailyTraces.map((item) => {
      if (item.id !== itemId || !isLifeRepeatTraceItem(item)) {
        return item;
      }
      title = item.title;
      didUpdate = true;
      return {
        ...item,
        endDateKey: dateKey,
        updatedAt: now,
      } as DailyTraceItem;
    });
    if (!didUpdate) {
      return false;
    }
    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
    setDailyTraceCleanupMessage(`${title} 반복 일정을 ${formatShortTraceDate(dateKey)}부터 종료했어요.`);
    return true;
  };

  const deleteLifeRepeatScheduleById = async (itemId: string) => {
    const now = new Date().toISOString();
    const target = dailyTraces.find((item) => item.id === itemId && isLifeRepeatTraceItem(item));
    if (!target) {
      return false;
    }
    const nextItems = dailyTraces.map((item) =>
      item.id === itemId && isLifeRepeatTraceItem(item)
        ? {
            ...item,
            status: "deleted",
            deletedAt: now,
            updatedAt: now,
          }
        : item
    );
    setDailyTraces(nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
    setDailyTraceCleanupMessage(`${target.title} 반복 일정을 삭제했어요.`);
    return true;
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
      saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems).catch((error) =>
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
    const targetItem = dailyTraces.find((item) => {
      if (itemId && item.id !== itemId) {
        return false;
      }
      return (item.routines ?? []).some((routine) => routine.id === routineId);
    });
    const routine = targetItem?.routines?.find((candidate) => candidate.id === routineId);
    if (!targetItem || !routine) {
      return false;
    }

    routineTitle = routine.title;
    displayUnit = unit ?? routine.unit ?? "";
    const normalizedValue = convertRoutineRecordValueToRoutineUnit(
      safeActualValue,
      unit,
      routine.unit
    );
    const existingRecord = findRoutineRecord(targetItem.routineRecords ?? [], routineId, dateKey);
    const score = completedOnly
      ? existingRecord?.score ?? 1
      : calculateRoutineScore(routine, normalizedValue, dateKey);
    const recordId = existingRecord?.id ?? createId("routine-record");
    const effectiveTargetValue = getEffectiveRoutineTargetValue(routine, dateKey);
    const completedValue = effectiveTargetValue > 0 ? effectiveTargetValue : Math.max(1, normalizedValue);
    const nextRecord = completedOnly
      ? buildCompletedRoutineRecordAction({
          recordId,
          routineId,
          dateKey,
          score,
          value: completedValue,
          existingRecord,
          now,
          note: originalText,
        })
      : buildRoutineRecord({
          recordId,
          routineId,
          dateKey,
          score,
          value: normalizedValue,
          existingRecord,
          now,
          note: originalText,
        });
    const recordResult = updateRoutineRecordInItems(dailyTraces, {
      itemId,
      routineId,
      record: nextRecord,
      now,
    });
    let nextItems = recordResult.items;
    const didUpdate = recordResult.didUpdate;

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
      await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
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

  useEffect(() => {
    const today = getLocalDateString(new Date());
    const now = new Date().toISOString();
    let didRepair = false;
    const nextItems = dailyTraces.map((item) => {
      if (!(item.routines ?? []).length || !(item.routineRecords ?? []).length) {
        return item;
      }

      let didRepairItem = false;
      const nextRecords = (item.routineRecords ?? []).map((record) => {
        if (record.date !== today || safeNumber(record.score) < 1) {
          return record;
        }
        const routine = (item.routines ?? []).find((candidate) => candidate.id === record.routineId);
        if (!routine) {
          return record;
        }
        const targetValue = getEffectiveRoutineTargetValue(routine, today);
        const measuredValue = getRoutineRecordMeasuredValue(record);
        const typedRecord = record as DreamRoutineRecord & {
          actualValue?: number;
          completed?: boolean;
          completionType?: "full";
        };
        const looksLikeLegacyCompletedRecord =
          typedRecord.completed === true ||
          typedRecord.completionType === "full" ||
          measuredValue === 1;
        if (targetValue <= 0 || measuredValue >= targetValue || !looksLikeLegacyCompletedRecord) {
          return record;
        }

        didRepair = true;
        didRepairItem = true;
        return {
          ...record,
          value: targetValue,
          actualValue: targetValue,
          completed: true,
          completionType: "full",
          updatedAt: now,
        } as DreamRoutineRecord & {
          actualValue?: number;
          completed?: boolean;
          completionType?: "full";
        };
      });

      if (!didRepairItem) {
        return item;
      }

      return {
        ...item,
        routineRecords: nextRecords,
        progressUpdatedAt: now,
        updatedAt: now,
      };
    });

    if (!didRepair) {
      return;
    }

    setDailyTraces(nextItems);
    saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems).catch((error) =>
      console.error("[routine-completion-repair-save-error]", error)
    );
    console.log("[routine-completion-records-repaired]", { dateKey: today });
  }, [dailyTraces]);

  const cancelRoutineTodayRecord = (itemId: string, routineId: string) => {
    const today = getLocalDateString(new Date());
    const now = new Date().toISOString();
    setDailyTraces((currentItems) => {
      const nextItems = removeRoutineRecordFromItems(currentItems, {
        itemId,
        routineId,
        dateKey: today,
        now,
      });
      saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems).catch((error) =>
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
      const targetItem = currentItems.find((item) => item.id === itemId);
      const targetRoutine = targetItem?.routines?.find((routine) => routine.id === routineId);
      if (!targetRoutine) {
        return currentItems;
      }

      const currentTarget = getEffectiveRoutineTargetValue(targetRoutine, today);
      const nextTarget = Math.max(30, roundRoutineTarget(currentTarget + delta));
      const currentMinimum = getEffectiveRoutineMinimumValue(targetRoutine, today);
      const nextMinimum = currentMinimum > 0 ? Math.min(currentMinimum, nextTarget) : currentMinimum;
      const nextItems = updateRoutineDailyTargetForItem(currentItems, {
        itemId,
        routineId,
        dateKey: today,
        targetValue: nextTarget,
        minimumValue: nextMinimum,
        unit: targetRoutine.unit,
        now,
      });

      saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems).catch((error) =>
        console.error("[routine-target-adjust-save-error]", error)
      );
      console.log("[routine-target-adjusted]", { routineId, dateKey: today });
      return nextItems;
    });
  };

  const completeRoutineFromTodayMe = (itemId: string, routineId: string) => {
    const now = new Date().toISOString();
    setDailyTraces((currentItems) => {
      const nextItems = updateRoutineTodayMeStateInItems(currentItems, {
        itemId,
        routineId,
        now,
        state: "completed",
      });
      saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems).catch((error) =>
        console.error("[today-me-routine-complete-save-error]", error)
      );
      console.log("[today-me-card-archived]", { sourceType: "routine", sourceId: routineId });
      return nextItems;
    });
  };

  const removeRoutineFromTodayMe = (itemId: string, routineId: string) => {
    const now = new Date().toISOString();
    setDailyTraces((currentItems) => {
      const nextItems = updateRoutineTodayMeStateInItems(currentItems, {
        itemId,
        routineId,
        now,
        state: "archived",
      });
      saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems).catch((error) =>
        console.error("[today-me-routine-remove-save-error]", error)
      );
      console.log("[today-me-card-removed]", { sourceType: "routine", sourceId: routineId });
      return nextItems;
    });
  };

  const completeProjectFromTodayMe = (projectId: string) => {
    const now = new Date().toISOString();
    setProjects((currentProjects) => {
      const nextProjects = completeProjectInList(currentProjects, projectId, now);
      saveJsonValue(STORAGE_KEYS.projects, nextProjects).catch((error) =>
        console.error("[today-me-project-complete-save-error]", error)
      );
      console.log("[today-me-card-archived]", { sourceType: "project", sourceId: projectId });
      return nextProjects;
    });
  };

  const removeProjectFromTodayMe = (projectId: string) => {
    const now = new Date().toISOString();
    setProjects((currentProjects) => {
      const nextProjects = removeProjectFromTodayMeInList(currentProjects, projectId, now);
      saveJsonValue(STORAGE_KEYS.projects, nextProjects).catch((error) =>
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

      saveJsonValue(STORAGE_KEYS.projects, nextProjects).catch((error) =>
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
      const nextProjects = cancelProjectNextActionInList(currentProjects, projectId, today, now);
      saveJsonValue(STORAGE_KEYS.projects, nextProjects).catch((error) =>
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

        const nextProjects = reactivateTodayMeProjectInList(
          safeProjects,
          existingProject.id,
          input,
          getNextTodayMeOrder(safeProjects),
          now
        );
        setProjects(nextProjects);
        await saveJsonValue(STORAGE_KEYS.projects, nextProjects);
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
      await saveJsonValue(STORAGE_KEYS.projects, nextProjects);
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
      await saveJsonValue(STORAGE_KEYS.dailyTraces, nextItems);
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

  const resetNoieDevData = async () => {
    if (!__DEV__) {
      return;
    }

    console.log("[NOIE RESET] 실제 초기화 함수 진입");
    console.log("[NOIE RESET] 초기화 시작");
    try {
      await Promise.all(NOIE_STORAGE_KEYS.map((key) => removeStorageValue(key)));
      const newSession = createEmptySession();
      const today = getLocalDateString(new Date());

      setSessions([newSession]);
      setActiveSessionId(newSession.id);
      setDailyTraces([]);
      setDailyLongRecords([]);
      setDreamTorchId(null);
      setProjects([]);
      setProjectMessages([]);
      setActiveProjectId(null);
      setProjectInputText("");
      setProjectForm({ title: "", goal: "", deadline: "" });
      setSelectedTraceDate(today);
      setCalendarMonth(getMonthStart(new Date()));
      setDailyTraceCleanupMessage("");
      setInputText("");
      setSavingDailyTraceMessageIds([]);
      setIsDrawerOpen(false);
      setScreenMode("chat");
      setSelectedFlowKeys(DEFAULT_FLOW_KEYS);
      setShowAllWeeklyAverages(false);
      setTodayMeFeedback("노이에 테스트 데이터를 초기화했어요.");
      setPendingRoutineAdjustment(null);
      setIsStartingProject(false);
      setIsSavingGoalDuration(false);
      scrollToBottom();
      console.log("[NOIE RESET] AsyncStorage 초기화 완료", NOIE_STORAGE_KEYS);
      console.log("[NOIE RESET] 실제 초기화 완료");
      console.log("[NOIE RESET] 초기화 완료");
      if (Platform.OS === "web") {
        const webGlobal = globalThis as typeof globalThis & { alert?: (message: string) => void };
        if (typeof webGlobal.alert === "function") {
          webGlobal.alert("노이에 테스트 데이터를 초기화했어요.");
        }
      } else {
        Alert.alert("노이에 테스트 데이터를 초기화했어요.");
      }
    } catch (error) {
      console.error("[NOIE RESET] 실제 초기화 실패", error);
      console.error("[NOIE RESET] 초기화 실패", error);
      setTodayMeFeedback("노이에 테스트 데이터 초기화에 실패했어요.");
    }
  };

  const confirmResetNoieDevData = () => {
    if (!__DEV__) {
      return;
    }

    console.log("[NOIE RESET] 버튼 클릭");
    const firstMessage = "노이에에 저장된 모든 테스트 데이터를 삭제할까요?";
    const secondMessage = "꿈, 반복 목표, 일정, 하루의 흔적과 기록이 모두 삭제됩니다.\n정말 초기화할까요?";

    if (Platform.OS === "web") {
      const webGlobal = globalThis as typeof globalThis & {
        confirm?: (message: string) => boolean;
      };
      if (typeof webGlobal.confirm !== "function") {
        console.log("[NOIE RESET] 사용자가 초기화를 취소함");
        return;
      }
      if (!webGlobal.confirm(firstMessage)) {
        console.log("[NOIE RESET] 첫 번째 확인 취소");
        console.log("[NOIE RESET] 사용자가 초기화를 취소함");
        return;
      }
      console.log("[NOIE RESET] 첫 번째 확인 완료");
      if (!webGlobal.confirm(secondMessage)) {
        console.log("[NOIE RESET] 두 번째 확인 취소");
        console.log("[NOIE RESET] 사용자가 초기화를 취소함");
        return;
      }
      console.log("[NOIE RESET] 두 번째 확인 완료");
      console.log("[NOIE RESET] 실제 초기화 함수 호출 직전");
      void resetNoieDevData();
      return;
    }

    Alert.alert(
      firstMessage,
      "",
      [
        {
          text: "취소",
          style: "cancel",
          onPress: () => {
            console.log("[NOIE RESET] 첫 번째 확인 취소");
            console.log("[NOIE RESET] 사용자가 초기화를 취소함");
          },
        },
        {
          text: "계속",
          style: "destructive",
          onPress: () => {
            console.log("[NOIE RESET] 첫 번째 확인 완료");
            Alert.alert(
              secondMessage,
              "",
              [
                {
                  text: "취소",
                  style: "cancel",
                  onPress: () => {
                    console.log("[NOIE RESET] 두 번째 확인 취소");
                    console.log("[NOIE RESET] 사용자가 초기화를 취소함");
                  },
                },
                {
                  text: "모두 초기화",
                  style: "destructive",
                  onPress: () => {
                    console.log("[NOIE RESET] 두 번째 확인 완료");
                    console.log("[NOIE RESET] 실제 초기화 함수 호출 직전");
                    void resetNoieDevData();
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const renderDreamFeature = () => {
    const dreamTorchCandidates = getDreamTorchCandidates(dailyTraces);
    const torchPiece = selectDreamTorchPiece(dreamTorchCandidates, dreamTorchId);
    const dreamFragments = getDreamFragments(dailyTraces).filter(
      (piece) => piece.id !== torchPiece?.id
    );
    const activeDreamFragments = dreamFragments.filter(
      (piece) => piece.projectStatus !== "done" && !getCompletedProjectForFragment(piece, projects)
    );
    const completedDreamFragments: CompletedDreamFragmentDisplayItem[] = dreamFragments
      .map((piece) => ({ piece, project: getCompletedProjectForFragment(piece, projects) }))
      .filter((item) => item.piece.projectStatus === "done" || Boolean(item.project))
      .map(({ piece, project }) => ({
        id: piece.id,
        title: getMemoryInputText(piece) || piece.title,
        meta: project
          ? getCompletedDreamFragmentMeta(project)
          : `완료 · ${formatDateDot((piece as DailyTraceItem & { completedAt?: string }).completedAt ?? piece.updatedAt ?? piece.createdAt)}`,
      }));
    const activeDreamFragmentCards: DreamFragmentDisplayItem[] = activeDreamFragments.map((piece) => {
      const linkedProjects = getLinkedProjectsForFragment(piece, projects);
      const completedProject = getCompletedProjectForFragment(piece, projects);
      const linkedProject = completedProject ?? linkedProjects.find(
        (project) => project.status !== "done" && !project.completedAt
      );
      const state = getDreamFragmentCardState(linkedProject);
      const displayText = getMemoryInputText(piece) || piece.title;
      const memoText = piece.memo?.trim() ?? "";
      const shouldShowMemo =
        memoText.length > 0 && normalizeMemoryInput(memoText) !== normalizeMemoryInput(displayText);

      return {
        id: piece.id,
        title: displayText,
        memo: shouldShowMemo ? memoText : undefined,
        statusIcon: state.icon,
        statusLabel: state.label,
        stateKind: state.kind,
        linkedProjectId: linkedProject?.id ?? null,
      };
    });
    const todayMeProjects = getTodayMeProjects(torchPiece, dreamFragments, projects);
    const dreamProjectSummary = getDreamProjectSummary(todayMeProjects, torchPiece, projects);
    const todayKey = getLocalDateString(new Date());
    const todayMeCards = getVisibleTodayMeCards(torchPiece, dreamFragments, projects, todayKey);
    const fireRoutines = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "routine" }> => card.cardType === "routine");
    const fireProjects = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "project" }> => card.cardType === "project");
    const selectedMonths = torchPiece ? getSelectedGoalDuration(torchPiece) : undefined;
    const completedRoutineCount = torchPiece
      ? fireRoutines.filter(({ routine }) => isRoutineActionDoneToday(getTodayRoutineRecord(torchPiece, routine))).length
      : 0;
    const completedProjectCount = fireProjects.filter(({ project }) => isProjectActionDone(project, todayKey)).length;
    const totalFireCount = todayMeCards.length;
    const completedFireCount = completedRoutineCount + completedProjectCount;
    const isAllDoneToday = totalFireCount > 0 && completedFireCount === totalFireCount;
    const selectTodayMeRecommendation = (
      recommendationTorchPiece: DailyTraceItem | undefined,
      recommendationDreamFragments: DailyTraceItem[],
      recommendationProjects: NoieProject[],
      activeCards: TodayMeCard[],
      dismissedKeys: string[]
    ): TodayMeRecommendation | undefined =>
      selectTodayMeRecommendationFromLogic(
        recommendationTorchPiece,
        recommendationDreamFragments,
        recommendationProjects,
        activeCards,
        dismissedKeys,
        {
          normalizeMemoryInput,
          getCompletedProjectForFragment,
          getMemoryInputText,
          makeMemoryTitle,
        }
      );
    const torch: DreamTorchDisplayItem | null = torchPiece
      ? {
          id: torchPiece.id,
          title: getMemoryInputText(torchPiece) || torchPiece.title,
          ddayLabel: getDreamDdayLabel(torchPiece),
          isSavingGoalDuration,
          durationOptions: ([3, 6, 12] as GoalDurationMonths[]).map((months) => ({
            months,
            label: `${months}개월`,
            isSelected: selectedMonths === months,
          })),
          fireTitle: isAllDoneToday ? "오늘의 불씨를 모두 켰어요 🔥" : "오늘의 불씨",
          completedFireCount,
          totalFireCount,
          fireItems: [
            ...fireRoutines.map(({ routine }, index) => {
              const record = getTodayRoutineRecord(torchPiece, routine);
              const isDone = isRoutineActionDoneToday(record);
              const targetValue = getEffectiveRoutineTargetValue(routine, todayKey);
              const routineTargetText =
                targetValue > 0 ? `오늘 목표 · ${formatRoutineTarget(targetValue, routine.unit)}` : formatRoutineMeta(routine);

              return {
                id: routine.id,
                title: isDone ? `🔥 ${routine.title}` : routine.title,
                meta: isDone ? "오늘 해냈어요." : routineTargetText,
                isDone,
                showDivider: index < totalFireCount - 1,
                kind: "routine" as const,
                itemId: torchPiece.id,
                routineId: routine.id,
              };
            }),
            ...fireProjects.map(({ project }, index) => {
              const isDone = isProjectActionDone(project, todayKey);
              const actionText = project.nextAction?.trim() || "다음 행동";

              return {
                id: `project-fire-${project.id}`,
                title: isDone ? `🔥 ${actionText}` : actionText,
                meta: isDone ? "오늘 해냈어요." : `프로젝트 · ${project.title}`,
                isDone,
                showDivider: fireRoutines.length + index < totalFireCount - 1,
                kind: "project" as const,
                projectId: project.id,
              };
            }),
          ],
        }
      : null;

    return (
      <DreamFeature
        summaryNode={<DreamProjectSummaryCard summary={dreamProjectSummary} />}
        torch={torch}
        activeDreamFragments={activeDreamFragmentCards}
        completedDreamFragments={completedDreamFragments}
        dreamFragmentsCount={dreamFragments.length}
        todayMeNode={
          <TodayMeSection
            torchPiece={torchPiece}
            projects={todayMeProjects}
            dreamFragments={dreamFragments}
            todayKey={todayKey}
            getActiveDreamSeason={getActiveDreamSeason}
            getActiveDreamRoutines={getActiveDreamRoutines}
            getVisibleTodayMeCards={getVisibleTodayMeCards}
            selectTodayMeRecommendation={selectTodayMeRecommendation}
            isRoutineActionDoneToday={isRoutineActionDoneToday}
            getTodayRoutineRecord={getTodayRoutineRecord}
            isProjectActionDone={isProjectActionDone}
            getTodayMeFeedback={getTodayMeFeedback}
            getEffectiveRoutineTargetValue={getEffectiveRoutineTargetValue}
            formatRoutineTarget={formatRoutineTarget}
            onAdjustRoutineTodayTarget={adjustRoutineTodayTarget}
            onAddRoutineToTodayMe={addRoutineToTodayMe}
            onRemoveRoutineFromTodayMe={removeRoutineFromTodayMe}
            externalFeedback={todayMeFeedback}
            isStartingProject={isStartingProject}
          />
        }
        onStartProjectFromFragment={startProjectFromDreamFragment}
        onSelectGoalDuration={handleSelectGoalDuration}
        onRecordDreamRoutine={recordDreamRoutineQuick}
        onCompleteProjectNextAction={completeProjectNextAction}
        onOpenProject={openProject}
        onCompleteProjectFromTodayMe={completeProjectFromTodayMe}
        onPromoteFragmentToTorch={pinDreamTorch}
        onDeleteFragment={hideFromDreamVault}
        onBackToChat={returnToChat}
      />
    );
  };

  const emotionRecentRecords = emotionRecords.slice(-10);
  const emotionWeeklyAverages = calculateWeeklyAverages(emotionRecords);
  const emotionDailyPieces = getRecentDailyPieces(dailyTraces);
  const emotionInterpretation = buildEmotionFlowInterpretation(
    emotionRecentRecords,
    emotionWeeklyAverages
  );

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
            getProjectDdayLabel={formatDDay}
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
            onResetNoieDevData={confirmResetNoieDevData}
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
              getProjectDdayLabel={formatDDay}
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
              onResetNoieDevData={confirmResetNoieDevData}
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
            renderDreamFeature()
          ) : screenMode === "flow" ? (
            <EmotionFlowFeature
              recentRecords={emotionRecentRecords}
              dailyPieces={emotionDailyPieces}
              weeklyAverages={emotionWeeklyAverages}
              interpretation={emotionInterpretation}
              selectedKeys={selectedFlowKeys}
              showAllWeeklyAverages={showAllWeeklyAverages}
              onToggleKey={toggleFlowKey}
              onToggleWeeklyAverages={() =>
                setShowAllWeeklyAverages((currentValue) => !currentValue)
              }
              onBackToChat={returnToChat}
              getDayPieceText={getDayPieceText}
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
              onDeleteSchedule={deleteScheduleById}
              onSkipLifeRepeatSchedule={skipLifeRepeatScheduleOnDate}
              onEndLifeRepeatSchedule={endLifeRepeatScheduleFromDate}
              onDeleteLifeRepeatSchedule={deleteLifeRepeatScheduleById}
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
              getDdayLabel={formatDDay}
              getTraceTitle={(item: DailyTraceItem) => getMemoryInputText(item) || item.title}
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
              displayHelpers={{
                shouldHideSaveUi,
                isDreamOrGoalType,
                getPendingMemoryNotice,
                buildMemorySavePolicy,
                getRoutineAdjustmentDisplayTitle,
                formatRoutineDurationMinutes,
                getGoalTargetLabel,
                getConfirmButtonLabel,
              }}
              onContentSizeChange={scrollToBottom}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  onDeleteSchedule,
  onSkipLifeRepeatSchedule,
  onEndLifeRepeatSchedule,
  onDeleteLifeRepeatSchedule,
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
  onDeleteSchedule: (itemId: string) => Promise<{ didDelete: boolean; title: string }>;
  onSkipLifeRepeatSchedule: (itemId: string, dateKey: string) => Promise<boolean>;
  onEndLifeRepeatSchedule: (itemId: string, dateKey: string) => Promise<boolean>;
  onDeleteLifeRepeatSchedule: (itemId: string) => Promise<boolean>;
  onCleanupDuplicateMemories: () => void;
  cleanupMessage: string;
  onBackToChat: () => void;
}) {
  return (
    <DailyTraceFrame
      styles={styles}
      cleanupMessage={cleanupMessage}
      onBackToChat={onBackToChat}
      onCleanupDuplicateMemories={onCleanupDuplicateMemories}
    >
      <DailyTraceCalendar
        styles={styles}
        helpers={{
          getDailyTraceItemsForDate,
          isScheduledDailyTraceItemForDate,
          buildUpcomingTraceSchedules,
          getTraceDaySymbol,
          formatShortTraceDate,
          formatDailyTraceSelectedDate,
          getEmptySelectedDayText,
          getTraceScheduleSectionTitle,
          getTraceRemainingSectionTitle,
          getDailyLongRecordTitle,
          getEmptyLongRecordText,
          formatTimeFromIso,
          formatUpcomingTraceDate,
          getTraceReminderLabel,
          isLifeRepeatTraceItem,
          getDailyTraceRowMemo,
          getDailyTraceDisplayTime,
          getDailyTraceRowSource,
          getDailyTraceRowIcon,
        }}
        items={dailyTraces}
        dailyLongRecords={dailyLongRecords}
        selectedDate={selectedTraceDate}
        calendarMonth={calendarMonth}
        onSelectDate={onSelectTraceDate}
        onChangeMonth={onChangeCalendarMonth}
        onToggleDone={onToggleDailyTraceDone}
        onAddItem={onAddDailyTraceItem}
        onSaveLongRecord={onSaveDailyLongRecord}
        onDeleteSchedule={onDeleteSchedule}
        onSkipLifeRepeatSchedule={onSkipLifeRepeatSchedule}
        onEndLifeRepeatSchedule={onEndLifeRepeatSchedule}
        onDeleteLifeRepeatSchedule={onDeleteLifeRepeatSchedule}
      />
    </DailyTraceFrame>
  );
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
  if (!isLifeRepeatTraceItem(item) || isCancelledTraceItem(item)) {
    return false;
  }

  const typedItem = item as DailyTraceItem & {
    excludedDateKeys?: string[];
    endDateKey?: string;
    endDate?: string;
    active?: boolean;
    status?: string;
  };
  if (typedItem.active === false || typedItem.status === "ended") {
    return false;
  }
  if ((typedItem.excludedDateKeys ?? []).includes(dateKey)) {
    return false;
  }
  const endDateKey = typedItem.endDateKey ?? typedItem.endDate;
  if (endDateKey && dateKey >= endDateKey) {
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

  const explicitRoutineAdjustment = findExplicitRoutineDurationAdjustmentRoute(userText, existingItems);
  if (explicitRoutineAdjustment) {
    return explicitRoutineAdjustment;
  }

  const explicitRoutineCreation = findRoutineDurationCreationRoute(userText, existingItems);
  if (explicitRoutineCreation) {
    return explicitRoutineCreation;
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

function findFutureOneTimeScheduleRoute(text: string): NoieSaveRoutingResult | null {
  const parsedDate = parseStrictFutureScheduleDate(text);
  const parsedRange = parseStrictKoreanClockTimeRange(text);
  const parsedTime = parsedRange?.start ?? parseStrictKoreanClockTime(text);

  if (!parsedDate || !parsedTime || !hasStrictScheduleTarget(text)) {
    return null;
  }

  const title = makeStrictLifeScheduleTitle(text);
  if (!title) {
    return null;
  }

  console.log("[SCHEDULE DETECT]", {
    originalText: text,
    dateKey: parsedDate.dateKey,
    startTime: parsedTime.time,
    title,
  });

  return {
    route: "life_schedule_once",
    title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.97,
    scheduledDate: parsedDate.dateKey,
    unit: parsedTime.label,
    displayUnit: parsedTime.time,
    endTime: parsedRange?.end.time ?? null,
    endDisplayUnit: parsedRange?.end.label ?? null,
    reason: "미래 날짜와 시간이 명확한 일회성 일정",
  };
}

function parseStrictFutureScheduleDate(text: string) {
  const today = new Date();
  if (/\ub0b4\uc77c/.test(text)) {
    return { dateKey: getLocalDateString(addDays(today, 1)), label: "\ub0b4\uc77c" };
  }
  if (/\ubaa8\ub808/.test(text)) {
    return { dateKey: getLocalDateString(addDays(today, 2)), label: "\ubaa8\ub808" };
  }
  return null;
}

function parseStrictKoreanClockTimeRange(text: string) {
  const match = text.match(/(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)?\s*(\d{1,2})\s*\uc2dc(?:\s*(\d{1,2})\s*\ubd84?)?\s*\ubd80\ud130\s*(?:(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)\s*)?(\d{1,2})\s*\uc2dc(?:\s*(\d{1,2})\s*\ubd84?)?\s*\uae4c\uc9c0/);
  if (!match) {
    return null;
  }

  const startMarker = match[1] ?? "";
  const endMarker = match[4] ?? startMarker;
  const start = buildStrictKoreanClockTime(startMarker, match[2], match[3]);
  const end = buildStrictKoreanClockTime(endMarker, match[5], match[6]);
  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function parseStrictKoreanClockTime(text: string) {
  const match = text.match(/(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)?\s*(\d{1,2})\s*\uc2dc(?:\s*(\d{1,2})\s*\ubd84?)?/);
  if (!match) {
    return null;
  }

  return buildStrictKoreanClockTime(match[1] ?? "", match[2], match[3]);
}

function buildStrictKoreanClockTime(marker: string, hourText: string, minuteText?: string) {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if ((marker === "\uc624\ud6c4" || marker === "\uc800\ub141" || marker === "\ubc24") && hour < 12) {
    hour += 12;
  }
  if ((marker === "\uc624\uc804" || marker === "\uc544\uce68" || marker === "\uc0c8\ubcbd") && hour === 12) {
    hour = 0;
  }

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const labelHour = hour >= 12 ? hour - 12 || 12 : hour || 12;
  const period = hour >= 12 ? "\uc624\ud6c4" : "\uc624\uc804";
  return {
    time,
    label: `${period} ${labelHour}:${String(minute).padStart(2, "0")}`,
  };
}

function hasStrictScheduleTarget(text: string) {
  return /(\uc77c\uc815|\uc608\uc57d|\uc57d\uc18d|\ubc29\ubb38|\uc218\uc5c5|\uba74\uc811|\uc9c4\ub8cc|\uac80\uc9c4|\uac00\uc57c|\uc788\uc5b4|\uc800\uc7a5\ud574\uc918|\ub2f4\uc544\uc918)/.test(text);
}

function makeStrictLifeScheduleTitle(text: string) {
  const cleaned = text
    .replace(/\ub0b4\uc77c|\ubaa8\ub808/g, " ")
    .replace(/(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)?\s*\d{1,2}\s*\uc2dc(?:\s*\d{1,2}\s*\ubd84?)?\s*(?:\uc5d0|\uc5d4)?/g, " ")
    .replace(/\uc77c\uc815\uc73c\ub85c\s*\uc800\uc7a5\ud574\uc918|\uc77c\uc815\uc73c\ub85c|\uc800\uc7a5\ud574\uc918|\ub2f4\uc544\uc918|\ub4f1\ub85d\ud574\uc918/g, " ")
    .replace(/\s*(?:\uc774|\uac00)?\s*\uc788\uc5b4[.!?]*$/g, " ")
    .replace(/\s*\uac00\uc57c\s*\ud574[.!?]*$/g, " \uac00\uae30")
    .replace(/\s*\uc57c\s*\ud574[.!?]*$/g, " ")
    .replace(/[.!?]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
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

  if (/취소해줘|취소해|삭제해줘|삭제해|지워줘|지워|없애줘|없애/.test(text) && /일정|예약|가는\s*일/.test(text)) {
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
    .replace(/일정|예약|가는\s*일|알려줘|취소해줘|취소해|삭제해줘|삭제해|지워줘|지워|없애줘|없애|전에/g, " ")
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
  const hasIntent = /할래|그릴래|읽을래|운동할래|공부할래|하려고\s*해|하기로\s*했|목표로\s*할래|습관으로\s*만들|꾸준히\s*할\s*거야|할\s*거야|추가해줘|넣어줘|만들어줘|반복\s*목표|오늘의\s*나/.test(normalizedText);
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
    .replace(/오늘의\s*나에|오늘의\s*나/g, "")
    .replace(/매일마다|매일|매주|주\s*\d+\s*회|하루에|아침마다|저녁마다|꾸준히|반복해서/g, "")
    .replace(/\d+(?:\.\d+)?\s*(시간|분|회|개|페이지|세트|장)\s*씩?/g, "")
    .replace(/반복\s*목표|목표/g, "")
    .replace(/추가해줘|넣어줘|만들어줘/g, "")
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

function getKoreanObjectParticle(text: string) {
  const lastChar = text.trim().slice(-1);
  if (!lastChar) {
    return "을";
  }
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) {
    return "을";
  }
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
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

function parseRoutineDurationMinutes(text: string) {
  const hourMinuteMatch = text.match(/(\d+(?:\.\d+)?)\s*시간\s*(?:(\d+(?:\.\d+)?)\s*분|반)?/);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1]);
    const minutes = hourMinuteMatch[2] ? Number(hourMinuteMatch[2]) : /시간\s*반/.test(hourMinuteMatch[0]) ? 30 : 0;
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return Math.round(hours * 60 + minutes);
    }
  }

  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*분/);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    return Number.isFinite(minutes) ? Math.round(minutes) : null;
  }

  return null;
}

function findRoutineDurationExpression(text: string) {
  return text.match(/(\d+(?:\.\d+)?)\s*시간\s*(?:(\d+(?:\.\d+)?)\s*분|반)?|(\d+(?:\.\d+)?)\s*분/);
}

function formatRoutineDurationMinutes(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const totalMinutes = Math.round(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const restMinutes = totalMinutes % 60;

  if (hours > 0 && restMinutes > 0) {
    return `${hours}시간 ${restMinutes}분`;
  }
  if (hours > 0) {
    return `${hours}시간`;
  }
  return `${restMinutes}분`;
}

function getRoutineDurationMinutes(value?: number | null, unit?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return unit?.includes("시간") ? Math.round(value * 60) : Math.round(value);
}

function normalizeRoutineAdjustmentTitleText(text: string) {
  return normalizeMemoryInput(text)
    .replace(/["'“”‘’]/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*시간\s*(?:(\d+(?:\.\d+)?)\s*분|반)?/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*분/g, "")
    .replace(/목표\s*시간|목표|시간/g, "")
    .replace(/으로\s*하고\s*싶어|로\s*하고\s*싶어|으로\s*할래|로\s*할래/g, "")
    .replace(/바꾸고\s*싶어|변경하고\s*싶어|수정하고\s*싶어|조절하고\s*싶어/g, "")
    .replace(/늘리고\s*싶어|줄이고\s*싶어|바꿔줘|변경해줘|수정해줘|조절해줘/g, "")
    .replace(/하고\s*싶어|할래/g, "")
    .replace(/(을|를|은|는|이|가|의)(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "");
}

function getRoutineAdjustmentDisplayTitle(title: string) {
  return title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/하기$/g, "")
    .trim();
}

function findRoutineForDurationAdjustment(titleText: string, items: DailyTraceItem[]) {
  const targetKey = normalizeRoutineAdjustmentTitleText(titleText);
  if (!targetKey) {
    return null;
  }

  const routines = getActiveRoutineEntries(items);
  const exactMatch = routines.find(({ routine }) => normalizeRoutineAdjustmentTitleText(routine.title) === targetKey);
  if (exactMatch) {
    return exactMatch;
  }

  const compactMatch = routines.find(({ routine }) => {
    const routineKey = normalizeRoutineAdjustmentTitleText(routine.title);
    return routineKey.replace(/\s/g, "") === targetKey.replace(/\s/g, "");
  });
  if (compactMatch) {
    return compactMatch;
  }

  const containsMatches = routines.filter(({ routine }) => {
    const routineKey = normalizeRoutineAdjustmentTitleText(routine.title);
    return (
      routineKey.length >= 2 &&
      targetKey.length >= 2 &&
      (targetKey.includes(routineKey) || routineKey.includes(targetKey))
    );
  });

  return containsMatches.length === 1 ? containsMatches[0] : null;
}

function extractRoutineDurationTitleCandidate(text: string) {
  const durationMatch = findRoutineDurationExpression(text);
  if (!durationMatch) {
    return "";
  }

  return stripTrailingKoreanParticles(text.slice(0, durationMatch.index ?? 0))
    .replace(/["'“”‘’]/g, "")
    .replace(/오늘의\s*나에|오늘의\s*나/g, "")
    .replace(/매일마다|매일|매주|평일마다|주말마다|아침마다|저녁마다|꾸준히|반복해서/g, "")
    .replace(/반복\s*목표|목표/g, "")
    .replace(/목표\s*시간|목표|시간/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/하기$/g, "")
    .replace(/\s*씩$/g, "")
    .trim();
}

function findRoutineDurationCreationRoute(
  text: string,
  items: DailyTraceItem[]
): NoieSaveRoutingResult | null {
  if (isActualRoutineExecutionText(text)) {
    return null;
  }
  if (/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시/.test(text) && /알림|일정|예약|해야\s*해|해야해|해야\s*돼|해야돼/.test(text)) {
    return null;
  }

  const durationMatch = findRoutineDurationExpression(text);
  const targetMinutes = parseRoutineDurationMinutes(text);
  if (!durationMatch || typeof targetMinutes !== "number") {
    return null;
  }

  const hasRoutineIntent =
    /하고\s*싶어|하려고\s*해|할래|꾸준히\s*할래|매일\s*할래|이어가고\s*싶어|추가해줘|넣어줘|만들어줘|반복\s*목표|오늘의\s*나/.test(text);
  if (!hasRoutineIntent) {
    return null;
  }

  const title = extractRoutineDurationTitleCandidate(text);
  if (!title) {
    return null;
  }

  return {
    route: "routine_create",
    title,
    originalText: text,
    normalizedText: normalizeMemoryInput(title),
    confidence: 0.92,
    repeatType: "daily",
    targetValue: targetMinutes,
    minimumValue: 0,
    unit: "분",
    reason: "기존 반복 목표가 없어 새 오늘의 나 반복 목표 후보",
  };
}

function findExplicitRoutineDurationAdjustmentRoute(
  text: string,
  items: DailyTraceItem[]
): NoieSaveRoutingResult | null {
  if (isActualRoutineExecutionText(text)) {
    return null;
  }

  const durationMatch = findRoutineDurationExpression(text);
  const newDurationMinutes = parseRoutineDurationMinutes(text);
  if (!durationMatch || typeof newDurationMinutes !== "number") {
    return null;
  }

  const wantsDurationAdjustment =
    /으로\s*하고\s*싶어|로\s*하고\s*싶어|으로\s*할래|로\s*할래|바꾸고\s*싶어|변경하고\s*싶어|수정하고\s*싶어|조절하고\s*싶어|늘리고\s*싶어|줄이고\s*싶어|바꿔줘|변경해줘|수정해줘|조절해줘/.test(text);
  if (!wantsDurationAdjustment) {
    return null;
  }

  const titleText = text.slice(0, durationMatch.index ?? 0);
  const matchedRoutine = findRoutineForDurationAdjustment(titleText, items);
  console.log("[TODAY ME ROUTINE TIME UPDATE CHECK]", {
    titleText: titleText.trim(),
    targetMinutes: newDurationMinutes,
    matchedRoutineId: matchedRoutine?.routine.id ?? null,
    matchedRoutineTitle: matchedRoutine?.routine.title ?? null,
  });

  if (!matchedRoutine) {
    return null;
  }

  const displayTitle = getRoutineAdjustmentDisplayTitle(matchedRoutine.routine.title);
  const previousDurationMinutes = getRoutineDurationMinutes(
    matchedRoutine.routine.targetValue,
    matchedRoutine.routine.unit
  );

  return {
    route: "routine_adjustment_confirm",
    title: displayTitle,
    originalText: text,
    normalizedText: normalizeMemoryInput(displayTitle),
    confidence: 0.97,
    targetValue: newDurationMinutes,
    unit: "분",
    matchedRoutineId: matchedRoutine.routine.id,
    matchedDailyTraceId: matchedRoutine.item.id,
    targetGoalTitle: displayTitle,
    previousDurationMinutes,
    newDurationMinutes,
    reason: "기존 반복 목표 시간 변경 후보",
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
    .replace(/오늘의\s*나에/g, "")
    .replace(/매일|매주|평일마다|주말마다/g, "")
    .replace(/\d+(?:\.\d+)?\s*(시간|분|회|개|페이지|세트)/g, "")
    .replace(/반복\s*목표/g, "")
    .replace(/추가해줘|넣어줘|만들어줘/g, "")
    .replace(/하고\s*싶어|하려고\s*해/g, "")
    .replace(/하기/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
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
  if (routingResult.route !== "life_schedule_repeat" && routingResult.route !== "life_schedule_once") {
    return false;
  }

  const targetTitle = normalizeMemoryInput(routingResult.title);
  const targetTime = routingResult.displayUnit ?? "";
  return items.some((item) => {
    const typedItem = item as DailyTraceItem & { sourceType?: string; recurrence?: string };
    if (routingResult.route === "life_schedule_once") {
      return (
        typedItem.sourceType === "life_schedule_once" &&
        item.date === routingResult.scheduledDate &&
        normalizeMemoryInput(item.title) === targetTitle &&
        item.time === targetTime
      );
    }

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
    const title = routingResult.title.replace(/하기$/, "");
    return `${title}${getKoreanObjectParticle(title)} 매일 이어갈까요?`;
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
    const title = getRoutineAdjustmentDisplayTitle(routingResult.targetGoalTitle ?? routingResult.title);
    const nextTargetText = formatRoutineDurationMinutes(
      routingResult.newDurationMinutes ?? routingResult.targetValue
    ) || formatRoutineTarget(routingResult.targetValue ?? 0, routingResult.unit);
    return `${title} 목표 시간을\n${nextTargetText}으로 변경할까요?`;
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

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeFallbackTitle(text: string) {
  return cleanTitle(text) || "새 채팅";
}

function cleanTitle(text: string) {
  return text.replace(/["'“”‘’.,!?]/g, "").trim().slice(0, 15);
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



















  flowCard: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },

  flowCardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
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















  flowEmptyExampleText: {
    color: "#8f8f8f",
    fontSize: 12,
    lineHeight: 19,
    marginTop: 10,
    textAlign: "center",
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
  todayMeTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  todayMeStatus: {
    color: "#9cc7ff",
    fontSize: 12,
    fontWeight: "900",
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
  dreamProjectSummaryCard: {
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
  traceScheduleRow: {
    borderBottomColor: "#1c1c1c",
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  traceScheduleRowMain: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
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
  traceScheduleMenuButton: {
    alignItems: "center",
    borderColor: "#2f2f2f",
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  traceScheduleMenuButtonText: {
    color: "#d1d5db",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 20,
  },
  traceScheduleMenuPanel: {
    alignSelf: "flex-end",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    minWidth: 168,
    overflow: "hidden",
  },
  traceScheduleMenuItem: {
    borderBottomColor: "#202020",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  traceScheduleMenuItemText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "800",
  },
  traceScheduleMenuDangerText: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "900",
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
























































































































