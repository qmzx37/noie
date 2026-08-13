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

function getMessageDateKey(createdAt: string) {
  const createdAtDate = new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    return "";
  }

  return getLocalDateString(createdAtDate);
}
