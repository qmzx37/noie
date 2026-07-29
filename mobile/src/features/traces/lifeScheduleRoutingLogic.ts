import { TRACE_REMINDER_OPTIONS } from "../../constants/appConstants";
import { addDays, getLocalDateString } from "../../noie/dateUtils";
import type { DailyTraceItem } from "../../noie/types";
import { dedupeMemories, normalizeMemoryInput, type NoieSaveRoutingResult } from "../../noie/memoryLogic";
import {
  getExistingReminderLabel,
  isCancelledTraceItem,
  isCompletedTraceScheduleItem,
  isLifeRepeatTraceItem,
  isScheduledDailyTraceItemForDate,
} from "./traceFeature";

export function parseStrictFutureScheduleDate(text: string) {
  const today = new Date();
  if (/\ub0b4\uc77c/.test(text)) {
    return { dateKey: getLocalDateString(addDays(today, 1)), label: "\ub0b4\uc77c" };
  }
  if (/\ubaa8\ub808/.test(text)) {
    return { dateKey: getLocalDateString(addDays(today, 2)), label: "\ubaa8\ub808" };
  }
  return null;
}

export function parseStrictKoreanClockTimeRange(text: string) {
  const match = text.match(/(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)?\s*(\d{1,2})\s*\uc2dc(?:\s*(\d{1,2})\s*\ubd84?)?\s*\ubd80\ud130\s*(?:(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)\s*)?(\d{1,2})\s*\uc2dc(?:\s*(\d{1,2})\s*\ubd84?)?\s*\uae4c\uc9c0/);
  if (!match) {
    return null;
  }

  const startMarker = match[1] ?? "";
  const endMarker = match[4] ?? startMarker;
  const start = buildStrictKoreanClockTime(startMarker, match[2], match[3]);
  const end = buildStrictKoreanClockTime(endMarker, match[5], match[6]);
  if (!start || !end) {
    return null;
  }

  return { start, end };
}

export function parseStrictKoreanClockTime(text: string) {
  const match = text.match(/(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)?\s*(\d{1,2})\s*\uc2dc(?:\s*(\d{1,2})\s*\ubd84?)?/);
  if (!match) {
    return null;
  }

  return buildStrictKoreanClockTime(match[1] ?? "", match[2], match[3]);
}

function buildStrictKoreanClockTime(marker: string, hourText: string, minuteText?: string) {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if ((marker === "\uc624\ud6c4" || marker === "\uc800\ub141" || marker === "\ubc24") && hour < 12) {
    hour += 12;
  }
  if ((marker === "\uc624\uc804" || marker === "\uc544\uce68" || marker === "\uc0c8\ubcbd") && hour === 12) {
    hour = 0;
  }

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const labelHour = hour >= 12 ? hour - 12 || 12 : hour || 12;
  const period = hour >= 12 ? "\uc624\ud6c4" : "\uc624\uc804";
  return {
    time,
    label: `${period} ${labelHour}:${String(minute).padStart(2, "0")}`,
  };
}


export function parseLifeScheduleReminderRequest(text: string) {
  if (!/알려줘|알림|리마인드/.test(text) || !/(전|전에|맞춰)/.test(text)) {
    return null;
  }
  const minuteMatch = text.match(/(\d+)\s*분\s*전/);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (minutes === 10 || minutes === 30) {
      return { value: `${minutes}m`, label: `${minutes}분 전` };
    }
  }
  const hourMatch = text.match(/(\d+)\s*시간\s*전/);
  if (hourMatch && Number(hourMatch[1]) === 1) {
    return { value: "1h", label: "1시간 전" };
  }
  if (/시간에\s*맞춰|정각|바로/.test(text)) {
    return { value: "on_time", label: "시간에 맞춰" };
  }
  return null;
}


