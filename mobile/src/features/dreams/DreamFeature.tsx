import React, { ReactNode, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export type CompletedDreamFragmentDisplayItem = {
  id: string;
  title: string;
  meta: string;
};

export type DreamFragmentDisplayItem = {
  id: string;
  title: string;
  memo?: string;
  statusIcon: string;
  statusLabel: string;
  stateKind: "none" | "progress" | "completed";
  linkedProjectId?: string | null;
};

export type DreamTorchDurationOption = {
  months: 3 | 6 | 12;
  label: string;
  isSelected: boolean;
};

export type DreamTorchFireItem = {
  id: string;
  title: string;
  meta: string;
  isDone: boolean;
  showDivider: boolean;
  kind: "routine" | "project";
  itemId?: string;
  routineId?: string;
  projectId?: string;
};

export type DreamTorchDisplayItem = {
  id: string;
  title: string;
  ddayLabel: string;
  isSavingGoalDuration: boolean;
  durationOptions: DreamTorchDurationOption[];
  fireTitle: string;
  completedFireCount: number;
  totalFireCount: number;
  fireItems: DreamTorchFireItem[];
};

export type DreamFeatureProps = {
  summaryNode: ReactNode;
  torch: DreamTorchDisplayItem | null;
  activeDreamFragments: DreamFragmentDisplayItem[];
  completedDreamFragments: CompletedDreamFragmentDisplayItem[];
  dreamFragmentsCount: number;
  todayMeNode: ReactNode;
  onSelectGoalDuration: (itemId: string, months: 3 | 6 | 12) => Promise<void>;
  onRecordDreamRoutine: (itemId: string, routineId: string, score: 1) => void;
  onCompleteProjectNextAction: (projectId: string) => void;
  onStartProjectFromFragment: (itemId: string) => void;
  onOpenProject: (projectId: string) => void;
  onCompleteProjectFromTodayMe: (projectId: string) => void;
  onPromoteFragmentToTorch: (itemId: string) => void;
  onDeleteFragment: (itemId: string) => void;
  onBackToChat: () => void;
};

export function DreamFeature({
  summaryNode,
  torch,
  activeDreamFragments,
  completedDreamFragments,
  dreamFragmentsCount,
  todayMeNode,
  onSelectGoalDuration,
  onRecordDreamRoutine,
  onCompleteProjectNextAction,
  onStartProjectFromFragment,
  onOpenProject,
  onCompleteProjectFromTodayMe,
  onPromoteFragmentToTorch,
  onDeleteFragment,
  onBackToChat,
}: DreamFeatureProps) {
  const [isCompletedDreamFragmentsOpen, setIsCompletedDreamFragmentsOpen] = useState(false);
  const hasDreamContent =
    Boolean(torch) ||
    activeDreamFragments.length > 0 ||
    completedDreamFragments.length > 0 ||
    dreamFragmentsCount > 0;

  return (
    <ScrollView
      style={styles.flowScroll}
      contentContainerStyle={styles.flowContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.flowHeaderRow}>
        <View style={styles.flowHeaderTextBlock}>
          <Text style={styles.flowTitle}>꿈의 조각</Text>
          <Text style={styles.flowSubtitle}>내가 향하는 방향</Text>
        </View>
        <TouchableOpacity
          style={styles.backToChatButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.backToChatButtonText}>채팅으로 돌아가기</Text>
        </TouchableOpacity>
      </View>

      {summaryNode}

      {!hasDreamContent ? (
        <View style={styles.flowCard}>
          <View style={styles.flowEmptyBox}>
            <Text style={styles.flowEmptyText}>
              아직 꿈의 조각이 없어요.{"\n"}채팅에서 되고 싶은 모습이나 목표를 말하면 여기에 모여요.
            </Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.flowCard}>
            {torch ? (
              <DreamTorchPanel
                torch={torch}
                onSelectGoalDuration={onSelectGoalDuration}
                onRecordDreamRoutine={onRecordDreamRoutine}
                onCompleteProjectNextAction={onCompleteProjectNextAction}
              />
            ) : null}
          </View>

          <View style={styles.flowCard}>
            <Text style={styles.flowCardTitle}>꿈의 파편</Text>
            {activeDreamFragments.length > 0 ? (
              activeDreamFragments.map((fragment) => (
                <DreamFragmentCard
                  key={fragment.id}
                  fragment={fragment}
                  onStartProjectFromFragment={onStartProjectFromFragment}
                  onOpenProject={onOpenProject}
                  onCompleteProjectFromTodayMe={onCompleteProjectFromTodayMe}
                  onPromoteFragmentToTorch={onPromoteFragmentToTorch}
                  onDeleteFragment={onDeleteFragment}
                />
              ))
            ) : (
              <View style={styles.flowEmptyBox}>
                <Text style={styles.flowEmptyText}>
                  {dreamFragmentsCount > 0
                    ? "진행 중인 꿈의 파편이 없어요."
                    : "아직 꿈의 파편이 없어요.\n만들고 싶은 프로젝트나 하위 목표를 말하면 여기에 모여요."}
                </Text>
                {dreamFragmentsCount === 0 ? (
                  <Text style={styles.flowEmptyExampleText}>예: noie를 완성하고 싶어{"\n"}예: 포트폴리오를 만들고 싶어{"\n"}예: 앱을 출시하고 싶어</Text>
                ) : null}
              </View>
            )}
          </View>

          {completedDreamFragments.length > 0 ? (
            <View style={styles.completedDreamFragmentsBox}>
              <TouchableOpacity
                style={styles.completedDreamFragmentsHeader}
                onPress={() => setIsCompletedDreamFragmentsOpen((value) => !value)}
                activeOpacity={0.85}
              >
                <Text style={styles.completedDreamFragmentsTitle}>
                  ⭐ 지금까지 완료한 꿈의 파편 {completedDreamFragments.length}개
                </Text>
                <Text style={styles.completedDreamFragmentsToggle}>
                  {isCompletedDreamFragmentsOpen ? "⌃" : "⌄"}
                </Text>
              </TouchableOpacity>
              {isCompletedDreamFragmentsOpen ? (
                <View style={styles.completedDreamFragmentsList}>
                  {completedDreamFragments.map((item) => (
                    <View key={`completed-dream-fragment-${item.id}`} style={styles.completedDreamFragmentItem}>
                      <Text style={styles.completedDreamFragmentTitle}>
                        ⭐ {item.title}
                      </Text>
                      <Text style={styles.completedDreamFragmentMeta}>{item.meta}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {todayMeNode}
    </ScrollView>
  );
}

function DreamTorchPanel({
  torch,
  onSelectGoalDuration,
  onRecordDreamRoutine,
  onCompleteProjectNextAction,
}: {
  torch: DreamTorchDisplayItem;
  onSelectGoalDuration: (itemId: string, months: 3 | 6 | 12) => Promise<void>;
  onRecordDreamRoutine: (itemId: string, routineId: string, score: 1) => void;
  onCompleteProjectNextAction: (projectId: string) => void;
}) {
  return (
    <View style={styles.dreamTorchSimplePanel}>
      <Text style={styles.flowCardTitle}>꿈의 횃불</Text>
      <View style={styles.dreamTorchGoalRow}>
        <Text style={styles.dreamTorchGoalText}>{torch.title}</Text>
        {torch.ddayLabel ? <Text style={styles.dreamTorchDdayText}>{torch.ddayLabel}</Text> : null}
      </View>

      <View style={styles.dreamTorchSection}>
        <Text style={styles.dreamTorchSectionTitle}>목표 기간</Text>
        <View style={styles.goalDurationButtonRow}>
          {torch.durationOptions.map((option) => (
            <TouchableOpacity
              key={option.months}
              style={[
                styles.goalDurationButton,
                option.isSelected && styles.goalDurationButtonSelected,
                torch.isSavingGoalDuration && styles.traceConfirmButtonDisabled,
              ]}
              onPress={() => {
                void onSelectGoalDuration(torch.id, option.months);
              }}
              disabled={torch.isSavingGoalDuration}
              activeOpacity={0.85}
            >
              <Text style={[styles.goalDurationButtonText, option.isSelected && styles.goalDurationButtonTextSelected]}>
                {torch.isSavingGoalDuration && option.isSelected ? "저장 중..." : option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.dreamTorchSection}>
        <View style={styles.dreamTorchFireHeader}>
          <Text style={styles.dreamTorchSectionTitle}>{torch.fireTitle}</Text>
          <Text style={styles.dreamTorchCountText}>{torch.completedFireCount} / {torch.totalFireCount}</Text>
        </View>
        {torch.totalFireCount > 0 ? (
          <View style={styles.dreamTorchRoutineList}>
            {torch.fireItems.map((item) => (
              <View key={item.id}>
                <View style={styles.dreamTorchRoutineRow}>
                  <View style={styles.dreamTorchRoutineTextBlock}>
                    <Text style={styles.dreamTorchRoutineTitle}>{item.title}</Text>
                    <Text style={styles.dreamTorchRoutineMeta}>{item.meta}</Text>
                  </View>
                  {!item.isDone ? (
                    <View style={styles.dreamTorchFireActionRow}>
                      <TouchableOpacity
                        style={styles.dreamTorchCompleteButton}
                        onPress={() => {
                          if (item.kind === "routine" && item.itemId && item.routineId) {
                            onRecordDreamRoutine(item.itemId, item.routineId, 1);
                          }
                          if (item.kind === "project" && item.projectId) {
                            onCompleteProjectNextAction(item.projectId);
                          }
                        }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.dreamTorchCompleteButtonText}>완료</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
                {item.showDivider ? <View style={styles.dreamTorchRoutineDivider} /> : null}
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.dreamTorchEmptyText}>오늘 켤 불씨가 아직 없어요.</Text>
        )}
      </View>
    </View>
  );
}

function DreamFragmentCard({
  fragment,
  onStartProjectFromFragment,
  onOpenProject,
  onCompleteProjectFromTodayMe,
  onPromoteFragmentToTorch,
  onDeleteFragment,
}: {
  fragment: DreamFragmentDisplayItem;
  onStartProjectFromFragment: (itemId: string) => void;
  onOpenProject: (projectId: string) => void;
  onCompleteProjectFromTodayMe: (projectId: string) => void;
  onPromoteFragmentToTorch: (itemId: string) => void;
  onDeleteFragment: (itemId: string) => void;
}) {
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isCompleteConfirmOpen, setIsCompleteConfirmOpen] = useState(false);
  const linkedProjectId = fragment.linkedProjectId ?? null;

  return (
    <View style={styles.traceListItem}>
      <View style={styles.traceListTextBlock}>
        <Text style={styles.traceItemTitle}>{fragment.statusIcon} {fragment.title}</Text>
        {fragment.memo ? <Text style={styles.traceItemMemo}>{fragment.memo}</Text> : null}
        <Text style={styles.dreamPieceStatusText}>{fragment.statusLabel}</Text>

        <View style={styles.dreamPieceActions}>
          {fragment.stateKind === "none" ? (
            <TouchableOpacity
              style={styles.dreamPieceActionButton}
              onPress={() => onStartProjectFromFragment(fragment.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceActionText}>프로젝트 시작</Text>
            </TouchableOpacity>
          ) : null}
          {fragment.stateKind === "progress" && linkedProjectId ? (
            <TouchableOpacity
              style={styles.dreamPieceActionButton}
              onPress={() => onOpenProject(linkedProjectId)}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceActionText}>이어가기</Text>
            </TouchableOpacity>
          ) : null}
          {fragment.stateKind === "progress" && linkedProjectId ? (
            <TouchableOpacity
              style={styles.dreamPieceActionButtonMuted}
              onPress={() => setIsCompleteConfirmOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceActionTextMuted}>완료</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.dreamPieceActionButtonMuted}
            onPress={() => setIsMoreMenuOpen((value) => !value)}
            activeOpacity={0.85}
          >
            <Text style={styles.dreamPieceActionTextMuted}>⋯</Text>
          </TouchableOpacity>
        </View>

        {isMoreMenuOpen ? (
          <View style={styles.dreamPieceMoreMenu}>
            <TouchableOpacity
              style={styles.dreamPieceMoreMenuItem}
              onPress={() => {
                setIsMoreMenuOpen(false);
                onPromoteFragmentToTorch(fragment.id);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceMoreMenuText}>꿈의 횃불로 밝히기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dreamPieceMoreMenuItem}
              onPress={() => {
                setIsMoreMenuOpen(false);
                setIsDeleteConfirmOpen(true);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.dreamPieceMoreMenuText}>삭제</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isCompleteConfirmOpen && linkedProjectId ? (
          <View style={styles.dreamPieceCompleteConfirmBox}>
            <Text style={styles.dreamPieceCompleteConfirmText}>이 꿈의 파편을 완성할까요?</Text>
            <View style={styles.dreamPieceActions}>
              <TouchableOpacity
                style={styles.dreamPieceCompleteButton}
                onPress={() => {
                  setIsCompleteConfirmOpen(false);
                  onCompleteProjectFromTodayMe(linkedProjectId);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceCompleteButtonText}>완료하기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dreamPieceActionButtonMuted}
                onPress={() => setIsCompleteConfirmOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceActionTextMuted}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {isDeleteConfirmOpen ? (
          <View style={styles.dreamPieceDeleteConfirmBox}>
            <Text style={styles.dreamPieceDeleteConfirmText}>이 꿈의 파편을 삭제할까요?</Text>
            <View style={styles.dreamPieceActions}>
              <TouchableOpacity
                style={styles.dreamPieceDeleteButton}
                onPress={() => {
                  setIsDeleteConfirmOpen(false);
                  onDeleteFragment(fragment.id);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceDeleteButtonText}>삭제</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dreamPieceActionButtonMuted}
                onPress={() => setIsDeleteConfirmOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.dreamPieceActionTextMuted}>취소</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flowScroll: { flex: 1 },
  flowContent: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingBottom: 34,
  },
  flowHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 14,
  },
  flowHeaderTextBlock: { flex: 1, minWidth: 210 },
  flowTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 6,
  },
  flowSubtitle: { color: "#9ca3af", fontSize: 14, lineHeight: 20 },
  backToChatButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  backToChatButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
  },
  flowCard: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  flowCardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  flowEmptyBox: {
    alignItems: "center",
    backgroundColor: "#0d0d0d",
    borderColor: "#2a2a2a",
    borderRadius: 10,
    borderWidth: 1,
    padding: 18,
  },
  flowEmptyText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
    textAlign: "center",
  },
  flowEmptyExampleText: {
    color: "#71717a",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    textAlign: "center",
  },
  dreamTorchSimplePanel: {
    gap: 14,
  },
  dreamTorchGoalRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  dreamTorchGoalText: {
    color: "#f2f4f8",
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 25,
  },
  dreamTorchDdayText: {
    color: "#fbbf24",
    flexShrink: 0,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 22,
  },
  dreamTorchSection: {
    gap: 9,
  },
  dreamTorchSectionTitle: {
    color: "#e5e7eb",
    fontSize: 13,
    fontWeight: "900",
  },
  goalDurationButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  goalDurationButton: {
    borderColor: "#3a3a3a",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  goalDurationButtonSelected: {
    backgroundColor: "#f2f4f8",
    borderColor: "#f2f4f8",
  },
  goalDurationButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
  },
  goalDurationButtonTextSelected: {
    color: "#050505",
  },
  traceConfirmButtonDisabled: {
    opacity: 0.55,
  },
  dreamTorchFireHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  dreamTorchCountText: {
    color: "#aeb4c0",
    flexShrink: 0,
    fontSize: 13,
    fontWeight: "900",
  },
  dreamTorchRoutineList: {
    borderTopColor: "#2a2a2a",
    borderTopWidth: 1,
  },
  dreamTorchRoutineRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    paddingVertical: 12,
  },
  dreamTorchRoutineTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  dreamTorchRoutineTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  dreamTorchRoutineMeta: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 2,
  },
  dreamTorchCompleteButton: {
    borderColor: "#4a5568",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  dreamTorchFireActionRow: {
    flexDirection: "row",
    flexShrink: 0,
    gap: 6,
  },
  dreamTorchCompleteButtonText: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "900",
  },
  dreamTorchRoutineDivider: {
    backgroundColor: "#2a2a2a",
    height: 1,
    marginLeft: 32,
  },
  dreamTorchEmptyText: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  traceListItem: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  traceListTextBlock: { flex: 1 },
  traceItemTitle: {
    color: "#f2f4f8",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  traceItemMemo: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  dreamPieceActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  dreamPieceActionButton: {
    borderColor: "#4a5568",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dreamPieceActionButtonMuted: {
    borderColor: "#333333",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dreamPieceActionText: {
    color: "#e5e7eb",
    fontSize: 11,
    fontWeight: "800",
  },
  dreamPieceActionTextMuted: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "800",
  },
  dreamPieceStatusText: {
    color: "#aeb4c0",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 6,
  },
  dreamPieceMoreMenu: {
    backgroundColor: "#151515",
    borderColor: "#2a2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginTop: 8,
    padding: 8,
  },
  dreamPieceMoreMenuItem: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  dreamPieceMoreMenuText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "800",
  },
  dreamPieceDeleteConfirmBox: {
    backgroundColor: "#1b1111",
    borderColor: "#4b2a2a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  dreamPieceDeleteConfirmText: {
    color: "#f5d0d0",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  dreamPieceCompleteConfirmBox: {
    backgroundColor: "#071b12",
    borderColor: "#1f7a4d",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  dreamPieceCompleteConfirmText: {
    color: "#bbf7d0",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  dreamPieceCompleteButton: {
    alignItems: "center",
    backgroundColor: "#16a34a",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  dreamPieceCompleteButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  dreamPieceDeleteButton: {
    alignItems: "center",
    backgroundColor: "#ef4444",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  dreamPieceDeleteButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  completedDreamFragmentsBox: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  completedDreamFragmentsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  completedDreamFragmentsTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  completedDreamFragmentsToggle: {
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "900",
  },
  completedDreamFragmentsList: {
    borderTopColor: "#262626",
    borderTopWidth: 1,
    gap: 8,
    padding: 14,
  },
  completedDreamFragmentItem: {
    backgroundColor: "#151515",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  completedDreamFragmentTitle: {
    color: "#f2f4f8",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 19,
  },
  completedDreamFragmentMeta: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
});
