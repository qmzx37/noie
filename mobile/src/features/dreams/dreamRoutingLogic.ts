import { getLocalDateString } from "../../noie/dateUtils";
import {
  dedupeMemories,
  getMemoryInputText,
  getMemoryPolicy,
  normalizeMemoryInput,
  type NoieSaveRoutingResult,
} from "../../noie/memoryLogic";
import type {
  ChatMessage,
  DailyTraceItem,
  DailyTraceItemType,
  DreamRole,
  MemorySavePolicy,
  MemorySavePolicyType,
  SaveDecision,
} from "../../noie/types";
import { parseRoutineGoalCandidate } from "../routines/routineRoutingLogic";
import { stripTrailingKoreanParticles } from "../traces/lifeScheduleRoutingLogic";
import { makeSmartTitle } from "../../noie/titleLogic";

type RoutedChatMessage = ChatMessage & {
  saveRoutingResult?: NoieSaveRoutingResult;
};

export function isDreamOrGoalType(type?: MemorySavePolicyType) {
  return type === "dream" || type === "goal";
}

export function findRecentDreamReference(messages: ChatMessage[], items: DailyTraceItem[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as RoutedChatMessage;
    const routingResult = message.saveRoutingResult;
    if (
      message.dailyTraceCandidate &&
      (routingResult?.route === "dream_torch" || routingResult?.route === "dream_fragment")
    ) {
      const candidateText =
        routingResult.originalText ||
        message.dailyTraceCandidate.memo ||
        message.dailyTraceCandidate.title;
      const existingItem = findSingleDreamFragmentByTitle(items, message.dailyTraceCandidate.title) ??
        findSingleDreamFragmentByTitle(items, candidateText);
      if (existingItem) {
        return existingItem;
      }
      return {
        id: "",
        type: "goal" as DailyTraceItemType,
        date: message.dailyTraceCandidate.date || getLocalDateString(new Date()),
        title: makeSmartTitle(candidateText, "dream_fragment"),
        memo: candidateText,
        text: candidateText,
        sourceText: candidateText,
        memoryType: "project" as MemorySavePolicyType,
        saveTargets: ["dream_fragment"] as SaveDecision["saveTargets"],
        dreamRole: "fragment" as DreamRole,
        createdAt: message.createdAt,
      } as DailyTraceItem;
    }
  }

  return undefined;
}

export function isExplicitTorchReferenceText(text: string) {
  return /(?:이걸|이\s*목표를|방금\s*말한\s*걸|방금\s*그거|그걸).*(꿈의\s*)?횃불|(?:꿈의\s*)?횃불로\s*밝혀/.test(text);
}

export function findReferencedDreamForTorchRequest(
  text: string,
  recentDreamReference: DailyTraceItem | null | undefined,
  items: DailyTraceItem[]
) {
  if (!isExplicitTorchReferenceText(text)) {
    return null;
  }

  if (recentDreamReference?.id) {
    return recentDreamReference;
  }

  if (recentDreamReference) {
    const existingItem = findSingleDreamFragmentByTitle(items, recentDreamReference.title) ??
      findSingleDreamFragmentByTitle(items, getMemoryInputText(recentDreamReference));
    return existingItem ?? recentDreamReference;
  }

  return null;
}

