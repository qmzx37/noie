import type {
  DailyTraceCandidate,
  DailyTraceItemType,
  MemorySavePolicy,
  MemorySavePolicyType,
} from "./types";
import type { NoieSaveRoutingResult } from "./memoryLogic";
import { formatRoutineTarget, formatRoutineTargetForDisplay } from "../features/traces/dailyTraceRoutingLogic";
import { getDailyLongRecordTitle } from "../features/traces/traceFeature";
import { makeMemoryTitle } from "../features/traces/lifeScheduleRoutingLogic";

type BuildRoutedDailyTraceCandidateInput = {
  userText: string;
  extractedCandidate: DailyTraceCandidate | null;
  memoryPolicy: MemorySavePolicy;
  routingResult: NoieSaveRoutingResult;
  todayKey: string;
};

export function buildRoutedDailyTraceCandidate({
  userText,
  extractedCandidate,
  memoryPolicy,
  routingResult,
  todayKey,
}: BuildRoutedDailyTraceCandidateInput): DailyTraceCandidate | null {
  let resolvedTraceCandidate = routingResult.route === "none"
    ? null
    : resolveDailyTraceCandidate(
    userText,
    extractedCandidate,
    memoryPolicy,
    todayKey
  );
  if (
    !resolvedTraceCandidate &&
    (routingResult.route === "routine_adjustment_intent" ||
      routingResult.route === "routine_adjustment_confirm" ||
      routingResult.route === "routine_remove")
  ) {
    resolvedTraceCandidate = {
      type: "todo",
      date: todayKey,
      title: routingResult.title,
      memo: routingResult.originalText,
    };
  }
  if (resolvedTraceCandidate) {
    if (routingResult.route === "routine_create") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = routingResult.targetValue
        ? `목표 시간 · ${formatRoutineTargetForDisplay(routingResult.targetValue, routingResult.unit)}`
        : `반복 · ${routingResult.repeatType === "weekly" ? "매주" : "매일"}`;
    }
    if (routingResult.route === "project_create") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "오늘의 나 프로젝트";
    }
    if (routingResult.route === "routine_record") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = `실제 수행량 · ${formatRoutineTarget(routingResult.displayValue ?? routingResult.actualValue ?? 0, routingResult.displayUnit ?? routingResult.actualUnit ?? routingResult.unit)}`;
    }
    if (routingResult.route === "routine_remove") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = routingResult.targetValue
        ? `목표 시간 · ${formatRoutineTargetForDisplay(routingResult.targetValue, routingResult.unit)}`
        : "";
    }
    if (routingResult.route === "important_day_event") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "오늘의 중요한 사건";
    }
    if (routingResult.route === "daily_idea") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "오늘의 아이디어";
    }
    if (routingResult.route === "daily_trace") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "하루의 흔적";
    }
    if (routingResult.route === "daily_long_record_create") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.title = getDailyLongRecordTitle(
        resolvedTraceCandidate.date,
        todayKey
      );
      resolvedTraceCandidate.memo = routingResult.longRecordBody ?? "";
    }
    if (routingResult.route === "daily_long_record_title_update") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.title = getDailyLongRecordTitle(
        resolvedTraceCandidate.date,
        todayKey
      );
      resolvedTraceCandidate.memo = routingResult.longRecordTitle ?? "";
    }
    if (routingResult.route === "daily_long_record_append") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.title = getDailyLongRecordTitle(
        resolvedTraceCandidate.date,
        todayKey
      );
      resolvedTraceCandidate.memo = routingResult.longRecordBody ?? "";
    }
    if (routingResult.route === "daily_trace_update") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = `${routingResult.previousTitle ?? ""}\n→ ${routingResult.nextTitle ?? ""}`;
    }
    if (routingResult.route === "completed_action") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "완료한 행동";
    }
    if (routingResult.route === "completed_project") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "완료한 프로젝트";
    }
    if (routingResult.route === "life_schedule_once" || routingResult.route === "life_schedule_repeat") {
      resolvedTraceCandidate.type = "todo";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo =
        routingResult.route === "life_schedule_repeat"
          ? "생활 반복 · 매일\n알림 · 시간에 맞춰"
          : "알림 · 시간에 맞춰";
    }
    if (routingResult.route === "life_schedule_date_request") {
      resolvedTraceCandidate.type = "todo";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
      resolvedTraceCandidate.memo = "날짜 선택 필요";
    }
    if (routingResult.route === "life_action_record") {
      resolvedTraceCandidate.type = "record";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "직접 기록";
    }
    if (routingResult.route === "life_schedule_reminder_update") {
      resolvedTraceCandidate.type = "todo";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = `${routingResult.previousTitle ?? ""}\n→ ${routingResult.unit ?? ""}`;
    }
    if (routingResult.route === "life_schedule_cancel") {
      resolvedTraceCandidate.type = "todo";
      resolvedTraceCandidate.date = routingResult.scheduledDate ?? resolvedTraceCandidate.date;
      resolvedTraceCandidate.time = routingResult.displayUnit ?? resolvedTraceCandidate.time;
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "일정 취소";
    }
    if (routingResult.route === "routine_adjustment_intent") {
      resolvedTraceCandidate.type = "todo";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = routingResult.targetValue
        ? `현재 목표 · ${routingResult.targetValue}${routingResult.unit ?? ""}`
        : "얼마로 바꾸고 싶은지 알려주세요.";
    }
    if (routingResult.route === "routine_adjustment_confirm") {
      resolvedTraceCandidate.type = "todo";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = `변경 목표 · ${formatRoutineTargetForDisplay(routingResult.targetValue ?? 0, routingResult.unit)}`;
    }
    if (routingResult.route === "dream_fragment") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.title;
    }
    if (routingResult.route === "dream_torch") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.title;
    }
    if (routingResult.route === "dream_fragment_rename") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.previousTitle ?? routingResult.title;
      resolvedTraceCandidate.memo = `${routingResult.previousTitle ?? ""}\n→ ${routingResult.nextTitle ?? ""}`;
    }
    if (routingResult.route === "dream_fragment_complete") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = "꿈의 파편 완료";
    }
    if (routingResult.route === "dream_fragment_next_action_update") {
      resolvedTraceCandidate.type = "goal";
      resolvedTraceCandidate.title = routingResult.title;
      resolvedTraceCandidate.memo = `다음 할 일\n→ ${routingResult.nextAction ?? ""}`;
    }
  }

  return resolvedTraceCandidate;
}

export function resolveDailyTraceCandidate(
  text: string,
  extractedCandidate: DailyTraceCandidate | null,
  memoryPolicy: MemorySavePolicy,
  todayKey: string
): DailyTraceCandidate | null {
  if (!memoryPolicy.shouldSave || memoryPolicy.type === "none") {
    return null;
  }

  if (extractedCandidate) {
    return extractedCandidate;
  }

  return {
    type: getDailyTraceTypeForMemory(memoryPolicy.type),
    date: todayKey,
    title: makeMemoryTitle(text),
    memo: text,
  };
}

export function getDailyTraceTypeForMemory(type: MemorySavePolicyType): DailyTraceItemType {
  if (type === "schedule" || type === "daily_plan") {
    return "schedule";
  }

  if (type === "todo" || type === "task") {
    return "todo";
  }

  if (type === "goal" || type === "dream" || type === "project") {
    return "goal";
  }

  if (type === "idea") {
    return "quote";
  }

  return "record";
}
