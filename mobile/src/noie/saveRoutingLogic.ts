import type { DailyTraceItem, MemorySavePolicy, NoieProject, SaveDecision } from "./types";
import {
  getMemoryInputText,
  getMemoryPolicy,
  getMemorySemanticKey,
  normalizeMemoryInput,
  type NoieSaveRoutingResult,
} from "./memoryLogic";
import type { DailyLongRecord } from "../features/traces/traceFeature";
import { findDailyRecordCommandRoute } from "../features/traces/dailyTraceRoutingLogic";
import { normalizeDreamFragmentKey } from "../features/traces/dailyPieceLogic";
import {
  findLifeScheduleMutationRoute,
  findLifeScheduleRoute,
} from "../features/traces/lifeScheduleRoutingLogic";
import { makeSmartTitle } from "./titleLogic";
import {
  findExplicitRoutineDurationAdjustmentRoute,
  findRoutineAdjustmentIntent,
  findRoutineDurationCreationRoute,
  findRoutineRecordRoute,
  findRoutineRemoveRoute,
  isAdditiveRoutineRecordText,
  isExplicitAdditiveRoutineRecordRequest,
  isNonCompletionRoutineText,
  parseRoutineGoalCandidate,
  parseTargetValueWithUnit,
  selectPreferredRoutineCandidate,
  type PendingRoutineAdjustment,
} from "../features/routines/routineRoutingLogic";
import {
  findCompletedProjectActionRoute,
  findCompletedProjectRoute,
  findDuplicateProjectByText,
  isProjectStartText,
  makeProjectTitle,
} from "../features/projects/projectRoutingLogic";
import {
  findDreamFragmentCompleteRoute,
  findDreamFragmentNextActionUpdateRoute,
  findDreamFragmentRenameRoute,
  findReferencedDreamForTorchRequest,
  getDreamFragments,
  isDailyIdeaText,
  isDreamFragmentText,
  isDreamOrGoalType,
  isDreamTorchCandidateText,
} from "../features/dreams/dreamRoutingLogic";
import { getDreamTorchCandidates, selectDreamTorchPiece } from "../features/dreams/dreamDisplayLogic";
import { isActiveTodayMeRoutine } from "../features/dreams/todayMeLogic";

