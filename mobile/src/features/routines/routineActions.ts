import type {
  DailyTraceItem,
  DreamRoutine,
  DreamRoutineRecord,
  DreamRoutineRecordType,
} from "../../noie/types";
import { dedupeMemories } from "../../noie/memoryLogic";
import {
  findRoutineRecord,
  getEffectiveRoutineTargetValue,
  safeNumber,
} from "../dreams/dreamProgress";
import { convertRoutineRecordValueToRoutineUnit } from "../routines/routineRoutingLogic";

export type BuildRoutineInput = {
  id: string;
  title: string;
  recordType: DreamRoutineRecordType;
  repeatType: DreamRoutine["repeatType"];
  targetValue?: number;
  minimumValue?: number;
  unit?: string;
  now: string;
};

export type RestoreRoutineInput = {
  routineId: string;
  targetValue?: number;
  unit?: string;
  now: string;
};

export type UpdateRoutineTargetInput = {
  routineId: string;
  targetValue: number;
  minimumValue: number;
  unit?: string;
  dateKey: string;
  now: string;
  mode: "default" | "today";
};

export type UpdateRoutineDailyTargetInput = {
  itemId: string;
  routineId: string;
  dateKey: string;
  targetValue: number;
  minimumValue: number;
  unit?: string;
  now: string;
  updateProgress?: boolean;
};

export type BuildRoutineRecordInput = {
  recordId: string;
  routineId: string;
  dateKey: string;
  score: DreamRoutineRecord["score"];
  value: number;
  now: string;
  existingRecord?: DreamRoutineRecord;
  note?: string;
};

export type BuildCompletedRoutineRecordInput = {
  recordId: string;
  routineId: string;
  dateKey: string;
  score: DreamRoutineRecord["score"];
  value: number;
  now: string;
  existingRecord?: DreamRoutineRecord;
  note?: string;
};

export type UpdateRoutineRecordInput = {
  itemId?: string;
  routineId: string;
  record: DreamRoutineRecord;
  now: string;
};

export type UpdateRoutineRecordResult = {
  items: DailyTraceItem[];
  didUpdate: boolean;
};

export type RemoveRoutineRecordInput = {
  itemId: string;
  routineId: string;
  dateKey: string;
  now: string;
};

export type UpdateRoutineTodayMeStateInput = {
  itemId: string;
  routineId: string;
  now: string;
  state: "completed" | "archived";
};

export type UpsertTodayMeRoutineInItemsInput = {
  currentItems: DailyTraceItem[];
  torchItem: DailyTraceItem;
  existingRoutineId?: string;
  title: string;
  recordType: DreamRoutineRecordType;
  repeatType: DreamRoutine["repeatType"];
  targetValue?: number;
  minimumValue?: number;
  unit?: string;
  now: string;
  newRoutineId: string;
};

export type UpsertTodayMeRoutineInItemsResult = {
  nextTorch: DailyTraceItem;
  nextItems: DailyTraceItem[];
  routine: DreamRoutine;
  restored: boolean;
  created: boolean;
};

export type RecordRoutineExecutionInItemsInput = {
  currentItems: DailyTraceItem[];
  itemId?: string;
  routineId: string;
  dateKey: string;
  actualValue: number;
  unit?: string;
  originalText?: string;
  completedOnly?: boolean;
  now: string;
  newRecordId: string;
};

export type RecordRoutineExecutionInItemsResult = {
  nextItems: DailyTraceItem[];
  targetItemId?: string;
  routineTitle?: string;
  displayUnit?: string;
  savedRecord?: DreamRoutineRecord;
  completed: boolean;
  found: boolean;
};

export type RemoveRoutineFromTodayMeInItemsInput = {
  currentItems: DailyTraceItem[];
  itemId: string;
  routineId: string;
  dateKey: string;
  now: string;
  resetTodayRecord: boolean;
};

export type RemoveRoutineFromTodayMeInItemsResult = {
  nextItems: DailyTraceItem[];
  removed: boolean;
  removedTodayRecord: boolean;
};

