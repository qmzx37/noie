import type {
  DailyTraceItem,
  DreamMilestone,
  DreamMilestonePriority,
  DreamRoutine,
  DreamRoutineRecord,
  DreamSeason,
  DreamSeasonStatus,
  GoalDurationMonths,
  NoieProject,
} from "../../noie/types";
import {
  enumerateDateKeys,
  getLocalDateString,
  getSelectedGoalDuration,
  isValidDateKey,
  parseDateOnly,
} from "../../noie/dateUtils";

export type ConsistencyStatus = "complete" | "partial" | "missed" | "neutral";

export type ConsistencyDay = {
  dateKey: string;
  ratio: number;
  status: ConsistencyStatus;
};

export type DreamProgressBreakdown = {
  executionProgress: number;
  timeProgress: number;
  baseProgress: number;
  paceBonus: number;
  baseExecutionProgress: number;
  elapsedPeriodPercent: number;
  periodAdjustment: number;
  hasExecutionData: boolean;
  goalDurationMonths?: GoalDurationMonths | null;
  goalStartDate?: string;
  goalTargetDate?: string;
  milestoneProgress: number;
  cumulativeRoutineProgress: number;
  recent28DayPace: number;
  projectProgress: number;
  evidenceProgress: number;
  reliability: "낮음" | "보통" | "높음";
  reliabilityReason: string;
  nextMilestone?: DreamMilestone;
  activeSeason?: DreamSeason;
  milestoneWeightTotal: number;
  routineWeight: number;
  milestoneWeight: number;
  consistencyScore: number;
  consistencyDays: ConsistencyDay[];
};

export type DreamProjectSummary = DreamProgressBreakdown & {
  progressPercent: number;
  linkedProjectCount: number;
  doneProjectCount: number;
};

type ProgressWeights = {
  routineWeight: number;
  milestoneWeight: number;
};

type RoutineScheduleBucket = {
  routineId: string;
  bucketKey: string;
  bucketType: "day" | "week";
  startDateKey: string;
  endDateKey: string;
};

type TodayConsistencyRoutineGroup = {
  primaryRoutineId: string;
  routines: DreamRoutine[];
};

type DreamProgressOptions = {
  todayConsistencyRoutineGroups?: TodayConsistencyRoutineGroup[];
};

export function getDailyRoutineCompletionRatio(
  routine: DreamRoutine,
  dateKey: string,
  records: DreamRoutineRecord[]
) {
  if (hasPausedDate(routine, dateKey)) {
    return 0;
  }
  const record = findRoutineRecord(records, routine.id, dateKey);
  if (isRoutineRecordFullyCompleted(record, routine, dateKey)) {
    return 1;
  }

  const targetValue = getEffectiveRoutineTargetValue(routine, dateKey);
  const actualValue = getRoutineRecordMeasuredValue(record);
  if (targetValue > 0) {
    return clampRatio(actualValue / targetValue);
  }
  if (record?.score) {
    return clampRatio(record.score);
  }
  return 0;
}



function getWeeklyRoutineCompletionRatio(
  routine: DreamRoutine,
  weekStartDateKey: string,
  weekEndDateKey: string,
  records: DreamRoutineRecord[]
) {
  const weeklyTargetValue = safeNumber(routine.weeklyTargetCount) || safeNumber(routine.targetValue) || 1;
  if (weeklyTargetValue <= 0) {
    return 0;
  }
  const actualWeeklyValue = records
    .filter(
      (record) => {
        const recordDateKey = normalizeRoutineRecordDateKey(record.date);
        return (
          record.routineId === routine.id &&
          recordDateKey >= weekStartDateKey &&
          recordDateKey <= weekEndDateKey
        );
      }
    )
    .reduce((sum, record) => {
      const value = getRoutineRecordActualValue(record);
      return sum + (value > 0 ? value : record.score > 0 ? 1 : 0);
    }, 0);

  return clampRatio(actualWeeklyValue / weeklyTargetValue);
}



