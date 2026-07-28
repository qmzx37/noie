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
