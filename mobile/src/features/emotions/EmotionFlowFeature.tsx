import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";

import {
  EMOTION_COLORS,
  EMOTION_KEYS,
  EMOTION_LABELS,
  MAX_FLOW_KEYS,
} from "../../noie/constants";
import type {
  DailyPiece,
  DailyPieceGroup,
  EmotionKey,
  EmotionRecord,
  WeeklyAverage,
} from "../../noie/types";

export type EmotionFlowFeatureProps = {
  recentRecords: EmotionRecord[];
  dailyPieces: DailyPieceGroup[];
  weeklyAverages: WeeklyAverage[];
  interpretation: string;
  selectedKeys: EmotionKey[];
  showAllWeeklyAverages: boolean;
  onToggleKey: (key: EmotionKey) => void;
  onToggleWeeklyAverages: () => void;
  onBackToChat: () => void;
  getDayPieceText: (piece: DailyPiece) => string;
};

export function EmotionFlowFeature({
  recentRecords,
  dailyPieces,
  weeklyAverages,
  interpretation,
  selectedKeys,
  showAllWeeklyAverages,
  onToggleKey,
  onToggleWeeklyAverages,
  onBackToChat,
  getDayPieceText,
}: EmotionFlowFeatureProps) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(300, Math.min(width - 32, 760));
  const visibleWeeklyAverages = showAllWeeklyAverages
    ? weeklyAverages
    : weeklyAverages.slice(0, 3);

  return (
    <ScrollView
      style={styles.flowScroll}
      contentContainerStyle={styles.flowContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.flowHeaderRow}>
        <View style={styles.flowHeaderTextBlock}>
          <Text style={styles.flowTitle}>감정 창고</Text>
          <Text style={styles.flowSubtitle}>
            감정 흐름은 그래프로, 일정과 기록은 하루의 흔적으로 따로 보관합니다.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.backToChatButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.backToChatButtonText}>채팅으로 돌아가기</Text>
        </TouchableOpacity>
      </View>

      <DailyPiecesSection pieces={dailyPieces} getDayPieceText={getDayPieceText} />

      <View style={styles.flowCard}>
        <View style={styles.flowCardHeader}>
          <View>
            <Text style={styles.flowCardTitle}>최근 10개 감정 변화</Text>
            <Text style={styles.flowCardHint}>기본 축: D 우울, T 긴장, R 안정</Text>
          </View>
        </View>

        <View style={styles.axisSelector}>
          {EMOTION_KEYS.map((key) => {
            const isSelected = selectedKeys.includes(key);
            const isDisabled = !isSelected && selectedKeys.length >= MAX_FLOW_KEYS;

            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.axisChip,
                  isSelected && {
                    borderColor: EMOTION_COLORS[key],
                    backgroundColor: `${EMOTION_COLORS[key]}22`,
                  },
                  isDisabled && styles.axisChipDisabled,
                ]}
                onPress={() => onToggleKey(key)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.axisChipText,
                    isSelected && { color: "#ffffff" },
                  ]}
                >
                  {key} {EMOTION_LABELS[key]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.axisLimitText}>
          한 번에 최대 {MAX_FLOW_KEYS}개 축까지 선택할 수 있습니다.
        </Text>

        {recentRecords.length < 2 ? (
          <View style={styles.flowEmptyBox}>
            <Text style={styles.flowEmptyText}>
              감정 흐름을 보려면 noie와 조금 더 대화해 주세요.
            </Text>
          </View>
        ) : (
          <LineChart
            records={recentRecords}
            selectedKeys={selectedKeys}
            width={chartWidth}
          />
        )}
      </View>

      <View style={styles.flowCard}>
        <Text style={styles.flowCardTitle}>최근 7일 감정 평균</Text>
        {weeklyAverages.length === 0 ? (
          <View style={styles.flowEmptyBox}>
            <Text style={styles.flowEmptyText}>
              최근 7일 감정 기록이 없습니다. noie와 대화하면 주간 평균이 생성됩니다.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.weeklyBarList}>
              {visibleWeeklyAverages.map((item) => (
                <WeeklyAverageBar key={item.key} item={item} />
              ))}
            </View>
            {weeklyAverages.length > 3 ? (
              <TouchableOpacity
                style={styles.moreButton}
                onPress={onToggleWeeklyAverages}
                activeOpacity={0.85}
              >
                <Text style={styles.moreButtonText}>
                  {showAllWeeklyAverages ? "접기" : "더보기"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.flowCard}>
        <Text style={styles.flowCardTitle}>noie 해석</Text>
        <Text style={styles.interpretationText}>{interpretation}</Text>
      </View>

    </ScrollView>
  );
}

function DailyPiecesSection({ pieces, getDayPieceText }: { pieces: DailyPieceGroup[]; getDayPieceText: (piece: DailyPiece) => string }) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(260, Math.min(width * 0.82, 380));

  return (
    <View style={styles.dailyPiecesSection}>
      <Text style={styles.dailyPiecesTitle}>하루의 조각</Text>
      <Text style={styles.dailyPiecesSubtitle}>최근 3일 동안 남은 조각들</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dailyPiecesCarousel}
      >
        {pieces.map((group) => (
          <View
            key={group.date}
            style={[styles.dailyPieceCard, { width: cardWidth }]}
          >
            <Text style={styles.dailyPieceDateTitle}>{group.label}</Text>
            {group.pieces.length === 0 ? (
              <Text style={styles.dailyPieceEmptyText}>
                아직 남은 조각이 없어요
              </Text>
            ) : (
              <View style={styles.dailyPieceList}>
                {group.pieces.map((piece, index) => (
                  <Text key={piece.id} style={styles.dailyPieceText}>
                    {index + 1}. {getDayPieceText(piece)}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

type LineChartProps = {
  records: EmotionRecord[];
  selectedKeys: EmotionKey[];
  width: number;
};

function LineChart({ records, selectedKeys, width }: LineChartProps) {
  const height = 236;
  const paddingLeft = 34;
  const paddingRight = 16;
  const paddingTop = 18;
  const paddingBottom = 34;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  const getX = (index: number) =>
    paddingLeft +
    (records.length === 1 ? 0 : (innerWidth * index) / (records.length - 1));
  const getY = (value: number) =>
    paddingTop + (1 - clampScore(value)) * innerHeight;

  return (
    <View style={styles.chartWrap}>
      <Svg width={width} height={height}>
        <Defs>
          <ClipPath id="emotionChartClip">
            <Rect
              x={paddingLeft}
              y={paddingTop}
              width={innerWidth}
              height={innerHeight}
            />
          </ClipPath>
        </Defs>
        {[0, 0.5, 1].map((tick) => {
          const y = getY(tick);
          return (
            <React.Fragment key={tick}>
              <Line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="#2a2a2a"
                strokeWidth="1"
              />
              <SvgText x={4} y={y + 4} fill="#858585" fontSize="10">
                {tick.toFixed(1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {records.map((record, index) => {
          const x = getX(index);
          return (
            <React.Fragment key={record.id}>
              <Line
                x1={x}
                y1={paddingTop}
                x2={x}
                y2={paddingTop + innerHeight}
                stroke="#161616"
                strokeWidth="1"
              />
              <SvgText
                x={x}
                y={height - 10}
                fill="#8f8f8f"
                fontSize="10"
                textAnchor="middle"
              >
                {String(index + 1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {selectedKeys.map((key) => {
          const points = records
            .map((record, index) => `${getX(index)},${getY(record.axis[key])}`)
            .join(" ");

          return (
            <React.Fragment key={key}>
              <G clipPath="url(#emotionChartClip)">
                <Polyline
                  points={points}
                  fill="none"
                  stroke={EMOTION_COLORS[key]}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {records.map((record, index) => (
                  <Circle
                    key={`${key}-${record.id}`}
                    cx={getX(index)}
                    cy={getY(record.axis[key])}
                    r="4"
                    fill="#050505"
                    stroke={EMOTION_COLORS[key]}
                    strokeWidth="2"
                  />
                ))}
              </G>
            </React.Fragment>
          );
        })}
      </Svg>

      <View style={styles.chartLegend}>
        {selectedKeys.map((key) => (
          <View key={key} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: EMOTION_COLORS[key] },
              ]}
            />
            <Text style={styles.legendText}>
              {key} {EMOTION_LABELS[key]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type WeeklyAverageBarProps = {
  item: WeeklyAverage;
};

function WeeklyAverageBar({ item }: WeeklyAverageBarProps) {
  const percent = Math.round(clampScore(item.value) * 100);

  return (
    <View style={styles.weeklyBarItem}>
      <View style={styles.weeklyBarHeader}>
        <Text style={styles.weeklyBarLabel}>
          {item.key} {item.label}
        </Text>
        <Text style={styles.weeklyBarValue}>{item.value.toFixed(2)}</Text>
      </View>
      <View style={styles.weeklyTrack}>
        <View
          style={[
            styles.weeklyFill,
            {
              width: `${percent}%`,
              backgroundColor: EMOTION_COLORS[item.key],
            },
          ]}
        />
      </View>
    </View>
  );
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

const styles = StyleSheet.create({
  flowScroll: { flex: 1 },  flowContent: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingBottom: 34,
  },  flowHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 14,
  },  flowHeaderTextBlock: { flex: 1, minWidth: 210 },  flowTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 6,
  },  flowSubtitle: { color: "#9ca3af", fontSize: 14, lineHeight: 20 },  backToChatButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },  backToChatButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
  },  dailyPiecesSection: {
    marginBottom: 14,
  },  dailyPiecesTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 5,
  },  dailyPiecesSubtitle: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginBottom: 10,
  },  dailyPiecesCarousel: {
    paddingRight: 18,
  },  dailyPieceCard: {
    backgroundColor: "#181818",
    borderColor: "#303030",
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 12,
    minHeight: 178,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },  dailyPieceDateTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 14,
  },  dailyPieceList: {
    gap: 10,
  },  dailyPieceText: {
    color: "#f2f4f8",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 23,
  },  dailyPieceEmptyText: {
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 22,
  },  dailyPiecesEmptyBox: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 86,
    padding: 14,
  },  dailyPiecesEmptyText: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },  flowCard: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },  flowCardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },  flowCardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },  flowCardHint: { color: "#8f8f8f", fontSize: 12, lineHeight: 18 },  axisSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },  axisChip: {
    backgroundColor: "#1c1c1c",
    borderColor: "#303030",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },  axisChipDisabled: { opacity: 0.42 },  axisChipText: { color: "#b8b8b8", fontSize: 12, fontWeight: "800" },  axisLimitText: {
    color: "#777777",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },  flowEmptyBox: {
    alignItems: "center",
    backgroundColor: "#0b0b0b",
    borderColor: "#242424",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 120,
    padding: 18,
  },  flowEmptyText: {
    color: "#b8b8b8",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },  chartWrap: {
    alignItems: "center",
    backgroundColor: "#0a0a0a",
    borderColor: "#242424",
    borderRadius: 8,
    borderWidth: 1,
    paddingTop: 8,
  },  chartLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    paddingBottom: 12,
    paddingHorizontal: 10,
  },  legendItem: { alignItems: "center", flexDirection: "row", gap: 6 },  legendDot: { borderRadius: 999, height: 8, width: 8 },  legendText: { color: "#d1d5db", fontSize: 12, fontWeight: "700" },  weeklyBarList: { gap: 12, marginTop: 8 },  weeklyBarItem: { gap: 7 },  weeklyBarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },  weeklyBarLabel: { color: "#eeeeee", fontSize: 14, fontWeight: "800" },  weeklyBarValue: { color: "#a9a9a9", fontSize: 13, fontWeight: "800" },  weeklyTrack: {
    backgroundColor: "#242424",
    borderRadius: 999,
    height: 10,
    overflow: "hidden",
  },  weeklyFill: { borderRadius: 999, height: 10 },  moreButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 38,
  },  moreButtonText: { color: "#d8d8d8", fontSize: 13, fontWeight: "900" },  interpretationText: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 23,
  },});
