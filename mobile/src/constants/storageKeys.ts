import {
  CURRENT_CHAT_ID_STORAGE_KEY,
  DAILY_TRACES_STORAGE_KEY,
  DREAM_TORCH_ID_STORAGE_KEY,
  PROJECT_MESSAGES_STORAGE_KEY,
  PROJECTS_STORAGE_KEY,
  SESSIONS_STORAGE_KEY,
} from "../noie/constants";

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
