import type { DailyTraceItem, DreamRoutine } from "../../noie/types";
import { normalizeMemoryInput, type NoieSaveRoutingResult } from "../../noie/memoryLogic";
import { getLocalDateString } from "../../noie/dateUtils";
import {
  findRoutineRecord,
  getEffectiveRoutineTargetValue,
  getRoutineRecordActualValue,
  isRoutineAvailableForTodayMe,
  safeNumber,
} from "../dreams/dreamProgress";
import { parseDurationValueWithUnit } from "../traces/dailyTraceRoutingLogic";
import {
  normalizeRoutineTitle,
  stripTrailingKoreanParticles,
} from "../traces/lifeScheduleRoutingLogic";
export function isNonCompletionRoutineText(text: string) {
  return /못\s*했어|못했어|안\s*했어|안했어|하지\s*못했어|못\s*끝냈어|완료하지\s*못했어|실패했어|건너뛰었어|쉬었어/.test(text);
}


export function isAdditiveRoutineRecordText(text: string) {
  return /더\s*했어|더\s*했다|추가로\s*했어/.test(text);
}


export function isExplicitAdditiveRoutineRecordRequest(text: string) {
  return isAdditiveRoutineRecordText(text) && /기록해줘|기록해|남겨줘|저장해줘|저장해/.test(text);
}


export function parseRoutineGoalCandidate(text: string): Pick<NoieSaveRoutingResult, "title" | "repeatType" | "targetValue" | "unit"> | null {
  const normalizedText = text.trim();
  const hasRepeat = /매일|매주|주\s*\d+\s*회|하루에|매일마다|아침마다|저녁마다|꾸준히|반복해서|\d+(?:\.\d+)?\s*(분|시간|회|개|페이지|세트|장)\s*씩/.test(normalizedText);
  const hasIntent = /할래|그릴래|읽을래|운동할래|공부할래|하려고\s*해|하기로\s*했|목표로\s*할래|습관으로\s*만들|꾸준히\s*할\s*거야|할\s*거야|추가해줘|넣어줘|만들어줘|반복\s*목표|오늘의\s*나/.test(normalizedText);
  const durationTarget = parseDurationValueWithUnit(normalizedText);
  const targetMatch = durationTarget ? null : normalizedText.match(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트|장)\s*씩?/);
  if (!hasRepeat || !hasIntent) {
    return null;
  }
  const targetValue = durationTarget?.targetValue ?? (targetMatch ? Number(targetMatch[1]) : undefined);
  if (targetMatch && !Number.isFinite(targetValue)) {
    return null;
  }
  const unit = durationTarget?.unit ?? targetMatch?.[2];
  const repeatType = /주\s*\d+\s*회|매주/.test(normalizedText) ? "weekly" : "daily";
  return {
    title: normalizeRoutineTitle(normalizedText),
    repeatType,
    targetValue,
    unit,
  };
}


