import type {
  DailyTraceItem,
  DailyTraceItemType,
  EmotionKey,
  EmotionLevel,
  EmotionSignals,
  MemorySavePolicy,
  MemorySavePolicyType,
  NoieMemory,
  SaveDecision,
} from "./types";
import { getLocalDateString } from "./dateUtils";

export type NoieSaveRoute =
  | "routine_record"
  | "routine_remove"
  | "routine_create"
  | "routine_adjustment_intent"
  | "routine_adjustment_confirm"
  | "project_create"
  | "completed_action"
  | "completed_project"
  | "life_schedule_once"
  | "life_schedule_repeat"
  | "life_schedule_date_request"
  | "life_schedule_missing_date"
  | "life_schedule_reminder_update"
  | "life_schedule_cancel"
  | "life_action_record"
  | "dream_torch"
  | "dream_fragment"
  | "dream_fragment_rename"
  | "dream_fragment_complete"
  | "dream_fragment_next_action_update"
  | "daily_long_record_create"
  | "daily_long_record_title_update"
  | "daily_long_record_append"
  | "daily_trace_update"
  | "daily_trace"
  | "important_day_event"
  | "daily_idea"
  | "achievement"
  | "sensitive_event"
  | "none";

export type NoieSaveRoutingResult = {
  route: NoieSaveRoute;
  title: string;
  originalText: string;
  normalizedText: string;
  reason?: string;
  confidence: number;
  scheduledDate?: string | null;
  needsDateSelection?: boolean;
  recurrence?: "daily" | "weekly" | null;
  repeatType?: "daily" | "weekly" | null;
  targetValue?: number | null;
  minimumValue?: number | null;
  unit?: string;
  actualValue?: number | null;
  actualUnit?: string | null;
  displayValue?: number | null;
  displayUnit?: string | null;
  endTime?: string | null;
  endDisplayUnit?: string | null;
  reminder?: string | null;
  isExplicitOverride?: boolean;
  isSensitive?: boolean;
  isOtherPerson?: boolean;
  matchedRoutineId?: string | null;
  matchedProjectId?: string | null;
  matchedNextAction?: string | null;
  hasExistingRoutineRecord?: boolean;
  matchedDailyTraceId?: string | null;
  targetGoalTitle?: string | null;
  previousDurationMinutes?: number | null;
  newDurationMinutes?: number | null;
  previousTitle?: string | null;
  nextTitle?: string | null;
  nextAction?: string | null;
  longRecordBody?: string | null;
  longRecordTitle?: string | null;
  isAdditiveRecord?: boolean;
};

export function getMemoryInputText(input: {
  title?: string;
  memo?: string;
  sourceText?: string;
}) {
  return input.sourceText || input.memo || input.title || "";
}

export function getMemoryPolicy(memory: NoieMemory): MemorySavePolicy {
  if (memory.memoryType) {
    return {
      type: memory.memoryType,
      shouldSave: memory.memoryType !== "none",
      requiresConfirmation: memory.memoryType !== "none",
      importance:
        memory.importance ??
        calculateMemoryImportance(memory.memoryType),
      label: memory.displayCategory ?? memory.memoryType,
      saveTargets: memory.saveTargets,
    };
  }

  return classifyMemorySavePolicy(
    getMemoryInputText({
      title: memory.title,
      memo: memory.memo,
      sourceText: memory.sourceText,
    }),
    undefined,
    memory
  );
}

