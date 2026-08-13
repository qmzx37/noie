import { getLocalDateString } from "./dateUtils";
import type { ChatMessage, DailyTraceItem } from "./types";

export type DailyPieceCandidateSourceType = "chat";

export type DailyPieceCandidate = {
  id: string;
  sourceType: DailyPieceCandidateSourceType;
  sourceId: string;
  text: string;
  createdAt: string;
  dateKey: string;
};

export type DailyPieceCandidateGroup = {
  id: string;
  candidates: DailyPieceCandidate[];
  representativeCandidateId: string;
};

export type DailyPieceMeaningSignals = {
  structuredRelevance: number;
  recurrence: number;
  specificity: number;
  emotionalWeight: number;
  lowContentPenalty: number;
};

export type ScoredDailyPieceCandidateGroup = {
  group: DailyPieceCandidateGroup;
  signals: DailyPieceMeaningSignals;
  score: number;
};

export type DailyPieceCandidateEmotionMetadata = {
  sourceId: string;
  intensity?: number;
  like?: number;
  dislike?: number;
  joy?: number;
  desire?: number;
  depression?: number;
  tension?: number;
};

export type ScoreDailyPieceCandidateGroupsOptions = {
  structuredRecords?: DailyTraceItem[];
  emotionMetadata?: DailyPieceCandidateEmotionMetadata[];
};

export function buildDailyPieceChatCandidates(
  messages: ChatMessage[],
  dateKey: string
): DailyPieceCandidate[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") {
      return [];
    }

    const text = message.text.trim();
    if (!text) {
      return [];
    }

    const messageDateKey = getMessageDateKey(message.createdAt);
    if (messageDateKey !== dateKey) {
      return [];
    }

    return [{
      id: `chat:${message.id}`,
      sourceType: "chat",
      sourceId: message.id,
      text,
      createdAt: message.createdAt,
      dateKey: messageDateKey,
    }];
  });
}

export function groupDailyPieceCandidates(
  candidates: DailyPieceCandidate[]
): DailyPieceCandidateGroup[] {
  const groups: DailyPieceCandidateGroup[] = [];

  candidates.forEach((candidate) => {
    const groupKey = getDailyPieceCandidateGroupKey(candidate);
    const existingGroup = groups.find((group) => group.id === groupKey);
    if (existingGroup) {
      const nextCandidates = [...existingGroup.candidates, candidate];
      existingGroup.candidates = nextCandidates;
      existingGroup.representativeCandidateId = selectRepresentativeDailyPieceCandidate(nextCandidates).id;
      return;
    }

    groups.push({
      id: groupKey,
      candidates: [candidate],
      representativeCandidateId: candidate.id,
    });
  });

  return groups;
}

export function scoreDailyPieceCandidateGroups(
  groups: DailyPieceCandidateGroup[],
  options: ScoreDailyPieceCandidateGroupsOptions = {}
): ScoredDailyPieceCandidateGroup[] {
  return groups.map((group) => scoreDailyPieceCandidateGroup(group, options));
}

export function scoreDailyPieceCandidateGroup(
  group: DailyPieceCandidateGroup,
  options: ScoreDailyPieceCandidateGroupsOptions = {}
): ScoredDailyPieceCandidateGroup {
  const signals: DailyPieceMeaningSignals = {
    structuredRelevance: calculateStructuredRelevanceSignal(
      group,
      options.structuredRecords ?? []
    ),
    recurrence: calculateRecurrenceSignal(group),
    specificity: calculateSpecificitySignal(group),
    emotionalWeight: calculateEmotionalWeightSignal(
      group,
      options.emotionMetadata ?? []
    ),
    lowContentPenalty: calculateLowContentPenalty(group),
  };

  return {
    group,
    signals,
    score: calculateDailyPieceMeaningScore(signals),
  };
}

function getMessageDateKey(createdAt: string) {
  const createdAtDate = new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    return "";
  }

  return getLocalDateString(createdAtDate);
}

function getDailyPieceCandidateGroupKey(candidate: DailyPieceCandidate) {
  const topicKey = normalizeDailyPieceCandidateTopic(candidate.text) || candidate.id;
  return `${candidate.dateKey}:${candidate.sourceType}:${topicKey}`;
}

function normalizeDailyPieceCandidateTopic(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\bnoie\b/g, "noie")
    .replace(/\uB178\uC774\uC5D0/g, "noie")
    .replace(/\uC624\uB298/g, " ")
    .replace(/\uD558\uACE0\s*\uC2F6\uC5B4(?:\uC694)?$/g, " ")
    .replace(/\uD558\uACE0\s*\uC2F6\uB2E4$/g, " ")
    .replace(/\uC2DC\uC791\uD588\uC5B4(?:\uC694)?$/g, "\uC2DC\uC791")
    .replace(/\uC644\uB8CC\uD588\uC5B4(?:\uC694)?$/g, "\uC644\uB8CC")
    .replace(/\uACE0\uCCE4\uC5B4(?:\uC694)?$/g, "\uC218\uC815")
    .replace(/\uC218\uC815\uD588\uC5B4(?:\uC694)?$/g, "\uC218\uC815")
    .replace(/\uD588\uC5B4(?:\uC694)?$/g, " ")
    .replace(/\uD588\uB2E4$/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .replace(/(?:\uC744|\uB97C|\uC774|\uAC00|\uC740|\uB294)$/g, "");
}

function selectRepresentativeDailyPieceCandidate(
  candidates: DailyPieceCandidate[]
) {
  return [...candidates].sort((left, right) => {
    const createdAtDiff = right.createdAt.localeCompare(left.createdAt);
    return createdAtDiff !== 0
      ? createdAtDiff
      : right.id.localeCompare(left.id);
  })[0];
}