export function resolvePrimarySaveRoute({
  userText,
  saveDecision,
  memoryPolicy,
  existingItems,
  dailyLongRecords,
  projects,
  pendingRoutineAdjustment,
  recentDreamReference,
  selectedDreamTorchId,
}: {
  userText: string;
  saveDecision?: SaveDecision;
  memoryPolicy: MemorySavePolicy;
  existingItems: DailyTraceItem[];
  dailyLongRecords: DailyLongRecord[];
  projects: NoieProject[];
  pendingRoutineAdjustment: PendingRoutineAdjustment | null;
  recentDreamReference?: DailyTraceItem | null;
  selectedDreamTorchId: string | null;
}): NoieSaveRoutingResult {
  const normalizedText = normalizeMemoryInput(userText);
  const routineCandidate = parseRoutineGoalCandidate(userText);
  const adjustmentValue = parseTargetValueWithUnit(userText);

  if (isOtherPersonOnlyText(userText, saveDecision)) {
    return {
      route: "none",
      title: "",
      originalText: userText,
      normalizedText,
      confidence: 0.98,
      isOtherPerson: true,
      reason: "다른 사람 이야기라 사용자 저장 제안을 만들지 않음",
    };
  }

  const explicitRoutineAdjustment = findExplicitRoutineDurationAdjustmentRoute(userText, existingItems);
  if (explicitRoutineAdjustment) {
    return explicitRoutineAdjustment;
  }

  const routineRemove = findRoutineRemoveRoute(userText, existingItems, {
    preferredRoutineIds: getPreferredTodayMeRoutineIds(existingItems, selectedDreamTorchId),
  });
  if (routineRemove) {
    return routineRemove;
  }

  const explicitRoutineCreation = findRoutineDurationCreationRoute(userText, existingItems);
  if (explicitRoutineCreation) {
    return explicitRoutineCreation;
  }

  const dailyRecordCommand = findDailyRecordCommandRoute(userText, existingItems, dailyLongRecords);
  if (dailyRecordCommand) {
    return dailyRecordCommand;
  }

  const dreamFragmentNextActionUpdate = findDreamFragmentNextActionUpdateRoute(userText, existingItems);
  if (dreamFragmentNextActionUpdate) {
    return dreamFragmentNextActionUpdate;
  }

  const dreamFragmentRename = findDreamFragmentRenameRoute(userText, existingItems);
  if (dreamFragmentRename) {
    return dreamFragmentRename;
  }

  const routineAdjustment = findRoutineAdjustmentIntent(userText, existingItems);
  if (routineAdjustment) {
    return {
      route: adjustmentValue ? "routine_adjustment_confirm" : "routine_adjustment_intent",
      title: routineAdjustment.routineTitle,
      originalText: userText,
      normalizedText,
      confidence: adjustmentValue ? 0.96 : 0.9,
      targetValue: adjustmentValue?.targetValue ?? routineAdjustment.currentTargetValue,
      unit: adjustmentValue?.unit ?? routineAdjustment.currentUnit,
      matchedRoutineId: routineAdjustment.routineId,
      reason: adjustmentValue ? "기존 반복 목표 시간 조정 확인" : "기존 공부 반복 목표 시간 조정 의도",
    };
  }

  if (isNonCompletionRoutineText(userText)) {
    return {
      route: "none",
      title: "",
      originalText: userText,
      normalizedText,
      confidence: 0.96,
      reason: "부정 또는 미수행 표현이라 수행량 저장 제안을 만들지 않음",
    };
  }

  if (isAdditiveRoutineRecordText(userText) && !isExplicitAdditiveRoutineRecordRequest(userText)) {
    return {
      route: "none",
      title: "",
      originalText: userText,
      normalizedText,
      confidence: 0.94,
      reason: "추가 수행 언급만 있고 명시적 기록 요청이 없어 저장 제안을 만들지 않음",
    };
  }

  const dreamFragmentComplete = findDreamFragmentCompleteRoute(userText, existingItems);
  if (dreamFragmentComplete) {
    return dreamFragmentComplete;
  }

  const explicitTorchReference = findReferencedDreamForTorchRequest(userText, recentDreamReference, existingItems);
  if (explicitTorchReference) {
    return {
      route: "dream_torch",
      title: explicitTorchReference.title,
      originalText: userText,
      normalizedText: normalizeMemoryInput(explicitTorchReference.title),
      confidence: 0.96,
      matchedDailyTraceId: explicitTorchReference.id,
      reason: "최근 또는 기존 꿈 후보를 꿈의 횃불로 승격",
    };
  }

  const lifeScheduleMutation = findLifeScheduleMutationRoute(userText, existingItems);
  if (lifeScheduleMutation) {
    return lifeScheduleMutation;
  }

  const lifeScheduleRoute = findLifeScheduleRoute(userText);
  if (lifeScheduleRoute) {
    return lifeScheduleRoute;
  }

  if (pendingRoutineAdjustment) {
    return {
      route: adjustmentValue ? "routine_adjustment_confirm" : "routine_adjustment_intent",
      title: pendingRoutineAdjustment.routineTitle,
      originalText: userText,
      normalizedText,
      confidence: adjustmentValue ? 0.95 : 0.7,
      targetValue: adjustmentValue?.targetValue ?? null,
      unit: adjustmentValue?.unit ?? pendingRoutineAdjustment.currentUnit,
      matchedRoutineId: pendingRoutineAdjustment.routineId,
      reason: "반복 목표 조정 대화 진행 중",
    };
  }

  const routineRecord = findRoutineRecordRoute(userText, existingItems, {
    preferredRoutineIds: getPreferredTodayMeRoutineIds(existingItems, selectedDreamTorchId),
  });
  if (routineRecord) {
    return routineRecord;
  }

  if (routineCandidate) {
    return {
      route: "routine_create",
      title: routineCandidate.title,
      originalText: userText,
      normalizedText: routineCandidate.title,
      confidence: 0.96,
      repeatType: routineCandidate.repeatType,
      targetValue: routineCandidate.targetValue,
      minimumValue: 0,
      unit: routineCandidate.unit,
      reason: "반복 표현과 수치가 있는 행동 목표",
    };
  }

  const completedProject = findCompletedProjectRoute(userText, projects);
  if (completedProject) {
    return completedProject;
  }

  const completedProjectAction = findCompletedProjectActionRoute(userText, projects, {
    isCompletedActionText,
    makeCompletedActionTitle,
  });
  if (completedProjectAction) {
    return completedProjectAction;
  }

  if (isCompletedActionText(userText)) {
    return {
      route: "completed_action",
      title: makeCompletedActionTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.86,
      reason: "완료한 행동",
    };
  }

  if (isPlainDailyTraceText(userText)) {
    return {
      route: "daily_trace",
      title: makeSmartTitle(userText, "daily_trace"),
      originalText: userText,
      normalizedText,
      confidence: 0.84,
      reason: "이미 일어난 하루의 행동 또는 사건",
    };
  }

  if (isProjectStartText(userText)) {
    const duplicateProject = findDuplicateProjectByText(userText, projects);
    return {
      route: "project_create",
      title: makeProjectTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: duplicateProject ? 0.98 : 0.86,
      matchedProjectId: duplicateProject?.id ?? null,
      reason: duplicateProject ? "이미 진행 중인 프로젝트" : "프로젝트 시작 의도",
    };
  }

  if (isImportantDayEventText(userText)) {
    return {
      route: "important_day_event",
      title: makeImportantDayEventTitle(userText),
      originalText: userText,
      normalizedText,
      confidence: 0.92,
      reason: "생활 단계 변화",
    };
  }

  if (memoryPolicy.type === "achievement") {
    return {
      route: "achievement",
      title: makeSmartTitle(userText, "completed_action"),
      originalText: userText,
      normalizedText,
      confidence: 0.84,
    };
  }

  if (isDailyIdeaText(userText)) {
    return {
      route: "daily_idea",
      title: makeSmartTitle(userText, "daily_piece"),
      originalText: userText,
      normalizedText,
      confidence: 0.82,
      reason: "오늘 떠오른 단발성 아이디어",
    };
  }

  if (isDreamTorchCandidateText(userText, memoryPolicy) || isDreamFragmentText(userText)) {
    const referencedDream = findReferencedDreamForTorchRequest(userText, recentDreamReference, existingItems);
    return {
      route: "dream_torch",
      title: referencedDream?.title ?? makeSmartTitle(userText, "dream"),
      originalText: userText,
      normalizedText: referencedDream ? normalizeMemoryInput(referencedDream.title) : normalizedText,
      confidence: 0.9,
      matchedDailyTraceId: referencedDream?.id ?? null,
      reason: referencedDream ? "최근 꿈 후보를 꿈의 횃불로 승격" : "새로운 꿈 후보 선택",
    };
  }

  if (isDreamOrGoalType(memoryPolicy.type)) {
    const duplicateFragment = findDuplicateDreamFragment(existingItems, userText);
    return {
      route: "dream_torch",
      title: makeSmartTitle(userText, "dream"),
      originalText: userText,
      normalizedText,
      confidence: duplicateFragment ? 0.99 : 0.88,
      reason: duplicateFragment ? "이미 저장된 꿈 후보" : "새로운 꿈 또는 중간 목표 후보 선택",
    };
  }

  if (memoryPolicy.type === "sensitive_event") {
    return {
      route: "sensitive_event",
      title: makeSmartTitle(userText, "daily_trace"),
      originalText: userText,
      normalizedText,
      confidence: 0.86,
      isSensitive: true,
    };
  }

  return {
    route: memoryPolicy.shouldSave ? "none" : "none",
    title: "",
    originalText: userText,
    normalizedText,
    confidence: 0,
  };
}