export function getMemoryPolicyForRoute(
  memoryPolicy: MemorySavePolicy,
  routingResult: NoieSaveRoutingResult
): MemorySavePolicy {
  if (routingResult.route === "routine_create") {
    return {
      type: "goal",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 88,
      label: "반복 목표",
      saveTargets: [],
    };
  }

  if (routingResult.route === "project_create") {
    return {
      type: "project",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 86,
      label: "오늘의 나 프로젝트",
      saveTargets: [],
    };
  }

  if (routingResult.route === "routine_record") {
    return {
      type: "achievement",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 72,
      label: "반복 목표 수행",
      saveTargets: ["daily_trace"],
    };
  }

  if (routingResult.route === "routine_remove") {
    return {
      type: "none",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 0,
      label: "오늘의 나 반복 목표 제거",
      saveTargets: [],
    };
  }

  if (
    routingResult.route === "life_schedule_once" ||
    routingResult.route === "life_schedule_repeat" ||
    routingResult.route === "life_schedule_date_request" ||
    routingResult.route === "life_schedule_reminder_update" ||
    routingResult.route === "life_schedule_cancel"
  ) {
    return {
      type: "todo",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: routingResult.route === "life_schedule_repeat" ? "생활 반복 예정" : "생활 예정",
      saveTargets: ["daily_trace"],
    };
  }

  if (routingResult.route === "life_action_record") {
    return {
      type: "daily_context",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: "직접 기록",
      saveTargets: ["daily_trace"],
    };
  }

  if (routingResult.route === "dream_torch") {
    return {
      type: "dream",
      shouldSave: true,
      requiresConfirmation: true,
      importance: Math.max(memoryPolicy.importance, 95),
      label: "꿈의 횃불",
      saveTargets: ["dream_torch"],
      dreamRole: "torch",
    };
  }

  if (routingResult.route === "dream_fragment") {
    return {
      type: "project",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 96,
      label: "꿈의 파편",
      saveTargets: ["dream_fragment"],
      dreamRole: "fragment",
    };
  }

  if (
    routingResult.route === "dream_fragment_rename" ||
    routingResult.route === "dream_fragment_complete" ||
    routingResult.route === "dream_fragment_next_action_update"
  ) {
    return {
      type: "project",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 96,
      label: "꿈의 파편",
      saveTargets: [],
      dreamRole: "fragment",
    };
  }

  if (routingResult.route === "important_day_event") {
    return {
      type: "important_note",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 92,
      label: "오늘의 중요한 사건",
      saveTargets: ["daily_piece", "daily_trace"],
    };
  }

  if (routingResult.route === "daily_trace") {
    return {
      type: "daily_context",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: "하루의 흔적",
      saveTargets: ["daily_trace"],
    };
  }

  if (
    routingResult.route === "daily_long_record_create" ||
    routingResult.route === "daily_long_record_title_update" ||
    routingResult.route === "daily_long_record_append" ||
    routingResult.route === "daily_trace_update"
  ) {
    return {
      type: "daily_context",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 70,
      label: "날짜별 기록",
      saveTargets: [],
    };
  }

  if (routingResult.route === "daily_idea") {
    return {
      type: "idea",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 72,
      label: "오늘의 아이디어",
      saveTargets: ["daily_piece", "daily_trace"],
    };
  }

  if (routingResult.route === "completed_action" || routingResult.route === "completed_project") {
    return {
      type: "achievement",
      shouldSave: true,
      requiresConfirmation: true,
      importance: routingResult.route === "completed_project" ? 94 : 84,
      label: routingResult.route === "completed_project" ? "완료한 프로젝트" : "완료한 행동",
      saveTargets: ["daily_piece", "daily_trace"],
    };
  }

  if (routingResult.route === "routine_adjustment_intent" || routingResult.route === "routine_adjustment_confirm") {
    return {
      type: "none",
      shouldSave: true,
      requiresConfirmation: true,
      importance: 0,
      label: "반복 목표 조정",
      saveTargets: [],
    };
  }

  if (routingResult.route === "life_schedule_missing_date") {
    return buildMemorySavePolicy("none");
  }

  if (routingResult.route === "none" || routingResult.isOtherPerson) {
    return buildMemorySavePolicy("none");
  }

  return memoryPolicy;
}

export function shouldSaveToDailyTrace(memoryPolicy: MemorySavePolicy) {
  if (!memoryPolicy.shouldSave || memoryPolicy.type === "sensitive_event") {
    return false;
  }

  if (memoryPolicy.saveTargets) {
    return memoryPolicy.saveTargets.includes("daily_trace");
  }

  return true;
}

