import type {
  DailyTraceItem,
  DailyTraceItemType,
  DreamProjectStatus,
  MemorySavePolicyType,
  SaveDecision,
} from "../../noie/types";

export type DreamActionHelpers = {
  createId: (prefix: string) => string;
  getMemorySemanticKey: (item: DailyTraceItem) => string;
  dedupeMemories: (items: DailyTraceItem[]) => DailyTraceItem[];
};

export type BuildDreamSaveMemoriesOptions = {
  replaceTorch: boolean;
};

export type CompleteDreamFragmentResult = {
  nextItems: DailyTraceItem[];
  completedFragment?: DailyTraceItem;
  completionTraceCreated: boolean;
  completionSourceId?: string;
};

export function mergeDreamTorchMemory(
  currentItems: DailyTraceItem[],
  newItem: DailyTraceItem,
  getMemorySemanticKey: (item: DailyTraceItem) => string
) {
  const newItemKey = getMemorySemanticKey(newItem);
  const existingTorch = currentItems.find((item) => {
    const isTorch =
      item.pinnedAsDreamTorch ||
      item.dreamRole === "torch" ||
      item.saveTargets?.includes("dream_torch");
    return isTorch && getMemorySemanticKey(item) === newItemKey;
  });

  if (!existingTorch) {
    return newItem;
  }

  return {
    ...existingTorch,
    ...newItem,
    id: existingTorch.id,
    createdAt: existingTorch.createdAt,
    goalStartDate: existingTorch.goalStartDate,
    goalTargetDate: existingTorch.goalTargetDate,
    goalDurationMonths: existingTorch.goalDurationMonths,
    completionCriteria: existingTorch.completionCriteria,
    currentSeason: existingTorch.currentSeason,
    seasons: existingTorch.seasons,
    activeSeasonId: existingTorch.activeSeasonId,
    milestones: existingTorch.milestones,
    currentMilestoneId: existingTorch.currentMilestoneId,
    evidence: existingTorch.evidence,
    routines: existingTorch.routines,
    routineRecords: existingTorch.routineRecords,
    overallProgress: existingTorch.overallProgress,
    baseProgress: existingTorch.baseProgress,
    paceBonus: existingTorch.paceBonus,
    progressUpdatedAt: existingTorch.progressUpdatedAt,
    pinnedAsDreamTorch: true,
    dreamRole: "torch" as const,
    hiddenFromDream: false,
    updatedAt: newItem.updatedAt,
  };
}

export function buildDreamSaveMemories(
  currentItems: DailyTraceItem[],
  newItem: DailyTraceItem,
  options: BuildDreamSaveMemoriesOptions,
  helpers: Pick<DreamActionHelpers, "dedupeMemories" | "getMemorySemanticKey">
) {
  const now = new Date().toISOString();
  const itemToSave = options.replaceTorch
    ? mergeDreamTorchMemory(currentItems, newItem, helpers.getMemorySemanticKey)
    : newItem;
  const sourceMemories = options.replaceTorch
    ? currentItems
        .filter((item) => item.id !== itemToSave.id)
        .map((item) =>
          item.pinnedAsDreamTorch
            ? { ...item, pinnedAsDreamTorch: false, updatedAt: now }
            : item
        )
    : currentItems;

  return helpers.dedupeMemories([...sourceMemories, itemToSave]);
}

export function promoteExistingDreamItemToTorch(
  currentItems: DailyTraceItem[],
  targetItemId: string,
  now: string
) {
  return currentItems.map((item) => {
    if (item.id === targetItemId) {
      return {
        ...item,
        saveTargets: Array.from(new Set([...(item.saveTargets ?? []), "dream_torch"])) as SaveDecision["saveTargets"],
        dreamRole: "torch" as const,
        pinnedAsDreamTorch: true,
        hiddenFromDream: false,
        updatedAt: now,
      };
    }

    return item.pinnedAsDreamTorch || item.dreamRole === "torch"
      ? {
          ...item,
          pinnedAsDreamTorch: false,
          dreamRole: item.dreamRole === "torch" ? undefined : item.dreamRole,
          updatedAt: now,
        }
      : item;
  });
}

export function renameDreamFragment(
  currentItems: DailyTraceItem[],
  targetId: string,
  nextTitle: string,
  updatedAt: string
) {
  return currentItems.map((item) =>
    item.id === targetId
      ? {
          ...item,
          title: nextTitle,
          updatedAt,
        }
      : item
  );
}

export function completeDreamFragment({
  currentItems,
  fragmentId,
  todayKey,
  now,
  originalText,
  helpers,
}: {
  currentItems: DailyTraceItem[];
  fragmentId: string;
  todayKey: string;
  now: string;
  originalText: string;
  helpers: Pick<DreamActionHelpers, "createId">;
}): CompleteDreamFragmentResult {
  const fragment = currentItems.find((item) => item.id === fragmentId);
  if (!fragment) {
    return {
      nextItems: currentItems,
      completionTraceCreated: false,
    };
  }

  const completionSourceId = `dream_fragment_complete:${fragment.id}:${todayKey}`;
  const nextItemsBase = currentItems.map((item) =>
    item.id === fragment.id
      ? ({
          ...item,
          projectStatus: "done" as DreamProjectStatus,
          completedAt: (item as DailyTraceItem & { completedAt?: string }).completedAt ?? now,
          updatedAt: now,
        } as DailyTraceItem)
      : item
  );
  const hasCompletionTrace = nextItemsBase.some((item) => {
    const typedItem = item as DailyTraceItem & { sourceId?: string };
    return typedItem.sourceId === completionSourceId;
  });

  if (hasCompletionTrace) {
    return {
      nextItems: nextItemsBase,
      completedFragment: fragment,
      completionTraceCreated: false,
      completionSourceId,
    };
  }

  return {
    nextItems: [
      ...nextItemsBase,
      {
        id: helpers.createId("trace"),
        type: "record" as DailyTraceItemType,
        date: todayKey,
        title: `${fragment.title} 완료`,
        memo: "꿈의 파편",
        text: originalText,
        originalText,
        sourceText: originalText,
        memoryType: "achievement" as MemorySavePolicyType,
        saveTargets: ["daily_piece", "daily_trace"] as SaveDecision["saveTargets"],
        importance: 94,
        displayCategory: "꿈의 파편 완료",
        category: "dream_fragment_complete",
        sourceType: "dream_fragment_complete",
        sourceId: completionSourceId,
        relatedDreamTorchId: fragment.relatedDreamTorchId,
        createdAt: now,
      } as DailyTraceItem,
    ],
    completedFragment: fragment,
    completionTraceCreated: true,
    completionSourceId,
  };
}

export function updateDreamFragmentNextAction(
  currentItems: DailyTraceItem[],
  fragmentId: string,
  nextAction: string,
  updatedAt: string
) {
  return currentItems.map((item) =>
    item.id === fragmentId
      ? {
          ...item,
          nextAction,
          updatedAt,
        }
      : item
  );
}
