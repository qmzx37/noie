import type {
  DailyTraceItem,
  DreamRoutine,
  DreamRoutineRecordType,
} from "../../noie/types";

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