export function isRoutineRecordText(text: string) {
  const hasRecordEditIntent = /기록해줘|기록해|기록을|수정해줘|수정해|바꿔줘|바꿔|변경해줘|변경해/.test(text);
  const hasValue = /(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/.test(text);
  const hasCompletionIntent = /했어|했어요|했다|끝냈어|끝냈어요|끝냈다|완료했어|완료했어요|완료했다|수행했어|수행했어요|수행했다/.test(text);
  if (isActualRoutineExecutionText(text)) {
    return true;
  }
  if (hasCompletionIntent) {
    return true;
  }
  if (hasRecordEditIntent && hasValue) {
    return true;
  }
  return /오늘|어제|방금/.test(text) && /했어|했다|완료했|끝냈|공부했|운동했|했는데|기록|남겨|바꿔|수정|변경/.test(text);
}


export function isActualRoutineExecutionText(text: string) {
  if (isNonCompletionRoutineText(text)) {
    return false;
  }
  if (/목표\s*(시간|수행량|량)?|바꿔줘|바꿔|수정해줘|수정해|변경해줘|변경해|조절|조정/.test(text)) {
    return false;
  }
  return (
    /오늘|어제|방금|아까/.test(text) &&
    /했어|했어요|했다|끝냈어|끝냈어요|끝냈다|완료했어|완료했어요|완료했다|수행했어|수행했어요|수행했다/.test(text) &&
    /(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/.test(text)
  );
}


export function parseRoutineRecordRequest(text: string) {
  const duration = parseDurationValueWithUnit(text);
  const matches = duration
    ? [{
      value: duration.targetValue,
      unit: duration.unit,
      index: text.search(/\d+(?:\.\d+)?\s*시간/),
    }]
    : Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/g)).map((match) => ({
      value: Number(match[1]),
      unit: match[2],
      index: match.index ?? 0,
    })).filter((match) => Number.isFinite(match.value));
  const explicitMatch = text.match(/기록|남겨|바꿔|변경|수정|담아|적어/);
  const isExplicitOverride = Boolean(explicitMatch);
  const isAdditiveRecord = isExplicitAdditiveRoutineRecordRequest(text);
  const requestedMatch = isExplicitOverride
    ? [...matches].reverse().find((match) => match.index >= (explicitMatch?.index ?? 0)) ?? matches[matches.length - 1]
    : undefined;
  const observedMatch = matches.find((match) => match !== requestedMatch) ?? matches[0];
  const selectedMatch = requestedMatch ?? observedMatch;

  return {
    activityText: text
      .replace(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/g, " ")
      .replace(/오늘|어제|방금|했어|했어요|했다|했는데|했지만|완료했어|완료했어요|끝냈어|끝냈어요|수행했어|수행했어요|기록해줘|기록하기|남겨줘|바꿔줘|수정해줘|변경해줘|으로|로/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    observedValue: observedMatch?.value,
    observedUnit: observedMatch?.unit,
    requestedValue: requestedMatch?.value ?? selectedMatch?.value,
    requestedUnit: requestedMatch?.unit ?? selectedMatch?.unit,
    isExplicitOverride,
    isAdditiveRecord,
  };
}


export function hasRoutineKeywordOverlap(textKey: string, routineKey: string) {
  const normalizeToken = (value: string) =>
    stripTrailingKoreanParticles(value)
      .replace(/하기$/g, "")
      .replace(/공부$/g, "")
      .trim();
  const textTokens = new Set(
    textKey
      .split(/\s+/)
      .map(normalizeToken)
      .filter((token) => token.length >= 2)
  );
  return routineKey
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 2)
    .some((token) => textTokens.has(token));
}


export function parseTargetValueWithUnit(text: string) {
  const duration = parseDurationValueWithUnit(text);
  if (duration) {
    return duration;
  }

  const targetMatch = text.match(/(\d+(?:\.\d+)?)\s*(시간|분|회|개|페이지|세트)/);
  if (!targetMatch) {
    return null;
  }
  const targetValue = Number(targetMatch[1]);
  if (!Number.isFinite(targetValue)) {
    return null;
  }
  return {
    targetValue,
    unit: targetMatch[2],
  };
}


export function parseRoutineDurationMinutes(text: string) {
  const hourMinuteMatch = text.match(/(\d+(?:\.\d+)?)\s*시간\s*(?:(\d+(?:\.\d+)?)\s*분|반)?/);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1]);
    const minutes = hourMinuteMatch[2] ? Number(hourMinuteMatch[2]) : /시간\s*반/.test(hourMinuteMatch[0]) ? 30 : 0;
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return Math.round(hours * 60 + minutes);
    }
  }

  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*분/);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    return Number.isFinite(minutes) ? Math.round(minutes) : null;
  }

  return null;
}


export function findRoutineDurationExpression(text: string) {
  return text.match(/(\d+(?:\.\d+)?)\s*시간\s*(?:(\d+(?:\.\d+)?)\s*분|반)?|(\d+(?:\.\d+)?)\s*분/);
}


