import React from "react";
import type { ReactNode } from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";

export type DailyTraceSectionStyles = {
  flowScroll: StyleProp<ViewStyle>;
  flowContent: StyleProp<ViewStyle>;
  flowHeaderRow: StyleProp<ViewStyle>;
  flowHeaderTextBlock: StyleProp<ViewStyle>;
  flowTitle: StyleProp<TextStyle>;
  flowSubtitle: StyleProp<TextStyle>;
  backToChatButton: StyleProp<ViewStyle>;
  backToChatButtonText: StyleProp<TextStyle>;
  traceCleanupTextButton: StyleProp<ViewStyle>;
  traceCleanupTextButtonText: StyleProp<TextStyle>;
  traceCandidateMemo: StyleProp<TextStyle>;
};

type DailyTraceSectionProps = {
  children: ReactNode;
  cleanupMessage: string;
  onBackToChat: () => void;
  onCleanupDuplicateMemories: () => void;
  styles: DailyTraceSectionStyles;
};

export function DailyTraceSection({
  children,
  cleanupMessage,
  onBackToChat,
  onCleanupDuplicateMemories,
  styles,
}: DailyTraceSectionProps) {
  return (
    <ScrollView
      style={styles.flowScroll}
      contentContainerStyle={styles.flowContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.flowHeaderRow}>
        <View style={styles.flowHeaderTextBlock}>
          <Text style={styles.flowTitle}>하루의 흔적</Text>
          <Text style={styles.flowSubtitle}>
            이번 주에 남긴 흔적이에요
          </Text>
        </View>
        <TouchableOpacity
          style={styles.backToChatButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.backToChatButtonText}>채팅</Text>
        </TouchableOpacity>
      </View>

      {children}

      <TouchableOpacity
        style={styles.traceCleanupTextButton}
        onPress={onCleanupDuplicateMemories}
        activeOpacity={0.85}
      >
        <Text style={styles.traceCleanupTextButtonText}>중복 기록 정리</Text>
      </TouchableOpacity>
      {cleanupMessage ? (
        <Text style={styles.traceCandidateMemo}>{cleanupMessage}</Text>
      ) : null}
    </ScrollView>
  );
}
