import { getLocalDateString } from "../../noie/dateUtils";
import {
  buildDailyPieceChatCandidates,
  groupDailyPieceCandidates,
  scoreDailyPieceCandidateGroups,
} from "../../noie/dailyPieceCandidateLogic";
import {
  dedupeMemories,
  getMemoryPolicy,
  normalizeMemoryInput,
  shouldSaveToDailyPieces,
} from "../../noie/memoryLogic";
import type {
  ChatMessage,
  DailyPiece,
  DailyPieceGroup,
  DailyTraceItem,
  MemorySavePolicy,
} from "../../noie/types";
import type {
  DailyPieceCandidate,
  ScoredDailyPieceCandidateGroup,
} from "../../noie/dailyPieceCandidateLogic";

export function normalizeDreamFragmentKey(text: string) {
  return normalizeMemoryInput(text)
    .replace(/노이에/g, "noie")
    .replace(/noie를/g, "noie")
    .replace(/noie을/g, "noie")
    .replace(/noie/g, "noie")
    .replace(/완성하고\s*싶/g, "완성")
    .replace(/완성하고싶/g, "완성")
    .replace(/만들고\s*싶/g, "만들기")
    .replace(/되고\s*싶/g, "되기")
    .replace(/\s+/g, "")
    .trim();
}

export function getRecentDailyPieces(
  items: DailyTraceItem[],
  chatMessages: ChatMessage[] = []
): DailyPieceGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayGroups = ["오늘", "어제", "그제"].map((label, index) => {
    const date = new Date(todayStart);
    date.setDate(todayStart.getDate() - index);

    return {
      date: getLocalDateString(date),
      label,
      pieces: [] as DailyPiece[],
    };
  });
  const piecesByDate = new Map<string, DailyPieceGroup>(
    dayGroups.map((group) => [group.date, group])
  );

  items.forEach((item) => {
    const targetDateKey = getDailyPieceEventDateKey(item);
    if (!targetDateKey) {
      return;
    }

    const targetGroup = piecesByDate.get(targetDateKey);
    if (!targetGroup) {
      return;
    }

    const memoryPolicy = getMemoryPolicy(item);

    if (!shouldSaveToDailyPieces(memoryPolicy) && !isDreamDayPiece(item)) {
      return;
    }

    const dailyPiece: DailyPiece = {
      ...item,
      memoryPolicy,
    };
    targetGroup.pieces.push(dailyPiece);
  });

  return dayGroups.map((group) => {
    const uniquePieces = removeDuplicateDailyPieces(group.pieces);
    const chatCandidates = buildDailyPieceChatCandidates(chatMessages, group.date);
    const topPieces = selectDailyPiecesForDisplay(uniquePieces, chatCandidates);

    console.log("하루의 조각 TOP3:", group.label, topPieces);

    return {
      ...group,
      pieces: topPieces,
    };
  });
}

export function sortDailyPiecesByImportance(left: DailyPiece, right: DailyPiece) {
  const leftImportantEvent = left.memoryPolicy.type === "important_note";
  const rightImportantEvent = right.memoryPolicy.type === "important_note";
  if (leftImportantEvent !== rightImportantEvent) {
    return leftImportantEvent ? -1 : 1;
  }

  const importanceDiff =
    right.memoryPolicy.importance - left.memoryPolicy.importance;
  if (importanceDiff !== 0) {
    return importanceDiff;
  }

  return right.createdAt.localeCompare(left.createdAt);
}

export function getDailyPieceEventDateKey(item: DailyTraceItem) {
  const timestamp = isDreamDayPiece(item)
    ? item.progressUpdatedAt || item.updatedAt || item.createdAt
    : item.createdAt;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return getLocalDateString(date);
}

export function isDreamDayPiece(item: DailyPiece | DailyTraceItem) {
  return isDreamTorchDayPiece(item) || isDreamFragmentDayPiece(item);
}