export function shouldSaveToDailyPieces(memoryPolicy: MemorySavePolicy) {
  if (!memoryPolicy.shouldSave || memoryPolicy.type === "none") {
    return false;
  }

  if (memoryPolicy.saveTargets) {
    return (
      memoryPolicy.saveTargets.includes("daily_piece") ||
      memoryPolicy.saveTargets.includes("dream_piece")
    );
  }

  return true;
}

export function normalizeMemoryInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[.,!?。！？，]/g, "")
    .replace(/\s+/g, " ")
    .replace(/ai\s*개발자/g, "ai개발자")
    .replace(/내\s*꿈/g, "꿈")
    .replace(/내꿈/g, "꿈")
    .replace(/내\s*목표/g, "목표")
    .replace(/\b나는\b|\b나\b|\b내\b/g, "")
    .replace(/개발자가\s*되는\s*게/g, "개발자 되는")
    .replace(/개발자가\s*되는게/g, "개발자 되는")
    .replace(/개발자가\s*되는거야/g, "개발자 되는")
    .replace(/개발자\s*되고/g, "개발자 되는")
    .replace(/개발자가\s*되고/g, "개발자 되는")
    .replace(/되고\s*싶어/g, "되는 목표")
    .replace(/되는\s*게/g, "되는")
    .replace(/되는게/g, "되는")
    .replace(/되는거야/g, "되는")
    .replace(/목표\s*야/g, "목표")
    .replace(/목표야/g, "목표")
    .replace(/목표는/g, "목표")
    .replace(/꿈은/g, "꿈")
    .replace(/\s+/g, " ")
    .trim();
}

function getMemoryDateKey(createdAt: string): string {
  const createdAtDate = new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    return "";
  }

  return getLocalDateString(createdAtDate);
}

function getMemoryTypePriority(type: MemorySavePolicyType) {
  const priorityMap: Record<MemorySavePolicyType, number> = {
    goal: 6,
    dream: 5,
    project: 4,
    achievement: 4,
    relationship: 3,
    idea: 2,
    schedule: 2,
    todo: 2,
    task: 2,
    daily_plan: 2,
    note: 1,
    important_note: 2,
    daily_context: 1,
    sensitive_event: 0,
    none: -1,
  };

  return priorityMap[type];
}

function getMemoryNaturalScore(memory: NoieMemory) {
  const input = getMemoryInputText({
    title: memory.title,
    memo: memory.memo,
    sourceText: memory.sourceText,
  }).trim();

  if (input.length >= 8 && input.length <= 40) {
    return 2;
  }

  if (input.length > 40) {
    return 1;
  }

  return 0;
}

function getDreamRolePriority(memory: NoieMemory) {
  if (memory.pinnedAsDreamTorch || memory.dreamRole === "torch") {
    return 3;
  }

  if (memory.dreamRole === "fragment" || memory.saveTargets?.includes("dream_fragment")) {
    return 2;
  }

  return 0;
}

function chooseRepresentativeMemory(left: NoieMemory, right: NoieMemory) {
  const leftPolicy = getMemoryPolicy(left);
  const rightPolicy = getMemoryPolicy(right);
  const torchDiff = Number(Boolean(right.pinnedAsDreamTorch)) - Number(Boolean(left.pinnedAsDreamTorch));

  if (torchDiff > 0) {
    return right;
  }

  if (torchDiff < 0) {
    return left;
  }

  const roleDiff = getDreamRolePriority(right) - getDreamRolePriority(left);
  if (roleDiff > 0) {
    return right;
  }

  if (roleDiff < 0) {
    return left;
  }

  const importanceDiff = rightPolicy.importance - leftPolicy.importance;

  if (importanceDiff > 0) {
    return right;
  }

  if (importanceDiff < 0) {
    return left;
  }

  const typePriorityDiff =
    getMemoryTypePriority(rightPolicy.type) -
    getMemoryTypePriority(leftPolicy.type);

  if (typePriorityDiff > 0) {
    return right;
  }

  if (typePriorityDiff < 0) {
    return left;
  }

  const createdAtDiff = left.createdAt.localeCompare(right.createdAt);
  if (createdAtDiff < 0) {
    return right;
  }

  if (createdAtDiff > 0) {
    return left;
  }

  return getMemoryNaturalScore(right) > getMemoryNaturalScore(left)
    ? right
    : left;
}

