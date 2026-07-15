import type { DailyTraceItemType, EmotionKey, PrimaryAxis } from "./types";

export const SESSIONS_STORAGE_KEY = "noie_chat_sessions_v1";
export const CURRENT_CHAT_ID_STORAGE_KEY = "noie_current_chat_id_v1";
export const DAILY_TRACES_STORAGE_KEY = "noie_daily_traces_v1";
export const DREAM_TORCH_ID_STORAGE_KEY = "noie_dream_torch_id_v1";
export const PROJECTS_STORAGE_KEY = "noie_projects_v1";
export const PROJECT_MESSAGES_STORAGE_KEY = "noie_project_messages_v1";
export const MAX_TODAY_ME_CARDS = 4;
export const MAX_TODAY_ME_RECOMMENDATIONS = 1;

export const EMOTION_LABELS: Record<EmotionKey, string> = {
  F: "공포",
  A: "분노",
  D: "우울",
  J: "기쁨",
  C: "호기심",
  G: "욕구",
  T: "긴장",
  R: "안정",
};

export const EMOTION_COLORS: Record<EmotionKey, string> = {
  F: "#f97316",
  A: "#ef4444",
  D: "#60a5fa",
  J: "#facc15",
  C: "#22d3ee",
  G: "#a78bfa",
  T: "#fb7185",
  R: "#34d399",
};

export const TRACE_TYPE_LABELS: Record<DailyTraceItemType, string> = {
  schedule: "일정",
  record: "오늘의 기록",
  todo: "할 일",
  quote: "남긴 말",
  goal: "장기 목표",
};

export const TRACE_CONFIRM_LABELS: Record<DailyTraceItemType, string> = {
  schedule: "일정 추가",
  record: "기록 추가",
  todo: "할 일 추가",
  quote: "남긴 말 추가",
  goal: "목표 추가",
};

export const TRACE_QUESTION_LABELS: Record<DailyTraceItemType, string> = {
  schedule: "일정으로 추가할까요?",
  record: "오늘의 기록으로 남길까요?",
  todo: "할 일로 추가할까요?",
  quote: "남긴 말로 저장할까요?",
  goal: "장기 목표로 남길까요?",
};

export const EMOTION_KEYS: EmotionKey[] = ["F", "A", "D", "J", "C", "G", "T", "R"];
export const DEFAULT_FLOW_KEYS: EmotionKey[] = ["D", "T", "R"];
export const MAX_FLOW_KEYS = 4;

export const primaryLabels: Array<{ key: keyof PrimaryAxis; label: string }> = [
  { key: "like", label: "호감 like" },
  { key: "dislike", label: "불호 dislike" },
];

export const emotionLabels: Array<{ key: EmotionKey; label: string }> = EMOTION_KEYS.map(
  (key) => ({ key, label: `${key} ${EMOTION_LABELS[key]}` })
);
