import { MAX_TODAY_ME_CARDS } from "../../noie/constants";
import { normalizeRoutineTitleKey } from "../routines/routineRoutingLogic";
import type { DailyTraceItem, DreamRoutine, NoieProject } from "../../noie/types";
import { getTodayMeProjects, isActiveTodayMeProject } from "../../noie/selectors";
import { getLocalDateString } from "../../noie/dateUtils";
import type { TodayMeCard, TodayMeRecommendation } from "./TodayMeSection";
import {
  getActiveDreamRoutines,
  getActiveDreamSeason,
  isRoutineAvailableForTodayMe,
  normalizeRoutineRecordDateKey,
} from "./dreamProgress";

export type TodayMeRecommendationHelpers = {
  normalizeMemoryInput: (input: string) => string;
  getCompletedProjectForFragment: (piece: DailyTraceItem, projects: NoieProject[]) => NoieProject | undefined;
  getMemoryInputText: (input: { title?: string; memo?: string; sourceText?: string }) => string;
  makeMemoryTitle: (text: string) => string;
};

export function buildTodayMeCards(
  routines: DreamRoutine[],
  projects: NoieProject[],
  torchPiece: DailyTraceItem | undefined,
  todayKey: string
): TodayMeCard[] {
  const routineCards: TodayMeCard[] = routines
    .filter((routine) => isActiveTodayMeRoutine(routine))
    .map((routine) => ({ cardType: "routine" as const, id: `routine-${routine.id}`, routine }));
  const projectCards: TodayMeCard[] = projects
    .filter((project) => isActiveTodayMeProject(project) && Boolean(project.nextAction?.trim()))
    .map((project) => ({ cardType: "project" as const, id: `project-${project.id}`, project }));

  return [...routineCards, ...projectCards].sort((left, right) => {
    const leftOrder = getTodayMeCardOrder(left, torchPiece, todayKey);
    const rightOrder = getTodayMeCardOrder(right, torchPiece, todayKey);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return getTodayMeCardUpdatedAt(right).localeCompare(getTodayMeCardUpdatedAt(left));
  });
}

export function getVisibleTodayMeCards(
  torchPiece: DailyTraceItem | undefined,
  dreamFragments: DailyTraceItem[],
  projects: NoieProject[],
  todayKey: string
) {
  const activeSeason = torchPiece ? getActiveDreamSeason(torchPiece) : undefined;
  const routines = torchPiece ? getActiveDreamRoutines(torchPiece, activeSeason) : [];
  const todayMeProjects = getTodayMeProjects(torchPiece, dreamFragments, projects);
  return selectVisibleTodayMeCards(
    buildTodayMeCards(routines, todayMeProjects, torchPiece, todayKey)
  );
}

export function isActiveTodayMeRoutine(routine: DreamRoutine) {
  return routine.active !== false && isRoutineAvailableForTodayMe(routine);
}

function selectVisibleTodayMeCards(cards: TodayMeCard[]) {
  const selected: TodayMeCard[] = [];

  for (const card of cards) {
    const hasSemanticDuplicate = card.cardType === "routine" && selected.some(
      (selectedCard) => selectedCard.cardType === "routine" && areRoutineTitlesSemanticallyDuplicate(
        selectedCard.routine.title,
        card.routine.title
      )
    );

    if (hasSemanticDuplicate) {
      continue;
    }

    selected.push(card);
    if (selected.length >= MAX_TODAY_ME_CARDS) {
      break;
    }
  }

  return selected;
}

export function areRoutineTitlesSemanticallyDuplicate(leftTitle: string, rightTitle: string) {
  const leftKey = normalizeRoutineTitleKey(leftTitle);
  const rightKey = normalizeRoutineTitleKey(rightTitle);

  if (!leftKey || !rightKey) {
    return false;
  }
  if (leftKey === rightKey) {
    return true;
  }

  const leftCore = getRoutineSemanticCore(leftTitle);
  const rightCore = getRoutineSemanticCore(rightTitle);
  return Boolean(leftCore && rightCore && leftCore === rightCore);
}

function getRoutineSemanticCore(title: string) {
  let core = normalizeRoutineTitleKey(title);
  let previous = "";

  while (core && core !== previous) {
    previous = core;
    core = stripRoutineGenericActionSuffix(core);
  }

  return core;
}

function stripRoutineGenericActionSuffix(value: string) {
  const genericActionTerms = [
    "\uD558\uAE30",
    "\uACF5\uBD80",
    "\uC791\uC5C5",
  ];

  for (const term of genericActionTerms) {
    if (value.endsWith(term) && value.length > term.length) {
      return value.slice(0, -term.length);
    }
  }

  return value;
}

function getTodayMeCardOrder(card: TodayMeCard, torchPiece: DailyTraceItem | undefined, todayKey: string) {
  const pinnedOrder = card.cardType === "routine" ? card.routine.todayMeOrder : card.project.todayMeOrder;
  if (typeof pinnedOrder === "number") {
    return pinnedOrder;
  }
  if (card.cardType === "routine") {
    return getTodayRoutineRecord(torchPiece, card.routine) ? 30 : 10;
  }
  return card.project.nextAction?.trim() ? 20 : 40;
}

