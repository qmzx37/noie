import type {
  DailyTraceItem,
  DailyTraceItemType,
  DreamProjectStatus,
  MemorySavePolicyType,
  NoieProject,
  ProjectDailyActionRecord,
  SaveDecision,
  SaveNoieMemoryResult,
  StartProjectInput,
} from "../../noie/types";

export type BuildProjectInput = {
  id: string;
  title: string;
  goal: string;
  deadline?: string;
  now: string;
};

export type BuildTodayMeProjectInput = StartProjectInput & {
  id: string;
  title: string;
  todayMeOrder: number;
  now: string;
  dreamFragmentDescription?: string;
};

export type BuildCompletedProjectTraceInput = {
  currentItems: DailyTraceItem[];
  projectId: string;
  title: string;
  originalText: string;
  todayKey: string;
  now: string;
  traceId: string;
  completedTitle: string;
  completedMemo: string;
  displayCategory: string;
  saveNoieMemory: (
    currentItems: DailyTraceItem[],
    newItem: DailyTraceItem,
    input: string,
    options?: { shouldLog?: boolean }
  ) => SaveNoieMemoryResult;
};

export type CompletedProjectTraceResult = {
  nextItems: DailyTraceItem[];
  traceCreated: boolean;
  sourceId: string;
};

export function buildProject(input: BuildProjectInput): NoieProject {
  return {
    id: input.id,
    title: input.title,
    goal: input.goal,
    deadline: input.deadline || undefined,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function updateProjectInList(
  projects: NoieProject[],
  projectId: string,
  values: Pick<NoieProject, "title" | "goal"> & { deadline?: string },
  now: string
) {
  return projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          title: values.title,
          goal: values.goal,
          deadline: values.deadline || undefined,
          updatedAt: now,
        }
      : project
  );
}

export function archiveProjectInList(
  projects: NoieProject[],
  projectId: string,
  now: string
) {
  return projects.map((project) =>
    project.id === projectId
      ? { ...project, isArchived: true, updatedAt: now }
      : project
  );
}

export function completeProjectInList(
  projects: NoieProject[],
  projectId: string,
  now: string,
  options: { archiveFromTodayMe?: boolean } = {}
) {
  return projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          status: "done" as DreamProjectStatus,
          archivedFromTodayMe:
            options.archiveFromTodayMe === undefined
              ? project.archivedFromTodayMe
              : options.archiveFromTodayMe,
          completedAt: now,
          updatedAt: now,
        }
      : project
  );
}

export function removeProjectFromTodayMeInList(
  projects: NoieProject[],
  projectId: string,
  now: string
) {
  return projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          archivedFromTodayMe: true,
          pinnedToTodayMe: false,
          updatedAt: now,
        }
      : project
  );
}

export function buildProjectDailyActionRecord(
  action: string,
  now: string,
  existingRecord?: ProjectDailyActionRecord
): ProjectDailyActionRecord {
  return {
    action,
    completed: true,
    source: "quick_check",
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
  };
}

export function completeProjectNextActionInList(
  projects: NoieProject[],
  projectId: string,
  dateKey: string,
  now: string,
  fallbackAction: string,
  explicitAction?: string
) {
  return projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const action = explicitAction ?? project.nextAction?.trim() ?? fallbackAction;
    return {
      ...project,
      dailyActionRecords: {
        ...(project.dailyActionRecords ?? {}),
        [dateKey]: buildProjectDailyActionRecord(
          action,
          now,
          project.dailyActionRecords?.[dateKey]
        ),
      },
      updatedAt: now,
    };
  });
}

export function cancelProjectNextActionInList(
  projects: NoieProject[],
  projectId: string,
  dateKey: string,
  now: string
) {
  return projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    const nextDailyActionRecords = { ...(project.dailyActionRecords ?? {}) };
    delete nextDailyActionRecords[dateKey];
    return {
      ...project,
      dailyActionRecords: nextDailyActionRecords,
      updatedAt: now,
    };
  });
}

export function reactivateTodayMeProjectInList(
  projects: NoieProject[],
  projectId: string,
  input: StartProjectInput,
  todayMeOrder: number,
  now: string
) {
  return projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          isArchived: false,
          pinnedToTodayMe: true,
          archivedFromTodayMe: false,
          todayMeOrder:
            typeof project.todayMeOrder === "number" ? project.todayMeOrder : todayMeOrder,
          relatedDreamTorchId:
            project.relatedDreamTorchId ?? input.relatedDreamTorchId ?? undefined,
          relatedDreamFragmentId:
            project.relatedDreamFragmentId ?? input.relatedDreamFragmentId ?? undefined,
          sourceDreamFragmentId:
            project.sourceDreamFragmentId ?? input.relatedDreamFragmentId ?? undefined,
          updatedAt: now,
        }
      : project
  );
}

export function buildTodayMeProject(input: BuildTodayMeProjectInput): NoieProject {
  return {
    id: input.id,
    title: input.title,
    goal: input.originalText?.trim() || input.title,
    description:
      input.source === "dream_fragment" ? input.dreamFragmentDescription : undefined,
    status: "planning",
    sourceDreamFragmentId: input.relatedDreamFragmentId ?? undefined,
    sourceMemoryId: input.relatedDreamFragmentId ?? undefined,
    relatedDreamTorchId: input.relatedDreamTorchId ?? undefined,
    relatedDreamFragmentId: input.relatedDreamFragmentId ?? undefined,
    fromDreamFragment: input.source === "dream_fragment",
    nextAction: input.nextAction ?? "",
    pinnedToTodayMe: true,
    todayMeOrder: input.todayMeOrder,
    archivedFromTodayMe: false,
    dailyActionRecords: {},
    originalText: input.originalText?.trim() || input.title,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function buildCompletedProjectTrace(
  input: BuildCompletedProjectTraceInput
): CompletedProjectTraceResult {
  const sourceId = `completed_project:${input.projectId}:${input.todayKey}`;
  const hasCompletedTrace = input.currentItems.some((item) => {
    const typedItem = item as DailyTraceItem & { sourceId?: string };
    return typedItem.sourceId === sourceId;
  });

  if (hasCompletedTrace) {
    return {
      nextItems: input.currentItems,
      traceCreated: false,
      sourceId,
    };
  }

  const completedTrace = {
    id: input.traceId,
    type: "record" as DailyTraceItemType,
    date: input.todayKey,
    title: input.completedTitle,
    memo: input.completedMemo,
    text: input.originalText,
    originalText: input.originalText,
    sourceText: input.originalText,
    memoryType: "achievement" as MemorySavePolicyType,
    saveTargets: ["daily_piece", "daily_trace"] as SaveDecision["saveTargets"],
    importance: 94,
    displayCategory: input.displayCategory,
    category: "completed_project",
    sourceType: "completed_project",
    sourceId,
    createdAt: input.now,
  } as DailyTraceItem;

  return {
    nextItems: input.saveNoieMemory(input.currentItems, completedTrace, input.originalText, {
      shouldLog: false,
    }).items,
    traceCreated: true,
    sourceId,
  };
}