function buildRoutineScheduleBuckets(
  routines: DreamRoutine[],
  startDateKey: string,
  targetDateKey: string
): RoutineScheduleBucket[] {
  const startDate = parseDateOnly(startDateKey);
  const targetDate = parseDateOnly(targetDateKey);
  if (!startDate || !targetDate || targetDate < startDate) {
    return [];
  }
  const buckets: RoutineScheduleBucket[] = [];

  routines.forEach((routine) => {
    const routineStartDate = maxDateLocal(startDate, parseDateOnly(routine.createdAt));
    if (!routineStartDate || routineStartDate > targetDate) {
      return;
    }
    if (routine.repeatType === "weekly") {
      let weekStart = new Date(routineStartDate);
      while (weekStart <= targetDate) {
        const weekEnd = minDateLocal(addDaysLocal(weekStart, 6), targetDate);
        buckets.push({
          routineId: routine.id,
          bucketKey: `${routine.id}:${getLocalDateString(weekStart)}`,
          bucketType: "week",
          startDateKey: getLocalDateString(weekStart),
          endDateKey: getLocalDateString(weekEnd),
        });
        weekStart = addDaysLocal(weekStart, 7);
      }
      return;
    }

    enumerateDateKeys(routineStartDate, targetDate).forEach((dateKey) => {
      if (hasPausedDate(routine, dateKey)) {
        return;
      }
      buckets.push({
        routineId: routine.id,
        bucketKey: `${routine.id}:${dateKey}`,
        bucketType: "day",
        startDateKey: dateKey,
        endDateKey: dateKey,
      });
    });
  });

  return buckets;
}



export function calculateRoutineAccumulationRatio({
  routines,
  routineRecords,
  startDateKey,
  targetDateKey,
}: {
  routines: DreamRoutine[];
  routineRecords: DreamRoutineRecord[];
  startDateKey: string;
  targetDateKey: string;
}) {
  const buckets = buildRoutineScheduleBuckets(routines, startDateKey, targetDateKey);
  if (buckets.length === 0) {
    return 0;
  }
  let earnedScore = 0;
  buckets.forEach((bucket) => {
    const routine = routines.find((item) => item.id === bucket.routineId);
    if (!routine) {
      return;
    }
    earnedScore += bucket.bucketType === "week"
      ? getWeeklyRoutineCompletionRatio(routine, bucket.startDateKey, bucket.endDateKey, routineRecords)
      : getDailyRoutineCompletionRatio(routine, bucket.startDateKey, routineRecords);
  });

  return clampRatio(earnedScore / buckets.length);
}

