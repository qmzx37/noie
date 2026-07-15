import type { DailyTraceItem, DreamProjectStatus, NoieProject } from "./types";

export function isActiveTodayMeProject(project: NoieProject) {
  const status = project.status ?? "idea";
  return (
    !project.isArchived &&
    project.archivedFromTodayMe !== true &&
    status !== "done" &&
    (
      project.pinnedToTodayMe === true ||
      typeof project.todayMeOrder === "number" ||
      status === "planning" ||
      status === "in_progress" ||
      status === "review" ||
      Boolean(project.nextAction?.trim())
    )
  );
}

export function getNextTodayMeOrder(projects: NoieProject[]) {
  const orders = projects
    .map((project) => project.todayMeOrder)
    .filter((order): order is number => typeof order === "number" && Number.isFinite(order));
  return orders.length > 0 ? Math.max(...orders) + 1 : 0;
}

export function getTodayMeProjects(
  torchPiece: DailyTraceItem | undefined,
  dreamFragments: DailyTraceItem[],
  projects: NoieProject[]
) {
  const relatedIds = new Set<string>();
  if (torchPiece?.id) {
    relatedIds.add(torchPiece.id);
  }
  dreamFragments.forEach((fragment) => relatedIds.add(fragment.id));

  const statusPriority: Record<DreamProjectStatus, number> = {
    in_progress: 0,
    review: 1,
    planning: 2,
    idea: 3,
    done: 4,
  };

  return projects
    .filter((project) => {
      if (project.isArchived || project.archivedFromTodayMe === true || project.status === "done") {
        return false;
      }
      if (isActiveTodayMeProject(project)) {
        return true;
      }
      const isRelated =
        (project.relatedDreamTorchId ? relatedIds.has(project.relatedDreamTorchId) : false) ||
        (project.sourceDreamFragmentId ? relatedIds.has(project.sourceDreamFragmentId) : false) ||
        (project.sourceMemoryId ? relatedIds.has(project.sourceMemoryId) : false) ||
        (project.relatedDreamFragmentId ? relatedIds.has(project.relatedDreamFragmentId) : false) ||
        project.fromDreamFragment === true;
      return isRelated;
    })
    .sort((left, right) => {
      const leftStatus = left.status ?? "idea";
      const rightStatus = right.status ?? "idea";
      const statusDiff = statusPriority[leftStatus] - statusPriority[rightStatus];
      return statusDiff !== 0 ? statusDiff : right.updatedAt.localeCompare(left.updatedAt);
    });
}