export function parseKoreanClockTimeRange(text: string) {
  const match = text.match(/(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?\s*부터\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?\s*까지/);
  if (!match) {
    return null;
  }

  const startMarker = match[1] ?? "";
  const endMarker = match[4] ?? startMarker;
  const start = buildKoreanClockTime(startMarker, match[2], match[3]);
  const end = buildKoreanClockTime(endMarker, match[5], match[6]);
  if (!start || !end) {
    return null;
  }

  return { start, end };
}

export function parseKoreanClockTime(text: string) {
  const match = text.match(/(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?/);
  if (!match) {
    return null;
  }

  return buildKoreanClockTime(match[1] ?? "", match[2], match[3]);
}

function buildKoreanClockTime(marker: string, hourText: string, minuteText?: string) {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if ((marker === "오후" || marker === "저녁" || marker === "밤") && hour < 12) {
    hour += 12;
  }
  if ((marker === "오전" || marker === "아침" || marker === "새벽") && hour === 12) {
    hour = 0;
  }

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const labelHour = hour >= 12 ? hour - 12 || 12 : hour || 12;
  const period = hour >= 12 ? "오후" : "오전";
  return {
    time,
    label: `${period} ${labelHour}:${String(minute).padStart(2, "0")}`,
  };
}

export function parseRelativeScheduleDate(text: string) {
  const today = new Date();
  const offset = /모레/.test(text) ? 2 : /내일/.test(text) ? 1 : /오늘/.test(text) ? 0 : null;
  if (offset !== null) {
    return {
      dateKey: getLocalDateString(addDays(today, offset)),
      label: offset === 0 ? "오늘" : offset === 1 ? "내일" : "모레",
    };
  }

  const nextWeekday = parseNextWeekdayScheduleDate(text, today);
  if (nextWeekday) {
    return nextWeekday;
  }

  return null;
}

export function parseNextWeekdayScheduleDate(text: string, today: Date) {
  const match = text.match(/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/);
  if (!match) {
    return null;
  }

  const weekdayMap: Record<string, number> = {
    일요일: 0,
    일: 0,
    월요일: 1,
    월: 1,
    화요일: 2,
    화: 2,
    수요일: 3,
    수: 3,
    목요일: 4,
    목: 4,
    금요일: 5,
    금: 5,
    토요일: 6,
    토: 6,
  };
  const targetDay = weekdayMap[match[1]];
  const thisWeekStart = addDays(today, -today.getDay());
  const targetDate = addDays(thisWeekStart, 7 + targetDay);
  return {
    dateKey: getLocalDateString(targetDate),
    label: `다음 주 ${match[1].length === 1 ? `${match[1]}요일` : match[1]}`,
  };
}
export function makeMemoryTitle(text: string) {
  const trimmedText = text.trim();
  if (trimmedText.length <= 24) {
    return trimmedText;
  }

  return `${trimmedText.slice(0, 24)}...`;
}


export function findLifeScheduleRoute(text: string): NoieSaveRoutingResult | null {
  const normalizedText = normalizeMemoryInput(text);
  const parsedRange = parseKoreanClockTimeRange(text);
  const parsedTime = parsedRange?.start ?? parseKoreanClockTime(text);
  const parsedDate = parseRelativeScheduleDate(text);
  const isRepeat = /매일|매주|평일마다|주말마다|아침마다|저녁마다|밤마다/.test(text);
  const isPastAction = /일어났|먹었|다녀왔|갔다왔|갔다\s*왔|끝냈|했어|했다/.test(text);
  const isFutureSchedule = /해야\s*해|해야해|해야\s*돼|해야돼|일어나야|먹어야|가야\s*해|갈\s*거야|일어날래|잘래|먹을래|버릴래|챙길래/.test(text);

  if (!parsedTime || !isLifeScheduleText(text) || isGrowthRoutineText(text)) {
    return null;
  }

  const scheduleTitle = makeLifeScheduleTitle(text);
  if (isPastAction) {
    const dateKey = parsedDate?.dateKey ?? getLocalDateString(new Date());
    return {
      route: "life_action_record",
      title: makeLifeActionRecordTitle(scheduleTitle),
      originalText: text,
      normalizedText,
      confidence: 0.94,
      scheduledDate: dateKey,
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      reason: "이미 실제로 한 생활 행동",
    };
  }

  if (isRepeat) {
    return {
      route: "life_schedule_repeat",
      title: scheduleTitle,
      originalText: text,
      normalizedText,
      confidence: 0.93,
      scheduledDate: getLocalDateString(new Date()),
      recurrence: /매주/.test(text) ? "weekly" : "daily",
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      endTime: parsedRange?.end.time ?? null,
      endDisplayUnit: parsedRange?.end.label ?? null,
      reason: "생활 반복 예정",
    };
  }

  if (parsedDate && isFutureSchedule) {
    return {
      route: "life_schedule_once",
      title: scheduleTitle,
      originalText: text,
      normalizedText,
      confidence: 0.92,
      scheduledDate: parsedDate.dateKey,
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      endTime: parsedRange?.end.time ?? null,
      endDisplayUnit: parsedRange?.end.label ?? null,
      reason: "날짜가 있는 한 번짜리 예정",
    };
  }

  if (isFutureSchedule) {
    return {
      route: "life_schedule_missing_date",
      title: scheduleTitle,
      originalText: text,
      normalizedText,
      confidence: 0.88,
      needsDateSelection: false,
      unit: parsedTime.label,
      displayUnit: parsedTime.time,
      reason: "시간은 있지만 날짜가 없는 예정",
    };
  }

  return null;
}

export function findFutureOneTimeScheduleRoute(text: string): NoieSaveRoutingResult | null {
  const parsedDate = parseStrictFutureScheduleDate(text);
  const parsedRange = parseStrictKoreanClockTimeRange(text);
  const parsedTime = parsedRange?.start ?? parseStrictKoreanClockTime(text);

  if (!parsedDate || !parsedTime || !hasStrictScheduleTarget(text)) {
    return null;
  }

  const title = makeStrictLifeScheduleTitle(text);
  if (!title) {
    return null;
  }

  console.log("[SCHEDULE DETECT]", {
    originalText: text,
    dateKey: parsedDate.dateKey,
    startTime: parsedTime.time,
    title,
  });

  return {
    route: "life_schedule_once",
    title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.97,
    scheduledDate: parsedDate.dateKey,
    unit: parsedTime.label,
    displayUnit: parsedTime.time,
    endTime: parsedRange?.end.time ?? null,
    endDisplayUnit: parsedRange?.end.label ?? null,
    reason: "미래 날짜와 시간이 명확한 일회성 일정",
  };
}

function hasStrictScheduleTarget(text: string) {
  return /(\uc77c\uc815|\uc608\uc57d|\uc57d\uc18d|\ubc29\ubb38|\uc218\uc5c5|\uba74\uc811|\uc9c4\ub8cc|\uac80\uc9c4|\uac00\uc57c|\uc788\uc5b4|\uc800\uc7a5\ud574\uc918|\ub2f4\uc544\uc918)/.test(text);
}

function makeStrictLifeScheduleTitle(text: string) {
  const cleaned = text
    .replace(/\ub0b4\uc77c|\ubaa8\ub808/g, " ")
    .replace(/(\uc624\uc804|\uc624\ud6c4|\uc544\uce68|\uc800\ub141|\ubc24|\uc0c8\ubcbd)?\s*\d{1,2}\s*\uc2dc(?:\s*\d{1,2}\s*\ubd84?)?\s*(?:\uc5d0|\uc5d4)?/g, " ")
    .replace(/\uc77c\uc815\uc73c\ub85c\s*\uc800\uc7a5\ud574\uc918|\uc77c\uc815\uc73c\ub85c|\uc800\uc7a5\ud574\uc918|\ub2f4\uc544\uc918|\ub4f1\ub85d\ud574\uc918/g, " ")
    .replace(/\s*(?:\uc774|\uac00)?\s*\uc788\uc5b4[.!?]*$/g, " ")
    .replace(/\s*\uac00\uc57c\s*\ud574[.!?]*$/g, " \uac00\uae30")
    .replace(/\s*\uc57c\s*\ud574[.!?]*$/g, " ")
    .replace(/[.!?]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

export function findLifeScheduleMutationRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  const reminder = parseLifeScheduleReminderRequest(text);
  if (reminder) {
    const matched = findSingleMatchingLifeSchedule(text, items);
    if (!matched) {
      return {
        route: "none",
        title: "",
        originalText: text,
        normalizedText: normalizeMemoryInput(text),
        confidence: 0.9,
        reason: "수정할 일정을 찾지 못함",
      };
    }
    const previousReminder = getExistingReminderLabel(matched) || "시간에 맞춰";
    return {
      route: "life_schedule_reminder_update",
      title: matched.title,
      originalText: text,
      normalizedText: normalizeMemoryInput(text),
      confidence: 0.96,
      scheduledDate: matched.date,
      displayUnit: matched.time,
      matchedDailyTraceId: matched.id,
      previousTitle: previousReminder,
      reminder: reminder.value,
      unit: reminder.label,
      reason: "기존 일정 알림 수정",
    };
  }

  if (/취소해줘|취소해|삭제해줘|삭제해|지워줘|지워|없애줘|없애/.test(text) && /일정|예약|가는\s*일/.test(text)) {
    const matched = findSingleMatchingLifeSchedule(text, items);
    if (!matched) {
      return {
        route: "none",
        title: "",
        originalText: text,
        normalizedText: normalizeMemoryInput(text),
        confidence: 0.9,
        reason: "취소할 일정을 찾지 못함",
      };
    }
    return {
      route: "life_schedule_cancel",
      title: matched.title,
      originalText: text,
      normalizedText: normalizeMemoryInput(text),
      confidence: 0.96,
      scheduledDate: matched.date,
      displayUnit: matched.time,
      matchedDailyTraceId: matched.id,
      reason: "기존 일정 취소",
    };
  }

  return null;
}

function findSingleMatchingLifeSchedule(text: string, items: DailyTraceItem[]) {
  const todayKey = getLocalDateString(new Date());
  const parsedDate = parseRelativeScheduleDate(text);
  const parsedTime = parseKoreanClockTime(text);
  const dateKey = parsedDate?.dateKey;
  const textKey = normalizeScheduleSearchText(text);
  const candidates = dedupeMemories(items)
    .filter((item) => {
      if (isCancelledTraceItem(item) || isCompletedTraceScheduleItem(item) || !isScheduledDailyTraceItemForDate(item, item.date)) {
        return false;
      }
      if (isLifeRepeatTraceItem(item)) {
        return false;
      }
      if (dateKey && item.date !== dateKey) {
        return false;
      }
      if (!dateKey && item.date < todayKey) {
        return false;
      }
      return true;
    })
    .map((item) => {
      let score = 0;
      const titleKey = normalizeScheduleSearchText(item.title);
      if (dateKey && item.date === dateKey) {
        score += 4;
      }
      if (parsedTime?.time && item.time === parsedTime.time) {
        score += 3;
      }
      if (titleKey && textKey.includes(titleKey)) {
        score += 4;
      } else if (hasScheduleKeywordOverlap(textKey, titleKey)) {
        score += 3;
      }
      return { item, score };
    })
    .filter((candidate) => candidate.score >= 3)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 1 || (candidates[0] && candidates[0].score > (candidates[1]?.score ?? 0))) {
    return candidates[0].item;
  }
  return null;
}

function normalizeScheduleSearchText(text: string) {
  return text
    .replace(/오늘|내일|모레|다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/g, " ")
    .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?/g, " ")
    .replace(/\d+\s*(분|시간)\s*전/g, " ")
    .replace(/일정|예약|가는\s*일|알려줘|취소해줘|취소해|삭제해줘|삭제해|지워줘|지워|없애줘|없애|전에/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasScheduleKeywordOverlap(textKey: string, titleKey: string) {
  const textTokens = new Set(textKey.split(/\s+/).map(stripTrailingKoreanParticles).filter((token) => token.length >= 2));
  return titleKey
    .split(/\s+/)
    .map(stripTrailingKoreanParticles)
    .filter((token) => token.length >= 2)
    .some((token) => textTokens.has(token));
}

export function getReminderLabelByValue(value: string) {
  return TRACE_REMINDER_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

function isLifeScheduleText(text: string) {
  return /일어나|기상|자기|잠자|취침|약\s*먹|약\s*복용|병원|쓰레기|분리수거|청소|빨래|설거지|밥\s*먹|식사|출근|등교|예약|미용실/.test(text);
}

function isGrowthRoutineText(text: string) {
  return /공부|연습|운동|훈련|복습|기술|자격증|코딩|미용사/.test(text);
}

function makeLifeScheduleTitle(text: string) {
  if (/일어나|기상/.test(text)) {
    return "일어나기";
  }
  if (/자기|잠자|취침/.test(text)) {
    return "자기";
  }
  if (/약\s*먹|약\s*복용/.test(text)) {
    return "약 먹기";
  }
  if (/쓰레기|분리수거/.test(text)) {
    return "쓰레기 버리기";
  }
  if (/병원/.test(text)) {
    return "병원 가기";
  }
  if (/미용실/.test(text) && /예약/.test(text)) {
    return "미용실 예약";
  }
  return normalizeRoutineTitle(text)
    .replace(/다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일|일|월|화|수|목|금|토)/g, "")
    .replace(/오늘|내일|모레/g, "")
    .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?\s*부터\s*(?:(오전|오후|아침|저녁|밤|새벽)\s*)?\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?\s*까지/g, "")
    .replace(/(오전|오후|아침|저녁|밤|새벽)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분?)?에/g, "")
    .replace(/해야\s*해|해야해|해야\s*돼|해야돼|일어날래|할래|갈\s*거야/g, "")
    .trim() || makeMemoryTitle(text);
}

function makeLifeActionRecordTitle(title: string) {
  if (title === "일어나기") {
    return "일어남";
  }
  if (title.endsWith("기")) {
    return `${title.slice(0, -1)}ㅁ`;
  }
  return title;
}


export function normalizeRoutineTitle(text: string) {
  let title = text
    .replace(/오늘의\s*나에|오늘의\s*나/g, "")
    .replace(/매일마다|매일|매주|주\s*\d+\s*회|하루에|아침마다|저녁마다|꾸준히|반복해서/g, "")
    .replace(/\d+(?:\.\d+)?\s*(시간|분|회|개|페이지|세트|장)\s*씩?/g, "")
    .replace(/반복\s*목표|목표/g, "")
    .replace(/추가해줘|넣어줘|만들어줘/g, "")
    .replace(/공부할래|공부하려고\s*해|연습할래|해볼래|시작할래|하고\s*싶어|할래|하려고\s*해|하기로\s*했어|목표로\s*할래|습관으로\s*만들래|꾸준히\s*할\s*거야|할\s*거야/g, "")
    .replace(/씩/g, " ")
    .trim();
  title = stripTrailingKoreanParticles(title);
  title = title.replace(/잡는\s*연습/g, "잡기 연습");
  if (/파이썬/.test(text) && /공부/.test(text)) {
    return "파이썬 공부하기";
  }
  if (/영어/.test(text) && /공부/.test(text)) {
    return "영어 공부";
  }
  if (/코딩/.test(text) && /공부/.test(text)) {
    return "코딩 공부";
  }
  if (/제과\s*이론/.test(text) && /공부/.test(text)) {
    return "제과 이론 공부";
  }
  if (/헤어\s*컬러\s*이론/.test(text) && /공부/.test(text)) {
    return "헤어 컬러 이론 공부";
  }
  if (/공부/.test(text) && title && !/공부$|공부하기$/.test(title)) {
    return `${title.replace(/\s+/g, " ")} 공부`;
  }
  if (/연습/.test(text) && title && !/연습$|연습하기$/.test(title)) {
    return `${title.replace(/\s+/g, " ")} 연습`;
  }
  if (/운동/.test(text)) {
    return "운동";
  }
  if (/공부$|연습$|운동$/.test(title)) {
    return title.replace(/\s+/g, " ");
  }
  if (!/기$/.test(title)) {
    title = `${title || makeMemoryTitle(text)}하기`;
  }
  return title.replace(/\s+/g, " ");
}

export function stripTrailingKoreanParticles(text: string) {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^(.+?)(을|를|은|는|이|가|도|만)$/u, "$1"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

