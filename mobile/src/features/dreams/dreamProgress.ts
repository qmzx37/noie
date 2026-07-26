import type { DreamRoutine, DreamRoutineRecord } from "../../noie/types";
import { enumerateDateKeys, getLocalDateString, parseDateOnly } from "../../noie/dateUtils";

export type ConsistencyStatus = "complete" | "partial" | "missed" | "neutral";

export type ConsistencyDay = {
  dateKey: string;
  ratio: number;
  status: ConsistencyStatus;
};

type RoutineScheduleBucket = {
  routineId: string;
  bucketKey: string;
  bucketType: "day" | "week";
  startDateKey: string;
  endDateKey: string;
};

export function getDailyRoutineCompletionRatio(
  routine: DreamRoutine,
  dateKey: string,
  records: DreamRoutineRecord[]
) {
  if (hasPausedDate(routine, dateKey)) {
    return 0;
  }
  const record = findRoutineRecord(records, routine.id, dateKey);
  if (isRoutineRecordExplicitlyCompleted(record)) {
    return 1;
  }

  const targetValue = getEffectiveRoutineTargetValue(routine, dateKey);
  const actualValue = getRoutineRecordMeasuredValue(record);
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
      (record) => {
        const recordDateKey = normalizeRoutineRecordDateKey(record.date);
        return (
          record.routineId === routine.id &&
          recordDateKey >= weekStartDateKey &&
          recordDateKey <= weekEndDateKey
        );
      }
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
      if (hasPausedDate(routine, dateKey)) {
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



export function calculateRoutineAccumulationRatio({
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

export function calculateConsistencyScore(
  routines: DreamRoutine[],
  routineRecords: DreamRoutineRecord[]
) {
  const todayKey = getLocalDateString(new Date());
  const today = parseDateOnly(todayKey) ?? new Date();
  const startDate = addDaysLocal(today, -6);
  const dateKeys = enumerateDateKeys(startDate, today);
  const days: ConsistencyDay[] = dateKeys.map((dateKey) => {
    const recordsForDate = routineRecords.filter(
      (record) => normalizeRoutineRecordDateKey(record.date) === dateKey
    );
    const scheduledRoutines = routines.filter(
      (routine) =>
        routine.repeatType !== "weekly" &&
        !hasPausedDate(routine, dateKey) &&
        (isRoutineActiveOnDate(routine, dateKey) ||
          Boolean(findRoutineRecord(routineRecords, routine.id, dateKey)))
    );
    if (scheduledRoutines.length === 0) {
      if (__DEV__) {
        console.log("[CONSISTENCY DAY]", {
          dateKey,
          scheduledRoutineIds: [],
          matchedRecordIds: recordsForDate.map((record) => record.id),
          ratios: [],
          finalRatio: 0,
          status: "neutral",
        });
      }
      return { dateKey, ratio: 0, status: "neutral" };
    }
    const routineRatios = scheduledRoutines.map((routine) => {
      const record = findRoutineRecord(routineRecords, routine.id, dateKey);
      const explicitCompleted = isRoutineRecordExplicitlyCompleted(record);
      const actualValue = getRoutineRecordMeasuredValue(record);
      const targetValue = getEffectiveRoutineTargetValue(routine, dateKey);
      const ratio = getDailyRoutineCompletionRatio(routine, dateKey, routineRecords);

      return ratio;
    });
    const ratio = routineRatios.reduce((sum, value) => sum + value, 0) / scheduledRoutines.length;
    const status: ConsistencyDay["status"] = ratio >= 1 ? "complete" : ratio > 0 ? "partial" : "missed";
    if (__DEV__) {
      console.log("[CONSISTENCY DAY]", {
        dateKey,
        scheduledRoutineIds: scheduledRoutines.map((routine) => routine.id),
        matchedRecordIds: recordsForDate.map((record) => record.id),
        ratios: scheduledRoutines.map((routine, index) => ({
          routineId: routine.id,
          recordId: findRoutineRecord(routineRecords, routine.id, dateKey)?.id,
          explicitCompleted: isRoutineRecordExplicitlyCompleted(
            findRoutineRecord(routineRecords, routine.id, dateKey)
          ),
          actualValue: getRoutineRecordMeasuredValue(findRoutineRecord(routineRecords, routine.id, dateKey)),
          targetValue: getEffectiveRoutineTargetValue(routine, dateKey),
          ratio: routineRatios[index],
        })),
        finalRatio: ratio,
        status,
      });
    }
    return {
      dateKey,
      ratio,
      status,
    };
  });
  const scoredDays = days.filter((day) => day.status !== "neutral");
  const score =
    scoredDays.length > 0
      ? Math.round((scoredDays.reduce((sum, day) => sum + day.ratio, 0) / scoredDays.length) * 100)
      : 0;

  return { score: clampPercent(score), days };
}



export function buildNeutralConsistencyDays() {
  const today = parseDateOnly(getLocalDateString(new Date())) ?? new Date();
  return enumerateDateKeys(addDaysLocal(today, -6), today).map((dateKey) => ({
    dateKey,
    ratio: 0,
    status: "neutral" as const,
  }));
}



export function getConsistencyStatusSymbol(status: ConsistencyDay["status"]) {
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



export function getConsistencyWeekdayLabel(dateKey: string) {
  const date = parseDateOnly(dateKey);
  if (!date) {
    return "";
  }
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}



export function isRoutineActiveOnDate(routine: DreamRoutine, dateKey: string) {
  const createdDateKey = getLocalDateString(parseDateOnly(routine.createdAt) ?? new Date());
  return dateKey >= createdDateKey;
}



export function findRoutineRecord(
  records: DreamRoutineRecord[],
  routineId: string,
  dateKey: string
) {
  const normalizedDateKey = normalizeRoutineRecordDateKey(dateKey);
  return records.find(
    (record) =>
      record.routineId === routineId &&
      normalizeRoutineRecordDateKey(record.date) === normalizedDateKey
  );
}



export function normalizeRoutineRecordDateKey(value?: string | null) {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const dateOnlyMatch = trimmed.match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const parsed = parseDateOnly(
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    );
    return parsed ? getLocalDateString(parsed) : "";
  }
  const parsed = parseDateOnly(trimmed);
  if (parsed) {
    return getLocalDateString(parsed);
  }
  const fallbackDate = new Date(trimmed);
  return Number.isNaN(fallbackDate.getTime()) ? "" : getLocalDateString(fallbackDate);
}



export function getRoutineRecordActualValue(record?: DreamRoutineRecord) {
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



export function getRoutineRecordMeasuredValue(record?: DreamRoutineRecord) {
  if (!record) {
    return 0;
  }
  const recordWithActual = record as DreamRoutineRecord & {
    actualValue?: number;
    amount?: number;
  };
  return (
    safeNumber(recordWithActual.actualValue) ||
    safeNumber(recordWithActual.amount) ||
    safeNumber(record.value)
  );
}



export function isRoutineRecordExplicitlyCompleted(record?: DreamRoutineRecord) {
  if (!record) {
    return false;
  }
  const recordWithCompletion = record as DreamRoutineRecord & {
    completed?: boolean;
    completedAt?: string;
  };
  return (
    recordWithCompletion.completed === true ||
    Boolean(recordWithCompletion.completedAt) ||
    safeNumber(record.score) >= 1
  );
}



export function isRoutineActionDoneToday(record?: DreamRoutineRecord) {
  return Boolean(record && (getRoutineRecordActualValue(record) > 0 || record.score > 0));
}



export function safeNumber(value: unknown) {
  const numberValue = typeof value === "number" || typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numberValue) ? numberValue : 0;
}



export function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}



export function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}



export function roundProgressPercent(value: number) {
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



function hasPausedDate(routine: DreamRoutine, dateKey: string) {
  return Boolean(
    routine.pausedDates?.some(
      (pausedDateKey) => normalizeRoutineRecordDateKey(pausedDateKey) === dateKey
    )
  );
}



export function getEffectiveRoutineTargetValue(routine: DreamRoutine, dateKey: string) {
  const dailyTarget = routine.dailySettings?.[dateKey]?.targetValue;
  if (typeof dailyTarget === "number" && Number.isFinite(dailyTarget)) {
    return dailyTarget;
  }
  return safeNumber(routine.targetValue);
}



export function getEffectiveRoutineMinimumValue(routine: DreamRoutine, dateKey: string) {
  const dailyMinimum = routine.dailySettings?.[dateKey]?.minimumValue;
  if (typeof dailyMinimum === "number" && Number.isFinite(dailyMinimum)) {
    return dailyMinimum;
  }
  return safeNumber(routine.minimumValue);
}

