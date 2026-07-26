import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import type { DailyTraceItem, NoieProject, NoieProjectMessage, ProjectFormState } from "../../noie/types";

export function ProjectSidebarList({
  projects,
  activeProjectId,
  currentMode,
  onCreateProject,
  onSelectProject,
  getDdayLabel,
}: {
  projects: NoieProject[];
  activeProjectId: string | null;
  currentMode: string;
  onCreateProject: () => void;
  onSelectProject: (projectId: string) => void;
  getDdayLabel: (deadline?: string) => string;
}) {
  const activeProjects = projects.filter((project) => !project.isArchived);

  return (
    <>
      <Text style={styles.sidebarSectionLabel}>프로젝트</Text>
      <TouchableOpacity
        style={styles.projectCreateButton}
        onPress={onCreateProject}
        activeOpacity={0.85}
      >
        <Text style={styles.projectCreateButtonText}>+ 새 프로젝트</Text>
      </TouchableOpacity>
      {activeProjects.map((project) => {
        const isActive =
          project.id === activeProjectId && currentMode === "project";
        const dDay = getDdayLabel(project.deadline);

        return (
          <TouchableOpacity
            key={project.id}
            style={[
              styles.projectItem,
              isActive && styles.projectItemActive,
            ]}
            onPress={() => onSelectProject(project.id)}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.projectItemTitle,
                isActive && styles.projectItemTitleActive,
              ]}
              numberOfLines={1}
            >
              {project.title}
            </Text>
            {dDay ? <Text style={styles.projectDday}>{dDay}</Text> : null}
          </TouchableOpacity>
        );
      })}
    </>
  );
}