export function getMemorySemanticKey(memory: NoieMemory): string {
  const dateKey = getMemoryDateKey(memory.createdAt);
  const input = getMemoryInputText({
    title: memory.title,
    memo: memory.memo,
    sourceText: memory.sourceText,
  });
  const normalizedInput = normalizeMemoryInput(input);

  const isDeveloperGoal =
    /ai?개발자|개발자/.test(normalizedInput) &&
    /목표|꿈|되는|취직/.test(normalizedInput);

  if (isDeveloperGoal) {
    return `${dateKey}_developer_goal`;
  }

  const memoryPolicy = getMemoryPolicy(memory);
  return `${dateKey}_${memoryPolicy.type}_${normalizedInput}`;
}

export function dedupeMemories(memories: NoieMemory[]): NoieMemory[] {
  console.log("중복 제거 전:", memories.length);

  const memoryMap = new Map<string, NoieMemory>();

  memories.forEach((memory) => {
    const semanticKey = getMemorySemanticKey(memory);
    console.log("중복 키:", semanticKey);
    const existingMemory = memoryMap.get(semanticKey);

    memoryMap.set(
      semanticKey,
      existingMemory
        ? chooseRepresentativeMemory(existingMemory, memory)
        : memory
    );
  });

  const dedupedMemories = Array.from(memoryMap.values()).sort(sortDailyTraceItems);
  console.log("중복 제거 후:", dedupedMemories.length);

  return dedupedMemories;
}

