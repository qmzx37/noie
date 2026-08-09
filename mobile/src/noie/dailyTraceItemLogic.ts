import { getLocalDateString } from "./dateUtils";
import { normalizeMemoryInput, type NoieSaveRoutingResult } from "./memoryLogic";
import type { DailyTraceCandidate, DailyTraceItem, MemorySavePolicy } from "./types";

export function buildDailyTraceItem(
  candidate: DailyTraceCandidate,
  sourceText: string,
  sourceMessageId: string,
  createdAt: string,
  memoryPolicy: MemorySavePolicy | undefined,
  createTraceId: () => string
): DailyTraceItem {
  return {
    id: createTraceId(),
    type: candidate.type,
    date: candidate.date,
    title: candidate.title,
    memo: candidate.memo,
    time: candidate.time ?? undefined,
    targetDate: candidate.targetDate ?? undefined,
    targetYear: candidate.targetYear ?? undefined,
    targetText: candidate.targetText ?? undefined,
    sourceText,
    text: sourceText,
    originalText: sourceText,
    sourceMessageId,
    isDone: candidate.type === "todo" ? false : undefined,
    memoryType: memoryPolicy?.type,
    saveTargets: memoryPolicy?.saveTargets,
    importance: memoryPolicy?.importance,
    displayCategory: memoryPolicy?.label,
    dreamRole: memoryPolicy?.dreamRole,
    pinnedAsDreamTorch: memoryPolicy?.dreamRole === "torch" ? true : undefined,
    createdAt,
  };
}

export function applyRoutingFieldsToDailyTrace(
  item: DailyTraceItem,
  routingResult?: NoieSaveRoutingResult
): DailyTraceItem {
  if (!routingResult) {
    return item;
  }

  const originalText = routingResult.originalText || item.originalText || item.text || item.title;

  if (routingResult.route === "important_day_event") {
    return {
      ...item,
      type: "record",
      title: routingResult.title || item.title,
      memo: item.memo || "오늘의 중요한 사건",
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "important_note",
      saveTargets: ["daily_piece", "daily_trace"],
      importance: Math.max(item.importance ?? 0, 94),
      displayCategory: "오늘의 중요한 사건",
      category: "important_day_event",
      priorityType: "top_two",
    } as DailyTraceItem;
  }

  if (routingResult.route === "daily_idea") {
    return {
      ...item,
      type: "quote",
      title: routingResult.title || item.title,
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "idea",
      saveTargets: ["daily_piece", "daily_trace"],
      importance: Math.max(item.importance ?? 0, 72),
      displayCategory: "오늘의 아이디어",
    };
  }

  if (routingResult.route === "daily_trace") {
    const title = routingResult.title || item.title;
    return {
      ...item,
      type: "record",
      date: routingResult.scheduledDate ?? item.date,
      title,
      memo: item.memo || "하루의 흔적",
      sourceText: originalText,
      text: title,
      originalText,
      memoryType: "daily_context",
      saveTargets: ["daily_trace"],
      importance: Math.max(item.importance ?? 0, 70),
      displayCategory: "하루의 흔적",
    };
  }

  if (routingResult.route === "life_schedule_once" || routingResult.route === "life_schedule_repeat") {
    const dateKey = routingResult.scheduledDate ?? item.date ?? getLocalDateString(new Date());
    const sourceKey = normalizeMemoryInput(`${routingResult.route}:${routingResult.title}:${routingResult.displayUnit ?? ""}`);
    return {
      ...item,
      type: "todo",
      date: dateKey,
      title: routingResult.title || item.title,
      memo: routingResult.route === "life_schedule_repeat" ? "매일 반복 · 🔔 시간에 맞춰" : "🔔 시간에 맞춰 알려주기",
      time: routingResult.displayUnit ?? item.time,
      endTime: routingResult.endTime ?? undefined,
      sourceText: originalText,
      text: originalText,
      originalText,
      isDone: false,
      memoryType: "todo",
      saveTargets: ["daily_trace"],
      importance: Math.max(item.importance ?? 0, 70),
      displayCategory: routingResult.route === "life_schedule_repeat" ? "생활 반복 예정" : "생활 예정",
      sourceType: routingResult.route,
      sourceId: `${routingResult.route}:${dateKey}:${sourceKey}`,
      reminder: routingResult.reminder ?? "on_time",
      recurrence: routingResult.route === "life_schedule_repeat" ? routingResult.recurrence ?? "daily" : undefined,
      completedDates: {},
    } as DailyTraceItem;
  }

  if (routingResult.route === "life_action_record") {
    const dateKey = routingResult.scheduledDate ?? item.date ?? getLocalDateString(new Date());
    const sourceKey = normalizeMemoryInput(`${routingResult.title}:${routingResult.displayUnit ?? ""}`);
    return {
      ...item,
      type: "record",
      date: dateKey,
      title: routingResult.title || item.title,
      memo: item.memo || "직접 기록",
      time: routingResult.displayUnit ?? item.time,
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "daily_context",
      saveTargets: ["daily_trace"],
      importance: Math.max(item.importance ?? 0, 70),
      displayCategory: "직접 기록",
      sourceType: "life_action_record",
      sourceId: `life_action_record:${dateKey}:${sourceKey}`,
    } as DailyTraceItem;
  }

  if (routingResult.route === "completed_action") {
    const completedActionKey = normalizeMemoryInput(routingResult.title || originalText);
    const dateKey = item.date || getLocalDateString(new Date());
    return {
      ...item,
      type: "record",
      title: routingResult.title || item.title,
      memo: item.memo || "완료한 행동",
      sourceText: originalText,
      text: originalText,
      originalText,
      memoryType: "achievement",
      saveTargets: ["daily_piece", "daily_trace"],
      importance: Math.max(item.importance ?? 0, 84),
      displayCategory: "완료한 행동",
      category: "completed_action",
      sourceType: "completed_action",
      sourceId: `completed_action:${dateKey}:${completedActionKey}`,
    } as DailyTraceItem;
  }

  return item;
}








