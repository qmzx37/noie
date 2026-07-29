import type { DailyTraceItem } from "../../noie/types";
import { normalizeMemoryInput, type NoieSaveRoutingResult } from "../../noie/memoryLogic";
import { getLocalDateString } from "../../noie/dateUtils";
import { shiftTraceDateKey, type DailyLongRecord } from "./traceFeature";

export function formatRoutineTarget(value: number, unit?: string) {
  if (value <= 0) {
    return "체크";
  }
  return formatRoutineTargetForDisplay(value, unit);
}

export function formatRoutineTargetForDisplay(value: number, unit?: string) {
  if (unit === "분" && value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  }
  return `${value}${unit ?? ""}`;
}


export function parseDurationValueWithUnit(text: string) {
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


export function findDailyRecordCommandRoute(
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

export function getRecordCommandDateKey(text: string, todayKey: string) {
  if (/어제/.test(text)) {
    return shiftTraceDateKey(todayKey, -1);
  }
  return todayKey;
}

export function extractQuotedRecordText(text: string) {
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

export function cleanRecordCommandText(text: string) {
  return text
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .replace(/[.!。…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanOneLineRecordText(text: string) {
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

export function findDailyLongRecordTitleUpdateRoute(
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

export function findDailyLongRecordAppendRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
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

export function findDailyLongRecordCreateRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
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

export function findRecentDailyTraceLineUpdateRoute(
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

export function findRecentOneLineDailyTrace(dailyTraces: DailyTraceItem[], todayKey: string) {
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

export function findOneLineDailyTraceCreateRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
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

export function findDatedActionDailyTraceRoute(text: string, dateKey: string): NoieSaveRoutingResult | null {
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

