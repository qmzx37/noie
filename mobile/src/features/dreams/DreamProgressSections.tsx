import React, { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";

import { formatDateDot } from "../../noie/dateUtils";
import { getMemoryInputText } from "../../noie/memoryLogic";
import type { DailyTraceItem, DreamRoutineQuickScore, NoieProject } from "../../noie/types";
import { styles } from "../../styles/appStyles";
import {
  calculateDreamProgress,
  getActiveDreamRoutines,
  getActiveDreamSeason,
  getConsistencyStatusSymbol,
  getConsistencyWeekdayLabel,
  getProjectsRelatedToDream,
  type DreamProjectSummary,
} from "./dreamProgress";

export function DreamProjectSummaryCard({ summary }: { summary: DreamProjectSummary }) {
  const [isProgressDetailsOpen, setIsProgressDetailsOpen] = useState(false);

  return (
    <View style={styles.dreamProjectSummaryCard}>
      <Text style={styles.dreamProjectSummaryTitle}>전체 진행률</Text>
      <Text style={styles.dreamProjectSummaryPercent}>{summary.progressPercent}%</Text>
      <View style={styles.dreamProjectSummaryTrack}>
        <View style={[styles.dreamProjectSummaryFill, { width: `${summary.progressPercent}%` }]} />
      </View>
      <Text style={styles.dreamProjectSummaryNext}>꾸준함 {summary.consistencyScore}%</Text>
      <View style={styles.consistencyStatusRow}>
        {summary.consistencyDays.map((day) => (
          <Text
            key={day.dateKey}
            style={[
              styles.consistencyStatusSymbol,
              day.status === "complete" && styles.consistencyStatusSymbolComplete,
            ]}
          >
            {getConsistencyStatusSymbol(day.status)}
          </Text>
        ))}
      </View>
      <View style={styles.consistencyWeekdayRow}>
        {summary.consistencyDays.map((day) => (
          <Text key={`weekday-${day.dateKey}`} style={styles.consistencyWeekdayText}>
            {getConsistencyWeekdayLabel(day.dateKey)}
          </Text>
        ))}
      </View>
      <Text style={styles.dreamProjectSummaryNext}>
        다음 이정표: {summary.nextMilestone?.title ?? "마일스톤을 추가하면 다음 이정표를 안내할 수 있어요."}
      </Text>
      <TouchableOpacity
        style={styles.dreamPieceActionButtonMuted}
        onPress={() => setIsProgressDetailsOpen((value) => !value)}
        activeOpacity={0.85}
      >
        <Text style={styles.dreamPieceActionTextMuted}>
          {isProgressDetailsOpen ? "진행률 근거 접기" : "진행률 근거 보기"}
        </Text>
      </TouchableOpacity>

      {isProgressDetailsOpen ? (
        <View style={styles.dreamProgressDetailsBox}>
          <Text style={styles.dreamPlanHint}>반복 목표 누적 수행: {summary.cumulativeRoutineProgress}%</Text>
          <Text style={styles.dreamPlanHint}>완료 단계: {summary.milestoneProgress}%</Text>
          <Text style={styles.dreamPlanHint}>목표 기간: {summary.goalDurationMonths ? `${summary.goalDurationMonths}개월` : "-"}</Text>
          <Text style={styles.dreamPlanHint}>기간: {summary.goalStartDate && summary.goalTargetDate ? `${formatDateDot(summary.goalStartDate)} ~ ${formatDateDot(summary.goalTargetDate)}` : "-"}</Text>
          <Text style={styles.dreamPlanHint}>최종 진행률: {summary.progressPercent}%</Text>
          <Text style={styles.dreamPlanHint}>오늘의 나 프로젝트 {summary.linkedProjectCount}개 · 완료된 프로젝트 {summary.doneProjectCount}개</Text>
        </View>
      ) : null}
    </View>
  );
}

export function DreamTorchPlanPanel({
  piece,
  projects,
  onUpdatePlan,
  onRecordRoutine,
}: {
  piece: DailyTraceItem;
  projects: NoieProject[];
  onUpdatePlan: (itemId: string, values: Partial<DailyTraceItem>) => void;
  onRecordRoutine: (itemId: string, routineId: string, score: DreamRoutineQuickScore, value?: number) => void;
}) {
  const activeSeason = getActiveDreamSeason(piece);
  const linkedProjects = getProjectsRelatedToDream(piece, projects);
  const progress = calculateDreamProgress(piece, linkedProjects);
  const activeRoutines = getActiveDreamRoutines(piece, progress.activeSeason);

  return (
    <View style={styles.dreamPlanBox}>
      <Text style={styles.dreamPlanTitle}>꿈의 실행 기록</Text>
      <Text style={styles.dreamPlanHint}>
        목표 기간: {piece.goalStartDate && piece.goalTargetDate ? `${formatDateDot(piece.goalStartDate)} ~ ${formatDateDot(piece.goalTargetDate)}` : "아래 기간 버튼에서 선택할 수 있어요."}
      </Text>
      {activeSeason?.title ? (
        <Text style={styles.dreamPlanHint}>
          현재 시즌: {activeSeason.title}
        </Text>
      ) : null}
      {activeRoutines.length > 0 ? (
        <View style={styles.dreamRoutineList}>
          <Text style={styles.dreamPlanSubtitle}>오늘 꿈에 얼마나 불을 보탰나요?</Text>
          {activeRoutines.map((routine) => (
            <View key={routine.id} style={styles.dreamRoutineRow}>
              <Text style={styles.dreamRoutineTitle}>{routine.title}</Text>
              <View style={styles.dreamRoutineActions}>
                <TouchableOpacity style={styles.dreamRoutineButton} onPress={() => onRecordRoutine(piece.id, routine.id, 0)}><Text style={styles.dreamRoutineButtonText}>아직</Text></TouchableOpacity>
                <TouchableOpacity style={styles.dreamRoutineButton} onPress={() => onRecordRoutine(piece.id, routine.id, 0.5)}><Text style={styles.dreamRoutineButtonText}>조금</Text></TouchableOpacity>
                <TouchableOpacity style={styles.dreamRoutineButton} onPress={() => onRecordRoutine(piece.id, routine.id, 1)}><Text style={styles.dreamRoutineButtonText}>완료</Text></TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export type ResumeMaterial = {
  goal: string;
  problem: string;
  action: string;
  tech: string;
  learning: string;
  nextImprovement: string;
};

export function formatProgressValue(value: number) {
  return Number.isFinite(value) ? `${value}%` : "-";
}

export function getDreamFragmentJudgement(
  piece: DailyTraceItem,
  isLinkedProject: boolean
) {
  if (piece.projectStatus === "done") {
    return "완료된 프로젝트로 표시되어 있어요.";
  }

  if (isLinkedProject && piece.nextAction?.trim()) {
    return "프로젝트로 연결되어 있고, 다음 행동이 정해져 있어요.";
  }

  if (isLinkedProject) {
    return "꿈의 파편에서 시작된 프로젝트예요.";
  }

  return "아직 프로젝트로 시작되기 전의 꿈의 파편이에요.";
}

export function buildResumeMaterial(
  piece: DailyTraceItem,
  linkedProject?: NoieProject
): ResumeMaterial {
  const goal =
    linkedProject?.goal ||
    getMemoryInputText(piece) ||
    piece.title ||
    "정리된 목표가 아직 부족해요.";
  const sourceText = getMemoryInputText(piece);
  const nextAction = piece.nextAction || linkedProject?.nextAction;

  return {
    goal,
    problem: "문제 상황은 아직 대화에서 충분히 드러나지 않았어요.",
    action: linkedProject
      ? "꿈의 파편을 프로젝트로 연결했어요."
      : "아직 프로젝트로 시작되기 전이에요.",
    tech: extractTechnologiesFromText(sourceText || goal),
    learning: "배운 점은 프로젝트 진행 기록이 더 쌓이면 정리할 수 있어요.",
    nextImprovement: nextAction || "다음 보완점은 아직 정해지지 않았어요.",
  };
}

function extractTechnologiesFromText(text: string) {
  const techKeywords = [
    "AI",
    "React Native",
    "Expo",
    "TypeScript",
    "FastAPI",
    "Python",
    "OpenAI",
    "Supabase",
    "백엔드",
    "프론트엔드",
    "앱",
  ];
  const normalizedText = text.toLowerCase();
  const matchedTech = techKeywords.filter((keyword) =>
    normalizedText.includes(keyword.toLowerCase())
  );

  return matchedTech.length > 0
    ? matchedTech.join(", ")
    : "사용 기술은 아직 충분히 드러나지 않았어요.";
}

function formatSaveDecisionValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }

  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

export function DreamProgressEvidenceCard({
  piece,
  progressPercent,
  linkedProject,
  relatedDream,
}: {
  piece: DailyTraceItem;
  progressPercent: number;
  linkedProject?: NoieProject;
  relatedDream?: DailyTraceItem;
}) {
  const rows: Array<[string, string]> = [
    ["project link", linkedProject ? "linked" : "-"],
    ["projectStatus", formatSaveDecisionValue(piece.projectStatus)],
    ["progressPercent", `${progressPercent}`],
    ["nextAction", formatSaveDecisionValue(piece.nextAction)],
    ["createdAt", formatSaveDecisionValue(piece.createdAt)],
    ["updatedAt", formatSaveDecisionValue(piece.updatedAt)],
    [
      "related dream",
      relatedDream
        ? getMemoryInputText(relatedDream) || relatedDream.title
        : "-",
    ],
    ["linked project", linkedProject?.title ?? "-"],
  ];

  return (
    <View style={styles.dreamEvidenceCard}>
      <Text style={styles.dreamEvidenceTitle}>진행 근거</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.dreamEvidenceRow}>
          <Text style={styles.dreamEvidenceKey}>{label}</Text>
          <Text style={styles.dreamEvidenceValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export function ResumeMaterialCard({ material }: { material: ResumeMaterial }) {
  const rows: Array<[string, string]> = [
    ["1. 목표", material.goal],
    ["2. 문제 상황", material.problem],
    ["3. 내가 한 일", material.action],
    ["4. 사용 기술", material.tech],
    ["5. 배운 점", material.learning],
    ["6. 다음 보완점", material.nextImprovement],
  ];

  return (
    <View style={styles.resumeMaterialCard}>
      <Text style={styles.resumeMaterialTitle}>자소서 추천 재료</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.resumeMaterialSection}>
          <Text style={styles.resumeMaterialSectionTitle}>{label}</Text>
          <Text style={styles.resumeMaterialText}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
