import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  SafeAreaView,
  ScrollView,
  StatusBar,
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
  DailyTraceCandidate,
  DailyTraceItem,
  DailyTraceItemType,
  DailyTraceStatus,
  DreamCompletionCriterion,
  DreamEvidence,
  DreamMilestoneStatus,
  DreamRole,
  DreamRoutine,
  DreamRoutineDailySetting,
  DreamRoutineQuickScore,
  DreamRoutineRecord,
  DreamRoutineRecordType,
  DreamSavePromptKind,
  EmotionAxis,
  EmotionKey,
  GoalDurationMonths,
  MemorySavePolicy,
  MemorySavePolicyType,
  NoieProject,
  NoieProjectMessage,
  PrimaryAxis,
  ProjectEmotionAdminView,
  ProjectFormState,
  SaveDecision,
  SaveNoieMemoryResult,
  ScreenMode,
  StartProjectInput,
} from "./src/noie/types";
import {
  DEFAULT_FLOW_KEYS,
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
  DailyTraceScreen,
} from "./src/features/traces/DailyTraceSection";
import {
  appendDailyLongRecordBodyInList,
  cancelDailyTraceSchedule,
  deleteLifeRepeatScheduleInItems,
  endLifeRepeatScheduleFromDateInItems,
  removeDailyTraceGoalItem,
  replaceDailyLongRecordBodyInList,
  saveDailyLongRecordInList,
  skipLifeRepeatScheduleOnDateInItems,
  toggleDailyTraceCompletion,
  updateDailyLongRecordTitleInList,
  updateDailyTraceReminder,
  updateRecentDailyTraceLineInItems,
} from "./src/features/traces/dailyTraceActions";
import {
  findDailyRecordCommandRoute,
  formatRoutineTarget,
  formatRoutineTargetForDisplay,
} from "./src/features/traces/dailyTraceRoutingLogic";
import {
  getDayPieceText,
  getMeaningfulDailyPieceText,
  getRecentDailyPieces,
  isDreamFragmentDayPiece,
  normalizeDreamFragmentKey,
} from "./src/features/traces/dailyPieceLogic";
import {
  findExplicitRoutineDurationAdjustmentRoute,
  findRoutineAdjustmentIntent,
  findRoutineDurationCreationRoute,
  findRoutineRecordRoute,
  findRoutineRemoveRoute,
  formatRoutineDurationMinutes,
  getRoutineAdjustmentDisplayTitle,
  isAdditiveRoutineRecordText,
  isExplicitAdditiveRoutineRecordRequest,
  isNonCompletionRoutineText,
  normalizeRoutineKey,
  normalizeRoutineTitleKey,
  parseRoutineGoalCandidate,
  parseTargetValueWithUnit,
  selectPreferredRoutineCandidate,
  type PendingRoutineAdjustment,
} from "./src/features/routines/routineRoutingLogic";
import {
  findFutureOneTimeScheduleRoute,
  findLifeScheduleMutationRoute,
  findLifeScheduleRoute,
  getReminderLabelByValue,
  makeMemoryTitle,
  normalizeRoutineTitle,
} from "./src/features/traces/lifeScheduleRoutingLogic";
import {
  DreamFeature,
  type DreamTorchDisplayItem,
} from "./src/features/dreams/DreamFeature";
import {
  cleanDreamFragmentCommandText,
  cleanDreamFragmentNextText,
  findDreamFragmentCompleteRoute,
  findDreamFragmentMatchesByTitle,
  findDreamFragmentNextActionUpdateRoute,
  findDreamFragmentRenameRoute,
  findReferencedDreamForTorchRequest,
  findRecentDreamReference,
  findSingleDreamFragmentByTitle,
  getDreamFragments,
  getKoreanObjectParticle,
  isCareerDreamText,
  isDailyIdeaText,
  isDreamFragmentText,
  isDreamOrGoalType,
  isDreamTorchCandidateText,
  isExplicitTorchReferenceText,
  isHiddenFromDream,
  isLifeDirectionDreamText,
  makeDreamChoicePromptTitle,
  normalizeDreamTitleForLookup,
  sortDreamItemsByImportance,
} from "./src/features/dreams/dreamRoutingLogic";
import {
  buildActiveDreamFragmentDisplayItems,
  buildCompletedDreamFragmentDisplayItems,
  formatRoutineMeta,
  getActiveDreamFragments,
  getCompletedProjectForFragment,
  getDreamTorchCandidates,
  isProjectActionDone,
  selectDreamTorchPiece,
} from "./src/features/dreams/dreamDisplayLogic";
import {
  TodayMeSection,
  type TodayMeCard,
  type TodayMeRecommendation,
} from "./src/features/dreams/TodayMeSection";
import {
  areRoutineTitlesSemanticallyDuplicate,
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
  deleteRoutineCompletelyFromItems,
  recordRoutineExecutionInItems,
  removeRoutineFromTodayMeInItems,
  removeRoutineRecordFromItems,
  upsertTodayMeRoutineInItems,
  updateRoutineDailyTargetForItem,
  updateRoutineTargetInItems,
  updateRoutineTodayMeStateInItems,
} from "./src/features/routines/routineActions";
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
  extractProjectTitle,
  findCompletedProjectActionRoute,
  findCompletedProjectRoute,
  findDuplicateProjectByText,
  findDuplicateProjectRoute,
  isProjectStartText,
  makeProjectTitle,
} from "./src/features/projects/projectRoutingLogic";
import {
  ChatScreen,
  Sidebar,
} from "./src/features/chat/ChatFeature";
import { EmotionFlowFeature } from "./src/features/emotions/EmotionFlowFeature";
import {
  buildEmotionFlowInterpretation,
  calculateWeeklyAverages,
  collectEmotionRecords,
} from "./src/features/emotions/emotionFlowLogic";
import type { DailyLongRecord } from "./src/features/traces/traceFeature";
import {
  buildWeeklyTraceDates,
  formatShortTraceDate,
  getDailyLongRecordTitle,
  getExistingReminderLabel,
  getTraceEmptyScheduleText,
  isCancelledTraceItem,
  isCompletedTraceScheduleItem,
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
import {
  isDuplicateDreamFragmentRoute,
  isDuplicateLifeScheduleRoute,
  isDuplicateRoutineRoute,
  resolvePrimarySaveRoute,
  resolveTodayMeRoutineRecordTarget,
  resolveTodayMeRoutineRemoveTarget,
} from "./src/noie/saveRoutingLogic";
import { buildRoutedDailyTraceCandidate } from "./src/noie/dailyTraceCandidateLogic";
import {
  buildMemorySavePolicy,
  buildMemorySavePolicyFromDecision,
  calculateMemoryImportance,
  classifyMemorySavePolicy,
  dedupeMemories,
  getMemoryInputText,
  getMemoryPolicy,
  getMemoryPolicyForRoute,
  getMemorySemanticKey,
  normalizeMemoryInput,
  shouldSaveToDailyPieces,
  shouldSaveToDailyTrace,
  type NoieSaveRoute,
  type NoieSaveRoutingResult,
} from "./src/noie/memoryLogic";

import { styles } from "./src/styles/appStyles";

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

      const normalizedDailyTraces = normalizeDailyTraces(parsedDailyTraces);
      const repairedDailyTraces =
        repairRoutineTitlesFromOriginalText(normalizedDailyTraces);
      setDailyTraces(repairedDailyTraces);
      if (repairedDailyTraces !== normalizedDailyTraces) {
        saveJsonValue(STORAGE_KEYS.dailyTraces, repairedDailyTraces).catch((error) =>
          console.log("[noie] routine title repair failed", error)
        );
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
        selectedDreamTorchId: dreamTorchId,
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
      const routingTodayKey = getLocalDateString(new Date());
      const resolvedTraceCandidate = buildRoutedDailyTraceCandidate({
        userText: trimmedText,
        extractedCandidate: traceCandidate,
        memoryPolicy: routedMemoryPolicy,
        routingResult,
        todayKey: routingTodayKey,
      });
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
        } else if (isDuplicateRoutineRoute(routingResult, dailyTraces, dreamTorchId)) {
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

      if (routingResult.route === "routine_remove") {
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
    const existingRoutineMatch = selectPreferredRoutineCandidate({
      routines: targetTorch.routines ?? [],
      requestedTitle: routineTitle,
      includeArchivedFallback: true,
      isActiveRoutine: isActiveTodayMeRoutine,
    });
    const existingRoutine = existingRoutineMatch?.routine;
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
      const upsertResult = upsertTodayMeRoutineInItems({
        currentItems: dailyTraces,
        torchItem: targetTorch,
        existingRoutineId: existingRoutine.id,
        title: routineTitle,
        recordType: "quantity",
        repeatType: routingResult.repeatType ?? "daily",
        targetValue: nextTargetValue,
        minimumValue: routingResult.minimumValue ?? 0,
        unit: routingResult.unit,
        now,
        newRoutineId: createId("routine"),
      });

      setDailyTraces(upsertResult.nextItems);
      await saveJsonValue(STORAGE_KEYS.dailyTraces, upsertResult.nextItems);
      if (!torchPiece) {
        setDreamTorchId(upsertResult.nextTorch.id);
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

    const upsertResult = upsertTodayMeRoutineInItems({
      currentItems: dailyTraces,
      torchItem: targetTorch,
      title: routineTitle,
      recordType: "quantity",
      repeatType: routingResult.repeatType ?? "daily",
      targetValue: routingResult.targetValue ?? undefined,
      minimumValue: routingResult.minimumValue ?? 0,
      unit: routingResult.unit,
      now,
      newRoutineId: createId("routine"),
    });

    setDailyTraces(upsertResult.nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, upsertResult.nextItems);
    if (!torchPiece) {
      setDreamTorchId(upsertResult.nextTorch.id);
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
    const existingRoutineMatch = selectPreferredRoutineCandidate({
      routines: targetTorch.routines ?? [],
      requestedTitle: routineTitle,
      includeArchivedFallback: true,
      isActiveRoutine: isActiveTodayMeRoutine,
    });
    const existingRoutine = existingRoutineMatch?.routine;

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
      const upsertResult = upsertTodayMeRoutineInItems({
        currentItems: dailyTraces,
        torchItem: targetTorch,
        existingRoutineId: existingRoutine.id,
        title: routineTitle,
        recordType: "quantity",
        repeatType: "daily",
        targetValue: nextTargetValue,
        minimumValue: 0,
        now,
        newRoutineId: createId("routine"),
      });

      setDailyTraces(upsertResult.nextItems);
      await saveJsonValue(STORAGE_KEYS.dailyTraces, upsertResult.nextItems);
      if (!torchPiece) {
        setDreamTorchId(upsertResult.nextTorch.id);
      }
      console.log("[TODAY ME ROUTINE RESTORED]", {
        routineId: upsertResult.routine.id,
        targetValue: nextTargetValue,
      });
      setTodayMeFeedback("기존 반복 목표를 오늘의 나에 다시 이어왔어요.");
      return true;
    }

    const upsertResult = upsertTodayMeRoutineInItems({
      currentItems: dailyTraces,
      torchItem: targetTorch,
      title: routineTitle,
      recordType: "quantity",
      repeatType: "daily",
      targetValue: Math.max(30, input.targetValue),
      minimumValue: 0,
      unit: "분",
      now,
      newRoutineId: createId("routine"),
    });

    setDailyTraces(upsertResult.nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, upsertResult.nextItems);
    if (!torchPiece) {
      setDreamTorchId(upsertResult.nextTorch.id);
    }
    console.log("[TODAY ME ROUTINE CREATED]", {
      routineId: upsertResult.routine.id,
      targetValue: upsertResult.routine.targetValue,
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

      if (routingResult?.route === "routine_remove") {
        if (action !== "archive") {
          updateSession(activeSession.id, (session) => ({
            ...session,
            messages: session.messages.map((item) =>
              item.id === messageId
                ? { ...item, dailyTraceStatus: "dismissed", dailyTraceNotice: "그대로 이어갈게요." }
                : item
            ),
            updatedAt: now,
          }));
          return;
        }

        const removeTarget = resolveTodayMeRoutineRemoveTarget(
          routingResult,
          dailyTraces,
          dreamTorchId
        );
        if (!removeTarget) {
          updateSession(activeSession.id, (session) => ({
            ...session,
            messages: session.messages.map((item) =>
              item.id === messageId
                ? { ...item, dailyTraceStatus: "dismissed", dailyTraceNotice: "오늘의 나에서 해당 반복 목표를 찾지 못했어요." }
                : item
            ),
            updatedAt: now,
          }));
          return;
        }

        const didRemove = await removeRoutineFromTodayMeById(
          removeTarget.itemId,
          removeTarget.routineId,
          "chat"
        );
        updateSession(activeSession.id, (session) => ({
          ...session,
          messages: session.messages.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  dailyTraceStatus: didRemove ? "added" : "dismissed",
                  dailyTraceNotice: didRemove
                    ? `${removeTarget.title}를 오늘의 나에서 없앴어요.`
                    : "오늘의 나에서 해당 반복 목표를 찾지 못했어요.",
                }
              : item
          ),
          updatedAt: now,
        }));
        return;
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

        const routineRecordTarget = resolveTodayMeRoutineRecordTarget(
          routingResult,
          dailyTraces,
          dreamTorchId
        );
        const routineRecordDateKey = getLocalDateString(new Date());
        const didRecord = await recordRoutineExecution({
          itemId: routineRecordTarget?.itemId ?? routingResult.matchedDailyTraceId ?? undefined,
          routineId: routineRecordTarget?.routineId ?? routingResult.matchedRoutineId,
          dateKey: routineRecordDateKey,
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
    const targetDateKey = dateKey ?? getLocalDateString(new Date());
    setDailyTraces((currentItems) =>
      toggleDailyTraceCompletion(currentItems, itemId, now, targetDateKey)
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
      const newRecordId = currentRecords.some((record) => record.dateKey === input.dateKey)
        ? ""
        : createId("daily-long-record");
      return saveDailyLongRecordInList(currentRecords, input.dateKey, title, body, newRecordId, now);
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
    const newRecordId = dailyLongRecords.some((record) => record.dateKey === dateKey)
      ? ""
      : createId("daily-long-record");
    const nextRecords = normalizeDailyLongRecords(
      replaceDailyLongRecordBodyInList(
        dailyLongRecords,
        dateKey,
        body,
        newRecordId,
        now
      )
    );
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

    const nextRecords = updateDailyLongRecordTitleInList(dailyLongRecords, dateKey, title, now);
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
    const newRecordId = dailyLongRecords.some((record) => record.dateKey === dateKey)
      ? ""
      : createId("daily-long-record");
    const nextRecords = normalizeDailyLongRecords(
      appendDailyLongRecordBodyInList(
        dailyLongRecords,
        dateKey,
        body,
        newRecordId,
        now
      )
    );
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
    const nextItems = updateRecentDailyTraceLineInItems(
      dailyTraces,
      routingResult.matchedDailyTraceId,
      nextText,
      now
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
    const nextItems = updateDailyTraceReminder(
      dailyTraces,
      routingResult.matchedDailyTraceId,
      reminder,
      `🔔 ${routingResult.unit ?? getReminderLabelByValue(reminder)}`,
      now
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
    const nextItems = cancelDailyTraceSchedule(dailyTraces, scheduleId, now);
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
    const result = skipLifeRepeatScheduleOnDateInItems(dailyTraces, itemId, dateKey, now);
    const title = result.title;
    const didUpdate = result.didUpdate;
    const nextItems = result.nextItems;
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
    const result = endLifeRepeatScheduleFromDateInItems(dailyTraces, itemId, dateKey, now);
    const title = result.title;
    const didUpdate = result.didUpdate;
    const nextItems = result.nextItems;
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
    const result = deleteLifeRepeatScheduleInItems(dailyTraces, itemId, now);
    const target = result.didUpdate ? { title: result.title } : null;
    if (!target) {
      return false;
    }
    const nextItems = result.nextItems;
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

    const recordResult = recordRoutineExecutionInItems({
      currentItems: dailyTraces,
      itemId,
      routineId,
      dateKey,
      actualValue: safeActualValue,
      unit,
      originalText,
      completedOnly,
      now,
      newRecordId: createId("routine-record"),
    });
    let nextItems = recordResult.nextItems;
    const didUpdate = recordResult.found;
    const routineTitle = recordResult.routineTitle ?? "";
    const displayUnit = recordResult.displayUnit ?? unit ?? "";

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

  const removeRoutineFromTodayMeById = async (
    itemId: string,
    routineId: string,
    source: "ui" | "chat"
  ) => {
    const now = new Date().toISOString();
    const today = getLocalDateString(new Date());
    const result = removeRoutineFromTodayMeInItems({
      currentItems: dailyTraces,
      itemId,
      routineId,
      dateKey: today,
      now,
      resetTodayRecord: true,
    });
    if (!result.removed) {
      return false;
    }
    setDailyTraces(result.nextItems);
    await saveJsonValue(STORAGE_KEYS.dailyTraces, result.nextItems);
    console.log("[today-me-card-removed]", { sourceType: "routine", sourceId: routineId, source });
    return true;
  };

  const removeRoutineFromTodayMe = (itemId: string, routineId: string) => {
    removeRoutineFromTodayMeById(itemId, routineId, "ui").catch((error) =>
      console.error("[today-me-routine-remove-save-error]", error)
    );
  };

  const deleteRoutineCompletelyFromTodayMe = (itemId: string, routineId: string) => {
    const now = new Date().toISOString();
    const targetItem = dailyTraces.find((item) => item.id === itemId);
    const targetRoutine = targetItem?.routines?.find((routine) => routine.id === routineId);
    if (!targetRoutine) {
      setTodayMeFeedback("삭제할 반복 목표를 찾지 못했어요.");
      return;
    }
    const routineIds = dailyTraces.flatMap((item) =>
      (item.routines ?? [])
        .filter((routine) =>
          routine.id === routineId ||
          areRoutineTitlesSemanticallyDuplicate(routine.title, targetRoutine.title)
        )
        .map((routine) => routine.id)
    );
    const result = deleteRoutineCompletelyFromItems({
      currentItems: dailyTraces,
      routineIds,
      now,
    });
    if (result.deletedRoutineCount === 0) {
      setTodayMeFeedback("삭제할 반복 목표를 찾지 못했어요.");
      return;
    }
    setDailyTraces(result.nextItems);
    saveJsonValue(STORAGE_KEYS.dailyTraces, result.nextItems).catch((error) =>
      console.error("[today-me-routine-complete-delete-save-error]", error)
    );
    setTodayMeFeedback(`${targetRoutine.title}을(를) 완전히 삭제했어요.`);
    console.log("[today-me-routine-completely-deleted]", {
      routineId,
      deletedRoutineIds: result.deletedRoutineIds,
      deletedRoutineCount: result.deletedRoutineCount,
      deletedRecordCount: result.deletedRecordCount,
      deletedLegacyTraceCount: result.deletedLegacyTraceCount,
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
        return existingProject.id;
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
      return newProject.id;
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
    const startedProjectId = await handleStartProjectInTodayMe({
      title: extractProjectTitle(fragment.title, fragment),
      originalText: getMemoryInputText(fragment) || fragment.title,
      relatedDreamTorchId: torchPiece?.id ?? null,
      relatedDreamFragmentId: fragment.id,
      nextAction: fragment.nextAction ?? "",
      source: "dream_fragment",
    });

    if (!startedProjectId) {
      return;
    }

    const now = new Date().toISOString();
    setDailyTraces((currentItems) =>
      currentItems.map((item) =>
        item.id === fragment.id
          ? {
              ...item,
              relatedDreamTorchId: torchPiece?.id ?? item.relatedDreamTorchId,
              linkedProjectId: startedProjectId,
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
      removeDailyTraceGoalItem(currentItems, itemId)
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
    const activeDreamFragments = getActiveDreamFragments(dreamFragments, projects);
    const completedDreamFragments = buildCompletedDreamFragmentDisplayItems(dreamFragments, projects);
    const activeDreamFragmentCards = buildActiveDreamFragmentDisplayItems(activeDreamFragments, projects);
    const todayKey = getLocalDateString(new Date());
    const todayMeProjects = getTodayMeProjects(torchPiece, dreamFragments, projects);
    const todayMeCards = getVisibleTodayMeCards(torchPiece, dreamFragments, projects, todayKey);
    const fireRoutines = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "routine" }> => card.cardType === "routine");
    const fireProjects = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "project" }> => card.cardType === "project");
    const dreamProjectSummary = getDreamProjectSummary(todayMeProjects, torchPiece, projects, {
      todayConsistencyRoutineGroups: buildTodayConsistencyRoutineGroups(
        torchPiece,
        fireRoutines.map(({ routine }) => routine)
      ),
    });
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
            onDeleteRoutineCompletely={deleteRoutineCompletelyFromTodayMe}
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
              styles={styles}
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

function buildTodayConsistencyRoutineGroups(
  torchPiece: DailyTraceItem | undefined,
  visibleRoutines: DreamRoutine[]
) {
  const allRoutines = torchPiece?.routines ?? [];

  return visibleRoutines.map((visibleRoutine) => {
    const routines = allRoutines.filter((routine) =>
      routine.id === visibleRoutine.id ||
      areRoutineTitlesSemanticallyDuplicate(routine.title, visibleRoutine.title)
    );

    return {
      primaryRoutineId: visibleRoutine.id,
      routines: routines.length > 0 ? routines : [visibleRoutine],
    };
  });
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

  if (routingResult?.route === "routine_remove") {
    return "오늘의 나에서 이 반복 목표를 없앨까요?";
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
