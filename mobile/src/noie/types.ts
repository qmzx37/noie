export type EmotionLevel = "Low" | "Mid" | "High";
export type AnalysisSource = "openai" | "rule_based";
export type ScreenMode =
  | "chat"
  | "dreamVault"
  | "flow"
  | "dailyTrace"
  | "project"
  | "projectCreate";
export type DailyTraceItemType = "schedule" | "record" | "todo" | "quote" | "goal";
export type DreamRole = "torch" | "fragment";
export type DreamProjectStatus = "idea" | "planning" | "in_progress" | "review" | "done";
export type DailyTraceStatus = "pending" | "added" | "dismissed" | "duplicate";
export type DreamSeasonStatus = "planned" | "active" | "completed" | "paused";
export type DreamMilestoneStatus = "not_started" | "in_progress" | "review" | "done";
export type DreamMilestonePriority = "high" | "medium" | "low";
export type DreamRoutineRecordType = "check" | "quantity" | "count" | "weekly";
export type DreamRoutineQuickScore = 0 | 0.5 | 1;
export type GoalDurationMonths = 3 | 6 | 12;

export type DreamSeason = {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  targetDate: string;
  durationMonths: number;
  status: DreamSeasonStatus;
  createdAt: string;
  updatedAt?: string;
};

export type DreamMilestone = {
  id: string;
  title: string;
  description?: string;
  weight: number;
  status: DreamMilestoneStatus;
  priority: DreamMilestonePriority;
  relatedProjectIds?: string[];
  evidenceIds?: string[];
  relatedSeasonId?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
};

export type DreamCompletionCriterion = {
  id: string;
  title: string;
  completed?: boolean;
  completedAt?: string;
  relatedMilestoneId?: string;
  evidenceIds?: string[];
};
export type DreamEvidence = {
  id: string;
  title: string;
  type: string;
  relatedProjectId?: string;
  relatedMilestoneId?: string;
  relatedSeasonId?: string;
  createdAt: string;
};

export type DreamRoutineDailySetting = {
  targetValue?: number;
  minimumValue?: number;
  unit?: string;
  updatedAt?: string;
};

export type DreamRoutineLifecycleStatus = "active" | "completed" | "archived";

export type DreamRoutine = {
  id: string;
  title: string;
  recordType: DreamRoutineRecordType;
  targetValue?: number;
  minimumValue?: number;
  unit?: string;
  repeatType?: "daily" | "weekly";
  weeklyTargetCount?: number;
  dailySettings?: Record<string, DreamRoutineDailySetting>;
  lifecycleStatus?: DreamRoutineLifecycleStatus;
  archivedFromTodayMe?: boolean;
  completedAt?: string | null;
  todayMeOrder?: number;
  relatedDreamFragmentId?: string;
  active?: boolean;
  relatedSeasonId?: string;
  pausedDates?: string[];
  createdAt: string;
  updatedAt?: string;
};

export type DreamRoutineRecord = {
  id: string;
  routineId: string;
  date: string;
  score: DreamRoutineQuickScore;
  value?: number;
  note?: string;
  createdAt: string;
  updatedAt?: string;
};

export type PrimaryAxis = {
  like: EmotionLevel;
  dislike: EmotionLevel;
};

export type EmotionAxis = {
  F: EmotionLevel;
  A: EmotionLevel;
  D: EmotionLevel;
  J: EmotionLevel;
  C: EmotionLevel;
  G: EmotionLevel;
  T: EmotionLevel;
  R: EmotionLevel;
};

export type EmotionKey = keyof EmotionAxis;
export type NumericEmotionAxis = Record<EmotionKey, number>;

export type SaveDecision = {
  memoryType: MemorySavePolicyType;
  savePolicy: "ask" | "auto" | "none";
  saveTargets: Array<"daily_piece" | "daily_trace" | "dream_piece" | "dream_torch" | "dream_fragment">;
  importance: number;
  displayCategory: string;
  reason: string;
  askText?: string | null;
  confidence?: number;
  intentCategory?:
    | "identity_goal"
    | "future_dream"
    | "action_todo"
    | "scheduled_event"
    | "completed_achievement"
    | "sensitive_negative_event"
    | "relationship_positive"
    | "daily_note"
    | "casual_none";
  eventTense?: "future" | "present" | "past" | "unknown";
  userActionRequired?: boolean;
  uiType?:
    | "dream_confirm"
    | "trace_confirm"
    | "sensitive_confirm"
    | "auto_saved"
    | "none";
  subjectScope?: "self" | "other_person" | "shared" | "unknown";
  selfRelevance?: "direct" | "indirect" | "none" | "explicit_store_request" | "unknown";
  shouldStore?: boolean;
};

export type AnalyzeEmotionResponse = {
  input: string;
  user_view: {
    primary_axis: PrimaryAxis;
    emotion_axis: EmotionAxis;
    state_summary: string;
  };
  admin_view: {
    primary_axis: { like: number; dislike: number };
    emotion_axis: NumericEmotionAxis;
  };
  source: AnalysisSource;
  save_decision?: SaveDecision;
  emotionOwner?: "user" | "other_person" | "unknown";
  analysisPerspective?:
    | "self_emotion"
    | "observed_other_info"
    | "shared_event"
    | "neutral_info";
  subjectScope?: "self" | "other_person" | "shared" | "unknown";
  selfRelevance?: "direct" | "indirect" | "none" | "explicit_store_request" | "unknown";
};

export type ChatApiResponse = {
  reply: string;
  state_summary: string;
  analysis: AnalyzeEmotionResponse;
  source: AnalysisSource;
};