export function normalizeDreamTitleForLookup(text: string) {
  return cleanDreamFragmentCommandText(text)
    .replace(/꿈의\s*파편|꿈\s*파편|이름|제목/g, " ")
    .split(/\s+/)
    .map((word) => stripTrailingKoreanParticles(word))
    .join("")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

export function cleanDreamFragmentCommandText(text: string) {
  return text
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .replace(/[.!。…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanDreamFragmentNextText(text: string) {
  return cleanDreamFragmentCommandText(text)
    .replace(/\s*(?:으로|로)\s*(?:바꿔줘|바꿔|변경해줘|변경|수정해줘|수정)\s*$/g, "")
    .replace(/\s*(?:바꿔줘|바꿔|변경해줘|변경|수정해줘|수정)\s*$/g, "")
    .replace(/\s*(?:으로|로)\s*$/g, "")
    .replace(/[.!。…]+$/g, "")
    .trim();
}

export function findDreamFragmentMatchesByTitle(items: DailyTraceItem[], title: string) {
  const fragments = getDreamFragments(items).filter((item) => item.projectStatus !== "done");
  const target = title.trim();
  const targetKey = normalizeDreamTitleForLookup(target);
  if (!targetKey) {
    return [];
  }

  const exact = fragments.filter((item) => item.title.trim() === target);
  if (exact.length > 0) {
    return exact;
  }

  const normalized = fragments.filter((item) => normalizeDreamTitleForLookup(item.title) === targetKey);
  if (normalized.length > 0) {
    return normalized;
  }

  const partial = fragments.filter((item) => {
    const itemKey = normalizeDreamTitleForLookup(item.title);
    return itemKey.includes(targetKey) || targetKey.includes(itemKey);
  });
  return partial.length === 1 ? partial : [];
}

export function findSingleDreamFragmentByTitle(items: DailyTraceItem[], title: string) {
  const matches = findDreamFragmentMatchesByTitle(items, title);
  return matches.length === 1 ? matches[0] : undefined;
}

export function findDreamFragmentNextActionUpdateRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  if (!/다음\s*(할\s*일|행동)/.test(text) || !/바꿔|수정|변경/.test(text)) {
    return null;
  }

  const match = text.match(/^(.+?)의\s*다음\s*(?:할\s*일|행동)을\s*(.+)$/);
  if (!match) {
    return null;
  }

  const previousTitle = cleanDreamFragmentCommandText(match[1]);
  const nextAction = cleanDreamFragmentNextText(match[2]);
  const matched = findSingleDreamFragmentByTitle(items, previousTitle);
  if (!matched || !nextAction) {
    return null;
  }

  return {
    route: "dream_fragment_next_action_update",
    title: matched.title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.98,
    matchedDailyTraceId: matched.id,
    previousTitle: matched.title,
    nextAction,
    reason: "기존 꿈의 파편 다음 할 일 수정",
  };
}

export function findDreamFragmentRenameRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  if (!/바꿔|수정|변경/.test(text) || !/꿈의\s*파편/.test(text)) {
    return null;
  }

  const match = text.match(/^(.+?)(?:라는|이라고)?\s*꿈의\s*파편\s*이름을\s*(.+)$/);
  if (!match) {
    return null;
  }

  const previousTitle = cleanDreamFragmentCommandText(match[1]);
  const nextTitle = cleanDreamFragmentNextText(match[2]);
  const matched = findSingleDreamFragmentByTitle(items, previousTitle);
  if (!matched || !nextTitle) {
    return null;
  }

  return {
    route: "dream_fragment_rename",
    title: matched.title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.97,
    matchedDailyTraceId: matched.id,
    previousTitle: matched.title,
    nextTitle,
    reason: "기존 꿈의 파편 이름 수정",
  };
}

export function findDreamFragmentCompleteRoute(text: string, items: DailyTraceItem[]): NoieSaveRoutingResult | null {
  if (!/완료했|완료\s*했|끝냈|달성했|마쳤|완성했/.test(text)) {
    return null;
  }

  const match = text.match(/^(?:오늘|방금)?\s*(.+?)(?:을|를)?\s*(?:완료했어|완료\s*했어|끝냈어|달성했어|마쳤어|완성했어|완료했다|끝냈다|달성했다|마쳤다|완성했다)/);
  const titleText = cleanDreamFragmentCommandText(match?.[1] ?? text);
  const matched = findSingleDreamFragmentByTitle(items, titleText || text);
  if (!matched) {
    return null;
  }

  return {
    route: "dream_fragment_complete",
    title: matched.title,
    originalText: text,
    normalizedText: normalizeMemoryInput(text),
    confidence: 0.98,
    matchedDailyTraceId: matched.id,
    reason: "기존 꿈의 파편 완료",
  };
}

export function getKoreanObjectParticle(text: string) {
  const lastChar = text.trim().slice(-1);
  if (!lastChar) {
    return "을";
  }
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) {
    return "을";
  }
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

export function isDreamTorchCandidateText(text: string, memoryPolicy: MemorySavePolicy) {
  if (isLifeDirectionDreamText(text)) {
    return true;
  }
  if (!isDreamOrGoalType(memoryPolicy.type) && !isCareerDreamText(text)) {
    return false;
  }
  const normalizedText = text.trim();
  if (isDreamFragmentText(normalizedText) || isDailyIdeaText(normalizedText) || parseRoutineGoalCandidate(normalizedText)) {
    return false;
  }
  return /가장\s*큰\s*목표|가장\s*중요한\s*꿈|대표\s*꿈|내\s*꿈|꿈이야|되는\s*게\s*꿈|장래희망|언젠가|장기적|진로|취직하고\s*싶|취업하고\s*싶|개발자가\s*되고|개발자로\s*취업|소방관이\s*되는|열고\s*싶/.test(normalizedText) &&
    (/되고\s*싶|되는\s*게\s*꿈|내\s*꿈|장래희망|취직하고\s*싶|취업하고\s*싶|열고\s*싶/.test(normalizedText) || isCareerDreamText(normalizedText));
}

export function isCareerDreamText(text: string) {
  return /파티시에|개발자|인공지능\s*개발자|ai\s*개발자|요리사|의사|디자이너|헤어\s*디자이너|소방관|간호사|선생님|교사|변호사|작가|뤼튼|미용실/.test(text) &&
    /되고\s*싶|되는\s*게\s*꿈|내\s*꿈|장래희망|언젠가|취직하고\s*싶|취업하고\s*싶|열고\s*싶/.test(text);
}

export function isLifeDirectionDreamText(text: string) {
  return (
    /되고\s*싶|되는\s*게\s*꿈|내\s*꿈|장래희망|언젠가|장기적인|만들고\s*싶|열고\s*싶|취직하고\s*싶|취업하고\s*싶|이루도록\s*돕/.test(text) &&
    (/파티시에|디자이너|개발자|의사|요리사|브랜드|AI|ai|인공지능|미용실|뤼튼|사람들의\s*감정|목표를\s*이루도록\s*돕|사람들에게\s*자신감을\s*주는/.test(text))
  );
}

export function makeDreamChoicePromptTitle(text: string) {
  return text
    .replace(/언젠가/g, "")
    .replace(/나는|내\s*꿈은|내\s*꿈|장래희망/g, "")
    .replace(/되고\s*싶어/g, "되고 싶은")
    .replace(/되는\s*게\s*내\s*꿈이야|되는\s*게\s*꿈이야|꿈이야/g, "되는")
    .replace(/\s+/g, " ")
    .trim() || "이";
}

export function isDailyIdeaText(text: string) {
  return (
    /아이디어.*생겼|아이디어가\s*떠올|추천\s*기능\s*아이디어|새로운.*아이디어/.test(text) &&
    !/만들고\s*싶|되고\s*싶|목표|꿈|장기/.test(text)
  );
}

export function isDreamFragmentText(text: string) {
  const normalizedText = text.trim().toLowerCase();
  return /noie|노이에|개인\s*ai|앱|출시|포트폴리오|기능|서비스|완성하고\s*싶|만들고\s*싶|고도화/.test(
    normalizedText
  );
}

export function isHiddenFromDream(item: DailyTraceItem) {
  if (item.hiddenFromDream) {
    return true;
  }

  const forbiddenTypes: MemorySavePolicyType[] = [
    "sensitive_event",
    "achievement",
    "relationship",
    "schedule",
    "todo",
    "task",
    "daily_plan",
    "daily_context",
    "none",
  ];

  return forbiddenTypes.includes(getMemoryPolicy(item).type);
}

export function sortDreamItemsByImportance(left: DailyTraceItem, right: DailyTraceItem) {
  const leftPolicy = getMemoryPolicy(left);
  const rightPolicy = getMemoryPolicy(right);
  const importanceDiff = rightPolicy.importance - leftPolicy.importance;

  if (importanceDiff !== 0) {
    return importanceDiff;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

export function getDreamFragments(items: DailyTraceItem[]) {
  const forbiddenTypes: MemorySavePolicyType[] = [
    "sensitive_event",
    "todo",
    "task",
    "schedule",
    "relationship",
    "achievement",
    "daily_context",
    "none",
  ];
  const fragmentItems = items.filter((item) => {
    if (isHiddenFromDream(item)) {
      return false;
    }

    const memoryPolicy = getMemoryPolicy(item);
    if (forbiddenTypes.includes(memoryPolicy.type)) {
      return false;
    }

    const isFragmentTarget =
      item.saveTargets?.includes("dream_fragment") ||
      memoryPolicy.saveTargets?.includes("dream_fragment");
    const isFragmentRole =
      item.dreamRole === "fragment" || memoryPolicy.dreamRole === "fragment";

    return memoryPolicy.type === "project" || isFragmentTarget || isFragmentRole;
  });

  return dedupeMemories(fragmentItems).sort(sortDreamItemsByImportance);
}
