import type {
  DailyTraceItem,
  DreamRoutine,
  SaveDecision,
} from "./types";
import type { DailyLongRecord } from "../features/traces/traceFeature";
import { isDreamFragmentDayPiece } from "../features/traces/dailyPieceLogic";
import { normalizeRoutineTitle } from "../features/traces/lifeScheduleRoutingLogic";
import {
  getMemoryInputText,
  normalizeMemoryInput,
} from "./memoryLogic";

export function normalizeDailyLongRecords(
  records: DailyLongRecord[],
  createDailyLongRecordId: () => string
) {
  const recordByDate = new Map<string, DailyLongRecord>();

  records.forEach((record) => {
    if (!record.dateKey || !record.body?.trim()) {
      return;
    }

    const normalizedRecord: DailyLongRecord = {
      id: record.id || createDailyLongRecordId(),
      dateKey: record.dateKey,
      title: record.title?.trim() || undefined,
      body: record.body,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    };
    const existingRecord = recordByDate.get(record.dateKey);
    if (!existingRecord || normalizedRecord.updatedAt > existingRecord.updatedAt) {
      recordByDate.set(record.dateKey, normalizedRecord);
    }
  });

  return Array.from(recordByDate.values()).sort((left, right) =>
    left.dateKey.localeCompare(right.dateKey)
  );
}

export function repairRoutineTitlesFromOriginalText(items: DailyTraceItem[]) {
  let changed = false;
  const repairedItems = items.map((item) => {
    const itemSourceText = getMemoryInputText(item) || item.originalText || item.text || item.sourceText || "";
    if (!(item.routines ?? []).length) {
      return item;
    }
    const repairedRoutines = (item.routines ?? []).map((routine) => {
      const titleKey = normalizeMemoryInput(routine.title);
      if (!/^(가위\s*)?위\s*잡\s*연습(하기)?$|^가위\s*잡\s*연습(하기)?$/.test(titleKey)) {
        return routine;
      }
      const routineSource = routine as DreamRoutine & { originalText?: string; sourceText?: string; text?: string };
      const sourceText = routineSource.originalText || routineSource.sourceText || routineSource.text || itemSourceText;
      if (!/가위.*연습/.test(sourceText)) {
        return routine;
      }
      const repairedTitle = normalizeRoutineTitle(sourceText);
      if (!repairedTitle || repairedTitle === routine.title) {
        return routine;
      }
      changed = true;
      return {
        ...routine,
        title: repairedTitle,
      };
    });
    return repairedRoutines === item.routines
      ? item
      : {
          ...item,
          routines: repairedRoutines,
        };
  });

  return changed ? repairedItems : items;
}

export function isLegacyRoutineExecutionTrace(
  item: DailyTraceItem,
  routineTitle: string,
  dateKey: string,
  currentSourceId: string
) {
  const typedItem = item as DailyTraceItem & { sourceId?: string; sourceType?: string };
  if (typedItem.sourceId === currentSourceId) {
    return false;
  }
  if (item.date !== dateKey || item.displayCategory !== "반복 목표 수행") {
    return false;
  }
  const itemTitle = normalizeMemoryInput(item.title);
  const routineKey = normalizeMemoryInput(routineTitle).replace(/하기$/g, "");
  return routineKey.length > 0 && itemTitle.includes(routineKey);
}

export function repairRecentDreamFragmentLinks(items: DailyTraceItem[], nowIso: string) {
  const now = new Date();
  let changed = false;
  const nextItems = items.map((item) => {
    if (!isDreamFragmentDayPiece(item) || !item.createdAt || !getMemoryInputText(item)) {
      return item;
    }
    const createdAt = new Date(item.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return item;
    }
    const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / 86400000);
    if (ageDays < 0 || ageDays > 2) {
      return item;
    }
    const saveTargets = item.saveTargets ?? [];
    const nextTargets = Array.from(new Set([...saveTargets, "dream_fragment", "daily_piece", "daily_trace"] as SaveDecision["saveTargets"]));
    if (
      saveTargets.includes("daily_piece") &&
      saveTargets.includes("daily_trace") &&
      item.importance &&
      item.importance >= 96
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      saveTargets: nextTargets,
      importance: Math.max(item.importance ?? 0, 96),
      updatedAt: nowIso,
    };
  });

  return changed ? nextItems : items;
}