export type DeleteRoutineCompletelyInput = {
  currentItems: DailyTraceItem[];
  routineIds: string[];
  now: string;
};

export type DeleteRoutineCompletelyResult = {
  nextItems: DailyTraceItem[];
  deletedRoutineIds: string[];
  deletedRoutineCount: number;
  deletedRecordCount: number;
  deletedLegacyTraceCount: number;
};

function isRoutineExecutionTraceForDeletedRoutine(
  item: DailyTraceItem,
  deletedRoutineIds: Set<string>
) {
  const typedItem = item as DailyTraceItem & {
    sourceId?: string;
    sourceType?: string;
    routineId?: string;
  };
  if (typedItem.routineId && deletedRoutineIds.has(typedItem.routineId)) {
    return true;
  }
  const sourceId = typedItem.sourceId;
  if (typedItem.sourceType !== "routine_execution" || !sourceId) {
    return false;
  }
  return Array.from(deletedRoutineIds).some((routineId) =>
    sourceId === `routine_execution:${routineId}` ||
    sourceId.startsWith(`routine_execution:${routineId}:`)
  );
}

export function buildTodayMeRoutine(input: BuildRoutineInput): DreamRoutine {
  return {
    id: input.id,
    title: input.title,
    recordType: input.recordType,
    repeatType: input.repeatType,
    targetValue: input.targetValue,
    minimumValue: input.minimumValue,
    unit: input.unit,
    dailySettings: {},
    lifecycleStatus: "active",
    archivedFromTodayMe: false,
    active: true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function restoreTodayMeRoutineInTorch(
  torch: DailyTraceItem,
  input: RestoreRoutineInput
): DailyTraceItem {
  return {
    ...torch,
    routines: (torch.routines ?? []).map((routine) =>
      routine.id === input.routineId
        ? {
            ...routine,
            targetValue: input.targetValue,
            ...(input.unit === undefined ? {} : { unit: input.unit }),
            lifecycleStatus: "active",
            archivedFromTodayMe: false,
            active: true,
            updatedAt: input.now,
          }
        : routine
    ),
    updatedAt: input.now,
  };
}

export function addRoutineToTorch(
  torch: DailyTraceItem,
  routine: DreamRoutine,
  now: string
): DailyTraceItem {
  return {
    ...torch,
    routines: [...(torch.routines ?? []), routine],
    updatedAt: now,
  };
}

export function upsertTodayMeRoutineInItems(
  input: UpsertTodayMeRoutineInItemsInput
): UpsertTodayMeRoutineInItemsResult {
  const existingRoutine = input.existingRoutineId
    ? input.torchItem.routines?.find((routine) => routine.id === input.existingRoutineId)
    : undefined;

  if (existingRoutine) {
    const nextTorch = restoreTodayMeRoutineInTorch(input.torchItem, {
      routineId: existingRoutine.id,
      targetValue: input.targetValue,
      unit: input.unit,
      now: input.now,
    });
    const restoredRoutine = nextTorch.routines?.find((routine) => routine.id === existingRoutine.id) ?? existingRoutine;

    return {
      nextTorch,
      nextItems: replaceTorchInItems(input.currentItems, nextTorch, input.now),
      routine: restoredRoutine,
      restored: true,
      created: false,
    };
  }

  const routine = buildTodayMeRoutine({
    id: input.newRoutineId,
    title: input.title,
    recordType: input.recordType,
    repeatType: input.repeatType,
    targetValue: input.targetValue,
    minimumValue: input.minimumValue,
    unit: input.unit,
    now: input.now,
  });
  const nextTorch = addRoutineToTorch(input.torchItem, routine, input.now);

  return {
    nextTorch,
    nextItems: replaceTorchInItems(input.currentItems, nextTorch, input.now),
    routine,
    restored: false,
    created: true,
  };
}

export function recordRoutineExecutionInItems(
  input: RecordRoutineExecutionInItemsInput
): RecordRoutineExecutionInItemsResult {
  const safeActualValue = Math.max(0, safeNumber(input.actualValue));
  if (!input.routineId || !Number.isFinite(safeActualValue)) {
    return {
      nextItems: input.currentItems,
      completed: false,
      found: false,
    };
  }

  const targetItem = input.currentItems.find((item) => {
    if (input.itemId && item.id !== input.itemId) {
      return false;
    }
    return (item.routines ?? []).some((routine) => routine.id === input.routineId);
  });
  const routine = targetItem?.routines?.find((candidate) => candidate.id === input.routineId);
  if (!targetItem || !routine) {
    return {
      nextItems: input.currentItems,
      completed: false,
      found: false,
    };
  }

  const normalizedValue = convertRoutineRecordValueToRoutineUnit(
    safeActualValue,
    input.unit,
    routine.unit
  );
  const existingRecord = findRoutineRecord(targetItem.routineRecords ?? [], input.routineId, input.dateKey);
  const score = input.completedOnly
    ? existingRecord?.score ?? 1
    : calculateRoutineScoreForAction(routine, normalizedValue);
  const effectiveTargetValue = getEffectiveRoutineTargetValue(routine, input.dateKey);
  const completedValue = effectiveTargetValue > 0 ? effectiveTargetValue : Math.max(1, normalizedValue);
  const nextRecord = input.completedOnly
    ? buildCompletedRoutineRecord({
        recordId: input.newRecordId,
        routineId: input.routineId,
        dateKey: input.dateKey,
        score,
        value: completedValue,
        existingRecord,
        now: input.now,
        note: input.originalText,
      })
    : buildRoutineRecord({
        recordId: input.newRecordId,
        routineId: input.routineId,
        dateKey: input.dateKey,
        score,
        value: normalizedValue,
        existingRecord,
        now: input.now,
        note: input.originalText,
      });
  const recordResult = updateRoutineRecordInItems(input.currentItems, {
    itemId: input.itemId,
    routineId: input.routineId,
    record: nextRecord,
    now: input.now,
  });

  return {
    nextItems: recordResult.items,
    targetItemId: targetItem.id,
    routineTitle: routine.title,
    displayUnit: input.unit ?? routine.unit ?? "",
    savedRecord: recordResult.didUpdate ? nextRecord : undefined,
    completed: score >= 1,
    found: recordResult.didUpdate,
  };
}

export function removeRoutineFromTodayMeInItems(
  input: RemoveRoutineFromTodayMeInItemsInput
): RemoveRoutineFromTodayMeInItemsResult {
  const targetItem = input.currentItems.find((item) => item.id === input.itemId);
  const removed = Boolean(targetItem?.routines?.some((routine) => routine.id === input.routineId));
  const beforeTodayRecordCount = (targetItem?.routineRecords ?? []).filter(
    (record) => isRoutineRecordForDate(record, input.routineId, input.dateKey)
  ).length;
  const archivedItems = updateRoutineTodayMeStateInItems(input.currentItems, {
    itemId: input.itemId,
    routineId: input.routineId,
    now: input.now,
    state: "archived",
  });
  const nextItems = input.resetTodayRecord
    ? removeRoutineRecordFromItems(archivedItems, {
        itemId: input.itemId,
        routineId: input.routineId,
        dateKey: input.dateKey,
        now: input.now,
      })
    : archivedItems;

  return {
    nextItems,
    removed,
    removedTodayRecord: beforeTodayRecordCount > 0,
  };
}

export function deleteRoutineCompletelyFromItems(
  input: DeleteRoutineCompletelyInput
): DeleteRoutineCompletelyResult {
  const deletedRoutineIds = Array.from(new Set(input.routineIds)).filter(Boolean);
  const deletedRoutineIdSet = new Set(deletedRoutineIds);
  let deletedRoutineCount = 0;
  let deletedRecordCount = 0;
  let deletedLegacyTraceCount = 0;

  if (deletedRoutineIdSet.size === 0) {
    return {
      nextItems: input.currentItems,
      deletedRoutineIds,
      deletedRoutineCount,
      deletedRecordCount,
      deletedLegacyTraceCount,
    };
  }

  const remainingItems = input.currentItems.filter((item) => {
    const shouldDelete = isRoutineExecutionTraceForDeletedRoutine(item, deletedRoutineIdSet);
    if (shouldDelete) {
      deletedLegacyTraceCount += 1;
    }
    return !shouldDelete;
  });

  const nextItems = remainingItems.map((item) => {
    const routines = item.routines ?? [];
    const routineRecords = item.routineRecords ?? [];
    const nextRoutines = routines.filter((routine) => !deletedRoutineIdSet.has(routine.id));
    const nextRoutineRecords = routineRecords.filter((record) => !deletedRoutineIdSet.has(record.routineId));
    const removedRoutineCount = routines.length - nextRoutines.length;
    const removedRecordCount = routineRecords.length - nextRoutineRecords.length;

    if (removedRoutineCount === 0 && removedRecordCount === 0) {
      return item;
    }

    deletedRoutineCount += removedRoutineCount;
    deletedRecordCount += removedRecordCount;

    return {
      ...item,
      routines: nextRoutines,
      routineRecords: nextRoutineRecords,
      progressUpdatedAt: removedRecordCount > 0 ? input.now : item.progressUpdatedAt,
      updatedAt: input.now,
    };
  });

  return {
    nextItems,
    deletedRoutineIds,
    deletedRoutineCount,
    deletedRecordCount,
    deletedLegacyTraceCount,
  };
}

export function updateRoutineTargetInItems(
  items: DailyTraceItem[],
  input: UpdateRoutineTargetInput
): DailyTraceItem[] {
  return items.map((item) => {
    const hasRoutine = (item.routines ?? []).some((routine) => routine.id === input.routineId);

    return {
      ...item,
      routines: (item.routines ?? []).map((routine) => {
        if (routine.id !== input.routineId) {
          return routine;
        }

        if (input.mode === "default") {
          const nextDailySettings = { ...(routine.dailySettings ?? {}) };
          delete nextDailySettings[input.dateKey];

          return {
            ...routine,
            targetValue: input.targetValue,
            minimumValue: input.minimumValue,
            ...(input.unit === undefined ? {} : { unit: input.unit }),
            dailySettings: nextDailySettings,
            updatedAt: input.now,
          };
        }

        return {
          ...routine,
          dailySettings: {
            ...(routine.dailySettings ?? {}),
            [input.dateKey]: {
              ...(routine.dailySettings?.[input.dateKey] ?? {}),
              targetValue: input.targetValue,
              minimumValue: input.minimumValue,
              unit: input.unit ?? routine.unit,
              updatedAt: input.now,
            },
          },
          updatedAt: input.now,
        };
      }),
      updatedAt: hasRoutine ? input.now : item.updatedAt,
    };
  });
}

function replaceTorchInItems(
  items: DailyTraceItem[],
  nextTorch: DailyTraceItem,
  now: string
) {
  const hasExistingTorch = items.some((item) => item.id === nextTorch.id);
  if (hasExistingTorch) {
    return items.map((item) => item.id === nextTorch.id ? nextTorch : item);
  }

  return dedupeMemories([
    ...items.map((item) =>
      item.pinnedAsDreamTorch ? { ...item, pinnedAsDreamTorch: false, updatedAt: now } : item
    ),
    nextTorch,
  ]);
}

function calculateRoutineScoreForAction(
  routine: DreamRoutine,
  value: number
): DreamRoutineRecord["score"] {
  if (routine.recordType === "check") {
    return 1;
  }

  const targetValue = safeNumber(routine.targetValue);
  const minimumValue = safeNumber(routine.minimumValue);
  if (targetValue > 0 && value >= targetValue) {
    return 1;
  }
  if (minimumValue > 0 && value >= minimumValue) {
    return 0.5;
  }
  return 0;
}

function isRoutineRecordForDate(
  record: DreamRoutineRecord,
  routineId: string,
  dateKey: string
) {
  return record.routineId === routineId && (
    record.date === dateKey ||
    record.date.slice(0, 10) === dateKey
  );
}

export function updateRoutineDailyTargetForItem(
  items: DailyTraceItem[],
  input: UpdateRoutineDailyTargetInput
): DailyTraceItem[] {
  return items.map((item) => {
    if (item.id !== input.itemId) {
      return item;
    }

    return {
      ...item,
      routines: (item.routines ?? []).map((routine) =>
        routine.id === input.routineId
          ? {
              ...routine,
              dailySettings: {
                ...(routine.dailySettings ?? {}),
                [input.dateKey]: {
                  ...(routine.dailySettings?.[input.dateKey] ?? {}),
                  targetValue: input.targetValue,
                  minimumValue: input.minimumValue,
                  unit: input.unit ?? routine.unit,
                  updatedAt: input.now,
                },
              },
              updatedAt: input.now,
            }
          : routine
      ),
      ...(input.updateProgress === false ? {} : { progressUpdatedAt: input.now }),
      updatedAt: input.now,
    };
  });
}

export function buildRoutineRecord(input: BuildRoutineRecordInput): DreamRoutineRecord {
  return {
    ...input.existingRecord,
    id: input.existingRecord?.id ?? input.recordId,
    routineId: input.routineId,
    date: input.dateKey,
    score: input.score,
    value: input.value,
    note: input.note ?? input.existingRecord?.note,
    createdAt: input.existingRecord?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

export function buildCompletedRoutineRecord(
  input: BuildCompletedRoutineRecordInput
): DreamRoutineRecord & {
  actualValue?: number;
  completed?: boolean;
  completionType?: "full";
} {
  return {
    ...input.existingRecord,
    id: input.existingRecord?.id ?? input.recordId,
    routineId: input.routineId,
    date: input.dateKey,
    score: input.score,
    value: input.value,
    actualValue: input.value,
    completed: true,
    completionType: "full",
    note: input.note ?? input.existingRecord?.note,
    createdAt: input.existingRecord?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

export function upsertRoutineRecord(
  records: DreamRoutineRecord[],
  nextRecord: DreamRoutineRecord
) {
  return [
    ...records.filter(
      (record) => !(record.routineId === nextRecord.routineId && record.date === nextRecord.date)
    ),
    nextRecord,
  ].sort((left, right) => right.date.localeCompare(left.date));
}

export function updateRoutineRecordInItems(
  items: DailyTraceItem[],
  input: UpdateRoutineRecordInput
): UpdateRoutineRecordResult {
  let didUpdate = false;
  const nextItems = items.map((item) => {
    if (input.itemId && item.id !== input.itemId) {
      return item;
    }
    if (!(item.routines ?? []).some((routine) => routine.id === input.routineId)) {
      return item;
    }

    didUpdate = true;
    return {
      ...item,
      routineRecords: upsertRoutineRecord(item.routineRecords ?? [], input.record),
      progressUpdatedAt: input.now,
      updatedAt: input.now,
    };
  });

  return { items: nextItems, didUpdate };
}

export function removeRoutineRecordFromItems(
  items: DailyTraceItem[],
  input: RemoveRoutineRecordInput
): DailyTraceItem[] {
  return items.map((item) => {
    if (item.id !== input.itemId) {
      return item;
    }
    return {
      ...item,
      routineRecords: (item.routineRecords ?? []).filter(
        (record) => !(record.routineId === input.routineId && (
          record.date === input.dateKey ||
          record.date.slice(0, 10) === input.dateKey
        ))
      ),
      progressUpdatedAt: input.now,
      updatedAt: input.now,
    };
  });
}

export function updateRoutineTodayMeStateInItems(
  items: DailyTraceItem[],
  input: UpdateRoutineTodayMeStateInput
): DailyTraceItem[] {
  return items.map((item) => {
    if (item.id !== input.itemId) {
      return item;
    }

    return {
      ...item,
      routines: (item.routines ?? []).map((routine) => {
        if (routine.id !== input.routineId) {
          return routine;
        }
        if (input.state === "completed") {
          return {
            ...routine,
            active: false,
            lifecycleStatus: "completed",
            completedAt: input.now,
            updatedAt: input.now,
          };
        }
        return {
          ...routine,
          archivedFromTodayMe: true,
          updatedAt: input.now,
        };
      }),
      updatedAt: input.now,
    };
  });
}