function isSelfDreamDirectionText(text: string) {
  return (
    /되고\s*싶|되는\s*게\s*(?:내\s*)?꿈|되는게\s*(?:내\s*)?꿈|내\s*꿈|내꿈|장래희망/.test(text) &&
    !/싶대|싶다고|싶다더|싶어\s*한|싶어한|꿈이래|꿈이라고/.test(text)
  );
}

export function isOtherPersonOnlyText(text: string, decision?: SaveDecision) {
  if (isSelfDreamDirectionText(text)) {
    return false;
  }
  if (decision?.subjectScope === "other_person" && decision.selfRelevance === "none") {
    return true;
  }
  return /^(지민|친구|동생|형|누나|언니|엄마|아빠|선배|후배|동기|그|그녀|걔|쟤|[가-힣]{2,4})(은|는|이|가)\s/.test(text.trim()) &&
    !/나한테|나에게|내가|나는|난|우리|같이|도와줘야|도와줄/.test(text);
}

export function isPlainDailyTraceText(text: string) {
  const normalizedText = text.trim();
  if (/되고\s*싶|만들고\s*싶|완성하고\s*싶|할래|시작할래|목표|꿈/.test(normalizedText)) {
    return false;
  }
  return /오늘|어제|방금|아까/.test(normalizedText) && /했어|했다|다녀왔|받았|만났|생겼|떠올랐|겪었|봤어|들었어|공부했|운동했/.test(normalizedText);
}

export function isImportantDayEventText(text: string) {
  return /방학.*시작|개학.*시작|졸업|입학|이사(를)?\s*했|첫\s*출근|복학|새로운\s*학기\s*시작|여행\s*출발/.test(text);
}

export function makeImportantDayEventTitle(text: string) {
  if (/방학/.test(text) && /시작/.test(text)) {
    return "방학 시작";
  }
  return makeSmartTitle(text, "daily_piece");
}

export function isCompletedActionText(text: string) {
  return (
    /끝냈어|완료했어|완성했어|다\s*했어|마쳤어|성공적으로\s*끝냈|통과했어|해냈어/.test(text) &&
    !/프로젝트/.test(text)
  );
}