const DAILY_PIECE_SIGNAL_WEIGHTS = {
  structuredRelevance: 34,
  recurrence: 16,
  specificity: 32,
  emotionalWeight: 14,
  lowContentPenalty: 24,
} as const;

function calculateDailyPieceMeaningScore(signals: DailyPieceMeaningSignals) {
  const positiveScore =
    signals.structuredRelevance * DAILY_PIECE_SIGNAL_WEIGHTS.structuredRelevance +
    signals.recurrence * DAILY_PIECE_SIGNAL_WEIGHTS.recurrence +
    signals.specificity * DAILY_PIECE_SIGNAL_WEIGHTS.specificity +
    signals.emotionalWeight * DAILY_PIECE_SIGNAL_WEIGHTS.emotionalWeight;
  const penalty =
    signals.lowContentPenalty * DAILY_PIECE_SIGNAL_WEIGHTS.lowContentPenalty;

  return clampScore(Math.round(positiveScore - penalty));
}

function calculateStructuredRelevanceSignal(
  group: DailyPieceCandidateGroup,
  structuredRecords: DailyTraceItem[]
) {
  const candidateIds = new Set(group.candidates.map((candidate) => candidate.sourceId));
  const candidateTextKeys = new Set(
    group.candidates
      .map((candidate) => normalizeSignalText(candidate.text))
      .filter(Boolean)
  );

  let strongestSignal = 0;

  structuredRecords.forEach((record) => {
    if (record.sourceMessageId && candidateIds.has(record.sourceMessageId)) {
      strongestSignal = Math.max(strongestSignal, 1);
      return;
    }

    const recordTextKeys = [
      record.originalText,
      record.sourceText,
      record.text,
      record.title,
      record.memo,
    ]
      .map((value) => normalizeSignalText(value ?? ""))
      .filter(Boolean);

    if (recordTextKeys.some((textKey) => candidateTextKeys.has(textKey))) {
      strongestSignal = Math.max(strongestSignal, 0.82);
    }
  });

  return strongestSignal;
}

function calculateRecurrenceSignal(group: DailyPieceCandidateGroup) {
  const uniqueTextCount = new Set(
    group.candidates
      .map((candidate) => normalizeSignalText(candidate.text))
      .filter(Boolean)
  ).size;
  const duplicateCount = Math.max(0, group.candidates.length - uniqueTextCount);

  if (uniqueTextCount <= 1) {
    return clampSignal(Math.min(0.2, duplicateCount * 0.03));
  }

  return clampSignal(
    Math.min(0.75, (uniqueTextCount - 1) * 0.25 + Math.min(duplicateCount, 2) * 0.04)
  );
}

function calculateSpecificitySignal(group: DailyPieceCandidateGroup) {
  const representative = selectRepresentativeDailyPieceCandidate(group.candidates);
  const compactText = normalizeSignalText(representative.text);
  const words = representative.text.trim().split(/\s+/).filter(Boolean);
  const uniqueCharCount = new Set(compactText.split("")).size;
  const hasNumber = /\d/.test(representative.text);
  const hasActionHint = /fix|test|build|start|done|complete|error|project|noie/i.test(
    representative.text
  );

  if (!compactText) {
    return 0;
  }

  const lengthSignal = Math.min(0.38, compactText.length / 70);
  const wordSignal = Math.min(0.24, Math.max(0, words.length - 1) * 0.06);
  const uniqueSignal = Math.min(0.22, uniqueCharCount / 55);
  const detailSignal = (hasNumber ? 0.06 : 0) + (hasActionHint ? 0.1 : 0);

  return clampSignal(lengthSignal + wordSignal + uniqueSignal + detailSignal);
}

function calculateEmotionalWeightSignal(
  group: DailyPieceCandidateGroup,
  emotionMetadata: DailyPieceCandidateEmotionMetadata[]
) {
  if (emotionMetadata.length === 0) {
    return 0;
  }

  const metadataBySourceId = new Map(
    emotionMetadata.map((metadata) => [metadata.sourceId, metadata])
  );

  return group.candidates.reduce((strongestSignal, candidate) => {
    const metadata = metadataBySourceId.get(candidate.sourceId);
    if (!metadata) {
      return strongestSignal;
    }

    const strongestValue = Math.max(
      metadata.intensity ?? 0,
      metadata.like ?? 0,
      metadata.dislike ?? 0,
      metadata.joy ?? 0,
      metadata.desire ?? 0,
      metadata.depression ?? 0,
      metadata.tension ?? 0
    );

    return Math.max(strongestSignal, normalizeEmotionValue(strongestValue));
  }, 0);
}

function calculateLowContentPenalty(group: DailyPieceCandidateGroup) {
  const representative = selectRepresentativeDailyPieceCandidate(group.candidates);
  const compactText = normalizeSignalText(representative.text);

  if (!compactText) {
    return 1;
  }

  if (/^(ㅋ+|ㅎ+|ㅠ+|ㅜ+|ha+|lol+)$/i.test(compactText)) {
    return 1;
  }

  const uniqueCharRatio = new Set(compactText.split("")).size / compactText.length;
  if (compactText.length <= 2) {
    return 0.85;
  }
  if (compactText.length <= 5 && uniqueCharRatio < 0.45) {
    return 0.75;
  }
  if (compactText.length <= 5) {
    return 0.45;
  }

  return uniqueCharRatio < 0.25 ? 0.5 : 0;
}

function normalizeSignalText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\bnoie\b/g, "noie")
    .replace(/\uB178\uC774\uC5D0/g, "noie")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeEmotionValue(value: number) {
  if (value <= 0) {
    return 0;
  }

  return clampSignal(value > 1 ? value / 100 : value);
}

function clampSignal(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}