export function isDreamTorchDayPiece(item: DailyPiece | DailyTraceItem) {
  const memoryPolicy = getMemoryPolicy(item);
  return (
    item.pinnedAsDreamTorch === true ||
    item.dreamRole === "torch" ||
    item.saveTargets?.includes("dream_torch") ||
    memoryPolicy.saveTargets?.includes("dream_torch")
  );
}

export function isDreamFragmentDayPiece(item: DailyPiece | DailyTraceItem) {
  const memoryPolicy = getMemoryPolicy(item);
  return (
    item.dreamRole === "fragment" ||
    item.saveTargets?.includes("dream_fragment") ||
    memoryPolicy.saveTargets?.includes("dream_fragment") ||
    Boolean((item as DailyTraceItem).linkedProjectId && item.memoryType === "project")
  );
}

export function isImportantDayEventPiece(item: DailyPiece | DailyTraceItem) {
  const typedItem = item as DailyTraceItem & { category?: string; priorityType?: string };
  return (
    typedItem.category === "important_day_event" ||
    typedItem.priorityType === "top_two" ||
    getMemoryPolicy(item).type === "important_note"
  );
}

export function selectDailyPieceTop3(pieces: DailyPiece[]) {
  return selectTopDayPiecesForDate(dedupeDayPiecesForDisplay(pieces));
}

const DAILY_PIECE_DISPLAY_LIMIT = 3;
const DAILY_PIECE_MINIMUM_MEANING_SCORE = 6;

type DailyPieceDisplayCandidate = {
  candidate: DailyPieceCandidate;
  piece: DailyPiece;
};

export function selectDailyPiecesForDisplay(
  pieces: DailyPiece[],
  chatCandidates: DailyPieceCandidate[] = []
) {
  const structuredCandidates = buildStructuredDailyPieceCandidates(pieces);
  const displayCandidates = [...structuredCandidates];
  const displayCandidateById = new Map(
    displayCandidates.map((item) => [item.candidate.id, item])
  );

  chatCandidates.forEach((candidate) => {
    const piece = buildChatDailyPieceDisplayItem(candidate);
    const displayCandidate = { candidate, piece };
    displayCandidates.push(displayCandidate);
    displayCandidateById.set(candidate.id, displayCandidate);
  });

  const groups = groupDailyPieceCandidates(
    displayCandidates.map((item) => item.candidate)
  );
  const scoredGroups = scoreDailyPieceCandidateGroups(groups, {
    structuredRecords: pieces,
  });

  return selectDiverseDailyPieceGroups(scoredGroups, displayCandidateById);
}

function selectDiverseDailyPieceGroups(
  scoredGroups: ScoredDailyPieceCandidateGroup[],
  displayCandidateById: Map<string, DailyPieceDisplayCandidate>
) {
  const sortedGroups = [...scoredGroups].sort(compareScoredDailyPieceGroups);
  const selectedPieces: DailyPiece[] = [];
  const selectedKeys = new Set<string>();

  for (const scoredGroup of sortedGroups) {
    if (selectedPieces.length >= DAILY_PIECE_DISPLAY_LIMIT) {
      break;
    }
    if (scoredGroup.score < DAILY_PIECE_MINIMUM_MEANING_SCORE) {
      continue;
    }

    const candidate = getRepresentativeCandidate(scoredGroup);
    if (!candidate) {
      continue;
    }

    const duplicateKeys = getDailyPieceSelectionKeys(scoredGroup);
    if (duplicateKeys.some((key) => selectedKeys.has(key))) {
      continue;
    }

    const displayCandidate = displayCandidateById.get(candidate.id);
    if (!displayCandidate) {
      continue;
    }

    selectedPieces.push(
      getPreferredDailyPieceDisplayCandidate(displayCandidate, displayCandidateById).piece
    );
    duplicateKeys.forEach((key) => selectedKeys.add(key));
  }

  return selectedPieces;
}

