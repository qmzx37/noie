import { getSelectedGoalDuration } from "../../noie/dateUtils";
import { getMemoryInputText, normalizeMemoryInput } from "../../noie/memoryLogic";
import { getTodayMeProjects } from "../../noie/selectors";
import type { DailyTraceItem, DreamRoutine, GoalDurationMonths, NoieProject } from "../../noie/types";
import { formatRoutineTarget } from "../traces/dailyTraceRoutingLogic";
import { makeMemoryTitle } from "../traces/lifeScheduleRoutingLogic";
import type { DreamTorchDisplayItem } from "./DreamFeature";
import {
  buildActiveDreamFragmentDisplayItems,
  buildCompletedDreamFragmentDisplayItems,
  formatRoutineMeta,
  getActiveDreamFragments,
  getCompletedProjectForFragment,
  getDreamTorchCandidates,
  isProjectActionDone,
  selectDreamTorchPiece,
} from "./dreamDisplayLogic";
import {
  getDreamDdayLabel,
  getDreamProjectSummary,
  getEffectiveRoutineTargetValue,
  isRoutineActionDoneToday,
} from "./dreamProgress";
import { getDreamFragments } from "./dreamRoutingLogic";
import {
  areRoutineTitlesSemanticallyDuplicate,
  getTodayRoutineRecord,
  getVisibleTodayMeCards,
  selectTodayMeRecommendation as selectTodayMeRecommendationFromLogic,
} from "./todayMeLogic";
import type { TodayMeCard, TodayMeRecommendation } from "./TodayMeSection";

export function buildTodayConsistencyRoutineGroups(
  torchPiece: DailyTraceItem | undefined,
  visibleRoutines: DreamRoutine[]
) {
  const allRoutines = torchPiece?.routines ?? [];

  return visibleRoutines.map((visibleRoutine) => {
    const routines = allRoutines.filter((routine) =>
      routine.id === visibleRoutine.id ||
      areRoutineTitlesSemanticallyDuplicate(routine.title, visibleRoutine.title)
    );

    return {
      primaryRoutineId: visibleRoutine.id,
      routines: routines.length > 0 ? routines : [visibleRoutine],
    };
  });
}

export function selectTodayMeRecommendation(
  recommendationTorchPiece: DailyTraceItem | undefined,
  recommendationDreamFragments: DailyTraceItem[],
  recommendationProjects: NoieProject[],
  activeCards: TodayMeCard[],
  dismissedKeys: string[]
): TodayMeRecommendation | undefined {
  return selectTodayMeRecommendationFromLogic(
    recommendationTorchPiece,
    recommendationDreamFragments,
    recommendationProjects,
    activeCards,
    dismissedKeys,
    {
      normalizeMemoryInput,
      getCompletedProjectForFragment,
      getMemoryInputText,
      makeMemoryTitle,
    }
  );
}

type BuildDreamFeatureViewModelInput = {
  dailyTraces: DailyTraceItem[];
  projects: NoieProject[];
  dreamTorchId: string | null;
  todayKey: string;
  isSavingGoalDuration: boolean;
};

export function buildDreamFeatureViewModel({
  dailyTraces,
  projects,
  dreamTorchId,
  todayKey,
  isSavingGoalDuration,
}: BuildDreamFeatureViewModelInput) {
  const dreamTorchCandidates = getDreamTorchCandidates(dailyTraces);
  const torchPiece = selectDreamTorchPiece(dreamTorchCandidates, dreamTorchId);
  const dreamFragments = getDreamFragments(dailyTraces).filter(
    (piece) => piece.id !== torchPiece?.id
  );
  const activeDreamFragments = getActiveDreamFragments(dreamFragments, projects);
  const completedDreamFragments = buildCompletedDreamFragmentDisplayItems(dreamFragments, projects);
  const activeDreamFragmentCards = buildActiveDreamFragmentDisplayItems(activeDreamFragments, projects);
  const todayMeProjects = getTodayMeProjects(torchPiece, dreamFragments, projects);
  const todayMeCards = getVisibleTodayMeCards(torchPiece, dreamFragments, projects, todayKey);
  const fireRoutines = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "routine" }> => card.cardType === "routine");
  const fireProjects = todayMeCards.filter((card): card is Extract<TodayMeCard, { cardType: "project" }> => card.cardType === "project");
  const dreamProjectSummary = getDreamProjectSummary(todayMeProjects, torchPiece, projects, {
    todayConsistencyRoutineGroups: buildTodayConsistencyRoutineGroups(
      torchPiece,
      fireRoutines.map(({ routine }) => routine)
    ),
  });
  const selectedMonths = torchPiece ? getSelectedGoalDuration(torchPiece) : undefined;
  const completedRoutineCount = torchPiece
    ? fireRoutines.filter(({ routine }) => isRoutineActionDoneToday(getTodayRoutineRecord(torchPiece, routine))).length
    : 0;
  const completedProjectCount = fireProjects.filter(({ project }) => isProjectActionDone(project, todayKey)).length;
  const totalFireCount = todayMeCards.length;
  const completedFireCount = completedRoutineCount + completedProjectCount;
  const isAllDoneToday = totalFireCount > 0 && completedFireCount === totalFireCount;
  const torch: DreamTorchDisplayItem | null = torchPiece
    ? {
        id: torchPiece.id,
        title: getMemoryInputText(torchPiece) || torchPiece.title,
        ddayLabel: getDreamDdayLabel(torchPiece),
        isSavingGoalDuration,
        durationOptions: ([3, 6, 12] as GoalDurationMonths[]).map((months) => ({
          months,
          label: `${months}개월`,
          isSelected: selectedMonths === months,
        })),
        fireTitle: isAllDoneToday ? "오늘의 불씨를 모두 켰어요 🔥" : "오늘의 불씨",
        completedFireCount,
        totalFireCount,
        fireItems: [
          ...fireRoutines.map(({ routine }, index) => {
            const record = getTodayRoutineRecord(torchPiece, routine);
            const isDone = isRoutineActionDoneToday(record);
            const targetValue = getEffectiveRoutineTargetValue(routine, todayKey);
            const routineTargetText =
              targetValue > 0 ? `오늘 목표 · ${formatRoutineTarget(targetValue, routine.unit)}` : formatRoutineMeta(routine);

            return {
              id: routine.id,
              title: isDone ? `🔥 ${routine.title}` : routine.title,
              meta: isDone ? "오늘 해냈어요." : routineTargetText,
              isDone,
              showDivider: index < totalFireCount - 1,
              kind: "routine" as const,
              itemId: torchPiece.id,
              routineId: routine.id,
            };
          }),
          ...fireProjects.map(({ project }, index) => {
            const isDone = isProjectActionDone(project, todayKey);
            const actionText = project.nextAction?.trim() || "다음 행동";

            return {
              id: `project-fire-${project.id}`,
              title: isDone ? `🔥 ${actionText}` : actionText,
              meta: isDone ? "오늘 해냈어요." : `프로젝트 · ${project.title}`,
              isDone,
              showDivider: fireRoutines.length + index < totalFireCount - 1,
              kind: "project" as const,
              projectId: project.id,
            };
          }),
        ],
      }
    : null;

  return {
    torchPiece,
    dreamFragments,
    activeDreamFragmentCards,
    completedDreamFragments,
    todayMeProjects,
    todayMeCards,
    dreamProjectSummary,
    torch,
    todayKey,
  };
}
