import type { DailyTraceItem, DreamProjectStatus } from "./types";

export function getDreamProjectProgress(status?: DreamProjectStatus) {
  const progressMap: Record<DreamProjectStatus, number> = {
    idea: 0,
    planning: 25,
    in_progress: 50,
    review: 80,
    done: 100,
  };

  return status ? progressMap[status] ?? 0 : 0;
}

export function calculateDreamFragmentProgress(
  piece: DailyTraceItem,
  isLinkedProject: boolean
) {
  const statusProgress: Record<DreamProjectStatus, number> = {
    idea: 0,
    planning: 20,
    in_progress: 50,
    review: 80,
    done: 100,
  };
  const status = piece.projectStatus ?? "idea";
  const explicitProgress =
    typeof piece.progressPercent === "number" ? piece.progressPercent : undefined;
  const baseProgress = explicitProgress ?? statusProgress[status] ?? 0;

  return Math.max(isLinkedProject ? 30 : 0, Math.min(100, baseProgress));
}