function getPreferredDailyPieceDisplayCandidate(
  displayCandidate: DailyPieceDisplayCandidate,
  displayCandidateById: Map<string, DailyPieceDisplayCandidate>
) {
  if (displayCandidate.candidate.sourceType === "structured") {
    return displayCandidate;
  }

  const structuredCandidate = Array.from(displayCandidateById.values()).find(
    (item) =>
      item.candidate.sourceType === "structured" &&
      item.candidate.sourceId === displayCandidate.candidate.sourceId
  );

  return structuredCandidate ?? displayCandidate;
}

function buildStructuredDailyPieceCandidates(pieces: DailyPiece[]): DailyPieceDisplayCandidate[] {
  return pieces.map((piece) => {
    const text = getDayPieceText(piece) || piece.title;
    const candidate: DailyPieceCandidate = {
      id: `structured:${piece.id}`,
      sourceType: "structured",
      sourceId: piece.sourceMessageId ?? piece.id,
      text,
      createdAt: piece.createdAt,
      dateKey: piece.date,
    };

    return { candidate, piece };
  });
}

function buildChatDailyPieceDisplayItem(candidate: DailyPieceCandidate): DailyPiece {
  const memoryPolicy: MemorySavePolicy = {
    type: "daily_context",
    shouldSave: true,
    requiresConfirmation: false,
    importance: 0,
    label: "chat",
    saveTargets: ["daily_piece"],
  };

  return {
    id: candidate.id,
    type: "record",
    date: candidate.dateKey,
    title: candidate.text,
    text: candidate.text,
    originalText: candidate.text,
    sourceText: candidate.text,
    sourceMessageId: candidate.sourceId,
    memoryType: memoryPolicy.type,
    saveTargets: memoryPolicy.saveTargets,
    importance: memoryPolicy.importance,
    createdAt: candidate.createdAt,
    memoryPolicy,
  };
}

function compareScoredDailyPieceGroups(
  left: ScoredDailyPieceCandidateGroup,
  right: ScoredDailyPieceCandidateGroup
) {
  const scoreDiff = right.score - left.score;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const leftCandidate = getRepresentativeCandidate(left);
  const rightCandidate = getRepresentativeCandidate(right);
  const createdAtDiff =
    (rightCandidate?.createdAt ?? "").localeCompare(leftCandidate?.createdAt ?? "");
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return right.group.id.localeCompare(left.group.id);
}

function getRepresentativeCandidate(scoredGroup: ScoredDailyPieceCandidateGroup) {
  return (
    scoredGroup.group.candidates.find(
      (candidate) => candidate.id === scoredGroup.group.representativeCandidateId
    ) ?? scoredGroup.group.candidates[0]
  );
}

function getDailyPieceSelectionKeys(scoredGroup: ScoredDailyPieceCandidateGroup) {
  const keys = new Set<string>();

  scoredGroup.group.candidates.forEach((candidate) => {
    keys.add(`source:${candidate.sourceId}`);
    const textKey = normalizeDailyPieceSelectionText(candidate.text);
    if (textKey) {
      keys.add(`text:${candidate.dateKey}:${textKey}`);
      getDailyPieceBroadTopicKeys(candidate.dateKey, textKey).forEach((key) => {
        keys.add(key);
      });
    }
  });

  return Array.from(keys);
}

function getDailyPieceBroadTopicKeys(dateKey: string, textKey: string) {
  const keys: string[] = [];

  if (textKey.includes("noie")) {
    keys.push(`topic:${dateKey}:noie`);
  }

  return keys;
}