export function makeCompletedActionTitle(text: string) {
  const title = text
    .replace(/오늘|끝냈어|완료했어|완성했어|다\s*했어|마쳤어|성공적으로\s*끝냈어|통과했어|해냈어/g, "")
    .trim();
  return makeSmartTitle(title || text, "completed_action");
}

export function findDuplicateDreamFragment(items: DailyTraceItem[], text: string) {
  const targetKey = normalizeDreamFragmentKey(text);
  const targetMemoryKey = normalizeMemoryInput(text);
  return getDreamFragments(items).find((item) => {
    const candidates = [
      item.originalText,
      item.text,
      item.sourceText,
      item.memo,
      item.title,
      getMemorySemanticKey(item),
    ].filter((value): value is string => Boolean(value));
    return candidates.some((candidate) => {
      const candidateKey = normalizeDreamFragmentKey(candidate);
      return candidateKey === targetKey || normalizeMemoryInput(candidate) === targetMemoryKey;
    });
  });
}

export function isDuplicateDreamFragmentRoute(routingResult: NoieSaveRoutingResult, items: DailyTraceItem[]) {
  return Boolean(findDuplicateDreamFragment(items, routingResult.originalText));
}

export function isDuplicateRoutineRoute(
  routingResult: NoieSaveRoutingResult,
  items: DailyTraceItem[],
  selectedDreamTorchId: string | null
) {
  if (routingResult.route !== "routine_create") {
    return false;
  }
  const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(items), selectedDreamTorchId);
  if (!torchPiece) {
    return false;
  }
  return Boolean(selectPreferredRoutineCandidate({
    routines: torchPiece.routines ?? [],
    requestedTitle: routingResult.title,
    isActiveRoutine: isActiveTodayMeRoutine,
  }));
}

export function resolveTodayMeRoutineRecordTarget(
  routingResult: NoieSaveRoutingResult,
  items: DailyTraceItem[],
  selectedDreamTorchId: string | null
) {
  if (routingResult.route !== "routine_record") {
    return null;
  }
  const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(items), selectedDreamTorchId);
  if (!torchPiece) {
    return null;
  }
  const activeRoutines = (torchPiece.routines ?? []).filter(isActiveTodayMeRoutine);
  const selected = selectPreferredRoutineCandidate({
    routines: activeRoutines,
    requestedTitle: routingResult.title,
    explicitRoutineId: routingResult.matchedRoutineId,
    isActiveRoutine: isActiveTodayMeRoutine,
  });
  return selected ? { itemId: torchPiece.id, routineId: selected.routine.id } : null;
}

export function resolveTodayMeRoutineRemoveTarget(
  routingResult: NoieSaveRoutingResult,
  items: DailyTraceItem[],
  selectedDreamTorchId: string | null
) {
  if (routingResult.route !== "routine_remove") {
    return null;
  }
  const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(items), selectedDreamTorchId);
  if (!torchPiece) {
    return null;
  }
  const activeRoutines = (torchPiece.routines ?? []).filter(isActiveTodayMeRoutine);
  const selected = selectPreferredRoutineCandidate({
    routines: activeRoutines,
    requestedTitle: routingResult.title,
    explicitRoutineId: routingResult.matchedRoutineId,
    isActiveRoutine: isActiveTodayMeRoutine,
  });
  return selected
    ? { itemId: torchPiece.id, routineId: selected.routine.id, title: selected.routine.title }
    : null;
}

export function getPreferredTodayMeRoutineIds(
  items: DailyTraceItem[],
  selectedDreamTorchId: string | null
) {
  const torchPiece = selectDreamTorchPiece(getDreamTorchCandidates(items), selectedDreamTorchId);
  return (torchPiece?.routines ?? [])
    .filter(isActiveTodayMeRoutine)
    .map((routine) => routine.id);
}

export function isDuplicateLifeScheduleRoute(routingResult: NoieSaveRoutingResult, items: DailyTraceItem[]) {
  if (routingResult.route !== "life_schedule_repeat" && routingResult.route !== "life_schedule_once") {
    return false;
  }

  const targetTitle = normalizeMemoryInput(routingResult.title);
  const targetTime = routingResult.displayUnit ?? "";
  return items.some((item) => {
    const typedItem = item as DailyTraceItem & { sourceType?: string; recurrence?: string };
    if (routingResult.route === "life_schedule_once") {
      return (
        typedItem.sourceType === "life_schedule_once" &&
        item.date === routingResult.scheduledDate &&
        normalizeMemoryInput(item.title) === targetTitle &&
        item.time === targetTime
      );
    }

    return (
      typedItem.sourceType === "life_schedule_repeat" &&
      normalizeMemoryInput(item.title) === targetTitle &&
      item.time === targetTime &&
      typedItem.recurrence === (routingResult.recurrence ?? "daily")
    );
  });
}
