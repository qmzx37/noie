import type { DailyTraceItem } from "../../noie/types";
import { isLifeRepeatTraceItem } from "./traceFeature";
import type { DailyLongRecord } from "./traceFeature";

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

export function saveDailyLongRecordInList(
  records: DailyLongRecord[],
  dateKey: string,
  title: string | undefined,
  body: string,
  newRecordId: string,
  now: string
) {
  const existingRecord = records.find((record) => record.dateKey === dateKey);
  if (existingRecord) {
    return records.map((record) =>
      record.dateKey === dateKey
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
    ...records,
    {
      id: newRecordId,
      dateKey,
      title: title || undefined,
      body,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function replaceDailyLongRecordBodyInList(
  records: DailyLongRecord[],
  dateKey: string,
  body: string,
  newRecordId: string,
  now: string
) {
  const existingRecord = records.find((record) => record.dateKey === dateKey);
  return [
    ...records.filter((record) => record.dateKey !== dateKey),
    {
      id: existingRecord?.id ?? newRecordId,
      dateKey,
      title: existingRecord?.title,
      body,
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now,
    },
  ];
}

export function updateDailyLongRecordTitleInList(
  records: DailyLongRecord[],
  dateKey: string,
  title: string,
  now: string
) {
  const existingRecord = records.find((record) => record.dateKey === dateKey);
  if (!existingRecord) {
    return records;
  }

  return records.map((record) =>
    record.dateKey === dateKey
      ? {
          ...record,
          title,
          updatedAt: now,
        }
      : record
  );
}

export function appendDailyLongRecordBodyInList(
  records: DailyLongRecord[],
  dateKey: string,
  body: string,
  newRecordId: string,
  now: string
) {
  const existingRecord = records.find((record) => record.dateKey === dateKey);
  return [
    ...records.filter((record) => record.dateKey !== dateKey),
    existingRecord
      ? {
          ...existingRecord,
          body: `${existingRecord.body.trim()}\n\n${body}`,
          updatedAt: now,
        }
      : {
          id: newRecordId,
          dateKey,
          body,
          createdAt: now,
          updatedAt: now,
        },
  ];
}

export function updateRecentDailyTraceLineInItems(
  items: DailyTraceItem[],
  itemId: string,
  nextText: string,
  now: string
) {
  return items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          title: nextText,
          text: nextText,
          memo: nextText,
          updatedAt: now,
        }
      : item
  );
}