export function calculateConsistencyScore(
  routines: DreamRoutine[],
  routineRecords: DreamRoutineRecord[],
  options: { todayRoutineGroups?: TodayConsistencyRoutineGroup[] } = {}
) {
  const todayKey = getLocalDateString(new Date());
  const today = parseDateOnly(todayKey) ?? new Date();
  const startDate = addDaysLocal(today, -6);
  const dateKeys = enumerateDateKeys(startDate, today);
  const days: ConsistencyDay[] = dateKeys.map((dateKey) => {
    const recordsForDate = routineRecords.filter(
      (record) => normalizeRoutineRecordDateKey(record.date) === dateKey
    );
    const todayRoutineGroups = dateKey === todayKey
      ? (options.todayRoutineGroups ?? [])
          .map((group) => ({
            primaryRoutineId: group.primaryRoutineId,
            routines: group.routines.filter(
              (routine) =>
                routine.repeatType !== "weekly" &&
                !hasPausedDate(routine, dateKey) &&
                (isRoutineActiveOnDate(routine, dateKey) ||
                  Boolean(findRoutineRecord(routineRecords, routine.id, dateKey)))
            ),
          }))
          .filter((group) => group.routines.length > 0)
      : undefined;
    const scheduledRoutines = todayRoutineGroups
      ? []
      : routines.filter(
          (routine) =>
            routine.repeatType !== "weekly" &&
            !hasPausedDate(routine, dateKey) &&
            (dateKey === todayKey
              ? isRoutineAvailableForTodayMe(routine) && isRoutineActiveOnDate(routine, dateKey)
              : isRoutineActiveOnDate(routine, dateKey) ||
                Boolean(findRoutineRecord(routineRecords, routine.id, dateKey)))
        );
    const consistencyRoutineGroups =
      todayRoutineGroups ?? buildConsistencyRoutineGroups(scheduledRoutines);
    const denominator = consistencyRoutineGroups.length;
    if (denominator === 0) {
      if (__DEV__) {
        console.log("[CONSISTENCY DAY]", {
          dateKey,
          scheduledRoutineIds: [],
          matchedRecordIds: recordsForDate.map((record) => record.id),
          completedRoutineIds: [],
          ratios: [],
          finalRatio: 0,
          status: "neutral",
        });
        if (dateKey === todayKey) {
          console.log("[TODAY ME VS CONSISTENCY]", {
            todayKey,
            visibleRoutineIds: routines
              .filter((routine) => isRoutineAvailableForTodayMe(routine))
              .map((routine) => routine.id),
            consistencyRoutineIds: [],
            completedRoutineIds: [],
            ratio: 0,
            status: "neutral",
          });
        }
      }
      return { dateKey, ratio: 0, status: "neutral" };
    }
    const routineRatios = consistencyRoutineGroups.map((group) =>
      getConsistencyRoutineGroupRatio(group, dateKey, routineRecords)
    );
    const ratio = routineRatios.reduce((sum, value) => sum + value, 0) / denominator;
    const status: ConsistencyDay["status"] = ratio >= 1 ? "complete" : ratio > 0 ? "partial" : "missed";
    if (__DEV__) {
      const completedRoutineIds = consistencyRoutineGroups
        .filter((_group, index) => routineRatios[index] >= 1)
        .map((group) => group.primaryRoutineId);
      console.log("[CONSISTENCY DAY]", {
        dateKey,
        scheduledRoutineIds: consistencyRoutineGroups.map((group) => group.primaryRoutineId),
        matchedRecordIds: recordsForDate.map((record) => record.id),
        completedRoutineIds,
        ratios: consistencyRoutineGroups.map((group, index) => ({
          routineId: group.primaryRoutineId,
          groupedRoutineIds: group.routines.map((routine) => routine.id),
          ratio: routineRatios[index],
        })),
        finalRatio: ratio,
        status,
      });
      if (dateKey === todayKey) {
        console.log("[TODAY ME VS CONSISTENCY]", {
          todayKey,
          visibleRoutineIds: routines
            .filter((routine) => isRoutineAvailableForTodayMe(routine))
            .map((routine) => routine.id),
          consistencyRoutineIds: consistencyRoutineGroups.map((group) => group.primaryRoutineId),
          completedRoutineIds,
          ratio,
          status,
        });
      }
    }
    return {
      dateKey,
      ratio,
      status,
    };
  });
  const scoredDays = days.filter((day) => day.status !== "neutral");
  const score =
    scoredDays.length > 0
      ? Math.round((scoredDays.reduce((sum, day) => sum + day.ratio, 0) / scoredDays.length) * 100)
      : 0;

  return { score: clampPercent(score), days };
}


function buildConsistencyRoutineGroups(routines: DreamRoutine[]): TodayConsistencyRoutineGroup[] {
  const groups: TodayConsistencyRoutineGroup[] = [];

  routines.forEach((routine) => {
    const semanticKey = getRoutineConsistencySemanticKey(routine.title);
    const existingGroup = semanticKey
      ? groups.find((group) =>
          group.routines.some(
            (groupRoutine) => getRoutineConsistencySemanticKey(groupRoutine.title) === semanticKey
          )
        )
      : undefined;

    if (existingGroup) {
      existingGroup.routines = [...existingGroup.routines, routine];
      return;
    }

    groups.push({
      primaryRoutineId: routine.id,
      routines: [routine],
    });
  });

  return groups;
}



function getConsistencyRoutineGroupRatio(
  group: TodayConsistencyRoutineGroup,
  dateKey: string,
  routineRecords: DreamRoutineRecord[]
) {
  const exactMatchedRoutines = group.routines.filter((routine) =>
    Boolean(findRoutineRecord(routineRecords, routine.id, dateKey))
  );
  const targetRoutines = exactMatchedRoutines.length > 0
    ? exactMatchedRoutines
    : group.routines;

  return Math.max(
    0,
    ...targetRoutines.map((routine) =>
      getDailyRoutineCompletionRatio(routine, dateKey, routineRecords)
    )
  );
}



function getRoutineConsistencySemanticKey(title: string) {
  let key = normalizeRoutineConsistencyText(title);
  let previous = "";

  while (key && key !== previous) {
    previous = key;
    key = stripRoutineConsistencySuffix(key);
  }

  return key;
}



function normalizeRoutineConsistencyText(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^(?:\uB9E4\uC77C|\uB9E4\uC8FC|\uC624\uB298|\uD558\uB8E8\uC5D0)+/g, "")
    .replace(/\d+(?:\.\d+)?(?:\uC2DC\uAC04|\uBD84|\uD68C|\uAC1C|\uD398\uC774\uC9C0|\uC138\uD2B8)/g, "")
    .replace(/\uBC18\uBCF5\uBAA9\uD45C/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/(?:\uC744|\uB97C|\uC774|\uAC00|\uC740|\uB294)$/g, "");
}



