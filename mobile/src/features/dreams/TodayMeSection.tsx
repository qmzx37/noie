import React, { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { MAX_TODAY_ME_CARDS } from "../../noie/constants";
import type { DailyTraceItem, DreamRoutine, DreamRoutineRecord, DreamSeason, NoieProject } from "../../noie/types";

export type TodayMeCard =
  | { cardType: "routine"; id: string; routine: DreamRoutine }
  | { cardType: "project"; id: string; project: NoieProject };

export type TodayMeRecommendation = {
  type: "routine" | "project";
  title: string;
  reason: string;
  sourceDreamFragmentId?: string;
  semanticKey: string;
};

export type TodayMeSectionProps = {
  todayKey: string;
  getActiveDreamSeason: (piece: DailyTraceItem) => DreamSeason | undefined;
  getActiveDreamRoutines: (piece: DailyTraceItem, activeSeason?: DreamSeason) => DreamRoutine[];
  getVisibleTodayMeCards: (torchPiece: DailyTraceItem | undefined, dreamFragments: DailyTraceItem[], projects: NoieProject[], todayKey: string) => TodayMeCard[];
  selectTodayMeRecommendation: (torchPiece: DailyTraceItem | undefined, dreamFragments: DailyTraceItem[], projects: NoieProject[], activeCards: TodayMeCard[], dismissedKeys: string[]) => TodayMeRecommendation | undefined;
  isRoutineActionDoneToday: (record?: DreamRoutineRecord) => boolean;
  getTodayRoutineRecord: (piece: DailyTraceItem | undefined, routine: DreamRoutine) => DreamRoutineRecord | undefined;
  isProjectActionDone: (project: NoieProject, dateKey: string) => boolean;
  getTodayMeFeedback: (routineCount: number, completedRoutineCount: number, partialRoutineCount: number, projectCount: number, completedProjectActionCount: number) => string;
  getEffectiveRoutineTargetValue: (routine: DreamRoutine, dateKey: string) => number;
  formatRoutineTarget: (value: number, unit?: string) => string;
  torchPiece?: DailyTraceItem;
  projects: NoieProject[];
  dreamFragments: DailyTraceItem[];
  onAdjustRoutineTodayTarget: (itemId: string, routineId: string, delta: number) => void;
  onAddRoutineToTodayMe: (input: { title: string; targetValue: number }) => Promise<boolean>;
  onRemoveRoutineFromTodayMe: (itemId: string, routineId: string) => void;
  externalFeedback: string;
  isStartingProject: boolean;
};

type TodayMeDeleteTarget =
  | { type: "routine"; itemId: string; id: string; title: string };

export function TodayMeSection({
  torchPiece,
  projects,
  dreamFragments,
  onAdjustRoutineTodayTarget,
  onAddRoutineToTodayMe,
  onRemoveRoutineFromTodayMe,
  externalFeedback,
  isStartingProject,
  todayKey,
  getActiveDreamSeason,
  getActiveDreamRoutines,
  getVisibleTodayMeCards,
  selectTodayMeRecommendation,
  isRoutineActionDoneToday,
  getTodayRoutineRecord,
  isProjectActionDone,
  getTodayMeFeedback,
  getEffectiveRoutineTargetValue,
  formatRoutineTarget,
}: TodayMeSectionProps) {
  const [dismissedRecommendationKeys, setDismissedRecommendationKeys] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<TodayMeDeleteTarget | null>(null);
  const [isRoutineAddOpen, setIsRoutineAddOpen] = useState(false);
  const [routineAddTitle, setRoutineAddTitle] = useState("");
  const [routineAddMinutes, setRoutineAddMinutes] = useState(30);
  const activeSeason = torchPiece ? getActiveDreamSeason(torchPiece) : undefined;
  const routines = torchPiece ? getActiveDreamRoutines(torchPiece, activeSeason) : [];
  const visibleCards = getVisibleTodayMeCards(torchPiece, dreamFragments, projects, todayKey);
  const visibleRoutineCards = visibleCards.filter((card): card is Extract<TodayMeCard, { cardType: "routine" }> => card.cardType === "routine");
  const recommendation = visibleRoutineCards.length < MAX_TODAY_ME_CARDS
    ? selectTodayMeRecommendation(torchPiece, dreamFragments, projects, visibleRoutineCards, dismissedRecommendationKeys)
    : undefined;
  const routineRecommendation = recommendation?.type === "routine" ? recommendation : undefined;
  const completedRoutineCount = routines.filter((routine) => isRoutineActionDoneToday(getTodayRoutineRecord(torchPiece, routine))).length;
  const partialRoutineCount = routines.filter((routine) => {
    const record = getTodayRoutineRecord(torchPiece, routine);
    return Boolean(record && !isRoutineActionDoneToday(record) && record.score > 0);
  }).length;
  const completedProjectActionCount = projects.filter((project) => isProjectActionDone(project, todayKey)).length;
  const feedback = getTodayMeFeedback(routines.length, completedRoutineCount, partialRoutineCount, projects.length, completedProjectActionCount);

  const confirmDeleteTarget = () => {
    if (!deleteTarget) {
      return;
    }
    onRemoveRoutineFromTodayMe(deleteTarget.itemId, deleteTarget.id);
    setDeleteTarget(null);
  };

  const saveRoutineAdd = async () => {
    const saved = await onAddRoutineToTodayMe({
      title: routineAddTitle,
      targetValue: routineAddMinutes,
    });
    if (saved) {
      setRoutineAddTitle("");
      setRoutineAddMinutes(30);
      setIsRoutineAddOpen(false);
    }
  };

  const openRoutineRecommendation = (recommendation: TodayMeRecommendation) => {
    setRoutineAddTitle(recommendation.title);
    setRoutineAddMinutes(30);
    setIsRoutineAddOpen(true);
  };

  console.log("[today-me-cards]", { activeCount: visibleRoutineCards.length });
  console.log("[today-me-recommendation]", { hasRecommendation: Boolean(recommendation), type: recommendation?.type });

  return (
    <View style={styles.flowCard}>
      <View style={styles.todayMeHeaderRow}>
        <View style={styles.todayMeHeaderText}>
          <Text style={styles.flowCardTitle}>오늘의 나</Text>
          <Text style={styles.todayMeSubtitle}>오늘 이어갈 반복 목표 {visibleRoutineCards.length}개</Text>
        </View>
        <TouchableOpacity
          style={[styles.todayMeAddButton, visibleRoutineCards.length >= MAX_TODAY_ME_CARDS && styles.todayMeButtonDone]}
          disabled={visibleRoutineCards.length >= MAX_TODAY_ME_CARDS}
          onPress={() => setIsRoutineAddOpen((value) => !value)}
          activeOpacity={0.85}
        >
          <Text style={styles.todayMeAddButtonText}>＋</Text>
        </TouchableOpacity>
      </View>
      {visibleRoutineCards.length >= MAX_TODAY_ME_CARDS ? (
        <Text style={styles.todayMeEmptyLine}>오늘의 나는 네 가지에만 집중할 수 있어요.</Text>
      ) : null}

      {isRoutineAddOpen && visibleRoutineCards.length < MAX_TODAY_ME_CARDS ? (
        <View style={styles.todayMeDetailBox}>
          <Text style={styles.todayMeTypeLabel}>반복 목표 추가</Text>
          <TextInput
            style={styles.todayMeInput}
            value={routineAddTitle}
            onChangeText={setRoutineAddTitle}
            placeholder="반복 목표 이름"
            placeholderTextColor="#777"
          />
          <Text style={styles.todayMeMeta}>목표 시간</Text>
          <View style={styles.todayMeTimeAdjustRow}>
            <TouchableOpacity
              style={styles.todayMeArrowButton}
              onPress={() => setRoutineAddMinutes((value) => Math.max(30, value - 30))}
              disabled={routineAddMinutes <= 30}
              activeOpacity={0.85}
            >
              <Text style={styles.todayMeArrowButtonText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.todayMeTargetTimeText}>{formatRoutineTarget(routineAddMinutes, "분")}</Text>
            <TouchableOpacity
              style={styles.todayMeArrowButton}
              onPress={() => setRoutineAddMinutes((value) => value + 30)}
              activeOpacity={0.85}
            >
              <Text style={styles.todayMeArrowButtonText}>›</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.todayMeButton, !routineAddTitle.trim() && styles.todayMeButtonDone]}
            onPress={() => {
              void saveRoutineAdd();
            }}
            disabled={!routineAddTitle.trim()}
            activeOpacity={0.85}
          >
            <Text style={styles.todayMeButtonText}>저장</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {visibleRoutineCards.length === 0 ? (
        <View style={styles.flowEmptyBox}>
          <Text style={styles.flowEmptyText}>아직 오늘 이어갈 반복 목표가 없어요.</Text>
        </View>
      ) : (
        <View style={styles.todayMeGroup}>
          {visibleRoutineCards.map((card) => {
              const routine = card.routine;
              const record = getTodayRoutineRecord(torchPiece, routine);
              const isDone = isRoutineActionDoneToday(record);
              const effectiveTarget = getEffectiveRoutineTargetValue(routine, todayKey);
              const displayedTarget = Math.max(30, effectiveTarget || 30);
              const unit = routine.unit ?? "";
              const isDeleteConfirmOpen = deleteTarget?.type === "routine" && deleteTarget.id === routine.id;
              return (
                <View key={card.id} style={styles.todayMeItem}>
                  <View style={styles.todayMeCardHeader}>
                    <Text style={styles.todayMeTitle}>{routine.title}</Text>
                    <TouchableOpacity
                      style={styles.todayMeMoreButton}
                      onPress={() => torchPiece && setDeleteTarget({ type: "routine", itemId: torchPiece.id, id: routine.id, title: routine.title })}
                      disabled={!torchPiece}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.todayMeMoreButtonText}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.todayMeItemMain}>
                    <Text style={styles.todayMeMeta}>오늘 목표</Text>
                    <View style={styles.todayMeTimeAdjustRow}>
                      <TouchableOpacity
                        style={styles.todayMeArrowButton}
                        onPress={() => torchPiece && displayedTarget > 30 && onAdjustRoutineTodayTarget(torchPiece.id, routine.id, -30)}
                        disabled={!torchPiece || displayedTarget <= 30}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.todayMeArrowButtonText}>‹</Text>
                      </TouchableOpacity>
                      <Text style={styles.todayMeTargetTimeText}>{formatRoutineTarget(displayedTarget, unit)}</Text>
                      <TouchableOpacity
                        style={styles.todayMeArrowButton}
                        onPress={() => torchPiece && onAdjustRoutineTodayTarget(torchPiece.id, routine.id, 30)}
                        disabled={!torchPiece}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.todayMeArrowButtonText}>›</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.todayMeStatus}>
                      {isDone ? "🔥 오늘의 불씨를 밝혔어요" : "완료는 오늘의 불씨에서 해요"}
                    </Text>
                  </View>
                  {isDeleteConfirmOpen ? (
                    <View style={styles.todayMeDeleteConfirmBox}>
                      <Text style={styles.todayMeDeleteConfirmText}>이 반복 목표를 오늘의 나에서 삭제할까요?</Text>
                      <View style={styles.todayMeDeleteConfirmActions}>
                        <TouchableOpacity style={styles.todayMeDeleteConfirmButton} onPress={confirmDeleteTarget} activeOpacity={0.85}>
                          <Text style={styles.todayMeDeleteConfirmButtonText}>삭제</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.todayMeCancelConfirmButton} onPress={() => setDeleteTarget(null)} activeOpacity={0.85}>
                          <Text style={styles.todayMeCancelConfirmButtonText}>취소</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
          })}
        </View>
      )}

      {routineRecommendation ? (
        <View style={styles.todayMeRecommendationCard}>
          <Text style={styles.todayMeTypeLabel}>노이에의 제안</Text>
          <Text style={styles.todayMeTitle}>{routineRecommendation.title}을 반복 목표로 이어가 볼까요?</Text>
          <Text style={styles.todayMeMeta}>{routineRecommendation.reason}</Text>
          <TouchableOpacity
            style={styles.todayMeButton}
            onPress={() => openRoutineRecommendation(routineRecommendation)}
            activeOpacity={0.85}
          >
            <Text style={styles.todayMeButtonText}>오늘의 나에 담기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.todayMeSecondaryButton} onPress={() => setDismissedRecommendationKeys((keys) => [...keys, routineRecommendation.semanticKey])} activeOpacity={0.85}>
            <Text style={styles.todayMeSecondaryButtonText}>지금은 괜찮아요</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={styles.todayMeFeedback}>{externalFeedback || feedback}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flowCard: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  todayMeHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  todayMeHeaderText: { flex: 1, minWidth: 180 },
  flowCardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  todayMeSubtitle: {
    color: "#aeb4c0",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  todayMeAddButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  todayMeButtonDone: {
    opacity: 0.55,
  },
  todayMeAddButtonText: {
    color: "#f2f4f8",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 26,
  },
  todayMeEmptyLine: {
    color: "#8f8f8f",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  todayMeDetailBox: {
    backgroundColor: "#0b0b0b",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  todayMeTypeLabel: {
    color: "#8f8f8f",
    fontSize: 11,
    fontWeight: "900",
  },
  todayMeInput: {
    backgroundColor: "#171717",
    borderColor: "#333333",
    borderRadius: 8,
    borderWidth: 1,
    color: "#ffffff",
    fontSize: 14,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  todayMeMeta: {
    color: "#aeb4c0",
    fontSize: 12,
    lineHeight: 18,
  },
  todayMeTimeAdjustRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    paddingVertical: 10,
  },
  todayMeArrowButton: {
    alignItems: "center",
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  todayMeArrowButtonText: {
    color: "#d1d5db",
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 30,
  },
  todayMeTargetTimeText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    minWidth: 92,
    textAlign: "center",
  },
  todayMeButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#f2f4f8",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 12,
  },
  todayMeButtonText: {
    color: "#050505",
    fontSize: 12,
    fontWeight: "900",
  },
  flowEmptyBox: {
    alignItems: "center",
    backgroundColor: "#0b0b0b",
    borderColor: "#242424",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 120,
    padding: 18,
  },
  flowEmptyText: {
    color: "#b8b8b8",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  todayMeGroup: {
    gap: 8,
    marginTop: 14,
  },
  todayMeItem: {
    backgroundColor: "#151515",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  todayMeCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  todayMeTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  todayMeMoreButton: {
    alignItems: "center",
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    height: 28,
    justifyContent: "center",
    width: 32,
  },
  todayMeMoreButtonText: {
    color: "#d1d5db",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  todayMeItemMain: {
    gap: 4,
  },
  todayMeStatus: {
    color: "#9cc7ff",
    fontSize: 12,
    fontWeight: "900",
  },
  todayMeDeleteConfirmBox: {
    backgroundColor: "#1b1111",
    borderColor: "#4b2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  todayMeDeleteConfirmText: {
    color: "#f5d0d0",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  todayMeDeleteConfirmActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  todayMeDeleteConfirmButton: {
    alignItems: "center",
    backgroundColor: "#ef4444",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  todayMeDeleteConfirmButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  todayMeCancelConfirmButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  todayMeCancelConfirmButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
  },
  todayMeRecommendationCard: {
    backgroundColor: "#101820",
    borderColor: "#26415f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 14,
    padding: 12,
  },
  todayMeSecondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 11,
  },
  todayMeSecondaryButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "800",
  },
  todayMeFeedback: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 14,
  },
});
