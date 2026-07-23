import React, { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  PanResponder,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import type { DailyTraceItem } from "../../noie/types";
import { TRACE_REMINDER_OPTIONS } from "../../constants/appConstants";
import {
  addMonths,
  buildCalendarMonth,
  formatMonthTitle,
  getLocalDateString,
  getMonthStart,
  parseDateOnly,
} from "../../noie/dateUtils";
import type { DailyLongRecord } from "./traceFeature";
import {
  buildWeeklyTraceDates,
  isFutureDateKey,
  shiftTraceDateKey,
} from "./traceFeature";

export type DailyTraceHelpers = {
  getDailyTraceItemsForDate: (items: DailyTraceItem[], dateKey: string) => DailyTraceItem[];
  isScheduledDailyTraceItemForDate: (item: DailyTraceItem, dateKey: string) => boolean;
  buildUpcomingTraceSchedules: (items: DailyTraceItem[], todayKey: string) => Array<{ item: DailyTraceItem; dateKey: string; reminderLabel: string }>;
  getTraceDaySymbol: (items: DailyTraceItem[], dateKey: string, selectedDate: string) => string;
  formatShortTraceDate: (dateKey: string) => string;
  formatDailyTraceSelectedDate: (dateKey: string) => string;
  getEmptySelectedDayText: (dateKey: string, todayKey: string) => string;
  getTraceScheduleSectionTitle: (dateKey: string, todayKey: string) => string;
  getTraceRemainingSectionTitle: (dateKey: string, todayKey: string) => string;
  getDailyLongRecordTitle: (dateKey: string, todayKey: string) => string;
  getEmptyLongRecordText: (dateKey: string, todayKey: string) => string;
  formatTimeFromIso: (value: string) => string;
  formatUpcomingTraceDate: (dateKey: string, todayKey: string) => string;
  getTraceReminderLabel: (item: DailyTraceItem) => string;
  isLifeRepeatTraceItem: (item: DailyTraceItem) => boolean;
  getDailyTraceRowMemo: (item: DailyTraceItem, dateKey?: string) => string | undefined;
  getDailyTraceDisplayTime: (item: DailyTraceItem, dateKey?: string) => string;
  getDailyTraceRowSource: (item: DailyTraceItem, dateKey?: string) => string;
  getDailyTraceRowIcon: (item: DailyTraceItem, dateKey?: string) => string;
};

export type DailyTraceSectionStyles = Record<string, any>;

type DailyTraceFrameProps = {
  children: ReactNode;
  cleanupMessage: string;
  onBackToChat: () => void;
  onCleanupDuplicateMemories: () => void;
  styles: DailyTraceSectionStyles;
};

export function DailyTraceFrame({
  children,
  cleanupMessage,
  onBackToChat,
  onCleanupDuplicateMemories,
  styles,
}: DailyTraceFrameProps) {
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
export function DailyTraceCalendar({
  styles,
  helpers,
  items,
  dailyLongRecords,
  selectedDate,
  calendarMonth,
  onSelectDate,
  onChangeMonth,
  onToggleDone,
  onAddItem,
  onSaveLongRecord,
  onDeleteSchedule,
  onSkipLifeRepeatSchedule,
  onEndLifeRepeatSchedule,
  onDeleteLifeRepeatSchedule,
}: {
  styles: DailyTraceSectionStyles;
  helpers: DailyTraceHelpers;
  items: DailyTraceItem[];
  dailyLongRecords: DailyLongRecord[];
  selectedDate: string;
  calendarMonth: Date;
  onSelectDate: (date: string) => void;
  onChangeMonth: (date: Date) => void;
  onToggleDone: (itemId: string, dateKey?: string) => void;
  onAddItem: (input: {
    type: "todo" | "schedule" | "record";
    date: string;
    title: string;
    time?: string;
    endTime?: string;
    reminder?: string;
  }) => boolean;
  onSaveLongRecord: (input: {
    dateKey: string;
    title?: string;
    body: string;
  }) => boolean;
  onDeleteSchedule: (itemId: string) => Promise<{ didDelete: boolean; title: string }>;
  onSkipLifeRepeatSchedule: (itemId: string, dateKey: string) => Promise<boolean>;
  onEndLifeRepeatSchedule: (itemId: string, dateKey: string) => Promise<boolean>;
  onDeleteLifeRepeatSchedule: (itemId: string) => Promise<boolean>;
}) {
  const {
    getDailyTraceItemsForDate,
    isScheduledDailyTraceItemForDate,
    buildUpcomingTraceSchedules,
    getTraceDaySymbol,
    formatShortTraceDate,
    formatDailyTraceSelectedDate,
    getEmptySelectedDayText,
    getTraceScheduleSectionTitle,
    getTraceRemainingSectionTitle,
    getDailyLongRecordTitle,
    getEmptyLongRecordText,
    formatTimeFromIso,
    formatUpcomingTraceDate,
  } = helpers;
  const [isMonthCalendarOpen, setIsMonthCalendarOpen] = useState(false);
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [isLongRecordEditorOpen, setIsLongRecordEditorOpen] = useState(false);
  const [isLongRecordExpanded, setIsLongRecordExpanded] = useState(false);
  const [longRecordTitle, setLongRecordTitle] = useState("");
  const [longRecordBody, setLongRecordBody] = useState("");
  const [showAllUpcomingSchedules, setShowAllUpcomingSchedules] = useState(false);
  const [addMode, setAddMode] = useState<"todo" | "schedule" | "record" | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addTime, setAddTime] = useState("");
  const [addEndTime, setAddEndTime] = useState("");
  const [addReminder, setAddReminder] = useState("none");
  const [scheduleMenuTarget, setScheduleMenuTarget] = useState<{ itemId: string; dateKey: string } | null>(null);
  const monthCells = buildCalendarMonth(calendarMonth);
  const weekDates = useMemo(() => buildWeeklyTraceDates(selectedDate), [selectedDate]);
  const selectedItems = useMemo(
    () => getDailyTraceItemsForDate(items, selectedDate),
    [items, selectedDate]
  );
  const scheduledItems = selectedItems.filter((item) => isScheduledDailyTraceItemForDate(item, selectedDate));
  const remainingItems = selectedItems.filter((item) => !isScheduledDailyTraceItemForDate(item, selectedDate));
  const todayKey = getLocalDateString(new Date());
  const isSelectedToday = selectedDate === todayKey;
  const isSelectedFuture = isFutureDateKey(selectedDate, todayKey);
  const hasSelectedDayItems = scheduledItems.length > 0 || remainingItems.length > 0;
  const selectedLongRecord = dailyLongRecords.find((record) => record.dateKey === selectedDate);
  const upcomingSchedules = useMemo(
    () => buildUpcomingTraceSchedules(items, todayKey),
    [items, todayKey]
  );
  const displayedUpcomingSchedules = showAllUpcomingSchedules
    ? upcomingSchedules
    : upcomingSchedules.slice(0, 3);

  useEffect(() => {
    setIsLongRecordEditorOpen(false);
    setIsLongRecordExpanded(false);
    setScheduleMenuTarget(null);
  }, [selectedDate]);

  const selectTraceDate = (dateKey: string) => {
    onSelectDate(dateKey);
    const nextMonth = parseDateOnly(dateKey);
    if (nextMonth) {
      onChangeMonth(getMonthStart(nextMonth));
    }
  };

  const moveWeek = (dayDelta: number) => {
    const nextDate = shiftTraceDateKey(selectedDate, dayDelta);
    selectTraceDate(nextDate);
  };
  const openLongRecordEditor = () => {
    setLongRecordTitle(selectedLongRecord?.title ?? "");
    setLongRecordBody(selectedLongRecord?.body ?? "");
    setIsLongRecordEditorOpen(true);
  };
  const saveLongRecord = () => {
    const saved = onSaveLongRecord({
      dateKey: selectedDate,
      title: longRecordTitle,
      body: longRecordBody,
    });

    if (saved) {
      setIsLongRecordEditorOpen(false);
      setIsLongRecordExpanded(false);
    }
  };
  const resetAddForm = () => {
    setAddTitle("");
    setAddTime("");
    setAddEndTime("");
    setAddReminder("none");
    setAddMode(null);
  };
  const openAddMode = (mode: "todo" | "schedule" | "record") => {
    resetAddForm();
    setAddMode(mode);
  };
  const saveAddedItem = () => {
    if (isSelectedFuture && addMode === "record") {
      return;
    }

    if (addMode === "schedule" && addEndTime && addTime && addEndTime < addTime) {
      return;
    }

    const saved = onAddItem({
      type: addMode ?? "record",
      date: selectedDate,
      title: addTitle,
      time: addTime,
      endTime: addMode === "schedule" ? addEndTime : undefined,
      reminder: addReminder,
    });

    if (saved) {
      resetAddForm();
      setIsAddPanelOpen(false);
    }
  };
  const closeScheduleMenu = () => {
    setScheduleMenuTarget(null);
  };
  const confirmDeleteSchedule = async (item: DailyTraceItem) => {
    console.log("[TRACE DELETE] 삭제 버튼 클릭", {
      itemId: item.id,
      title: item.title,
    });

    if (Platform.OS === "web") {
      const webGlobal = globalThis as typeof globalThis & {
        window?: { confirm?: (message: string) => boolean };
      };
      if (typeof webGlobal.window !== "undefined" && typeof webGlobal.window.confirm === "function") {
        const confirmed = webGlobal.window.confirm(`${item.title} 일정을 삭제할까요?`);
        if (!confirmed) {
          return;
        }

        console.log("[TRACE DELETE] 웹 삭제 확인 완료", {
          itemId: item.id,
        });
        closeScheduleMenu();

        try {
          console.log("[TRACE DELETE] 실제 삭제 함수 호출", {
            itemId: item.id,
          });
          const result = await onDeleteSchedule(item.id);
          console.log("[TRACE DELETE] 삭제 완료", {
            itemId: item.id,
            didDelete: result.didDelete,
          });
        } catch (error) {
          console.error("[TRACE DELETE] 일정 삭제 실패", error);
        }
        return;
      }
    }

    Alert.alert(`${item.title} 일정을 삭제할까요?`, "", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제하기",
        style: "destructive",
        onPress: () => {
          closeScheduleMenu();
          console.log("[TRACE DELETE] 웹 삭제 확인 완료", {
            itemId: item.id,
          });
          console.log("[TRACE DELETE] 실제 삭제 함수 호출", {
            itemId: item.id,
          });
          onDeleteSchedule(item.id)
            .then((result) => {
              console.log("[TRACE DELETE] 삭제 완료", {
                itemId: item.id,
                didDelete: result.didDelete,
              });
            })
            .catch((error) => console.error("[TRACE DELETE] 일정 삭제 실패", error));
        },
      },
    ]);
  };
  const confirmSkipLifeRepeat = (item: DailyTraceItem) => {
    Alert.alert(`${formatShortTraceDate(selectedDate)}의 ${item.title} 일정만 건너뛸까요?`, "", [
      { text: "취소", style: "cancel" },
      {
        text: "건너뛰기",
        style: "destructive",
        onPress: () => {
          closeScheduleMenu();
          onSkipLifeRepeatSchedule(item.id, selectedDate).catch((error) =>
            console.log("[noie] 반복 일정 하루 제외 실패", error)
          );
        },
      },
    ]);
  };
  const confirmEndLifeRepeat = (item: DailyTraceItem) => {
    Alert.alert(`${item.title} 반복 일정을 ${formatShortTraceDate(selectedDate)}부터 종료할까요?`, "", [
      { text: "취소", style: "cancel" },
      {
        text: "종료하기",
        style: "destructive",
        onPress: () => {
          closeScheduleMenu();
          onEndLifeRepeatSchedule(item.id, selectedDate).catch((error) =>
            console.log("[noie] 반복 일정 종료 실패", error)
          );
        },
      },
    ]);
  };
  const confirmDeleteLifeRepeat = (item: DailyTraceItem) => {
    Alert.alert(`${item.title} 반복 일정을 완전히 삭제할까요?`, "과거에 실제로 완료한 기록은 유지돼요.", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제하기",
        style: "destructive",
        onPress: () => {
          closeScheduleMenu();
          onDeleteLifeRepeatSchedule(item.id).catch((error) =>
            console.log("[noie] 반복 일정 삭제 실패", error)
          );
        },
      },
    ]);
  };
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dx) > 22 && Math.abs(gestureState.dy) < 16,
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dx > 42) {
            moveWeek(-7);
          } else if (gestureState.dx < -42) {
            moveWeek(7);
          }
        },
      }),
    [selectedDate]
  );

  return (
    <View style={styles.traceSurface}>
      <View style={styles.traceWeekHeader}>
        <TouchableOpacity
          style={styles.calendarNavButton}
          onPress={() => moveWeek(-7)}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarNavText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.traceMonthToggle}
          onPress={() => setIsMonthCalendarOpen((value) => !value)}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarMonthTitle}>
            {formatMonthTitle(calendarMonth)} {isMonthCalendarOpen ? "▴" : "▾"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.calendarNavButton}
          onPress={() => moveWeek(7)}
          activeOpacity={0.85}
        >
          <Text style={styles.calendarNavText}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.traceConstellation} {...panResponder.panHandlers}>
        <View style={styles.traceWeekDateRow}>
          {weekDates.map((dateKey) => {
            const date = parseDateOnly(dateKey) ?? new Date();
            const isToday = dateKey === todayKey;
            return (
              <TouchableOpacity
                key={`date-${dateKey}`}
                style={styles.traceWeekDayButton}
                onPress={() => selectTraceDate(dateKey)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.traceWeekDateText,
                    isToday && styles.traceWeekDateTextToday,
                    dateKey === selectedDate && styles.traceWeekDateTextSelected,
                  ]}
                >
                  {date.getDate()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.traceStarRow}>
          {weekDates.map((dateKey, index) => (
            <React.Fragment key={`star-${dateKey}`}>
              <View style={styles.traceStarSlot}>
                <TouchableOpacity
                  style={styles.traceStarButton}
                  onPress={() => selectTraceDate(dateKey)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.traceStarSymbol,
                      dateKey === todayKey && dateKey !== selectedDate && styles.traceStarSymbolToday,
                      dateKey === selectedDate && styles.traceStarSymbolSelected,
                    ]}
                  >
                    {getTraceDaySymbol(items, dateKey, selectedDate)}
                  </Text>
                </TouchableOpacity>
                {dateKey === todayKey ? <Text style={styles.traceTodayLabel}>오늘</Text> : null}
              </View>
              {index < weekDates.length - 1 ? <View style={styles.traceStarLine} /> : null}
            </React.Fragment>
          ))}
        </View>
      </View>

      {isMonthCalendarOpen ? (
        <View style={styles.traceMonthPanel}>
          <View style={styles.calendarHeader}>
            <TouchableOpacity
              style={styles.calendarNavButton}
              onPress={() => onChangeMonth(addMonths(calendarMonth, -1))}
              activeOpacity={0.85}
            >
              <Text style={styles.calendarNavText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.calendarMonthTitle}>{formatMonthTitle(calendarMonth)}</Text>
            <TouchableOpacity
              style={styles.calendarNavButton}
              onPress={() => onChangeMonth(addMonths(calendarMonth, 1))}
              activeOpacity={0.85}
            >
              <Text style={styles.calendarNavText}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.weekdayRow}>
            {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
              <Text key={day} style={styles.weekdayText}>
                {day}
              </Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {monthCells.map((cell) => {
              const dateKey = getLocalDateString(cell.date);
              const isSelected = dateKey === selectedDate;
              const dayItems = getDailyTraceItemsForDate(items, dateKey);
              const hasItems = dayItems.length > 0;

              return (
                <TouchableOpacity
                  key={dateKey}
                  style={[
                    styles.calendarDayCell,
                    !cell.isCurrentMonth && styles.calendarDayMuted,
                    isSelected && styles.calendarDaySelected,
                  ]}
                  onPress={() => {
                    selectTraceDate(dateKey);
                    setIsMonthCalendarOpen(false);
                  }}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.calendarDayText,
                      !cell.isCurrentMonth && styles.calendarDayTextMuted,
                      isSelected && styles.calendarDayTextSelected,
                    ]}
                  >
                    {cell.date.getDate()}
                  </Text>
                  {hasItems ? <View style={styles.calendarDot} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.traceDetail}>
        <View style={styles.traceDetailHeaderRow}>
          <Text style={styles.traceDateTitle}>{formatDailyTraceSelectedDate(selectedDate)}</Text>
          <View style={styles.traceHeaderActions}>
            {!isSelectedToday ? (
              <TouchableOpacity
                style={styles.traceTodayButton}
                onPress={() => selectTraceDate(todayKey)}
                activeOpacity={0.85}
              >
                <Text style={styles.traceTodayButtonText}>오늘로</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.traceAddButton}
              onPress={() => setIsAddPanelOpen((value) => !value)}
              activeOpacity={0.85}
            >
              <Text style={styles.traceAddButtonText}>+ 날짜에 남기기</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isAddPanelOpen ? (
          <View style={styles.traceAddPanel}>
            <Text style={styles.traceAddPanelTitle}>이 날짜에 무엇을 남길까요?</Text>
            <View style={styles.traceAddModeRow}>
              {([
                ["todo", "○ 할 일"],
                ["schedule", "▣ 일정"],
                ["record", "💬 기록"],
              ] as Array<["todo" | "schedule" | "record", string]>)
                .filter(([mode]) => !(isSelectedFuture && mode === "record"))
                .map(([mode, label]) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.traceAddModeButton, addMode === mode && styles.traceAddModeButtonActive]}
                  onPress={() => openAddMode(mode)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.traceAddModeText, addMode === mode && styles.traceAddModeTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {addMode ? (
              <View style={styles.traceAddForm}>
                <TextInput
                  style={styles.traceAddInput}
                  placeholder={addMode === "schedule" ? "일정 제목" : addMode === "todo" ? "제목" : "짧은 기록 내용"}
                  placeholderTextColor="#6b7280"
                  value={addTitle}
                  onChangeText={setAddTitle}
                />
                {addMode !== "record" ? (
                  <>
                    <TextInput
                      style={styles.traceAddInput}
                      placeholder={addMode === "schedule" ? "시작 시간 예: 08:30" : "예정 시간 예: 08:30"}
                      placeholderTextColor="#6b7280"
                      value={addTime}
                      onChangeText={setAddTime}
                    />
                    {addMode === "schedule" ? (
                      <TextInput
                        style={styles.traceAddInput}
                        placeholder="종료 시간 예: 09:30"
                        placeholderTextColor="#6b7280"
                        value={addEndTime}
                        onChangeText={setAddEndTime}
                      />
                    ) : null}
                    <View style={styles.traceReminderRow}>
                      {TRACE_REMINDER_OPTIONS.map((option) => (
                        <TouchableOpacity
                          key={option.value}
                          style={[
                            styles.traceReminderChip,
                            addReminder === option.value && styles.traceReminderChipActive,
                          ]}
                          onPress={() => setAddReminder(option.value)}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={[
                              styles.traceReminderChipText,
                              addReminder === option.value && styles.traceReminderChipTextActive,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
                <TouchableOpacity
                  style={[styles.traceAddSaveButton, !addTitle.trim() && styles.traceAddSaveButtonDisabled]}
                  onPress={saveAddedItem}
                  disabled={!addTitle.trim()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.traceAddSaveButtonText}>
                    {addMode === "record" ? "남기기" : "저장"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}

        {!hasSelectedDayItems ? (
          <Text style={styles.traceEmptyDayText}>{getEmptySelectedDayText(selectedDate, todayKey)}</Text>
        ) : (
          <>
            {scheduledItems.length > 0 ? (
              <>
                <Text style={styles.traceDetailTitle}>
                  {getTraceScheduleSectionTitle(selectedDate, todayKey)} · {scheduledItems.length}개
                </Text>
                <View style={styles.traceRecordList}>
                  {scheduledItems.map((item, index) => (
                    <DailyTraceScheduledRow
                      styles={styles}
                      helpers={helpers}
                      key={item.id}
                      item={item}
                      isLast={index === scheduledItems.length - 1}
                      dateKey={selectedDate}
                      onComplete={onToggleDone}
                      isMenuOpen={scheduleMenuTarget?.itemId === item.id && scheduleMenuTarget.dateKey === selectedDate}
                      onOpenMenu={() =>
                        setScheduleMenuTarget((current) =>
                          current?.itemId === item.id && current.dateKey === selectedDate
                            ? null
                            : { itemId: item.id, dateKey: selectedDate }
                        )
                      }
                      onCloseMenu={closeScheduleMenu}
                      onDeleteSchedule={confirmDeleteSchedule}
                      onSkipLifeRepeat={confirmSkipLifeRepeat}
                      onEndLifeRepeat={confirmEndLifeRepeat}
                      onDeleteLifeRepeat={confirmDeleteLifeRepeat}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {remainingItems.length > 0 ? (
              <>
                <Text style={[styles.traceDetailTitle, scheduledItems.length > 0 && styles.traceRemainingTitle]}>
                  {getTraceRemainingSectionTitle(selectedDate, todayKey)} · {remainingItems.length}개
                </Text>
                <View style={styles.traceRecordList}>
                  {remainingItems.map((item, index) => (
                    <DailyTraceRecordRow
                      styles={styles}
                      helpers={helpers}
                      key={item.id}
                      item={item}
                      dateKey={selectedDate}
                      isLast={index === remainingItems.length - 1}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}

        <View style={styles.traceLongRecordBox}>
          <View style={styles.traceLongRecordHeader}>
            <Text style={styles.traceLongRecordTitle}>
              {getDailyLongRecordTitle(selectedDate, todayKey)}
            </Text>
            {!isSelectedFuture ? (
              <TouchableOpacity
                style={styles.traceLongRecordAction}
                onPress={openLongRecordEditor}
                activeOpacity={0.85}
              >
                <Text style={styles.traceLongRecordActionText}>
                  {selectedLongRecord ? "수정" : isSelectedToday ? "기록 쓰기" : "기록 남기기"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {isLongRecordEditorOpen ? (
            <View style={styles.traceLongRecordEditor}>
              <View style={styles.traceLongRecordEditorHeader}>
                <Text style={styles.traceLongRecordEditorTitle}>
                  {getDailyLongRecordTitle(selectedDate, todayKey)}
                </Text>
                <TouchableOpacity onPress={() => setIsLongRecordEditorOpen(false)} activeOpacity={0.85}>
                  <Text style={styles.traceLongRecordActionText}>닫기</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.traceLongRecordLabel}>제목 · 선택</Text>
              <TextInput
                style={styles.traceLongRecordInput}
                placeholder="제목"
                placeholderTextColor="#6b7280"
                value={longRecordTitle}
                onChangeText={setLongRecordTitle}
              />
              <Text style={styles.traceLongRecordLabel}>오늘의 이야기</Text>
              <TextInput
                style={[styles.traceLongRecordInput, styles.traceLongRecordBodyInput]}
                placeholder="오늘 남기고 싶은 이야기를 적어주세요"
                placeholderTextColor="#6b7280"
                value={longRecordBody}
                onChangeText={setLongRecordBody}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[
                  styles.traceLongRecordSaveButton,
                  !longRecordBody.trim() && styles.traceAddSaveButtonDisabled,
                ]}
                onPress={saveLongRecord}
                disabled={!longRecordBody.trim()}
                activeOpacity={0.85}
              >
                <Text style={styles.traceLongRecordSaveButtonText}>저장</Text>
              </TouchableOpacity>
            </View>
          ) : selectedLongRecord ? (
            <View style={styles.traceLongRecordContent}>
              {selectedLongRecord.title ? (
                <Text style={styles.traceLongRecordContentTitle}>{selectedLongRecord.title}</Text>
              ) : null}
              <Text
                style={styles.traceLongRecordBody}
                numberOfLines={isLongRecordExpanded ? undefined : 4}
              >
                {selectedLongRecord.body}
              </Text>
              {selectedLongRecord.body.length > 120 ? (
                <TouchableOpacity
                  style={styles.traceLongRecordMoreButton}
                  onPress={() => setIsLongRecordExpanded((value) => !value)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.traceLongRecordActionText}>
                    {isLongRecordExpanded ? "접기" : "더 보기"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.traceLongRecordSavedAt}>{formatTimeFromIso(selectedLongRecord.updatedAt)}</Text>
            </View>
          ) : (
            <View style={styles.traceLongRecordContent}>
              <Text style={styles.traceEmptySmallText}>
                {getEmptyLongRecordText(selectedDate, todayKey)}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.traceAdjacentRow}>
        <TouchableOpacity onPress={() => selectTraceDate(shiftTraceDateKey(selectedDate, -1))} activeOpacity={0.85}>
          <Text style={styles.traceAdjacentText}>‹ {formatShortTraceDate(shiftTraceDateKey(selectedDate, -1))}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => selectTraceDate(shiftTraceDateKey(selectedDate, 1))} activeOpacity={0.85}>
          <Text style={styles.traceAdjacentText}>{formatShortTraceDate(shiftTraceDateKey(selectedDate, 1))} ›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.traceUpcomingBox}>
        <View style={styles.traceLongRecordHeader}>
          <Text style={styles.traceLongRecordTitle}>다가오는 예정</Text>
          {upcomingSchedules.length > 3 ? (
            <TouchableOpacity
              style={styles.traceLongRecordAction}
              onPress={() => setShowAllUpcomingSchedules((value) => !value)}
              activeOpacity={0.85}
            >
              <Text style={styles.traceLongRecordActionText}>
                {showAllUpcomingSchedules ? "접기" : "전체 보기"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {upcomingSchedules.length === 0 ? (
          <View style={styles.traceUpcomingEmptyRow}>
            <Text style={styles.traceEmptySmallText}>아직 예정된 일이 없어요.</Text>
            <TouchableOpacity
              style={styles.traceLongRecordAction}
              onPress={() => {
                setIsAddPanelOpen(true);
                openAddMode("todo");
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.traceLongRecordActionText}>+ 남기기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.traceUpcomingTimeline}>
            {displayedUpcomingSchedules.map((schedule, index) => (
              <TouchableOpacity
                key={`${schedule.item.id}:${schedule.dateKey}`}
                style={[
                  styles.traceUpcomingRow,
                  index === displayedUpcomingSchedules.length - 1 && styles.traceRecordRowLast,
                ]}
                onPress={() => selectTraceDate(schedule.dateKey)}
                activeOpacity={0.85}
              >
                <Text style={styles.traceUpcomingDate}>
                  {index === 0 || displayedUpcomingSchedules[index - 1].dateKey !== schedule.dateKey
                    ? formatUpcomingTraceDate(schedule.dateKey, todayKey)
                    : ""}
                </Text>
                <Text style={styles.traceRecordTime}>{schedule.item.time ?? ""}</Text>
                <Text style={styles.traceTodoCompleteText}>○</Text>
                <View style={styles.traceRecordTextBlock}>
                  <Text style={styles.traceItemTitle}>{schedule.item.title}</Text>
                  {schedule.reminderLabel ? (
                    <Text style={styles.traceItemMemo}>🔔 {schedule.reminderLabel}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function DailyTraceScheduledRow({
  styles,
  helpers,
  item,
  isLast,
  dateKey,
  onComplete,
  isMenuOpen,
  onOpenMenu,
  onCloseMenu,
  onDeleteSchedule,
  onSkipLifeRepeat,
  onEndLifeRepeat,
  onDeleteLifeRepeat,
}: {
  styles: DailyTraceSectionStyles;
  helpers: DailyTraceHelpers;
  item: DailyTraceItem;
  isLast: boolean;
  dateKey: string;
  onComplete: (itemId: string, dateKey?: string) => void;
  isMenuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onDeleteSchedule: (item: DailyTraceItem) => void;
  onSkipLifeRepeat: (item: DailyTraceItem) => void;
  onEndLifeRepeat: (item: DailyTraceItem) => void;
  onDeleteLifeRepeat: (item: DailyTraceItem) => void;
}) {
  const { getTraceReminderLabel, isLifeRepeatTraceItem } = helpers;
  const reminderLabel = getTraceReminderLabel(item);
  const isLifeRepeat = isLifeRepeatTraceItem(item);
  const repeatLabel = isLifeRepeat ? "매일 반복 · " : "";

  return (
    <View style={[styles.traceScheduleRow, isLast && styles.traceRecordRowLast]}>
      <View style={styles.traceScheduleRowMain}>
        <Text style={styles.traceRecordTime}>{item.time ?? ""}</Text>
        <TouchableOpacity
          style={styles.traceTodoCompleteButton}
          onPress={() => item.type === "todo" && onComplete(item.id, dateKey)}
          disabled={item.type !== "todo"}
          activeOpacity={0.85}
        >
          <Text style={styles.traceTodoCompleteText}>○</Text>
        </TouchableOpacity>
        <View style={styles.traceRecordTextBlock}>
          <Text style={styles.traceItemTitle}>{item.title}</Text>
          {reminderLabel && reminderLabel !== "없음" ? (
            <Text style={styles.traceItemMemo}>{repeatLabel}🔔 {reminderLabel}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.traceScheduleMenuButton}
          onPress={onOpenMenu}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="일정 관리 메뉴"
        >
          <Text style={styles.traceScheduleMenuButtonText}>⋯</Text>
        </TouchableOpacity>
      </View>
      {isMenuOpen ? (
        <View style={styles.traceScheduleMenuPanel}>
          {isLifeRepeat ? (
            <>
              <TouchableOpacity
                style={styles.traceScheduleMenuItem}
                onPress={() => onSkipLifeRepeat(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.traceScheduleMenuItemText}>오늘만 건너뛰기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.traceScheduleMenuItem}
                onPress={() => onEndLifeRepeat(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.traceScheduleMenuDangerText}>반복 종료하기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.traceScheduleMenuItem}
                onPress={() => onDeleteLifeRepeat(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.traceScheduleMenuDangerText}>반복 일정 삭제하기</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.traceScheduleMenuItem}
              onPress={() => onDeleteSchedule(item)}
              activeOpacity={0.85}
            >
              <Text style={styles.traceScheduleMenuDangerText}>삭제하기</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.traceScheduleMenuItem} onPress={onCloseMenu} activeOpacity={0.85}>
            <Text style={styles.traceScheduleMenuItemText}>취소</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function DailyTraceRecordRow({
  styles,
  helpers,
  item,
  dateKey,
  isLast,
}: {
  styles: DailyTraceSectionStyles;
  helpers: DailyTraceHelpers;
  item: DailyTraceItem;
  dateKey: string;
  isLast: boolean;
}) {
  const { getDailyTraceRowMemo, getDailyTraceDisplayTime, getDailyTraceRowSource, getDailyTraceRowIcon } = helpers;
  const memo = getDailyTraceRowMemo(item, dateKey);
  const displayTime = getDailyTraceDisplayTime(item, dateKey);
  const source = getDailyTraceRowSource(item, dateKey);

  return (
    <View style={[styles.traceRecordRow, isLast && styles.traceRecordRowLast]}>
      <Text style={styles.traceRecordTime}>{displayTime}</Text>
      <Text style={styles.traceRecordIcon}>{getDailyTraceRowIcon(item, dateKey)}</Text>
      <View style={styles.traceRecordTextBlock}>
        <Text style={styles.traceItemTitle}>
          {item.title}
        </Text>
        {memo ? <Text style={styles.traceItemMemo}>{memo}</Text> : null}
        {source ? <Text style={styles.traceItemSource}>{source}</Text> : null}
      </View>
    </View>
  );
}