function stripRoutineConsistencySuffix(value: string) {
  const suffixes = [
    "\uD558\uAE30",
    "\uACF5\uBD80",
    "\uC791\uC5C5",
  ];

  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length > suffix.length) {
      return value.slice(0, -suffix.length);
    }
  }

  return value;
}



export function normalizeSingleSeason(seasons?: DreamSeason[]) {
  if (!Array.isArray(seasons) || seasons.length === 0) {
    return [];
  }

  const selectedSeason =
    seasons.find((season) => season.status === "active") ?? seasons[0];

  return [
    {
      ...selectedSeason,
      status: "active" as DreamSeasonStatus,
    },
  ];
}



export function getActiveDreamSeason(piece: DailyTraceItem) {
  if (piece.currentSeason) {
    return { ...piece.currentSeason, status: "active" as DreamSeasonStatus };
  }

  const seasons = normalizeSingleSeason(piece.seasons);
  return seasons.find((season) => season.id === piece.activeSeasonId) ?? seasons[0];
}



export function isRoutineAvailableForTodayMe(routine: DreamRoutine) {
  const typedRoutine = routine as DreamRoutine & {
    deletedAt?: string | null;
    hidden?: boolean;
    status?: string;
  };
  return (
    typedRoutine.deletedAt == null &&
    typedRoutine.hidden !== true &&
    typedRoutine.status !== "deleted" &&
    typedRoutine.status !== "hidden" &&
    routine.lifecycleStatus !== "completed" &&
    routine.lifecycleStatus !== "archived" &&
    routine.archivedFromTodayMe !== true
  );
}



export function getActiveDreamRoutines(piece: DailyTraceItem, activeSeason?: DreamSeason) {
  return (piece.routines ?? []).filter((routine) => {
    if (!isRoutineAvailableForTodayMe(routine)) {
      return false;
    }

    return !activeSeason || !routine.relatedSeasonId || routine.relatedSeasonId === activeSeason.id;
  });
}



export function getDreamRoutinesForConsistency(piece: DailyTraceItem, activeSeason?: DreamSeason) {
  const routineRecordIds = new Set((piece.routineRecords ?? []).map((record) => record.routineId));
  return (piece.routines ?? []).filter((routine) => {
    if (activeSeason && routine.relatedSeasonId && routine.relatedSeasonId !== activeSeason.id) {
      return false;
    }
    return isRoutineAvailableForTodayMe(routine) || routineRecordIds.has(routine.id);
  });
}



export function getProjectsRelatedToDream(piece: DailyTraceItem, projects: NoieProject[]) {
  return projects.filter((project) => {
    return (
      project.relatedDreamTorchId === piece.id ||
      project.sourceDreamFragmentId === piece.id ||
      project.sourceMemoryId === piece.id
    );
  });
}