export function classifyMemorySavePolicy(
  text: string,
  emotionSignals?: EmotionSignals,
  traceItem?: {
    type?: DailyTraceItemType | null;
    targetDate?: string | null;
    targetYear?: string | null;
    targetText?: string | null;
  }
): MemorySavePolicy {
  const normalizedText = text.trim().toLowerCase();
  const has = (patterns: RegExp[]) =>
    patterns.some((pattern) => pattern.test(normalizedText));

  const sensitivePatterns = [
    /싸움|싸웠|싸웟|다툼|다퉜|갈등|차단|상처|배신|헤어졌|헤어짐|이별|손절/,
    /실패|실패햇|떨어졌|떨어졋|탈락|불합격|망했|망쳣|망침|못했|안\s*됐|안됐|안됏|거절|거절당/,
    /취직\s*실패|면접\s*떨어|시험\s*망|프로젝트\s*실패|코딩\s*테스트\s*떨어|서류\s*탈락/,
    /무너졌|좌절|포기하고\s*싶|절망|끝난\s*것\s*같|잃었|잃어버렸|해고|퇴사당|버림받/,
    /불안|무서|무서운\s*꿈|악몽|공포|놀랐|충격|멘붕|긴장돼|숨\s*막혀/,
    /우울|힘들|힘들엇|지쳤|지침|번아웃|아무것도\s*하기\s*싫|눈물|울었|울엇|울음/,
  ];
  const achievementActionPatterns = [
    /완료|끝냄|해냄|성공|통과|해결/,
    /수정|고침|구현|만듦|제작|시작|진행/,
    /정리|연결|실행|테스트|검증|배포|확인/,
  ];
  const achievementTopicPatterns = [
    /코드|앱|모바일|백엔드|프론트|api|ui|화면/,
    /노이에\s*개발|감정\s*분석기|하루의\s*조각|감정창고|app\.tsx/,
  ];
  const relationshipPatterns = [
    /친구|새\s*친구|사귐|사귀|친해짐/,
    /만남|대화|연락|도움|화해|같이|약속/,
    /선배|동기|가족/,
  ];
  const dreamPatterns = [
    /꿈|되고\s*싶|가고\s*싶|만들고\s*싶/,
    /나중에|언젠가|장기적으로/,
    /개인\s*ai|ai\s*개발자|개발자|뤼튼|취직|창업|내\s*ai|노이에|아미/,
  ];
  const explicitGoalPatterns = [
    /내\s*목표|목표는|목표가|목표야|목표\s*야/,
    /되고\s*싶|개발자가\s*되는|개발자가\s*될/,
    /되는\s*게\s*목표|되는게\s*목표/,
    /완성하는\s*게\s*목표|완성하는게\s*목표/,
    /ai\s*개발자|취직|뤼튼|개인\s*ai\s*만들고\s*싶/,
  ];
  const timePatterns = [
    /오늘|내일|이번\s*주|다음\s*주|방학|주말|아침|저녁/,
    /월요일|화요일|수요일|목요일|금요일|토요일|일요일/,
    /\d{1,2}월|\d{1,2}일/,
  ];
  const goalPatterns = [
    /해야|할\s*일|계획|목표|예정|준비/,
    /공부|개발|만들기|확인|정리|예비군/,
  ];
  const ideaPatterns = [
    /아이디어|기능|버튼|화면|ui|ux|카드/,
    /섹션|추천|저장|분류|자동저장|감정창고/,
    /하루의\s*조각|프로젝트|사이드바|탑\s*3|top\s*3|가로\s*카드/,
    /넣자|바꾸자|추가|개선|구조|올리자|띄우자|가자/,
  ];
  const dailyContextPatterns = [
    /방학\s*이야|방학이야|방학\s*시작|방학시작/,
    /휴가\s*야|휴가야|쉬는\s*날/,
    /생일\s*이야|생일이야/,
  ];
  const vacationPlanPatterns = [
    /방학.*개발|방학.*공부|방학.*만들|방학.*노이에/,
    /방학.*할\s*거야|방학.*해야|방학.*계획|방학.*목표/,
  ];

  const hasSensitiveSignal = has(sensitivePatterns);
  const hasAchievementAction = has(achievementActionPatterns);
  const hasAchievementTopic = has(achievementTopicPatterns);
  const hasRelationshipSignal = has(relationshipPatterns);
  const hasDreamSignal = has(dreamPatterns);
  const hasExplicitGoalSignal = has(explicitGoalPatterns);
  const hasTimeSignal = has(timePatterns);
  const hasGoalSignal =
    has(goalPatterns) ||
    traceItem?.type === "goal" ||
    traceItem?.type === "todo" ||
    traceItem?.type === "schedule" ||
    Boolean(
      traceItem?.targetDate || traceItem?.targetYear || traceItem?.targetText
    );
  const hasIdeaSignal = has(ideaPatterns);
  const hasVacationPlanSignal = has(vacationPlanPatterns);
  const hasHighNegativeEmotion = (["D", "A", "T", "F"] as EmotionKey[]).some(
    (key) => isHighEmotion(emotionSignals?.[key])
  );
  const isAchievement =
    hasAchievementAction ||
    (hasAchievementTopic &&
      /시작|진행|확인|수정|완료|성공|실행/.test(normalizedText));
  const isGoal =
    (hasGoalSignal && (hasTimeSignal || traceItem?.type !== undefined)) ||
    hasVacationPlanSignal;
  const isDailyContext = has(dailyContextPatterns) && !hasVacationPlanSignal;

  if (hasSensitiveSignal) {
    return buildMemorySavePolicy("sensitive_event");
  }

  if (isDailyContext) {
    return buildMemorySavePolicy("daily_context");
  }

  if (isAchievement) {
    return buildMemorySavePolicy("achievement");
  }

  if (hasExplicitGoalSignal) {
    return buildMemorySavePolicy("goal", { isExplicitGoal: true });
  }

  if (hasDreamSignal) {
    return buildMemorySavePolicy("dream");
  }

  if (hasRelationshipSignal) {
    return buildMemorySavePolicy("relationship");
  }

  if (isGoal) {
    return buildMemorySavePolicy("goal");
  }

  if (hasIdeaSignal) {
    return buildMemorySavePolicy("idea");
  }

  if (hasHighNegativeEmotion) {
    return buildMemorySavePolicy("sensitive_event");
  }

  return buildMemorySavePolicy("none");
}

export function isHighEmotion(value: EmotionLevel | number | undefined) {
  if (typeof value === "number") {
    return value >= 0.7;
  }

  return value === "High";
}