function getTodayMeCardUpdatedAt(card: TodayMeCard) {
  return card.cardType === "routine" ? getRoutineUpdatedAt(card.routine) : card.project.updatedAt;
}

function getRoutineUpdatedAt(routine: DreamRoutine) {
  return routine.updatedAt ?? routine.createdAt;
}

export function selectTodayMeRecommendation(
  torchPiece: DailyTraceItem | undefined,
  dreamFragments: DailyTraceItem[],
  projects: NoieProject[],
  activeCards: TodayMeCard[],
  dismissedKeys: string[],
  helpers: TodayMeRecommendationHelpers
): TodayMeRecommendation | undefined {
  const { normalizeMemoryInput, getCompletedProjectForFragment, getMemoryInputText, makeMemoryTitle } = helpers;
  const activeKeys = new Set(
    activeCards.map((card) => normalizeMemoryInput(card.cardType === "routine" ? card.routine.title : card.project.title))
  );
  const activeRoutineKeys = new Set(
    (torchPiece?.routines ?? [])
      .filter(isActiveTodayMeRoutine)
      .map((routine) => normalizeMemoryInput(routine.title))
  );

  for (const fragment of dreamFragments) {
    if (getCompletedProjectForFragment(fragment, projects)) {
      continue;
    }
    const text = getMemoryInputText(fragment) || fragment.title;
    const recommendationTitle = makeRoutineRecommendationTitle(text, makeMemoryTitle);
    if (!recommendationTitle) {
      continue;
    }
    const recommendationKey = normalizeMemoryInput(recommendationTitle);
    const sourceKey = normalizeMemoryInput(text);
    if (
      !recommendationKey ||
      activeKeys.has(recommendationKey) ||
      activeRoutineKeys.has(recommendationKey) ||
      dismissedKeys.includes(recommendationKey) ||
      dismissedKeys.includes(sourceKey)
    ) {
      continue;
    }

    return {
      type: "routine",
      title: recommendationTitle,
      reason: sourceKey === recommendationKey
        ? "반복해서 이어갈 수 있는 행동이에요."
        : `‘${makeMemoryTitle(text)}’를 위한 반복 행동이에요.`,
      sourceDreamFragmentId: fragment.id,
      semanticKey: recommendationKey,
    };
  }

  return undefined;
}

function makeRoutineRecommendationTitle(text: string, makeMemoryTitle: (text: string) => string) {
  const title = makeMemoryTitle(text);
  if (isRepeatableActionTitle(title)) {
    return title;
  }

  if (!isResultGoalTitle(title) && !hasRoutineRepeatSignal(text)) {
    return undefined;
  }

  return convertResultGoalToRoutineTitle(title);
}

function isResultGoalTitle(title: string) {
  return /(따기|합격하기|완성하기|만들기|열기|출시하기|취업하기|달성하기)$/.test(title);
}

function isRepeatableActionTitle(title: string) {
  return /(공부하기|연습하기|운동하기|읽기|쓰기|복습하기|정리하기|훈련하기|작업하기)$/.test(title);
}

function hasRoutineRepeatSignal(text: string) {
  return /매일|매주|주\s*\d+\s*회|\d+(?:\.\d+)?\s*(분|시간|회|개|페이지|세트|장)\s*씩|꾸준히|반복해서/.test(text);
}

function convertResultGoalToRoutineTitle(title: string) {
  if (/자격증.*(따기|취득하기)$/.test(title)) {
    return title.replace(/(따기|취득하기)$/g, "공부하기");
  }
  if (/시험.*합격하기$/.test(title)) {
    return title.replace(/합격하기$/g, "공부하기");
  }
  if (/헤어.*기술.*익히기$/.test(title)) {
    return title.replace(/익히기$/g, "연습하기");
  }
  if (/포트폴리오.*완성하기$/.test(title)) {
    return title.replace(/완성하기$/g, "작업하기");
  }
  return undefined;
}
export function getTodayRoutineRecord(piece: DailyTraceItem | undefined, routine: DreamRoutine) {
  const todayKey = getLocalDateString(new Date());
  return (piece?.routineRecords ?? [])
    .filter((record) => record.routineId === routine.id && normalizeRoutineRecordDateKey(record.date) === todayKey)
    .sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt))[0];
}

export function getTodayMeFeedback(
  routineCount: number,
  completedRoutineCount: number,
  partialRoutineCount: number,
  projectCount: number,
  completedProjectActionCount: number
) {
  if (routineCount === 0 && projectCount === 0) {
    return "오늘은 아직 불씨가 남아 있어요.";
  }
  if (routineCount > 0 && completedRoutineCount === routineCount) {
    return "오늘의 나를 모두 채웠어요. 꿈에 불을 보탰어요.";
  }
  if (completedRoutineCount > 0 || partialRoutineCount > 0) {
    return "오늘 기록도 꿈으로 가는 과정이에요.";
  }
  if (completedProjectActionCount > 0) {
    return "오늘의 한 걸음이 프로젝트에 옮겨졌어요.";
  }
  return "오늘은 아직 불씨가 남아 있어요.";
}
