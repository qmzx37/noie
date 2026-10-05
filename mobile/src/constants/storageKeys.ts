import {
  CURRENT_CHAT_ID_STORAGE_KEY,
  DAILY_TRACES_STORAGE_KEY,
  DREAM_TORCH_ID_STORAGE_KEY,
  PROJECT_MESSAGES_STORAGE_KEY,
  PROJECTS_STORAGE_KEY,
  SESSIONS_STORAGE_KEY,
} from "../noie/constants";

// 인증 정보는 기존 NOIE 데이터 초기화 목록과 분리하여 관리합니다.
export const AUTH_SESSION_STORAGE_KEY = "noie_auth_session_v1";

export const STORAGE_KEYS = {
  sessions: SESSIONS_STORAGE_KEY,
  currentChatId: CURRENT_CHAT_ID_STORAGE_KEY,
  dailyTraces: DAILY_TRACES_STORAGE_KEY,
  dailyLongRecords: "noie_daily_long_records_v1",
  dreamTorchId: DREAM_TORCH_ID_STORAGE_KEY,
  projects: PROJECTS_STORAGE_KEY,
  projectMessages: PROJECT_MESSAGES_STORAGE_KEY,
} as const;

export const NOIE_STORAGE_KEYS = [
  STORAGE_KEYS.sessions,
  STORAGE_KEYS.currentChatId,
  STORAGE_KEYS.dailyTraces,
  STORAGE_KEYS.dailyLongRecords,
  STORAGE_KEYS.dreamTorchId,
  STORAGE_KEYS.projects,
  STORAGE_KEYS.projectMessages,
];