export function calculateMemoryImportance(
  type: MemorySavePolicyType,
  options: { isExplicitGoal?: boolean } = {}
) {
  if (type === "goal" && options.isExplicitGoal) {
    return 88;
  }

  const importanceMap: Record<MemorySavePolicyType, number> = {
    sensitive_event: 100,
    achievement: 90,
    relationship: 80,
    dream: 85,
    goal: 78,
    project: 76,
    idea: 70,
    schedule: 60,
    todo: 65,
    task: 65,
    daily_plan: 65,
    note: 45,
    important_note: 75,
    daily_context: 40,
    none: 0,
  };

  return importanceMap[type];
}

export function buildMemorySavePolicy(
  type: MemorySavePolicyType,
  options: { isExplicitGoal?: boolean } = {}
): MemorySavePolicy {
  const policyMap: Record<MemorySavePolicyType, Omit<MemorySavePolicy, "importance">> = {
    sensitive_event: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "최근 사건",
    },
    achievement: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "성과",
      saveTargets: ["daily_piece", "daily_trace"],
    },
    relationship: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "관계",
      saveTargets: ["daily_piece"],
    },
    dream: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "꿈",
      saveTargets: ["dream_piece", "daily_trace"],
    },
    goal: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "목표",
      saveTargets: ["dream_piece", "daily_trace"],
    },
    project: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "프로젝트",
      saveTargets: ["dream_piece", "dream_fragment"],
      dreamRole: "fragment",
    },
    idea: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "아이디어",
      saveTargets: ["daily_piece"],
    },
    schedule: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "일정",
      saveTargets: ["daily_trace"],
    },
    todo: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "할 일",
      saveTargets: ["daily_trace"],
    },
    task: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "할 일",
      saveTargets: ["daily_trace"],
    },
    daily_plan: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "계획",
      saveTargets: ["daily_trace"],
    },
    note: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "기록",
      saveTargets: ["daily_piece"],
    },
    important_note: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "중요 기록",
      saveTargets: ["daily_trace"],
    },
    daily_context: {
      type,
      shouldSave: true,
      requiresConfirmation: true,
      label: "기록",
      saveTargets: ["daily_piece"],
    },
    none: {
      type,
      shouldSave: false,
      requiresConfirmation: false,
      label: "저장 안 함",
    },
  };

  return {
    ...policyMap[type],
    importance: calculateMemoryImportance(type, options),
  };
}

export function buildMemorySavePolicyFromDecision(decision: SaveDecision): MemorySavePolicy {
  if (
    decision.shouldStore === false ||
    decision.savePolicy === "none" ||
    decision.uiType === "none" ||
    decision.memoryType === "none" ||
    decision.saveTargets.length === 0
  ) {
    return {
      type: "none",
      shouldSave: false,
      requiresConfirmation: false,
      importance: decision.importance ?? 0,
      label: decision.displayCategory || "저장 안 함",
      saveTargets: [],
    };
  }

  if (decision.memoryType === "dream" || decision.memoryType === "goal") {
    return {
      type: decision.memoryType,
      shouldSave: true,
      requiresConfirmation: true,
      importance: decision.importance,
      label: decision.displayCategory,
      saveTargets: ["dream_piece", "daily_trace"],
    };
  }

  if (
    decision.memoryType === "todo" ||
    decision.memoryType === "task" ||
    decision.memoryType === "schedule" ||
    decision.memoryType === "daily_plan"
  ) {
    return {
      type: decision.memoryType,
      shouldSave: true,
      requiresConfirmation: true,
      importance: decision.importance,
      label: decision.displayCategory,
      saveTargets: ["daily_trace"],
    };
  }

  return {
    type: decision.memoryType,
    shouldSave: true,
    requiresConfirmation: true,
    importance: decision.importance,
    label: decision.displayCategory,
    saveTargets: decision.saveTargets,
  };
}

function sortDailyTraceItems(left: DailyTraceItem, right: DailyTraceItem) {
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }

  const leftTime = left.time ?? "99:99";
  const rightTime = right.time ?? "99:99";
  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  return left.createdAt.localeCompare(right.createdAt);
}
