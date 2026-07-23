import { addDays, getLocalDateString, parseDateOnly } from "../../noie/dateUtils";
import { TRACE_REMINDER_OPTIONS } from "../../constants/appConstants";
import type { DailyTraceItem } from "../../noie/types";

export type DailyLongRecord = {
  id: string;
  dateKey: string;
  title?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export function buildWeeklyTraceDates(selectedDate: string) {
  const selected = parseDateOnly(selectedDate) ?? new Date();
  const weekStart = new Date(selected);
  weekStart.setDate(selected.getDate() - selected.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return getLocalDateString(date);
  });
}

export function shiftTraceDateKey(dateKey: string, dayDelta: number) {
  const baseDate = parseDateOnly(dateKey) ?? new Date();
  return getLocalDateString(addDays(baseDate, dayDelta));
}

export function isFutureDateKey(dateKey: string, todayKey: string) {
  return dateKey > todayKey;
}

export function formatDailyTraceSelectedDate(dateKey: string) {
  const date = parseDateOnly(dateKey);
  if (!date) {
    return dateKey;
  }

  const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekdays[date.getDay()]}`;
}

export function getDailyLongRecordTitle(dateKey: string, todayKey: string) {
  const yesterdayKey = shiftTraceDateKey(todayKey, -1);
  if (dateKey === todayKey) {
    return "오늘의 기록";
  }

  if (dateKey === yesterdayKey) {
    return "어제의 기록";
  }

  return `${formatShortTraceDate(dateKey)}의 기록`;
}

export function getEmptyLongRecordText(dateKey: string, todayKey: string) {
  if (dateKey > todayKey) {
    return "이날이 지나면 기록을 남길 수 있어요.";
  }

  if (dateKey === todayKey) {
    return "오늘 하루를 조금 더 길게 남겨보세요.";
  }

  return "이날의 기억을 조금 더 길게 남겨보세요.";
}

export function getTraceScheduleSectionTitle(dateKey: string, todayKey: string) {
  return dateKey === todayKey ? "오늘 예정" : "그날의 예정";
}

export function getTraceRemainingSectionTitle(dateKey: string, todayKey: string) {
  return dateKey === todayKey ? "남은 흔적" : "그날 남은 흔적";
}

export function getTraceEmptyScheduleText(dateKey: string, todayKey: string) {
  return dateKey === todayKey ? "오늘 예정된 일은 없어요." : "그날 예정된 일은 없어요.";
}

export function getEmptySelectedDayText(dateKey: string, todayKey: string) {
  if (dateKey > todayKey) {
    return "아직 예정된 일이 없어요.\n필요한 일정이나 할 일을 남겨보세요.";
  }

  if (dateKey === todayKey) {
    return "아직 오늘 남겨진 흔적이 없어요.\n작은 계획이나 있었던 일을 남겨보세요.";
  }

  return "이날에는 남겨진 흔적이 없어요.\n기억나는 일이 있다면 기록으로 남겨보세요.";
}

export function isCancelledTraceItem(item: DailyTraceItem) {
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

export function isCompletedTraceScheduleItem(item: DailyTraceItem) {
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

export function getExistingReminderLabel(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { reminder?: string };
  if (!typedItem.reminder || typedItem.reminder === "none") {
    return "";
  }

  const option = TRACE_REMINDER_OPTIONS.find((candidate) => candidate.value === typedItem.reminder);
  return option?.label ?? "";
}

export function formatUpcomingTraceDate(dateKey: string, todayKey: string) {
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

export function isScheduledDailyTraceItem(item: DailyTraceItem) {
  return isScheduledDailyTraceItemForDate(item, item.date);
}

export function isScheduledDailyTraceItemForDate(item: DailyTraceItem, dateKey: string) {
  if (isLifeRepeatTraceItem(item)) {
    return !getLifeRepeatCompletedAt(item, dateKey);
  }

  return item.type === "schedule" || (item.type === "todo" && !item.isDone);
}

export function isLifeRepeatTraceItem(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { recurrence?: string; sourceType?: string };
  return item.type === "todo" && typedItem.sourceType === "life_schedule_repeat" && Boolean(typedItem.recurrence);
}

export function getLifeRepeatCompletedAt(item: DailyTraceItem, dateKey: string) {
  const typedItem = item as DailyTraceItem & { completedDates?: Record<string, string> };
  return typedItem.completedDates?.[dateKey];
}

export function isDreamFragmentTraceItem(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { sourceDreamFragmentId?: string };

  return (
    item.dreamRole === "fragment" ||
    item.saveTargets?.includes("dream_fragment") ||
    Boolean(item.linkedProjectId && item.memoryType === "project") ||
    Boolean(typedItem.sourceDreamFragmentId)
  );
}

export function getDailyTraceRowIcon(item: DailyTraceItem, dateKey?: string) {
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

export function getDailyTraceRowMemo(item: DailyTraceItem, dateKey?: string) {
  if (isLifeRepeatTraceItem(item) && dateKey && getLifeRepeatCompletedAt(item, dateKey)) {
    return "생활 반복 완료";
  }

  if (item.type === "todo" && item.isDone) {
    return item.time ? `${item.time}에 예정했던 일` : "직접 완료";
  }

  return item.memo;
}

export function getDailyTraceRowSource(item: DailyTraceItem, dateKey?: string) {
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

export function getDailyTraceDisplayTime(item: DailyTraceItem, dateKey?: string) {
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

export function formatTimeFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatShortTraceDate(dateKey: string) {
  const date = parseDateOnly(dateKey);
  if (!date) {
    return dateKey;
  }

  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function getTraceReminderLabel(item: DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { reminder?: string };
  const option = TRACE_REMINDER_OPTIONS.find((candidate) => candidate.value === typedItem.reminder);
  return option?.label ?? item.memo ?? "";
}