function normalizeDailyPieceSelectionText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\bnoie\b/g, "noie")
    .replace(/\uB178\uC774\uC5D0/g, "noie")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function selectTopDayPiecesForDate(pieces: DailyPiece[]) {
  const sortedPieces = [...pieces].sort(sortDailyPiecesByImportance);
  const dreamPieces = sortedPieces.filter(isDreamDayPiece);
  const normalPieces = sortedPieces.filter(
    (piece) =>
      !isDreamDayPiece(piece) &&
      isDailyLifeActionOrEventPiece(piece)
  );
  const selectedPieces: DailyPiece[] = [];

  for (const dreamPiece of dreamPieces) {
    if (selectedPieces.length >= 2) {
      break;
    }
    selectedPieces.push(dreamPiece);
  }

  if (normalPieces[0] && selectedPieces.length < 3) {
    selectedPieces.push(normalPieces[0]);
  }

  for (const piece of normalPieces.slice(1)) {
    if (selectedPieces.length >= 3) {
      break;
    }
    if (!selectedPieces.some((selected) => selected.id === piece.id)) {
      selectedPieces.push(piece);
    }
  }

  if (selectedPieces.length < 3) {
    const selectedIds = new Set(selectedPieces.map((piece) => piece.id));
    const fallbackPieces = sortedPieces.filter(
      (piece) => !selectedIds.has(piece.id) && !isDreamDayPiece(piece)
    );

    selectedPieces.push(...fallbackPieces.slice(0, 3 - selectedPieces.length));
  }

  return selectedPieces.slice(0, 3);
}

export function isDailyLifeActionOrEventPiece(piece: DailyPiece) {
  const type = piece.memoryPolicy.type;
  return (
    type === "achievement" ||
    type === "important_note" ||
    type === "relationship" ||
    type === "idea" ||
    type === "note" ||
    type === "daily_context" ||
    type === "sensitive_event" ||
    isImportantDayEventPiece(piece)
  );
}

export function dedupeDayPiecesForDisplay(pieces: DailyPiece[]) {
  const pieceMap = new Map<string, DailyPiece>();

  pieces.forEach((piece) => {
    const key = getDayPieceDisplayKey(piece);
    if (!key) {
      pieceMap.set(piece.id, piece);
      return;
    }
    const existingPiece = pieceMap.get(key);
    if (!existingPiece || compareDayPieceForDisplay(piece, existingPiece) < 0) {
      pieceMap.set(key, piece);
    }
  });

  return Array.from(pieceMap.values());
}

export function getDayPieceDisplayKey(piece: DailyPiece) {
  const typedPiece = piece as DailyTraceItem & {
    sourceId?: string;
    sourceType?: string;
    routineId?: string;
    projectId?: string;
    action?: string;
    milestoneId?: string;
  };
  if (typedPiece.sourceId) {
    return `source:${typedPiece.sourceId}`;
  }
  if (typedPiece.routineId) {
    return `routine:${typedPiece.routineId}:${piece.date}`;
  }
  if (typedPiece.projectId && (typedPiece.action || typedPiece.milestoneId)) {
    return `project:${typedPiece.projectId}:${normalizeDayPieceText(typedPiece.action ?? typedPiece.milestoneId ?? "")}`;
  }
  const textKey = normalizeDayPieceText(getDayPieceText(piece));
  if (!textKey) {
    return "";
  }
  if (isDreamFragmentDayPiece(piece)) {
    return `dream:${normalizeDreamFragmentKey(textKey)}`;
  }
  if (isDreamTorchDayPiece(piece)) {
    return `dream_torch:${normalizeDreamFragmentKey(textKey)}`;
  }
  return `${piece.date}:${piece.memoryPolicy.type}:${textKey}`;
}

export function getDayPieceText(piece: DailyPiece) {
  if (isDreamTorchDayPiece(piece)) {
    return summarizeDreamTorchDailyPiece(piece);
  }
  if (isDreamFragmentDayPiece(piece)) {
    return summarizeDreamFragmentDailyPiece(piece);
  }
  return getMeaningfulDailyPieceText(piece) || "";
}

export function summarizeDreamTorchDailyPiece(piece: DailyPiece) {
  return summarizeDreamSubject(piece);
}

export function summarizeDreamFragmentDailyPiece(piece: DailyPiece) {
  return summarizeDreamSubject(piece);
}