export type GenerateTitleResponse = {
  title: string;
};

export type DailyTraceCandidate = {
  type: DailyTraceItemType;
  date: string;
  title: string;
  memo?: string;
  time?: string | null;
  targetDate?: string | null;
  targetYear?: string | null;
  targetText?: string | null;
};

export type ExtractDailyTraceResponse = {
  has_trace: boolean;
  type?: DailyTraceItemType | null;
  date?: string | null;
  time?: string | null;
  title?: string | null;
  memo?: string | null;
  targetDate?: string | null;
  targetYear?: string | null;
  targetText?: string | null;
};

export type DailyTraceItem = {
  id: string;
  type: DailyTraceItemType;
  date: string;
  title: string;
  memo?: string;
  time?: string;
  targetDate?: string;
  targetYear?: string;
  targetText?: string;
  sourceText?: string;
  text?: string;
  originalText?: string;
  sourceMessageId?: string;
  isDone?: boolean;
  memoryType?: MemorySavePolicyType;
  saveTargets?: SaveDecision["saveTargets"];
  importance?: number;
  displayCategory?: string;
  hiddenFromDream?: boolean;
  dreamRole?: DreamRole;
  pinnedAsDreamTorch?: boolean;
  relatedDreamTorchId?: string;
  linkedProjectId?: string;
  projectStatus?: DreamProjectStatus;
  nextAction?: string;
  progressPercent?: number;
  projectLinkNotice?: string;
  goalStartDate?: string;
  goalTargetDate?: string;
  goalDurationMonths?: number;
  completionCriteria?: Array<string | DreamCompletionCriterion>;
  currentSeason?: DreamSeason;
  seasons?: DreamSeason[];
  activeSeasonId?: string;
  milestones?: DreamMilestone[];
  currentMilestoneId?: string;
  evidence?: DreamEvidence[];
  routines?: DreamRoutine[];
  routineRecords?: DreamRoutineRecord[];
  overallProgress?: number;
  baseProgress?: number;
  paceBonus?: number;
  periodAdjustment?: number;
  progressUpdatedAt?: string;
  createdAt: string;
  updatedAt?: string;
};

export type NoieMemory = DailyTraceItem;

export type MemorySavePolicyType =
  | "sensitive_event"
  | "achievement"
  | "relationship"
  | "dream"
  | "goal"
  | "project"
  | "idea"
  | "schedule"
  | "todo"
  | "task"
  | "daily_plan"
  | "note"
  | "important_note"
  | "daily_context"
  | "none";

export type MemorySavePolicy = {
  type: MemorySavePolicyType;
  shouldSave: boolean;
  requiresConfirmation: boolean;
  importance: number;
  label: string;
  saveTargets?: SaveDecision["saveTargets"];
  dreamRole?: DreamRole;
};

export type DreamSavePromptKind = "torch_first" | "fragment_first";

export type EmotionSignals = Partial<Record<EmotionKey, EmotionLevel | number>>;

export type DailyPiece = DailyTraceItem & {
  memoryPolicy: MemorySavePolicy;
};

export type DailyPieceGroup = {
  date: string;
  label: string;
  pieces: DailyPiece[];
};

export type SaveNoieMemoryResult = {
  items: DailyTraceItem[];
  saved: boolean;
  duplicate: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reply?: string;
  stateSummary?: string;
  analysis?: AnalyzeEmotionResponse;
  isLoading?: boolean;
  error?: string;
  showAdminView?: boolean;
  showSaveDecisionView?: boolean;
  dailyTraceCandidate?: DailyTraceCandidate;
  dailyTraceStatus?: DailyTraceStatus;
  dailyTraceNotice?: string;
  dailyMemoryPolicy?: MemorySavePolicy;
  dreamSavePromptKind?: DreamSavePromptKind;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectEmotionAdminView = {
  like?: number;
  dislike?: number;
  F?: number;
  A?: number;
  D?: number;
  J?: number;
  C?: number;
  G?: number;
  T?: number;
  R?: number;
};

export type ProjectDailyActionRecord = {
  action: string;
  completed: boolean;
  source: "quick_check";
  createdAt: string;
  updatedAt?: string;
};

export type NoieProject = {
  id: string;
  title: string;
  goal: string;
  deadline?: string;
  description?: string;
  status?: DreamProjectStatus;
  sourceDreamFragmentId?: string;
  sourceMemoryId?: string;
  relatedDreamTorchId?: string;
  relatedDreamFragmentId?: string;
  fromDreamFragment?: boolean;
  nextAction?: string;
  dailyActionRecords?: Record<string, ProjectDailyActionRecord>;
  archivedFromTodayMe?: boolean;
  completedAt?: string | null;
  todayMeOrder?: number;
  pinnedToTodayMe?: boolean;
  originalText?: string;
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
};

export type NoieProjectMessage = {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  emotionAdminView?: ProjectEmotionAdminView;
  stateSummary?: string;
  source?: string;
  isLoading?: boolean;
  error?: string;
};

export type ProjectFormState = {
  title: string;
  goal: string;
  deadline: string;
};

export type StartProjectInput = {
  title: string;
  originalText?: string;
  relatedDreamTorchId?: string | null;
  relatedDreamFragmentId?: string | null;
  nextAction?: string;
  source: "direct" | "dream_fragment" | "recommendation" | "chat";
};

export type EmotionRecord = {
  id: string;
  sessionTitle: string;
  createdAt: string;
  timestamp: number;
  axis: NumericEmotionAxis;
};

export type WeeklyAverage = {
  key: EmotionKey;
  label: string;
  value: number;
};
