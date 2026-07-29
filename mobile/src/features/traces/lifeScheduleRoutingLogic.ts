import { addDays, getLocalDateString } from "../../noie/dateUtils";

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

