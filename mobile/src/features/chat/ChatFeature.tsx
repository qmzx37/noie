import React from "react";
import type { MutableRefObject } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  TRACE_TYPE_LABELS,
  emotionLabels,
  primaryLabels,
} from "../../noie/constants";
import type {
  ChatMessage,
  ChatSession,
  DailyTraceCandidate,
  DailyTraceItemType,
  DreamRole,
  DreamSavePromptKind,
  EmotionLevel,
  MemorySavePolicy,
  MemorySavePolicyType,
  NoieProject,
  SaveDecision,
  ScreenMode,
} from "../../noie/types";
import { ProjectSidebarList } from "../projects/ProjectFeature";

type NoieSaveRoute =
  | "dream_torch"
  | "dream_fragment"
  | "project_create"
  | "routine_create"
  | "routine_adjustment_intent"
  | "routine_adjustment_confirm"
  | "routine_remove"
  | "routine_record"
  | "life_schedule_once"
  | "life_schedule_repeat"
  | "life_schedule_date_request"
  | "life_schedule_missing_date"
  | "life_schedule_reminder_update"
  | "life_schedule_cancel"
  | "life_action_record"
  | "completed_action"
  | "completed_project"
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

type RoutedChatMessage = ChatMessage & {
  saveRoutingResult?: NoieSaveRoutingResult;
};

type TraceConfirmAction = "today" | "tomorrow" | "default" | "archive" | "continue" | "open_calendar";

type ChatDisplayHelpers = {
  shouldHideSaveUi: (decision?: SaveDecision, memoryPolicy?: MemorySavePolicy) => boolean;
  isDreamOrGoalType: (type?: MemorySavePolicyType) => boolean;
  getPendingMemoryNotice: (memoryPolicy: MemorySavePolicy, dreamSavePromptKind?: DreamSavePromptKind, routingResult?: NoieSaveRoutingResult) => string;
  buildMemorySavePolicy: (type: MemorySavePolicyType) => MemorySavePolicy;
  getRoutineAdjustmentDisplayTitle: (title: string) => string;
  formatRoutineDurationMinutes: (minutes: number | null | undefined) => string;
  getGoalTargetLabel: (item: DailyTraceCandidate) => string;
  getConfirmButtonLabel: (memoryType: MemorySavePolicyType | undefined, candidateType: DailyTraceItemType, routingResult?: NoieSaveRoutingResult) => string;
};
function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "방금";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

export type SidebarProps = {
  sessions: ChatSession[];
  projects: NoieProject[];
  activeSessionId: string;
  activeProjectId: string | null;
  currentMode: ScreenMode;
  getProjectDdayLabel: (deadline?: string) => string;
  onNewChat: () => void;
  onOpenDreamVault: () => void;
  onOpenEmotionFlow: () => void;
  onOpenDailyTrace: () => void;
  onCreateProject: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onResetNoieDevData: () => void;
};

