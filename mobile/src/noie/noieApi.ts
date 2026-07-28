import { API_BASE_URL } from "../constants/appConstants";
import type {
  ChatApiResponse,
  ExtractDailyTraceResponse,
  GenerateTitleResponse,
} from "./types";

export type NoieChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function requestChatReply(
  text: string,
  messages: NoieChatHistoryMessage[]
) {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`API 응답 오류: ${response.status}`);
  }

  return (await response.json()) as ChatApiResponse;
}

export async function requestProjectChatReply({
  text,
  messages,
  projectName,
  projectGoal,
}: {
  text: string;
  messages: NoieChatHistoryMessage[];
  projectName: string;
  projectGoal: string;
}) {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      messages,
      is_project: true,
      project_name: projectName,
      project_goal: projectGoal,
    }),
  });

  if (!response.ok) {
    throw new Error(`프로젝트 API 응답 오류: ${response.status}`);
  }

  return (await response.json()) as ChatApiResponse;
}

export async function extractDailyTraceCandidate(
  text: string,
  currentDate: string
) {
  const response = await fetch(`${API_BASE_URL}/extract-daily-trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      current_date: currentDate,
    }),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as ExtractDailyTraceResponse;
}

export async function generateTitle(text: string) {
  const response = await fetch(`${API_BASE_URL}/generate-title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`제목 API 응답 오류: ${response.status}`);
  }

  return (await response.json()) as GenerateTitleResponse;
}
