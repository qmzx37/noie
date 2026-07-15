import type { DailyTraceItem, DreamRoutine, NoieProject } from "./types";

export function normalizeDailyTraces(value: unknown): DailyTraceItem[] {
  return Array.isArray(value) ? (value as DailyTraceItem[]) : [];
}

export function normalizeProjects(value: unknown): NoieProject[] {
  return Array.isArray(value)
    ? (value as NoieProject[]).map((project) => ({
        dailyActionRecords: {},
        archivedFromTodayMe: false,
        ...project,
        status: project.status ?? "idea",
      }))
    : [];
}

export function normalizeRoutines(value: unknown): DreamRoutine[] {
  return Array.isArray(value)
    ? (value as DreamRoutine[]).map((routine) => ({
        dailySettings: {},
        active: true,
        ...routine,
      }))
    : [];
}

export function normalizeDreamFragments(value: unknown): DailyTraceItem[] {
  return normalizeDailyTraces(value).filter((item) => item.dreamRole === "fragment" || item.saveTargets?.includes("dream_fragment"));
}