export function calculateDreamProgress(
  piece: DailyTraceItem,
  _projects: NoieProject[],
  options: DreamProgressOptions = {}
): DreamProgressBreakdown {
  const activeSeason = getActiveDreamSeason(piece);
  const milestones = (piece.milestones ?? []).filter(
    (milestone) => !activeSeason || !milestone.relatedSeasonId || milestone.relatedSeasonId === activeSeason.id
  );
  const activeRoutines = getActiveDreamRoutines(piece, activeSeason);
  const consistencyRoutines = getDreamRoutinesForConsistency(piece, activeSeason);
  const selectedDuration = normalizeGoalDurationMonths(getSelectedGoalDuration(piece) ?? piece.goalDurationMonths);
  const goalStartDate = getDreamStartDateKey(piece);
  const goalTargetDate = getDreamTargetDateKey(piece, goalStartDate, selectedDuration);
  const routineAccumulationRatio = calculateRoutineAccumulationRatio({
    routines: activeRoutines,
    routineRecords: piece.routineRecords ?? [],
    startDateKey: goalStartDate,
    targetDateKey: goalTargetDate,
  });
  const milestoneProgressRatio = calculateMilestoneProgressRatio(milestones);
  const weights = resolveProgressWeights({
    hasRoutines: activeRoutines.length > 0,
    hasMilestones: milestones.length > 0,
  });
  const executionProgress = calculateOverallDreamProgress({
    routineAccumulationRatio,
    milestoneProgressRatio,
    hasRoutines: activeRoutines.length > 0,
    hasMilestones: milestones.length > 0,
  });
  const consistency = calculateConsistencyScore(consistencyRoutines, piece.routineRecords ?? [], {
    todayRoutineGroups: options.todayConsistencyRoutineGroups,
  });
  const cumulativeRoutineProgress = Math.round(clampRatio(routineAccumulationRatio) * 100);
  const milestoneProgress = Math.round(clampRatio(milestoneProgressRatio) * 100);
  const hasExecutionData =
    activeRoutines.length > 0 ||
    milestones.length > 0 ||
    (piece.routineRecords ?? []).length > 0;

  return {
    executionProgress,
    timeProgress: 0,
    baseProgress: executionProgress,
    paceBonus: 0,
    baseExecutionProgress: executionProgress,
    elapsedPeriodPercent: 0,
    periodAdjustment: 0,
    hasExecutionData,
    goalDurationMonths: selectedDuration,
    goalStartDate,
    goalTargetDate,
    milestoneProgress,
    cumulativeRoutineProgress,
    recent28DayPace: consistency.score,
    projectProgress: 0,
    evidenceProgress: 0,
    reliability: hasExecutionData ? "높음" : "낮음",
    reliabilityReason: hasExecutionData
      ? "반복 목표와 완료 단계 원본 데이터로 계산했어요."
      : "반복 목표와 완료 단계가 아직 없어요.",
    nextMilestone: selectNextDreamMilestone(milestones),
    activeSeason,
    milestoneWeightTotal: milestones.length,
    routineWeight: weights.routineWeight,
    milestoneWeight: weights.milestoneWeight,
    consistencyScore: consistency.score,
    consistencyDays: consistency.days,
  };
}



export function getEmptyDreamProgressBreakdown(): DreamProgressBreakdown {
  return {
    executionProgress: 0,
    timeProgress: 0,
    baseProgress: 0,
    paceBonus: 0,
    baseExecutionProgress: 0,
    elapsedPeriodPercent: 0,
    periodAdjustment: 0,
    hasExecutionData: false,
    goalDurationMonths: null,
    goalStartDate: "",
    goalTargetDate: "",
    milestoneProgress: 0,
    cumulativeRoutineProgress: 0,
    recent28DayPace: 0,
    projectProgress: 0,
    evidenceProgress: 0,
    reliability: "낮음",
    reliabilityReason: "목표 계획이 아직 설정되지 않았어요.",
    milestoneWeightTotal: 0,
    routineWeight: 0,
    milestoneWeight: 0,
    consistencyScore: 0,
    consistencyDays: buildNeutralConsistencyDays(),
  };
}



export function getDreamProjectSummary(
  projects: NoieProject[],
  torchPiece?: DailyTraceItem,
  allProjects: NoieProject[] = projects,
  options: DreamProgressOptions = {}
): DreamProjectSummary {
  const progress = torchPiece
    ? calculateDreamProgress(torchPiece, getProjectsRelatedToDream(torchPiece, allProjects), options)
    : getEmptyDreamProgressBreakdown();

  return {
    ...progress,
    progressPercent: progress.executionProgress,
    linkedProjectCount: projects.length,
    doneProjectCount: projects.filter((project) => project.status === "done").length,
  };
}



export function getDreamDdayLabel(piece: DailyTraceItem) {
  const selectedDuration = normalizeGoalDurationMonths(getSelectedGoalDuration(piece) ?? piece.goalDurationMonths);
  const startDateKey = getDreamStartDateKey(piece);
  const targetDateKey = getDreamTargetDateKey(piece, startDateKey, selectedDuration);
  const targetDate = parseDateOnly(targetDateKey);
  const today = parseDateOnly(getLocalDateString(new Date()));

  if (!targetDate || !today) {
    return "";
  }

  const diffDays = Math.ceil((targetDate.getTime() - today.getTime()) / 86400000);
  if (diffDays > 0) {
    return `D-${diffDays}`;
  }
  if (diffDays === 0) {
    return "D-DAY";
  }
  return "기간 종료";
}



export function normalizeGoalDurationMonths(value: unknown): GoalDurationMonths {
  if (value === 3 || value === "3" || value === "3months" || value === "3개월") {
    return 3;
  }
  if (value === 12 || value === "12" || value === "12months" || value === "12개월") {
    return 12;
  }
  return 6;
}



