import type { DailyTraceItem } from "../../noie/types";
import { isLifeRepeatTraceItem } from "./traceFeature";

type CompletedDatesTraceItem = DailyTraceItem & {
  completedDates?: Record<string, string>;
};

type TodoCompletionTraceItem = DailyTraceItem & {
  completedAt?: string;
};

type CancelledScheduleTraceItem = DailyTraceItem & {
  status?: string;
  cancelledAt?: string;
};

export function toggleDailyTraceCompletion(
  items: DailyTraceItem[],
  itemId: string,
  now: string,
  dateKey: string
) {
  return items.map((item) => {
    if (item.id !== itemId || item.type !== "todo") {
      return item;
    }

    if (isLifeRepeatTraceItem(item)) {
      const typedItem = item as CompletedDatesTraceItem;
      if (typedItem.completedDates?.[dateKey]) {
        return item;
      }
      return {
        ...item,
        completedDates: {
          ...(typedItem.completedDates ?? {}),
          [dateKey]: now,
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
    } as TodoCompletionTraceItem;
  });
}

export function removeDailyTraceGoalItem(items: DailyTraceItem[], itemId: string) {
  return items.filter((item) => !(item.id === itemId && item.type === "goal"));
}

export function cancelDailyTraceSchedule(
  items: DailyTraceItem[],
  scheduleId: string,
  now: string
) {
  return items.map((item) =>
    item.id === scheduleId
      ? ({
          ...item,
          status: "cancelled",
          cancelledAt: now,
          updatedAt: now,
        } as CancelledScheduleTraceItem)
      : item
  );
}

export function updateDailyTraceReminder(
  items: DailyTraceItem[],
  itemId: string,
  reminder: string,
  memo: string,
  now: string
) {
  return items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          reminder,
          memo,
          updatedAt: now,
        }
      : item
  );
}