export function formatRoutineDurationMinutes(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const totalMinutes = Math.round(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const restMinutes = totalMinutes % 60;

  if (hours > 0 && restMinutes > 0) {
    return `${hours}시간 ${restMinutes}분`;
  }
  if (hours > 0) {
    return `${hours}시간`;
  }
  return `${restMinutes}분`;
}


export function getRoutineDurationMinutes(value?: number | null, unit?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return unit?.includes("시간") ? Math.round(value * 60) : Math.round(value);
}


export function normalizeRoutineAdjustmentTitleText(text: string) {
  return normalizeMemoryInput(text)
    .replace(/["'“”‘’]/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*시간\s*(?:(\d+(?:\.\d+)?)\s*분|반)?/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*분/g, "")
    .replace(/목표\s*시간|목표|시간/g, "")
    .replace(/으로\s*하고\s*싶어|로\s*하고\s*싶어|으로\s*할래|로\s*할래/g, "")
    .replace(/바꾸고\s*싶어|변경하고\s*싶어|수정하고\s*싶어|조절하고\s*싶어/g, "")
    .replace(/늘리고\s*싶어|줄이고\s*싶어|바꿔줘|변경해줘|수정해줘|조절해줘/g, "")
    .replace(/하고\s*싶어|할래/g, "")
    .replace(/(을|를|은|는|이|가|의)(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "");
}


export function getRoutineAdjustmentDisplayTitle(title: string) {
  return title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/하기$/g, "")
    .trim();
}


export function extractRoutineDurationTitleCandidate(text: string) {
  const durationMatch = findRoutineDurationExpression(text);
  if (!durationMatch) {
    return "";
  }

  return stripTrailingKoreanParticles(text.slice(0, durationMatch.index ?? 0))
    .replace(/["'“”‘’]/g, "")
    .replace(/오늘의\s*나에|오늘의\s*나/g, "")
    .replace(/매일마다|매일|매주|평일마다|주말마다|아침마다|저녁마다|꾸준히|반복해서/g, "")
    .replace(/반복\s*목표|목표/g, "")
    .replace(/목표\s*시간|목표|시간/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/하기$/g, "")
    .replace(/\s*씩$/g, "")
    .trim();
}


export function normalizeRoutineKey(title: string, repeatType?: string, targetValue?: number, unit?: string) {
  return `${normalizeMemoryInput(title)}|${repeatType ?? ""}|${targetValue ?? ""}|${unit ?? ""}`;
}


export function normalizeRoutineTitleKey(title: string) {
  return stripTrailingKoreanParticles(title)
    .replace(/오늘의\s*나에/g, "")
    .replace(/매일|매주|평일마다|주말마다/g, "")
    .replace(/\d+(?:\.\d+)?\s*(시간|분|회|개|페이지|세트)/g, "")
    .replace(/반복\s*목표/g, "")
    .replace(/추가해줘|넣어줘|만들어줘/g, "")
    .replace(/하고\s*싶어|하려고\s*해/g, "")
    .replace(/하기/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim()
    .toLowerCase();
}


export type PendingRoutineAdjustment = {
  routineId: string;
  routineTitle: string;
  currentTargetValue: number;
  currentUnit: string;
  requestedValue?: number | null;
  applyMode?: "today" | "default" | null;
};

export type PreferredRoutineMatch = {
  routine: DreamRoutine;
  candidateCount: number;
  matchedBy: "id" | "exact_title" | "semantic_title" | "fallback";
} | null;

export type SelectPreferredRoutineCandidateInput = {
  routines: DreamRoutine[];
  requestedTitle?: string;
  explicitRoutineId?: string | null;
  includeArchivedFallback?: boolean;
  allowSingleFallback?: boolean;
  isActiveRoutine?: (routine: DreamRoutine) => boolean;
};

function getRoutineSemanticTitleKey(title: string) {
  let key = normalizeRoutineTitleKey(title)
    .replace(/하기/g, "")
    .replace(/공부$/g, "")
    .replace(/작업$/g, "")
    .trim();

  let previous = "";
  while (key && key !== previous) {
    previous = key;
    key = key
      .replace(/하기$/g, "")
      .replace(/공부하기$/g, "공부")
      .replace(/작업하기$/g, "작업")
      .trim();
  }

  return key;
}

export function selectPreferredRoutineCandidate(
  input: SelectPreferredRoutineCandidateInput
): PreferredRoutineMatch {
  const isActiveRoutine =
    input.isActiveRoutine ??
    ((routine: DreamRoutine) => routine.active !== false && isRoutineAvailableForTodayMe(routine));

  if (input.explicitRoutineId) {
    const explicitMatch = input.routines.find((routine) => routine.id === input.explicitRoutineId);
    if (explicitMatch) {
      return {
        routine: explicitMatch,
        candidateCount: 1,
        matchedBy: "id",
      };
    }
  }

  const requestedTitle = input.requestedTitle?.trim() ?? "";
  const requestedTitleKey = normalizeRoutineTitleKey(requestedTitle);
  const requestedSemanticKey = getRoutineSemanticTitleKey(requestedTitle);
  const activeRoutines = input.routines.filter(isActiveRoutine);
  const inactiveRoutines = input.includeArchivedFallback
    ? input.routines.filter((routine) => !isActiveRoutine(routine))
    : [];

  const findTitleMatch = (
    routines: DreamRoutine[],
    predicate: (routine: DreamRoutine) => boolean,
    matchedBy: "exact_title" | "semantic_title"
  ): PreferredRoutineMatch => {
    const matches = routines.filter(predicate);
    return matches[0]
      ? {
          routine: matches[0],
          candidateCount: matches.length,
          matchedBy,
        }
      : null;
  };

  if (requestedTitleKey) {
    const activeExact = findTitleMatch(
      activeRoutines,
      (routine) => normalizeRoutineTitleKey(routine.title) === requestedTitleKey,
      "exact_title"
    );
    if (activeExact) {
      return activeExact;
    }

    const activeSemantic = findTitleMatch(
      activeRoutines,
      (routine) => {
        const routineSemanticKey = getRoutineSemanticTitleKey(routine.title);
        return Boolean(
          routineSemanticKey &&
            requestedSemanticKey &&
            routineSemanticKey === requestedSemanticKey
        );
      },
      "semantic_title"
    );
    if (activeSemantic) {
      return activeSemantic;
    }

    const inactiveExact = findTitleMatch(
      inactiveRoutines,
      (routine) => normalizeRoutineTitleKey(routine.title) === requestedTitleKey,
      "exact_title"
    );
    if (inactiveExact) {
      return inactiveExact;
    }

    const inactiveSemantic = findTitleMatch(
      inactiveRoutines,
      (routine) => {
        const routineSemanticKey = getRoutineSemanticTitleKey(routine.title);
        return Boolean(
          routineSemanticKey &&
            requestedSemanticKey &&
            routineSemanticKey === requestedSemanticKey
        );
      },
      "semantic_title"
    );
    if (inactiveSemantic) {
      return inactiveSemantic;
    }
  }

  if (input.allowSingleFallback && activeRoutines.length === 1) {
    return {
      routine: activeRoutines[0],
      candidateCount: 1,
      matchedBy: "fallback",
    };
  }

  return null;
}


export function convertRoutineRecordValueToRoutineUnit(
  value: number,
  sourceUnit?: string | null,
  targetUnit?: string | null
) {
  const safeValue = safeNumber(value);
  if (safeValue <= 0) {
    return 0;
  }
  if (sourceUnit === "시간" && targetUnit === "분") {
    return safeValue * 60;
  }
  if (sourceUnit === "분" && targetUnit === "시간") {
    return safeValue / 60;
  }
  return safeValue;
}


export function findRoutineRecordRoute(
  text: string,
  items: DailyTraceItem[],
  options: { preferredRoutineIds?: string[] } = {}
): NoieSaveRoutingResult | null {
  if (isNonCompletionRoutineText(text) || (isAdditiveRoutineRecordText(text) && !isExplicitAdditiveRoutineRecordRequest(text))) {
    return null;
  }
  if (!isRoutineRecordText(text)) {
    return null;
  }
  try {
    const parsed = parseRoutineRecordRequest(text);
    const matched = findMatchingActiveRoutineForRecord(text, parsed, items, options);
    if (!matched) {
      return null;
    }
    const targetUnit = matched.routine.unit ?? parsed.requestedUnit ?? parsed.observedUnit ?? "";
    const effectiveTargetValue = getEffectiveRoutineTargetValue(matched.routine, getLocalDateString(new Date()));
    const sourceValue =
      parsed.requestedValue ??
      parsed.observedValue ??
      (effectiveTargetValue > 0 ? effectiveTargetValue : /완료|끝냈|수행|했어|했다/.test(text) ? 1 : 0);
    const sourceUnit = parsed.requestedUnit ?? parsed.observedUnit ?? targetUnit;
    const convertedValue = convertRoutineRecordValueToRoutineUnit(sourceValue, sourceUnit, targetUnit);
    const existingRecord = findRoutineRecord(matched.item.routineRecords ?? [], matched.routine.id, getLocalDateString(new Date()));
    const existingActualValue = parsed.isAdditiveRecord ? getRoutineRecordActualValue(existingRecord) : 0;
    const actualValue = convertedValue + existingActualValue;
    if (!Number.isFinite(actualValue) || actualValue <= 0) {
      return null;
    }

    if (__DEV__) {
      console.log("[ROUTINE MATCH RESULT]", {
        selectedRoutineId: matched.routine.id,
        selectedRoutineTitle: matched.routine.title,
        selectedTargetValue: getEffectiveRoutineTargetValue(matched.routine, getLocalDateString(new Date())),
        candidateCount: matched.candidateCount,
        selectedIsActive: matched.selectedIsActive,
      });
    }
    return {
      route: "routine_record",
      title: matched.routine.title,
      originalText: text,
      normalizedText: normalizeMemoryInput(text),
      confidence: matched.confidence,
      matchedRoutineId: matched.routine.id,
      targetValue: getEffectiveRoutineTargetValue(matched.routine, getLocalDateString(new Date())),
      actualValue,
      actualUnit: targetUnit,
      displayValue: sourceValue,
      displayUnit: sourceUnit,
      unit: targetUnit,
      isExplicitOverride: parsed.isExplicitOverride,
      isAdditiveRecord: parsed.isAdditiveRecord,
      hasExistingRoutineRecord: Boolean(existingRecord),
      reason: parsed.isAdditiveRecord
        ? "명시적 반복 목표 수행량 누적 기록"
        : parsed.isExplicitOverride ? "명시적 반복 목표 수행 기록 수정" : "반복 목표 수행 기록",
    };
  } catch (error) {
    console.error("[routine-record-routing-error]", error);
    return null;
  }
}

function cleanRoutineRemoveTitleCandidate(text: string) {
  return stripTrailingKoreanParticles(text)
    .replace(/["'“”‘’]/g, " ")
    .replace(/하루의\s*흔적|기록|프로젝트/g, " ")
    .replace(/오늘의\s*나에서|오늘의\s*나에|오늘의\s*나|반복\s*목표|목표/g, " ")
    .replace(/매일|매주|오늘은|오늘/g, " ")
    .replace(/\d+(?:\.\d+)?\s*(시간|분|회|개|페이지|세트)/g, " ")
    .replace(/삭제해줘|삭제|빼줘|빼\s*줘|없애줘|없애|제거해줘|제거/g, " ")
    .replace(/종료해줘|종료|그만할래|그만\s*할래|그만|안\s*할래|안\s*해/g, " ")
    .replace(/을|를|이|가|은|는|으로|로/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRoutineRemoveText(text: string) {
  const isDailyTraceRecordDelete =
    /하루의\s*흔적|기록/.test(text) && /삭제|지워|없애|제거/.test(text);
  const isProjectDelete = /프로젝트/.test(text) && /삭제|지워|없애|제거|종료/.test(text);
  const isDurationAdjustment =
    /\d+(?:\.\d+)?\s*(시간|분|회|개|페이지|세트)/.test(text) &&
    /줄여|늘려|바꿔|변경|수정|조절/.test(text);
  const isNonCompletionOnly = /못\s*했|못했/.test(text);
  if (isDailyTraceRecordDelete || isProjectDelete || isDurationAdjustment || isNonCompletionOnly) {
    return false;
  }

  const hasRemoveIntent =
    /삭제해줘|삭제|빼줘|빼\s*줘|없애줘|없애|제거해줘|제거|종료해줘|종료|그만할래|그만\s*할래|안\s*할래/.test(text);
  const hasRoutineScope = /오늘의\s*나|반복\s*목표|목표|매일/.test(text);
  const todayOptOut = /오늘은/.test(text) && /안\s*할래/.test(text);
  return hasRemoveIntent && (hasRoutineScope || todayOptOut);
}

export function findRoutineRemoveRoute(
  text: string,
  items: DailyTraceItem[],
  options: { preferredRoutineIds?: string[] } = {}
): NoieSaveRoutingResult | null {
  if (!isRoutineRemoveText(text)) {
    return null;
  }

  const routines = getActiveRoutineEntries(items);
  if (routines.length === 0) {
    return null;
  }

  const titleCandidate = cleanRoutineRemoveTitleCandidate(text);
  const selected = selectPreferredRoutineCandidate({
    routines: routines.map(({ routine }) => routine),
    requestedTitle: titleCandidate,
    explicitRoutineId: options.preferredRoutineIds?.find((routineId) =>
      routines.some(({ routine }) => routine.id === routineId && normalizeRoutineTitleKey(routine.title) === normalizeRoutineTitleKey(titleCandidate))
    ),
  });
  if (!selected) {
    return null;
  }
  const matched = routines.find(({ routine }) => routine.id === selected.routine.id);
  if (!matched) {
    return null;
  }

  const targetValue = getEffectiveRoutineTargetValue(matched.routine, getLocalDateString(new Date()));
  return {
    route: "routine_remove",
    title: matched.routine.title,
    originalText: text,
    normalizedText: normalizeMemoryInput(matched.routine.title),
    confidence: selected.matchedBy === "id" ? 0.98 : 0.94,
    matchedDailyTraceId: matched.item.id,
    matchedRoutineId: matched.routine.id,
    targetValue,
    unit: matched.routine.unit,
    reason: "오늘의 나 반복 목표 제거 요청",
  };
}


function findMatchingActiveRoutineForRecord(
  text: string,
  parsed: ReturnType<typeof parseRoutineRecordRequest>,
  items: DailyTraceItem[],
  options: { preferredRoutineIds?: string[] } = {}
) {
  const routines = getActiveRoutineEntries(items);
  if (routines.length === 0) {
    return null;
  }
  const textKey = normalizeMemoryInput(`${text} ${parsed.activityText}`);
  const titleMatchedRoutineIds = routines
    .filter(({ routine }) => hasRoutineKeywordOverlap(textKey, normalizeMemoryInput(routine.title)))
    .map(({ routine }) => routine.id);
  const allowSingleFallback =
    isActualRoutineExecutionText(text) ||
    parsed.isExplicitOverride ||
    parsed.isAdditiveRecord;
  const preferredRoutine = selectPreferredRoutineCandidate({
    routines: routines.map(({ routine }) => routine),
    requestedTitle: parsed.activityText || text,
    explicitRoutineId: options.preferredRoutineIds?.find((routineId) => titleMatchedRoutineIds.includes(routineId)),
    allowSingleFallback,
  });
  const preferredRoutineEntry = preferredRoutine
    ? routines.find(({ routine }) => routine.id === preferredRoutine.routine.id)
    : null;
  if (preferredRoutine && preferredRoutineEntry) {
    return {
      item: preferredRoutineEntry.item,
      routine: preferredRoutineEntry.routine,
      confidence: preferredRoutine.matchedBy === "fallback" ? 0.62 : 0.96,
      candidateCount: preferredRoutine.candidateCount,
      selectedIsActive: preferredRoutineEntry.routine.active !== false && isRoutineAvailableForTodayMe(preferredRoutineEntry.routine),
    };
  }
  const todayKey = getLocalDateString(new Date());
  const requestedTargetValue = parsed.requestedValue ?? parsed.observedValue;
  const preferredRoutineIds = new Set(options.preferredRoutineIds ?? []);
  if (__DEV__) {
    const normalizedTargetTitle = normalizeRoutineTitleKey(parsed.activityText || text);
    const candidateRoutines = routines.filter(({ routine }) => {
      const routineKey = normalizeRoutineTitleKey(routine.title);
      const normalizedRoutineTitle = normalizeMemoryInput(routine.title);
      const routineTitleWithoutActionSuffix = normalizedRoutineTitle.endsWith("하기")
        ? normalizedRoutineTitle.slice(0, -2)
        : normalizedRoutineTitle;
      return (
        routineKey === normalizedTargetTitle ||
        textKey.includes(normalizedRoutineTitle) ||
        textKey.includes(routineTitleWithoutActionSuffix)
      );
    });
    void {
      normalizedTargetTitle,
      candidates: candidateRoutines.map(({ routine }) => ({
        id: routine.id,
        title: routine.title,
        active: routine.active,
        archivedFromTodayMe: routine.archivedFromTodayMe,
        lifecycleStatus: routine.lifecycleStatus,
        targetValue: routine.targetValue,
        unit: routine.unit,
      })),
    };
  }
  const scored = routines
    .map(({ item, routine }) => {
      const titleKey = normalizeMemoryInput(routine.title);
      const compactTitleKey = titleKey.replace(/하기$/g, "");
      const effectiveTargetValue = getEffectiveRoutineTargetValue(routine, todayKey);
      const isPreferredTodayMeRoutine = preferredRoutineIds.has(routine.id);
      const targetMatchesRequest =
        typeof requestedTargetValue === "number" &&
        Number.isFinite(requestedTargetValue) &&
        effectiveTargetValue === convertRoutineRecordValueToRoutineUnit(
          requestedTargetValue,
          parsed.requestedUnit ?? parsed.observedUnit,
          routine.unit
        );
      let score = 0;
      if (titleKey && textKey.includes(titleKey)) {
        score += 4;
      }
      if (compactTitleKey && textKey.includes(compactTitleKey)) {
        score += 3;
      }
      if (/운동|헬스|러닝|달리기|체력/.test(textKey) && /운동|헬스|러닝|달리기|체력/.test(titleKey)) {
        score += 2;
      }
      if (/파이썬|코딩|개발|공부|학습/.test(textKey) && /파이썬|코딩|개발|공부|학습/.test(titleKey)) {
        score += 2;
      }
      if (hasRoutineKeywordOverlap(textKey, titleKey)) {
        score += 3;
      }
      return { item, routine, score, targetMatchesRequest, isPreferredTodayMeRoutine };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (left.isPreferredTodayMeRoutine !== right.isPreferredTodayMeRoutine) {
        return left.isPreferredTodayMeRoutine ? -1 : 1;
      }
      if (left.targetMatchesRequest !== right.targetMatchesRequest) {
        return left.targetMatchesRequest ? -1 : 1;
      }
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return (right.routine.updatedAt ?? right.routine.createdAt).localeCompare(
        left.routine.updatedAt ?? left.routine.createdAt
      );
    });

  if (scored[0]) {
    return {
      item: scored[0].item,
      routine: scored[0].routine,
      confidence: Math.min(0.98, 0.72 + scored[0].score * 0.05),
      candidateCount: scored.length,
      selectedIsActive: scored[0].routine.active !== false && isRoutineAvailableForTodayMe(scored[0].routine),
    };
  }
  if (allowSingleFallback && routines.length === 1) {
    return {
      item: routines[0].item,
      routine: routines[0].routine,
      confidence: 0.62,
      candidateCount: 1,
      selectedIsActive: routines[0].routine.active !== false && isRoutineAvailableForTodayMe(routines[0].routine),
    };
  }
  return null;
}


function findRoutineForDurationAdjustment(titleText: string, items: DailyTraceItem[]) {
  const routines = getActiveRoutineEntries(items);
  const selected = selectPreferredRoutineCandidate({
    routines: routines.map(({ routine }) => routine),
    requestedTitle: titleText,
  });
  if (__DEV__) {
    console.log("[ROUTINE SELECT RESULT]", {
      requestedTitle: titleText,
      explicitRoutineId: null,
      selectedRoutineId: selected?.routine.id ?? null,
      selectedRoutineTitle: selected?.routine.title ?? null,
      candidateCount: selected?.candidateCount ?? 0,
      matchedBy: selected?.matchedBy ?? null,
      selectedIsActive: selected ? selected.routine.active !== false && isRoutineAvailableForTodayMe(selected.routine) : false,
    });
  }
  if (!selected) {
    return null;
  }
  return routines.find(({ routine }) => routine.id === selected.routine.id) ?? null;
}

export function findRoutineDurationCreationRoute(
  text: string,
  items: DailyTraceItem[]
): NoieSaveRoutingResult | null {
  if (isActualRoutineExecutionText(text)) {
    return null;
  }
  if (/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시/.test(text) && /알림|일정|예약|해야\s*해|해야해|해야\s*돼|해야돼/.test(text)) {
    return null;
  }

  const durationMatch = findRoutineDurationExpression(text);
  const targetMinutes = parseRoutineDurationMinutes(text);
  if (!durationMatch || typeof targetMinutes !== "number") {
    return null;
  }

  const hasRoutineIntent =
    /하고\s*싶어|하려고\s*해|할래|꾸준히\s*할래|매일\s*할래|이어가고\s*싶어|추가해줘|넣어줘|만들어줘|반복\s*목표|오늘의\s*나/.test(text);
  if (!hasRoutineIntent) {
    return null;
  }

  const title = extractRoutineDurationTitleCandidate(text);
  if (!title) {
    return null;
  }

  return {
    route: "routine_create",
    title,
    originalText: text,
    normalizedText: normalizeMemoryInput(title),
    confidence: 0.92,
    repeatType: "daily",
    targetValue: targetMinutes,
    minimumValue: 0,
    unit: "분",
    reason: "기존 반복 목표가 없어 새 오늘의 나 반복 목표 후보",
  };
}


export function findExplicitRoutineDurationAdjustmentRoute(
  text: string,
  items: DailyTraceItem[]
): NoieSaveRoutingResult | null {
  if (isActualRoutineExecutionText(text)) {
    return null;
  }

  const durationMatch = findRoutineDurationExpression(text);
  const newDurationMinutes = parseRoutineDurationMinutes(text);
  if (!durationMatch || typeof newDurationMinutes !== "number") {
    return null;
  }

  const wantsDurationAdjustment =
    /으로\s*하고\s*싶어|로\s*하고\s*싶어|으로\s*할래|로\s*할래|바꾸고\s*싶어|변경하고\s*싶어|수정하고\s*싶어|조절하고\s*싶어|늘리고\s*싶어|줄이고\s*싶어|바꿔줘|변경해줘|수정해줘|조절해줘/.test(text);
  if (!wantsDurationAdjustment) {
    return null;
  }

  const titleText = text.slice(0, durationMatch.index ?? 0);
  const matchedRoutine = findRoutineForDurationAdjustment(titleText, items);
  console.log("[TODAY ME ROUTINE TIME UPDATE CHECK]", {
    titleText: titleText.trim(),
    targetMinutes: newDurationMinutes,
    matchedRoutineId: matchedRoutine?.routine.id ?? null,
    matchedRoutineTitle: matchedRoutine?.routine.title ?? null,
  });

  if (!matchedRoutine) {
    return null;
  }

  const displayTitle = getRoutineAdjustmentDisplayTitle(matchedRoutine.routine.title);
  const previousDurationMinutes = getRoutineDurationMinutes(
    matchedRoutine.routine.targetValue,
    matchedRoutine.routine.unit
  );

  return {
    route: "routine_adjustment_confirm",
    title: displayTitle,
    originalText: text,
    normalizedText: normalizeMemoryInput(displayTitle),
    confidence: 0.97,
    targetValue: newDurationMinutes,
    unit: "분",
    matchedRoutineId: matchedRoutine.routine.id,
    matchedDailyTraceId: matchedRoutine.item.id,
    targetGoalTitle: displayTitle,
    previousDurationMinutes,
    newDurationMinutes,
    reason: "기존 반복 목표 시간 변경 후보",
  };
}


function getActiveRoutineEntries(items: DailyTraceItem[]) {
  return items.flatMap((item) =>
    (item.routines ?? [])
      .filter((routine) => routine.active !== false && isRoutineAvailableForTodayMe(routine))
      .map((routine) => ({ item, routine }))
  );
}


export function findRoutineAdjustmentIntent(
  text: string,
  items: DailyTraceItem[]
): PendingRoutineAdjustment | null {
  const normalizedText = text.trim();
  if (isActualRoutineExecutionText(normalizedText)) {
    return null;
  }
  const wantsAdjustment = /바꾸고\s*싶|변경|조절|조정|늘리|줄이|줄이고|늘리고|목표.*바꿔|목표.*조정/.test(normalizedText);
  const targetDomain = /공부|학습|파이썬|코딩|영어|독서|운동|반복|목표|시간/.test(normalizedText);
  if (!wantsAdjustment || !targetDomain) {
    return null;
  }

  const routines = getActiveRoutineEntries(items);
  if (routines.length === 0) {
    return null;
  }

  const preferredRoutine = selectPreferredRoutineCandidate({
    routines: routines.map(({ routine }) => routine),
    requestedTitle: normalizedText,
    allowSingleFallback: true,
  });
  const preferredRoutineEntry = preferredRoutine
    ? routines.find(({ routine }) => routine.id === preferredRoutine.routine.id)
    : null;
  if (preferredRoutineEntry) {
    return {
      routineId: preferredRoutineEntry.routine.id,
      routineTitle: preferredRoutineEntry.routine.title,
      currentTargetValue: preferredRoutineEntry.routine.targetValue ?? 0,
      currentUnit: preferredRoutineEntry.routine.unit ?? "",
    };
  }

  const textKey = normalizeMemoryInput(normalizedText);
  const matchedRoutine =
    routines.find(({ routine }) => {
      const routineKey = normalizeMemoryInput(routine.title);
      return (
        textKey.includes(routineKey.replace(/하기$/g, "")) ||
        (/파이썬|코딩|공부|학습/.test(textKey) && /파이썬|코딩|공부|학습/.test(routineKey))
      );
    }) ?? (routines.length === 1 ? routines[0] : null);

  if (!matchedRoutine) {
    return null;
  }

  return {
    routineId: matchedRoutine.routine.id,
    routineTitle: matchedRoutine.routine.title,
    currentTargetValue: matchedRoutine.routine.targetValue ?? 0,
    currentUnit: matchedRoutine.routine.unit ?? "",
  };
}
