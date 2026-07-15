import type { DailyTraceItem, GoalDurationMonths } from "./types";

export function parseDateOnly(value?: string) {
  if (!value) {
    return null;
  }
  const normalized = value.includes(".") ? value.replace(/\./g, "-") : value;
  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export function maxDate(left: Date, right: Date | null) {
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

export function minDate(left: Date, right: Date | null) {
  if (!right) {
    return left;
  }
  return left < right ? left : right;
}

export function enumerateDateKeys(startDate: Date, endDate: Date) {
  const keys: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    keys.push(getLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

export function calculateElapsedPeriodPercent(start?: string, target?: string) {
  const startDate = parseDateOnly(start);
  const targetDate = parseDateOnly(target);
  if (!startDate || !targetDate || targetDate <= startDate) {
    return 0;
  }

  const today = parseDateOnly(getLocalDateString(new Date())) ?? new Date();
  const totalDays = Math.max(1, Math.round((targetDate.getTime() - startDate.getTime()) / 86400000));
  const elapsedDays = Math.round((today.getTime() - startDate.getTime()) / 86400000);
  return Math.max(0, Math.min(100, Math.round((elapsedDays / totalDays) * 100)));
}

export function isValidDateKey(value?: string) {
  return Boolean(parseDateOnly(value));
}

export function addMonthsToLocalDate(isoDate: string, months: GoalDurationMonths) {
  const source = parseDateOnly(isoDate) ?? new Date();
  const year = source.getFullYear();
  const month = source.getMonth();
  const day = source.getDate();
  const lastDay = new Date(year, month + months + 1, 0).getDate();
  const nextDate = new Date(year, month + months, Math.min(day, lastDay));
  return getLocalDateString(nextDate);
}

export function getSelectedGoalDuration(piece: DailyTraceItem): GoalDurationMonths | null {
  if (piece.goalDurationMonths === 3 || piece.goalDurationMonths === 6 || piece.goalDurationMonths === 12) {
    return piece.goalDurationMonths;
  }

  const startDate = parseDateOnly(piece.goalStartDate);
  const targetDate = parseDateOnly(piece.goalTargetDate);
  if (!startDate || !targetDate) {
    return null;
  }

  for (const months of [3, 6, 12] as GoalDurationMonths[]) {
    if (addMonthsToLocalDate(getLocalDateString(startDate), months) === getLocalDateString(targetDate)) {
      return months;
    }
  }

  return null;
}

export function getGoalDurationMessage(months: GoalDurationMonths) {
  if (months === 3) {
    return "3개월 동안 이 꿈에 집중해요.";
  }
  if (months === 6) {
    return "6개월 동안 이 꿈을 이어가요.";
  }
  return "12개월 동안 천천히 오래 이어가요.";
}

export function formatDateDot(value: string) {
  return value.replace(/-/g, ".");
}

export function formatRelativeTraceDate(dateText: string) {
  const targetDate = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(targetDate.getTime())) {
    return dateText;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (todayStart.getTime() - targetDate.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  return `${diffDays}일 전`;
}

export function getLocalDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function buildCalendarMonth(monthDate: Date) {
  const firstDay = getMonthStart(monthDate);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      date,
      isCurrentMonth: date.getMonth() === monthDate.getMonth(),
    };
  });
}

export function formatMonthTitle(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export function formatKoreanDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }

  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