export function Sidebar({
  sessions,
  projects,
  activeSessionId,
  activeProjectId,
  currentMode,
  getProjectDdayLabel,
  onNewChat,
  onOpenDreamVault,
  onOpenEmotionFlow,
  onOpenDailyTrace,
  onCreateProject,
  onSelectProject,
  onSelectSession,
  onDeleteSession,
  onResetNoieDevData,
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
        <ProjectSidebarList
          projects={projects}
          activeProjectId={activeProjectId}
          currentMode={currentMode}
          onCreateProject={onCreateProject}
          onSelectProject={onSelectProject}
          getDdayLabel={getProjectDdayLabel}
        />

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
      {__DEV__ ? (
        <TouchableOpacity
          style={styles.devResetButton}
          onPress={() => {
            console.log("[NOIE RESET TEST] 실제 버튼 onPress 실행");
            if (Platform.OS === "web") {
              const webGlobal = globalThis as typeof globalThis & { window?: { alert?: (message: string) => void } };
              if (typeof webGlobal.window !== "undefined" && typeof webGlobal.window.alert === "function") {
                webGlobal.window.alert("초기화 버튼 연결 확인");
              }
            }
            onResetNoieDevData();
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.devResetButtonText}>노이에 데이터 전체 초기화</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export type ChatScreenProps = {
  activeSession?: ChatSession;
  inputText: string;
  isHydrated: boolean;
  isSending: boolean;
  scrollViewRef: React.MutableRefObject<ScrollView | null>;
  onChangeInputText: (text: string) => void;
  onSendMessage: () => void;
  onToggleAdminView: (messageId: string) => void;
  onToggleSaveDecisionView: (messageId: string) => void;
  onConfirmDailyTrace: (messageId: string, dreamRole?: DreamRole, action?: TraceConfirmAction) => void;
  onDismissDailyTrace: (messageId: string) => void;
  savingDailyTraceMessageIds: string[];
  displayHelpers: ChatDisplayHelpers;
  onContentSizeChange: () => void;
};

export function ChatScreen({
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
  displayHelpers,
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
              displayHelpers={displayHelpers}
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
  onToggleSaveDecisionView: (messageId: string) => void;
  onConfirmDailyTrace: (messageId: string, dreamRole?: DreamRole, action?: TraceConfirmAction) => void;
  onDismissDailyTrace: (messageId: string) => void;
  isSavingDailyTrace: boolean;
  displayHelpers: ChatDisplayHelpers;
};

function ChatBubble({
  message,
  onToggleAdminView,
  onToggleSaveDecisionView,
  onConfirmDailyTrace,
  onDismissDailyTrace,
  isSavingDailyTrace,
  displayHelpers,
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
            displayHelpers={displayHelpers}
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
    case "routine_remove":
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
    case "routine_remove":
      return "end_routine";
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

function DailyTraceCandidateCard({
  message,
  onConfirm,
  onDismiss,
  isSaving,
  displayHelpers,
}: {
  message: ChatMessage;
  onConfirm: (messageId: string, dreamRole?: DreamRole, action?: "today" | "tomorrow" | "default" | "archive" | "continue" | "open_calendar") => void;
  onDismiss: (messageId: string) => void;
  isSaving: boolean;
  displayHelpers: ChatDisplayHelpers;
}) {
  const candidate = message.dailyTraceCandidate;
  const memoryPolicy = message.dailyMemoryPolicy;
  const routingResult = (message as RoutedChatMessage).saveRoutingResult;
  const {
    shouldHideSaveUi,
    isDreamOrGoalType,
    getPendingMemoryNotice,
    buildMemorySavePolicy,
    getRoutineAdjustmentDisplayTitle,
    formatRoutineDurationMinutes,
    getGoalTargetLabel,
    getConfirmButtonLabel,
  } = displayHelpers;

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
  const isRoutineRemove = routingResult?.route === "routine_remove";
  const isRoutineAdjustment = routingResult?.route === "routine_adjustment_intent" || routingResult?.route === "routine_adjustment_confirm";
  const isRoutineAdjustmentConfirm = routingResult?.route === "routine_adjustment_confirm";
  const routineAdjustmentTitle = isRoutineAdjustmentConfirm
    ? getRoutineAdjustmentDisplayTitle(routingResult.targetGoalTitle ?? routingResult.title)
    : "";
  const routineAdjustmentPreviousText = isRoutineAdjustmentConfirm
    ? formatRoutineDurationMinutes(routingResult.previousDurationMinutes)
    : "";
  const routineAdjustmentNextText = isRoutineAdjustmentConfirm
    ? formatRoutineDurationMinutes(routingResult.newDurationMinutes ?? routingResult.targetValue)
    : "";
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
      {isRoutineAdjustmentConfirm ? (
        <>
          <Text style={styles.traceCandidateTitle}>{routineAdjustmentTitle}</Text>
          {routineAdjustmentPreviousText ? (
            <Text style={styles.traceCandidateMemo}>현재 목표 · {routineAdjustmentPreviousText}</Text>
          ) : null}
          {routineAdjustmentNextText ? (
            <Text style={styles.traceCandidateMemo}>변경 목표 · {routineAdjustmentNextText}</Text>
          ) : null}
        </>
      ) : isRoutineCandidate ? (
        <>
          <Text style={styles.traceCandidateTitle}>{candidate.title}</Text>
          {candidate.memo ? (
            <Text style={styles.traceCandidateMemo}>{candidate.memo}</Text>
          ) : null}
        </>
      ) : isRoutineRemove ? (
        <>
          <Text style={styles.traceCandidateTitle}>{candidate.title}</Text>
          {candidate.memo ? (
            <Text style={styles.traceCandidateMemo}>{candidate.memo}</Text>
          ) : null}
        </>
      ) : (
        <>
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
        </>
      )}
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
          ) : isRoutineRemove ? (
            <>
              <TouchableOpacity
                style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, undefined, "archive")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceConfirmButtonText}>{isSaving ? "???以?.." : "없애기"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.traceCancelButton, isSaving && styles.traceConfirmButtonDisabled]}
                onPress={() => onConfirm(message.id, undefined, "continue")}
                disabled={isSaving}
                activeOpacity={0.85}
              >
                <Text style={styles.traceCancelButtonText}>안 할래</Text>
              </TouchableOpacity>
            </>
          ) : isRoutineAdjustment ? (
            <>
              {routingResult.route === "routine_adjustment_confirm" ? (
                <TouchableOpacity
                  style={[styles.traceConfirmButton, isSaving && styles.traceConfirmButtonDisabled]}
                  onPress={() => onConfirm(message.id, undefined, "default")}
                  disabled={isSaving}
                  activeOpacity={0.85}
                >
                  <Text style={styles.traceConfirmButtonText}>{isSaving ? "저장 중..." : "변경하기"}</Text>
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
          {routingResult?.route !== "dream_fragment_complete" && routingResult?.route !== "life_schedule_cancel" && routingResult?.route !== "routine_remove" ? (
            <TouchableOpacity
              style={[styles.traceCancelButton, isSaving && styles.traceConfirmButtonDisabled]}
              onPress={() => onDismiss(message.id)}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              <Text style={styles.traceCancelButtonText}>안 할래</Text>
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



function levelStyle(value: EmotionLevel) {
  if (value === "High") return styles.levelHigh;
  if (value === "Mid") return styles.levelMid;
  return styles.levelLow;
}

const styles = StyleSheet.create({
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
  devResetButton: {
    alignItems: "center",
    borderColor: "#7f1d1d",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    marginBottom: 12,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  devResetButtonText: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "800",
  },
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
});