export function summarizeDreamSubject(item: DailyTraceItem) {
  const rawText = getMeaningfulDailyPieceText(item) || item.title;
  return rawText
    .replace(/^나는\s*/g, "")
    .replace(/^내\s*꿈은\s*/g, "")
    .replace(/^내\s*목표는\s*/g, "")
    .replace(/꿈의\s*파편으로\s*남김$/g, "")
    .replace(/꿈을\s*횃불로\s*정함$/g, "")
    .replace(/장기\s*목표로\s*저장$/g, "")
    .replace(/완료한\s*행동$/g, "")
    .replace(/입니다$/g, "")
    .replace(/이에요$/g, "")
    .replace(/예요$/g, "")
    .replace(/따고\s*싶어$/g, "따기")
    .replace(/취득하고\s*싶어$/g, "취득하기")
    .replace(/하고\s*싶어$/g, "하기")
    .replace(/만들고\s*싶어$/g, "만들기")
    .replace(/되고\s*싶어$/g, "되기")
    .replace(/되는\s*게\s*꿈이야$/g, "되기")
    .replace(/되는\s*게\s*목표야$/g, "되기")
    .replace(/가\s*되기$/g, "되기")
    .replace(/\s+/g, " ")
    .trim();
}

export function getMeaningfulDailyPieceText(item: DailyTraceItem & { normalizedText?: string; content?: string }) {
  const candidates = [
    item.title,
    item.originalText,
    item.text,
    item.sourceText,
    item.content,
    item.memo,
    item.normalizedText,
  ];
  const selected = candidates.find((value) => isMeaningfulDailyPieceDisplayText(value));
  if (!selected) {
    return "";
  }
  return cleanDailyPieceDisplayText(selected);
}

export function isMeaningfulDailyPieceDisplayText(value?: string | null) {
  if (!value) {
    return false;
  }
  const normalizedValue = normalizeDayPieceText(value);
  if (!normalizedValue) {
    return false;
  }
  return !isGenericDailyPieceLabel(normalizedValue);
}

export function isGenericDailyPieceLabel(normalizedText: string) {
  return [
    "완료한 행동",
    "오늘의 중요한 사건",
    "중요한 사건",
    "장기 목표",
    "목표",
    "아이디어",
    "프로젝트",
    "프로젝트 완료",
    "반복 목표",
    "오늘의 기록",
    "행동 완료",
    "기록",
  ].some((label) => normalizeDayPieceText(label) === normalizedText);
}

export function cleanDailyPieceDisplayText(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/을\s*했어$/, "을 진행함")
    .replace(/를\s*했어$/, "를 진행함")
    .replace(/했어$/, "진행함")
    .replace(/을\s*끝냈어$/, " 완료")
    .replace(/를\s*끝냈어$/, " 완료")
    .replace(/끝냈어$/, "완료")
    .replace(/완료했어$/, "완료");
}

export function normalizeDayPieceText(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .toLowerCase();
}

export function compareDayPieceForDisplay(left: DailyPiece, right: DailyPiece) {
  return sortDailyPiecesByImportance(left, right);
}

export function removeDuplicateDailyPieces(pieces: DailyPiece[]) {
  const pieceMap = new Map(pieces.map((piece) => [piece.id, piece]));

  const dedupedByMemory = dedupeMemories(pieces).map((memory) => {
    const existingPiece = pieceMap.get(memory.id);
    if (existingPiece) {
      return existingPiece;
    }

    return {
      ...memory,
      memoryPolicy: getMemoryPolicy(memory),
    };
  });

  return dedupeDayPiecesForDisplay(dedupedByMemory)
    .filter((piece) => Boolean(getDayPieceText(piece)));
}

export function getDailyPieceCategory(item: DailyTraceItem) {
  const text = `${item.title} ${item.memo ?? ""}`;

  if (item.type === "goal") return "목표";
  if (item.type === "todo") return "할 일";
  if (item.type === "quote") return "문장";
  if (/친구|사람|관계|만남|연락|가족|동료/.test(text)) return "관계";
  if (/개발|완성|시작|저장|확인|성공|공부|포트폴리오|프로젝트/.test(text)) {
    return "성과";
  }
  if (/꿈|놀랐|무서|병원|예비군|훈련|학교|출근|약속/.test(text)) return "사건";

  return item.type === "schedule" ? "사건" : "기록";
}