export function getDreamStartDateKey(piece: DailyTraceItem) {
  const typedPiece = piece as DailyTraceItem & {
    journeyStartedAt?: string;
    dreamStartedAt?: string;
  };
  const candidates = [
    typedPiece.journeyStartedAt,
    typedPiece.dreamStartedAt,
    piece.goalStartDate,
    piece.createdAt,
    piece.date,
  ];
  const selected = candidates.find((value) => Boolean(parseDateOnly(value)));
  return selected ? getLocalDateString(parseDateOnly(selected) ?? new Date()) : getLocalDateString(new Date());
}



export function getDreamTargetDateKey(
  piece: DailyTraceItem,
  startDateKey: string,
  durationMonths: GoalDurationMonths
) {
  if (isValidDateKey(piece.goalTargetDate)) {
    return String(piece.goalTargetDate);
  }
  const startDate = parseDateOnly(startDateKey) ?? new Date();
  return getLocalDateString(addMonthsSafe(startDate, durationMonths));
}



export function calculateMilestoneProgressRatio(milestones: DreamMilestone[]) {
  if (milestones.length === 0) {
    return 0;
  }
  const completedCount = milestones.filter(
    (milestone) => milestone.status === "done" || Boolean(milestone.completedAt)
  ).length;
  return clampRatio(completedCount / milestones.length);
}



export function resolveProgressWeights({
  hasRoutines,
  hasMilestones,
}: {
  hasRoutines: boolean;
  hasMilestones: boolean;
}): ProgressWeights {
  if (hasRoutines && hasMilestones) {
    return { routineWeight: 70, milestoneWeight: 30 };
  }
  if (hasRoutines) {
    return { routineWeight: 100, milestoneWeight: 0 };
  }
  if (hasMilestones) {
    return { routineWeight: 0, milestoneWeight: 100 };
  }
  return { routineWeight: 0, milestoneWeight: 0 };
}



export function calculateOverallDreamProgress({
  routineAccumulationRatio,
  milestoneProgressRatio,
  hasRoutines,
  hasMilestones,
}: {
  routineAccumulationRatio: number;
  milestoneProgressRatio: number;
  hasRoutines: boolean;
  hasMilestones: boolean;
}) {
  const weights = resolveProgressWeights({ hasRoutines, hasMilestones });
  const routineContribution = clampRatio(routineAccumulationRatio) * weights.routineWeight;
  const milestoneContribution = clampRatio(milestoneProgressRatio) * weights.milestoneWeight;

  return roundProgressPercent(routineContribution + milestoneContribution);
}



export function selectNextDreamMilestone(milestones: DreamMilestone[]) {
  const priorityScore: Record<DreamMilestonePriority, number> = { high: 0, medium: 1, low: 2 };
  return [...milestones]
    .filter((milestone) => milestone.status !== "done")
    .sort((left, right) => {
      const priorityDiff = priorityScore[left.priority] - priorityScore[right.priority];
      return priorityDiff !== 0 ? priorityDiff : left.createdAt.localeCompare(right.createdAt);
    })[0];
}



export function buildNeutralConsistencyDays() {
  const today = parseDateOnly(getLocalDateString(new Date())) ?? new Date();
  return enumerateDateKeys(addDaysLocal(today, -6), today).map((dateKey) => ({
    dateKey,
    ratio: 0,
    status: "neutral" as const,
  }));
}



export function getConsistencyStatusSymbol(status: ConsistencyDay["status"]) {
  if (status === "complete") {
    return "🔥";
  }
  if (status === "partial") {
    return "◐";
  }
  if (status === "missed") {
    return "○";
  }
  return "·";
}



export function getConsistencyWeekdayLabel(dateKey: string) {
  const date = parseDateOnly(dateKey);
  if (!date) {
    return "";
  }
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
}



export function isRoutineActiveOnDate(routine: DreamRoutine, dateKey: string) {
  const createdDateKey = getLocalDateString(parseDateOnly(routine.createdAt) ?? new Date());
  return dateKey >= createdDateKey;
}



export function findRoutineRecord(
  records: DreamRoutineRecord[],
  routineId: string,
  dateKey: string
) {
  const normalizedDateKey = normalizeRoutineRecordDateKey(dateKey);
  return records.find(
    (record) =>
      record.routineId === routineId &&
      normalizeRoutineRecordDateKey(record.date) === normalizedDateKey
  );
}