export function ProjectCreateScreen({
  form,
  onChangeForm,
  onCreateProject,
  onBackToChat,
}: {
  form: ProjectFormState;
  onChangeForm: (form: ProjectFormState) => void;
  onCreateProject: () => void;
  onBackToChat: () => void;
}) {
  const canCreate = form.title.trim().length > 0 && form.goal.trim().length > 0;

  return (
    <ScrollView
      style={styles.projectScroll}
      contentContainerStyle={styles.projectContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.projectHeaderRow}>
        <View style={styles.projectHeaderTextBlock}>
          <Text style={styles.projectTitle}>새 프로젝트</Text>
          <Text style={styles.projectSubtitle}>
            목표와 마감일이 있는 집중 작업 공간을 만듭니다.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.projectSecondaryButton}
          onPress={onBackToChat}
          activeOpacity={0.85}
        >
          <Text style={styles.projectSecondaryButtonText}>채팅으로 돌아가기</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.projectPanel}>
        <Text style={styles.projectFieldLabel}>프로젝트 이름</Text>
        <TextInput
          style={styles.projectInput}
          placeholder="예: noie 개발"
          placeholderTextColor="#7d7d7d"
          value={form.title}
          onChangeText={(title) => onChangeForm({ ...form, title })}
        />

        <Text style={styles.projectFieldLabel}>목표</Text>
        <TextInput
          style={[styles.projectInput, styles.projectTextArea]}
          placeholder="예: 개인 AI MVP 완성"
          placeholderTextColor="#7d7d7d"
          value={form.goal}
          onChangeText={(goal) => onChangeForm({ ...form, goal })}
          multiline
        />

        <Text style={styles.projectFieldLabel}>마감일</Text>
        <TextInput
          style={styles.projectInput}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#7d7d7d"
          value={form.deadline}
          onChangeText={(deadline) => onChangeForm({ ...form, deadline })}
        />

        <TouchableOpacity
          style={[
            styles.projectPrimaryButton,
            !canCreate && styles.sendButtonDisabled,
          ]}
          onPress={onCreateProject}
          disabled={!canCreate}
          activeOpacity={0.85}
        >
          <Text style={styles.projectPrimaryButtonText}>프로젝트 만들기</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export function ProjectScreen({
  project,
  dailyTraces,
  messages,
  inputText,
  isSending,
  onChangeInputText,
  onSendMessage,
  onUpdateProject,
  onArchiveProject,
  onBackToChat,
  getDdayLabel,
  getTraceTitle,
}: {
  project: NoieProject;
  dailyTraces: DailyTraceItem[];
  messages: NoieProjectMessage[];
  inputText: string;
  isSending: boolean;
  onChangeInputText: (text: string) => void;
  onSendMessage: () => void;
  onUpdateProject: (
    projectId: string,
    values: Pick<NoieProject, "title" | "goal"> & { deadline?: string }
  ) => void;
  onArchiveProject: (projectId: string) => void;
  onBackToChat: () => void;
  getDdayLabel: (deadline?: string) => string;
  getTraceTitle: (item: DailyTraceItem) => string;
}) {
  const scrollViewRef = useRef<ScrollView | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormState>({
    title: project.title,
    goal: project.goal,
    deadline: project.deadline ?? "",
  });
  const dDay = getDdayLabel(project.deadline);
  const sourceFragment = dailyTraces.find(
    (item) =>
      item.id === project.sourceDreamFragmentId ||
      item.id === project.sourceMemoryId
  );
  const relatedDream = project.relatedDreamTorchId
    ? dailyTraces.find((item) => item.id === project.relatedDreamTorchId)
    : undefined;

  useEffect(() => {
    setEditForm({
      title: project.title,
      goal: project.goal,
      deadline: project.deadline ?? "",
    });
    setIsEditing(false);
    setIsConfirmingArchive(false);
  }, [project.id, project.title, project.goal, project.deadline]);

  const saveEdit = () => {
    onUpdateProject(project.id, editForm);
    setIsEditing(false);
  };

  return (
    <View style={styles.projectShell}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.projectScroll}
        contentContainerStyle={styles.projectContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          scrollViewRef.current?.scrollToEnd({ animated: true })
        }
      >
        <View style={styles.projectHeaderRow}>
          <View style={styles.projectHeaderTextBlock}>
            <View style={styles.projectTitleRow}>
              <Text style={styles.projectTitle}>{project.title}</Text>
              {dDay ? <Text style={styles.projectDdayBadge}>{dDay}</Text> : null}
            </View>
            <Text style={styles.projectSubtitle}>프로젝트 작업 공간</Text>
            {project.fromDreamFragment ? (
              <View style={styles.projectOriginBox}>
                <Text style={styles.projectOriginText}>꿈의 파편에서 시작됨</Text>
                {relatedDream ? (
                  <Text style={styles.projectOriginText}>
                    연결된 꿈: {getTraceTitle(relatedDream)}
                  </Text>
                ) : null}
                {sourceFragment ? (
                  <Text style={styles.projectOriginText}>
                    시작 파편: {getTraceTitle(sourceFragment)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.projectSecondaryButton}
            onPress={onBackToChat}
            activeOpacity={0.85}
          >
            <Text style={styles.projectSecondaryButtonText}>채팅으로 돌아가기</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.projectPanel}>
          <View style={styles.projectPanelHeader}>
            <Text style={styles.projectPanelTitle}>목표</Text>
            <TouchableOpacity
              style={styles.projectTinyButton}
              onPress={() => setIsEditing((currentValue) => !currentValue)}
              activeOpacity={0.85}
            >
              <Text style={styles.projectTinyButtonText}>
                {isEditing ? "닫기" : "수정"}
              </Text>
            </TouchableOpacity>
          </View>

          {isEditing ? (
            <View>
              <Text style={styles.projectFieldLabel}>프로젝트 이름</Text>
              <TextInput
                style={styles.projectInput}
                value={editForm.title}
                onChangeText={(title) => setEditForm({ ...editForm, title })}
                placeholderTextColor="#7d7d7d"
              />
              <Text style={styles.projectFieldLabel}>목표</Text>
              <TextInput
                style={[styles.projectInput, styles.projectTextArea]}
                value={editForm.goal}
                onChangeText={(goal) => setEditForm({ ...editForm, goal })}
                multiline
                placeholderTextColor="#7d7d7d"
              />
              <Text style={styles.projectFieldLabel}>마감일</Text>
              <TextInput
                style={styles.projectInput}
                value={editForm.deadline}
                onChangeText={(deadline) =>
                  setEditForm({ ...editForm, deadline })
                }
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#7d7d7d"
              />
              <TouchableOpacity
                style={styles.projectPrimaryButton}
                onPress={saveEdit}
                activeOpacity={0.85}
              >
                <Text style={styles.projectPrimaryButtonText}>저장</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.projectGoalText}>{project.goal}</Text>
          )}
        </View>

        <View style={styles.projectPanel}>
          <Text style={styles.projectPanelTitle}>프로젝트 대화</Text>
          {messages.length === 0 ? (
            <Text style={styles.projectEmptyText}>
              오늘 할 작업을 noie에게 말해보세요.
            </Text>
          ) : (
            messages.map((message) => (
              <ProjectMessageBubble key={message.id} message={message} />
            ))
          )}
        </View>

        <View style={styles.projectArchiveRow}>
          {isConfirmingArchive ? (
            <>
              <Text style={styles.projectArchiveText}>이 프로젝트를 보관할까요?</Text>
              <TouchableOpacity
                style={styles.projectDangerButton}
                onPress={() => onArchiveProject(project.id)}
                activeOpacity={0.85}
              >
                <Text style={styles.projectDangerButtonText}>보관</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.projectSecondaryButton}
                onPress={() => setIsConfirmingArchive(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.projectSecondaryButtonText}>취소</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.projectSecondaryButton}
              onPress={() => setIsConfirmingArchive(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.projectSecondaryButtonText}>프로젝트 보관</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.messageInput}
          placeholder="프로젝트 작업을 입력해 주세요"
          placeholderTextColor="#8b949e"
          value={inputText}
          onChangeText={onChangeInputText}
          multiline
          editable={!isSending}
          returnKeyType="send"
          onSubmitEditing={onSendMessage}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!inputText.trim() || isSending) && styles.sendButtonDisabled,
          ]}
          onPress={onSendMessage}
          disabled={!inputText.trim() || isSending}
          activeOpacity={0.85}
        >
          <Text style={styles.sendButtonText}>전송</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ProjectMessageBubble({ message }: { message: NoieProjectMessage }) {
  const isUser = message.role === "user";

  return (
    <View
      style={[
        styles.projectMessageRow,
        isUser ? styles.projectUserMessageRow : styles.projectAssistantMessageRow,
      ]}
    >
      <View
        style={[
          styles.projectMessageBubble,
          isUser ? styles.projectUserBubble : styles.projectAssistantBubble,
        ]}
      >
        {message.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#f2f4f8" />
            <Text style={styles.assistantText}>{message.content}</Text>
          </View>
        ) : (
          <Text
            style={isUser ? styles.userText : styles.projectAssistantText}
          >
            {message.content}
          </Text>
        )}
        {message.error ? <Text style={styles.errorText}>{message.error}</Text> : null}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  sidebarSectionLabel: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
    marginTop: 18,
  },
  projectCreateButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    marginBottom: 8,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  projectCreateButtonText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "900",
  },
  projectItem: {
    borderRadius: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  projectItemActive: { backgroundColor: "#2a2b32" },
  projectItemTitle: {
    color: "#c9d1d9",
    fontSize: 14,
    fontWeight: "800",
  },
  projectItemTitleActive: { color: "#ffffff" },
  projectDday: {
    color: "#34d399",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },
  projectScroll: { flex: 1 },
  projectContent: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingBottom: 34,
  },
  projectHeaderRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 14,
  },
  projectHeaderTextBlock: { flex: 1, minWidth: 220 },
  projectTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 30,
  },
  projectSubtitle: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  projectSecondaryButton: {
    alignItems: "center",
    borderColor: "#3a3a3a",
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  projectSecondaryButtonText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "900",
  },
  projectPanel: {
    backgroundColor: "#111111",
    borderColor: "#262626",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    padding: 14,
  },
  projectFieldLabel: {
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 7,
    marginTop: 10,
  },
  projectInput: {
    backgroundColor: "#0a0a0a",
    borderColor: "#333333",
    borderRadius: 8,
    borderWidth: 1,
    color: "#ffffff",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  projectTextArea: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  projectPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 9,
    justifyContent: "center",
    marginTop: 14,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  sendButtonDisabled: { opacity: 0.38 },
  projectPrimaryButtonText: {
    color: "#050505",
    fontSize: 14,
    fontWeight: "900",
  },
  projectShell: { flex: 1, backgroundColor: "#050505" },
  projectTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  projectDdayBadge: {
    backgroundColor: "#123026",
    borderColor: "#1f6f55",
    borderRadius: 999,
    borderWidth: 1,
    color: "#34d399",
    fontSize: 13,
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  projectOriginBox: {
    alignSelf: "flex-start",
    backgroundColor: "#151515",
    borderColor: "#303030",
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  projectOriginText: {
    color: "#aeb4c0",
    fontSize: 12,
    lineHeight: 17,
  },
  projectPanelHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  projectPanelTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 8,
  },
  projectTinyButton: {
    borderColor: "#3a3a3a",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  projectTinyButtonText: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "900",
  },
  projectGoalText: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 23,
  },
  projectEmptyText: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 21,
    paddingVertical: 10,
  },
  projectArchiveRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  projectArchiveText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
  },
  projectDangerButton: {
    alignItems: "center",
    backgroundColor: "#3a1515",
    borderColor: "#7f1d1d",
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  projectDangerButtonText: {
    color: "#fecaca",
    fontSize: 13,
    fontWeight: "900",
  },
  inputBar: {
    alignItems: "flex-end",
    backgroundColor: "#050505",
    borderTopColor: "#1f1f1f",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageInput: {
    backgroundColor: "#171717",
    borderColor: "#333333",
    borderRadius: 12,
    borderWidth: 1,
    color: "#ffffff",
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#f2f4f8",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  sendButtonText: { color: "#050505", fontSize: 15, fontWeight: "900" },
  projectMessageRow: {
    flexDirection: "row",
    marginTop: 12,
  },
  projectUserMessageRow: { justifyContent: "flex-end" },
  projectAssistantMessageRow: { justifyContent: "flex-start" },
  projectMessageBubble: {
    borderRadius: 12,
    maxWidth: "90%",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  projectUserBubble: {
    backgroundColor: "#2f6fed",
    borderBottomRightRadius: 4,
  },
  projectAssistantBubble: {
    backgroundColor: "#171717",
    borderColor: "#2b2b2b",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  assistantText: { color: "#f2f4f8", fontSize: 15, lineHeight: 22 },
  userText: { color: "#ffffff", fontSize: 16, lineHeight: 23 },
  projectAssistantText: {
    color: "#f2f4f8",
    fontSize: 15,
    lineHeight: 22,
  },
  errorText: {
    color: "#ffb4b4",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
  },
});
