import { normalizeMemoryInput, type NoieSaveRoutingResult } from "../../noie/memoryLogic";
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
  if (isActualRoutineExecutionText(text)) {
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
    /했어|했다|끝냈어|끝냈다|완료했어|완료했다/.test(text) &&
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
      .replace(/오늘|어제|방금|했어|했다|했는데|했지만|완료했어|끝냈어|기록해줘|기록하기|남겨줘|바꿔줘|수정해줘|변경해줘|으로|로/g, " ")
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
