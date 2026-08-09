import { TRACE_CONFIRM_LABELS } from "./constants";
import { getLocalDateString } from "./dateUtils";
import type {
  DailyTraceItemType,
  DreamRole,
  DreamSavePromptKind,
  MemorySavePolicy,
  MemorySavePolicyType,
  SaveDecision,
} from "./types";
import type { NoieSaveRoutingResult } from "./memoryLogic";
import { formatRoutineTarget } from "../features/traces/dailyTraceRoutingLogic";
import { getDailyLongRecordTitle, shiftTraceDateKey } from "../features/traces/traceFeature";
import { formatRoutineDurationMinutes, getRoutineAdjustmentDisplayTitle } from "../features/routines/routineRoutingLogic";
import {
  getKoreanObjectParticle,
  isDreamFragmentText,
  isDreamOrGoalType,
} from "../features/dreams/dreamRoutingLogic";

export function getAutoSavedMemoryNotice(type: MemorySavePolicyType) {
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

export function isDailyTraceConfirmType(type?: MemorySavePolicyType) {
  return type === "todo" || type === "task" || type === "schedule" || type === "daily_plan";
}

export function getPendingMemoryNotice(
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

export function formatScheduleRouteDateLabel(routingResult: NoieSaveRoutingResult) {
  if (/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/.test(routingResult.originalText)) {
    const match = routingResult.originalText.match(/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/);
    const weekday = match?.[1] ?? "";
    return `다음 주 ${weekday.length === 1 ? `${weekday}요일` : weekday}`;
  }
  return formatRelativeScheduleLabel(routingResult.scheduledDate);
}

export function formatRelativeScheduleLabel(dateKey?: string | null) {
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

export function stripKoreanTimePeriodIfSame(value?: string | null, previous?: string | null) {
  if (!value || !previous) {
    return value ?? "";
  }
  const previousPeriod = previous.match(/^(오전|오후)/)?.[1];
  if (previousPeriod && value.startsWith(previousPeriod)) {
    return value.replace(/^(오전|오후)\s*/, "");
  }
  return value;
}

export function formatScheduleTitleForSentence(title: string) {
  if (title.endsWith(" 가기")) {
    return title.slice(0, -3);
  }
  if (title.endsWith("기")) {
    return title.slice(0, -1);
  }
  return title;
}

export function getConfirmButtonLabel(
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

export function getDreamRoleButtonOrder(kind?: DreamSavePromptKind): DreamRole[] {
  return kind === "fragment_first" ? ["fragment", "torch"] : ["torch", "fragment"];
}

export function getDreamSavePromptKind(text: string): DreamSavePromptKind {
  return isDreamFragmentText(text) ? "fragment_first" : "torch_first";
}

export function shouldHideSaveUi(
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
export function getSavedMemoryNotice(memoryPolicy: MemorySavePolicy) {
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

export function getDuplicateMemoryNotice(memoryPolicy?: MemorySavePolicy) {
  if (isDreamOrGoalType(memoryPolicy?.type)) {
    return "이미 꿈의 조각에 있는 내용이에요.";
  }

  return "이미 하루의 조각에 있는 내용이에요.";
}

export function getGoalTargetLabel(
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
