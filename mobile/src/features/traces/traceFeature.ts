import { addDays, getLocalDateString, parseDateOnly } from "../../noie/dateUtils";
import { TRACE_REMINDER_OPTIONS } from "../../constants/appConstants";
import type { DailyTraceItem } from "../../noie/types";
import {
  dedupeMemories,
  getMemoryPolicy,
  normalizeMemoryInput,
  shouldSaveToDailyTrace,
} from "../../noie/memoryLogic";

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

export function getDailyTraceItemsForDate(items: DailyTraceItem[], dateKey: string) {
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

export type UpcomingTraceSchedule = {
  item: DailyTraceItem;
  dateKey: string;
  reminderLabel: string;
};

export function buildUpcomingTraceSchedules(items: DailyTraceItem[], todayKey: string): UpcomingTraceSchedule[] {
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

export function getTraceDaySymbol(
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