export function normalizeRoutineRecordDateKey(value?: string | null) {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const dateOnlyMatch = trimmed.match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const parsed = parseDateOnly(
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    );
    return parsed ? getLocalDateString(parsed) : "";
  }
  const parsed = parseDateOnly(trimmed);
  if (parsed) {
    return getLocalDateString(parsed);
  }
  const fallbackDate = new Date(trimmed);
  return Number.isNaN(fallbackDate.getTime()) ? "" : getLocalDateString(fallbackDate);
}



export function getRoutineRecordActualValue(record?: DreamRoutineRecord) {
  if (!record) {
    return 0;
  }
  const recordWithActual = record as DreamRoutineRecord & {
    actualValue?: number;
    amount?: number;
    completed?: boolean;
  };
  const actualValue =
    safeNumber(recordWithActual.actualValue) ||
    safeNumber(recordWithActual.amount) ||
    safeNumber(record.value);
  if (actualValue > 0) {
    return actualValue;
  }
  if (recordWithActual.completed) {
    return 1;
  }
  return clampRatio(record.score);
}



export function getRoutineRecordMeasuredValue(record?: DreamRoutineRecord) {
  if (!record) {
    return 0;
  }
  const recordWithActual = record as DreamRoutineRecord & {
    actualValue?: number;
    amount?: number;
  };
  return (
    safeNumber(recordWithActual.actualValue) ||
    safeNumber(recordWithActual.amount) ||
    safeNumber(record.value)
  );
}



export function isRoutineRecordExplicitlyCompleted(record?: DreamRoutineRecord) {
  if (!record) {
    return false;
  }
  const recordWithCompletion = record as DreamRoutineRecord & {
    completed?: boolean;
    completedAt?: string;
    completionType?: string;
  };
  return (
    recordWithCompletion.completed === true ||
    recordWithCompletion.completionType === "full" ||
    Boolean(recordWithCompletion.completedAt) ||
    safeNumber(record.score) >= 1
  );
}



export function isRoutineRecordFullyCompleted(
  record?: DreamRoutineRecord,
  routine?: DreamRoutine,
  dateKey?: string
) {
  if (!record) {
    return false;
  }
  if (isRoutineRecordExplicitlyCompleted(record)) {
    return true;
  }
  if (!routine || !dateKey) {
    return false;
  }
  const targetValue = getEffectiveRoutineTargetValue(routine, dateKey);
  if (targetValue <= 0) {
    return safeNumber(record.score) >= 1;
  }
  return getRoutineRecordMeasuredValue(record) >= targetValue;
}



export function isRoutineActionDoneToday(record?: DreamRoutineRecord) {
  return isRoutineRecordFullyCompleted(record);
}



export function safeNumber(value: unknown) {
  const numberValue = typeof value === "number" || typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numberValue) ? numberValue : 0;
}



export function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}



export function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}



export function roundProgressPercent(value: number) {
  return Math.round(clampPercent(value) * 10) / 10;
}



function addDaysLocal(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}



function addMonthsSafe(sourceDate: Date, months: number): Date {
  const result = new Date(sourceDate);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const finalDayOfMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, finalDayOfMonth));
  return result;
}



function maxDateLocal(left: Date, right: Date | null) {
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}



function minDateLocal(left: Date, right: Date | null) {
  if (!right) {
    return left;
  }
  return left < right ? left : right;
}



function hasPausedDate(routine: DreamRoutine, dateKey: string) {
  return Boolean(
    routine.pausedDates?.some(
      (pausedDateKey) => normalizeRoutineRecordDateKey(pausedDateKey) === dateKey
    )
  );
}



export function getEffectiveRoutineTargetValue(routine: DreamRoutine, dateKey: string) {
  const dailyTarget = routine.dailySettings?.[dateKey]?.targetValue;
  if (typeof dailyTarget === "number" && Number.isFinite(dailyTarget)) {
    return dailyTarget;
  }
  return safeNumber(routine.targetValue);
}



export function getEffectiveRoutineMinimumValue(routine: DreamRoutine, dateKey: string) {
  const dailyMinimum = routine.dailySettings?.[dateKey]?.minimumValue;
  if (typeof dailyMinimum === "number" && Number.isFinite(dailyMinimum)) {
    return dailyMinimum;
  }
  return safeNumber(routine.minimumValue);
}

