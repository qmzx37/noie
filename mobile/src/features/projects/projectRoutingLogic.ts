import {
  normalizeMemoryInput,
  type NoieSaveRoutingResult,
} from "../../noie/memoryLogic";
import type { NoieProject } from "../../noie/types";
import { isActiveTodayMeProject } from "../../noie/selectors";
import { makeSmartTitle } from "../../noie/titleLogic";

export function extractProjectTitle(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const candidate =
        item.title ??
        item.normalizedText ??
        item.text ??
        item.originalText ??
        item.content;

      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return "";
}

export function isProjectStartText(text: string) {
  const normalizedText = text.trim();
  if (/언젠가|나중에|되고\s*싶|완성하고\s*싶|만들고\s*싶|꿈|목표/.test(normalizedText) && !/시작할래|시작하려고|실제로\s*개발|프로젝트를\s*시작/.test(normalizedText)) {
    return false;
  }
  return /프로젝트.*시작할래|프로젝트를\s*시작|프로젝트\s*시작|MVP.*만들래|포트폴리오.*만들래|이력서.*완성할래|앱.*만들기\s*시작|실제로\s*개발할래|실제로\s*만들래/.test(normalizedText);
}

export function makeProjectTitle(text: string) {
  return makeSmartTitle(
    text
      .replace(/프로젝트를\s*시작할래|프로젝트\s*시작할래|프로젝트를\s*시작|시작할래|실제로\s*개발할래|실제로\s*만들래/g, "")
      .replace(/만들래/g, "만들기")
      .replace(/완성할래/g, "완성하기")
      .trim() || text,
    "project"
  );
}

export function findDuplicateProjectByText(text: string, projects: NoieProject[]) {
  const projectKey = normalizeMemoryInput(makeProjectTitle(text));
  if (!projectKey) {
    return undefined;
  }
  return projects.find((project) => {
    if (project.status === "done" || project.isArchived || project.archivedFromTodayMe) {
      return false;
    }
    const titleKey = normalizeMemoryInput(project.title || project.goal || project.originalText || "");
    return titleKey === projectKey || titleKey.includes(projectKey) || projectKey.includes(titleKey);
  });
}

export function findDuplicateProjectRoute(routingResult: NoieSaveRoutingResult, projects: NoieProject[]) {
  if (routingResult.matchedProjectId) {
    return projects.find((project) => project.id === routingResult.matchedProjectId);
  }
  return findDuplicateProjectByText(routingResult.originalText || routingResult.title, projects);
}

export function findCompletedProjectRoute(
  text: string,
  projects: NoieProject[]
): NoieSaveRoutingResult | null {
  if (!/프로젝트|전체\s*프로젝트/.test(text) || !/완료했|끝냈|마쳤|끝남|완성했|완료\s*처리|완료/.test(text)) {
    return null;
  }

  const normalizedText = normalizeMemoryInput(text);
  const activeProjects = projects.filter(
    (project) =>
      isActiveTodayMeProject(project) &&
      project.status !== "done" &&
      project.isArchived !== true &&
      project.archivedFromTodayMe !== true
  );
  const completionSubjectKey = normalizeProjectCompletionSubject(text);
  const matchedProject = activeProjects.find((project) => {
    const titleKey = normalizeMemoryInput(project.title);
    const goalKey = normalizeMemoryInput(project.goal);
    return (
      isProjectTextMatch(normalizedText, titleKey) ||
      isProjectTextMatch(normalizedText, goalKey) ||
      isProjectTextMatch(completionSubjectKey, titleKey) ||
      isProjectTextMatch(completionSubjectKey, goalKey)
    );
  });

  if (!matchedProject) {
    return null;
  }

  return {
    route: "completed_project",
    title: matchedProject.title,
    originalText: text,
    normalizedText,
    confidence: 0.9,
    matchedProjectId: matchedProject.id,
    reason: "진행 중인 프로젝트 완료 의도",
  };
}

export function normalizeProjectCompletionSubject(text: string) {
  return normalizeMemoryInput(
    text
      .replace(/전체\s*프로젝트|프로젝트/g, " ")
      .replace(/완료\s*처리해줘|완료했어|완료|끝냈어|끝냄|마쳤어|끝남|완성했어/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function isProjectTextMatch(sourceKey: string, projectKey: string) {
  if (!sourceKey || !projectKey || projectKey.length < 2) {
    return false;
  }
  return sourceKey.includes(projectKey) || projectKey.includes(sourceKey);
}

export function findCompletedProjectActionRoute(
  text: string,
  projects: NoieProject[],
  helpers: {
    isCompletedActionText: (text: string) => boolean;
    makeCompletedActionTitle: (text: string) => string;
  }
): NoieSaveRoutingResult | null {
  if (!helpers.isCompletedActionText(text)) {
    return null;
  }

  const normalizedText = normalizeMemoryInput(text);
  const activeProjects = projects.filter(
    (project) =>
      project.status !== "done" &&
      project.isArchived !== true &&
      project.archivedFromTodayMe !== true &&
      Boolean(project.nextAction?.trim())
  );
  const matchedProject = activeProjects.find((project) => {
    const actionKey = normalizeMemoryInput(project.nextAction ?? "");
    const compactActionKey = actionKey.replace(/하기$|테스트$/g, "").trim();
    return (
      actionKey.length > 0 &&
      (normalizedText.includes(actionKey) ||
        (compactActionKey.length > 1 && normalizedText.includes(compactActionKey)))
    );
  });

  if (!matchedProject) {
    return null;
  }

  return {
    route: "completed_action",
    title: matchedProject.nextAction?.trim() || helpers.makeCompletedActionTitle(text),
    originalText: text,
    normalizedText,
    confidence: 0.88,
    matchedProjectId: matchedProject.id,
    matchedNextAction: matchedProject.nextAction?.trim() ?? null,
    reason: "프로젝트 다음 행동 완료",
  };
}
