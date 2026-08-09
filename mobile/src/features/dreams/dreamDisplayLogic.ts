import { formatDateDot } from "../../noie/dateUtils";
import {
  dedupeMemories,
  getMemoryInputText,
  getMemoryPolicy,
  normalizeMemoryInput,
} from "../../noie/memoryLogic";
import type {
  DailyTraceItem,
  DreamProjectStatus,
  DreamRoutine,
  NoieProject,
} from "../../noie/types";
import {
  isDreamOrGoalType,
  isHiddenFromDream,
  sortDreamItemsByImportance,
} from "./dreamRoutingLogic";
import type {
  CompletedDreamFragmentDisplayItem,
  DreamFragmentDisplayItem,
} from "./DreamFeature";

export function formatRoutineMeta(routine: DreamRoutine) {
  if (routine.recordType === "check") {
    return routine.repeatType === "weekly" ? `주 ${routine.weeklyTargetCount ?? 1}회` : "매일 확인";
  }

  const target = routine.targetValue ? `목표 ${routine.targetValue}${routine.unit ?? ""}` : "목표 수치 미설정";
  const minimum = routine.minimumValue ? `최소 ${routine.minimumValue}${routine.unit ?? ""}` : "최소 기준 없음";
  return `${target} · ${minimum}`;
}

export function isProjectActionDone(project: NoieProject, dateKey: string) {
  return project.dailyActionRecords?.[dateKey]?.completed === true;
}

export function getProjectRelatedDreamText(
  project: NoieProject,
  dreamFragments: DailyTraceItem[],
  torchPiece?: DailyTraceItem
) {
  const relatedFragment = dreamFragments.find(
    (fragment) =>
      fragment.id === project.sourceDreamFragmentId ||
      fragment.id === project.sourceMemoryId ||
      fragment.id === project.relatedDreamFragmentId
  );
  const relatedDream = relatedFragment ?? (project.relatedDreamTorchId === torchPiece?.id ? torchPiece : undefined);
  return relatedDream ? getMemoryInputText(relatedDream) || relatedDream.title : "";
}

export function formatDreamProjectStatus(status?: DreamProjectStatus) {
  const labelMap: Record<DreamProjectStatus, string> = {
    idea: "아이디어",
    planning: "계획 중",
    in_progress: "진행 중",
    review: "검토 중",
    done: "완료",
  };

  return status ? labelMap[status] : "아이디어";
}

export function isProjectLinkedToFragment(project: NoieProject, fragment: DailyTraceItem) {
  return (
    project.id === fragment.linkedProjectId ||
    project.sourceDreamFragmentId === fragment.id ||
    project.sourceMemoryId === fragment.id ||
    project.relatedDreamFragmentId === fragment.id
  );
}

export function getLinkedProjectsForFragment(
  piece: DailyTraceItem,
  projects: NoieProject[]
) {
  return projects.filter((project) => !project.isArchived && isProjectLinkedToFragment(project, piece));
}

export function getCompletedProjectForFragment(
  piece: DailyTraceItem,
  projects: NoieProject[]
) {
  return getLinkedProjectsForFragment(piece, projects).find(
    (project) => project.status === "done" || Boolean(project.completedAt)
  );
}

export function getLinkedProjectForFragment(
  piece: DailyTraceItem,
  projects: NoieProject[]
) {
  return getLinkedProjectsForFragment(piece, projects)[0];
}

export function getDreamFragmentCardState(project?: NoieProject) {
  if (!project) {
    return {
      kind: "none" as const,
      icon: "✦",
      label: "아직 시작하지 않은 꿈",
    };
  }

  if (project.status === "done" || project.completedAt) {
    return {
      kind: "completed" as const,
      icon: "⭐",
      label: "프로젝트를 완료했어요",
    };
  }

  return {
    kind: "progress" as const,
    icon: "🔥",
    label: "프로젝트가 진행 중이에요",
  };
}

export function getCompletedDreamFragmentMeta(project: NoieProject) {
  if (!project.completedAt) {
    return "완료";
  }
  return `완료 · ${formatDateDot(project.completedAt)}`;
}

export function getDreamTorchCandidates(items: DailyTraceItem[]) {
  return dedupeMemories(items)
    .filter((item) => {
      if (isHiddenFromDream(item) || item.dreamRole === "fragment") {
        return false;
      }

      const memoryPolicy = getMemoryPolicy(item);
      return (
        item.pinnedAsDreamTorch === true ||
        item.saveTargets?.includes("dream_torch") ||
        memoryPolicy.saveTargets?.includes("dream_torch") ||
        isDreamOrGoalType(memoryPolicy.type)
      );
    })
    .sort(sortDreamItemsByImportance);
}

export function selectDreamTorchPiece(
  dreamPieces: DailyTraceItem[],
  dreamTorchId: string | null
) {
  const pinnedPiece = dreamPieces.find((piece) => piece.pinnedAsDreamTorch) ??
    (dreamTorchId ? dreamPieces.find((piece) => piece.id === dreamTorchId) : undefined);

  if (pinnedPiece) {
    return pinnedPiece;
  }

  return [...dreamPieces].sort(sortDreamItemsByImportance)[0];
}

export function getActiveDreamFragments(
  dreamFragments: DailyTraceItem[],
  projects: NoieProject[]
) {
  return dreamFragments.filter(
    (piece) => piece.projectStatus !== "done" && !getCompletedProjectForFragment(piece, projects)
  );
}

export function buildCompletedDreamFragmentDisplayItems(
  dreamFragments: DailyTraceItem[],
  projects: NoieProject[]
): CompletedDreamFragmentDisplayItem[] {
  return dreamFragments
    .map((piece) => ({ piece, project: getCompletedProjectForFragment(piece, projects) }))
    .filter((item) => item.piece.projectStatus === "done" || Boolean(item.project))
    .map(({ piece, project }) => ({
      id: piece.id,
      title: getMemoryInputText(piece) || piece.title,
      meta: project
        ? getCompletedDreamFragmentMeta(project)
        : `완료 · ${formatDateDot((piece as DailyTraceItem & { completedAt?: string }).completedAt ?? piece.updatedAt ?? piece.createdAt)}`,
    }));
}

export function buildActiveDreamFragmentDisplayItems(
  activeDreamFragments: DailyTraceItem[],
  projects: NoieProject[]
): DreamFragmentDisplayItem[] {
  return activeDreamFragments.map((piece) => {
    const linkedProjects = getLinkedProjectsForFragment(piece, projects);
    const completedProject = getCompletedProjectForFragment(piece, projects);
    const linkedProject = completedProject ?? linkedProjects.find(
      (project) => project.status !== "done" && !project.completedAt
    );
    const state = getDreamFragmentCardState(linkedProject);
    const displayText = getMemoryInputText(piece) || piece.title;
    const memoText = piece.memo?.trim() ?? "";
    const shouldShowMemo =
      memoText.length > 0 && normalizeMemoryInput(memoText) !== normalizeMemoryInput(displayText);

    return {
      id: piece.id,
      title: displayText,
      memo: shouldShowMemo ? memoText : undefined,
      statusIcon: state.icon,
      statusLabel: state.label,
      stateKind: state.kind,
      linkedProjectId: linkedProject?.id ?? null,
    };
  });
}
