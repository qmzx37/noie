import { getLocalDateString } from "./dateUtils";
import type { ChatMessage } from "./types";

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
