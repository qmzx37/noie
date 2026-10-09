"""Behavior의 상태를 재사용하고 명시된 시간만 해독합니다. DB/OpenAI 호출은 없습니다."""

from datetime import date, datetime, time, timedelta
import re

from agent.behavior_schemas import BehaviorContext
from agent.behavior_specialist import BehaviorSpecialist
from agent.activity_schemas import ActivityAnalysis, ActivityObservation
from agent.lv4.schemas import OpinionEvidence
from agent.orchestrator import schedule_time_context
from memory_privacy import automatic_memory_allowed


# 시간 접두어만 분리합니다. 행동명/status 문형은 기존 Behavior가 판단합니다.
_CLOCK = r"(?:(?:오전|오후)\s*)?\d{1,2}(?:시(?:\s*\d{1,2}분)?|:\d{2})"
_TERM = re.compile(
    rf"(?P<range>{_CLOCK}\s*부터\s*{_CLOCK}\s*까지)"
    rf"|(?P<start>{_CLOCK}\s*부터)|(?P<end>{_CLOCK}\s*에)"
    r"|(?P<duration>\d{1,5}시간(?:\s*\d{1,3}분)?|\d{1,6}분)"
    r"|(?P<day>\d{4}-\d{2}-\d{2}|오늘|어제|내일|지금|방금)"
    r"|(?P<period>아침에|저녁에|오전에|오후에)"
)
_SPEAKER = re.compile(r"^(?:나는|내가|나|저는|제가)\s+")
_FINISHED = re.compile(r"(?:끝냈|마쳤|완료했)(?:어|다|어요|습니다)$")


def _clock(token, issues):
    """오전/오후 없는 1~12시는 사용자 승인 정책대로 unknown입니다."""
    match = re.fullmatch(r"(?:(오전|오후)\s*)?(\d{1,2})(?:시(?:\s*(\d{1,2})분)?|:(\d{2}))", token.strip())
    if match is None:
        issues.append("invalid_clock")
        return None
    meridiem, hour, minute, colon_minute = match.groups()
    hour, minute = int(hour), int(minute or colon_minute or 0)
    if minute > 59 or hour > 23 or (meridiem and not 1 <= hour <= 12):
        issues.append("invalid_clock")
        return None
    if meridiem:
        hour = hour % 12 + (12 if meridiem == "오후" else 0)
    elif 1 <= hour <= 12 and ":" not in token:
        issues.append("ambiguous_clock")
        return None
    # HH:MM은 명시적 24시간 표기로 취급하며 로컬 clock 값이지 UTC 시각이 아닙니다.
    return time(hour, minute)


def _duration(token):
    """직접 보고한 기간만 분으로 바꿉니다. 이 기간에서 start/end를 역산하지 않습니다."""
    match = re.fullmatch(r"(\d+)시간(?:\s*(\d+)분)?|(\d+)분", token)
    hours, minutes, only_minutes = match.groups()
    value = int(hours or 0) * 60 + int(minutes or only_minutes or 0)
    return value if value <= 525600 else None


def _times(terms, *, observed_at, status, finished):
    """날짜/clock/직접 duration/계산 duration을 독립적으로 보존합니다."""
    issues, days, starts, ends, durations = [], [], [], [], []
    for kind, token in terms:
        if kind == "range":
            start, end = re.split(r"\s*부터\s*", token.removesuffix("까지").strip())
            starts.append(_clock(start, issues)); ends.append(_clock(end, issues))
        elif kind == "start":
            starts.append(_clock(re.sub(r"\s*부터$", "", token), issues))
        elif kind == "end":
            # '3시에 개발했어'는 시작/종료 중 무엇인지 모릅니다. 완료 동사일 때만 종료로 받습니다.
            if finished:
                ends.append(_clock(re.sub(r"\s*에$", "", token), issues))
        elif kind == "duration":
            durations.append(_duration(token))
        elif kind == "day":
            days.append(token)
    start = starts[0] if len(starts) == 1 else None
    end = ends[0] if len(ends) == 1 else None
    if len(starts) > 1 or len(ends) > 1:
        issues.append("invalid_clock")
    reported = durations[0] if len(durations) == 1 else None
    if len(durations) > 1 or (durations and reported is None):
        issues.append("duration_conflict")
    if status == "ongoing" and end is not None:
        issues.append("ongoing_end_unconfirmed")
        end = None
    calculated = None
    if start is not None and end is not None:
        delta = end.hour * 60 + end.minute - start.hour * 60 - start.minute
        if delta < 0:
            issues.append("end_before_start")
        else:
            calculated = delta
    if reported is not None and calculated is not None and reported != calculated:
        issues.append("duration_conflict")
    duration = None if "duration_conflict" in issues else reported if reported is not None else calculated
    activity_date = None
    concrete_days = [item for item in days if item not in {"지금", "방금"}]
    if not concrete_days and any(item in days for item in ("지금", "방금")):
        concrete_days = ["오늘"]
    if len(set(concrete_days)) > 1:
        issues.append("date_conflict")
    elif concrete_days:
        day = concrete_days[0]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            try:
                activity_date = date.fromisoformat(day)
            except ValueError:
                issues.append("invalid_date")
        elif observed_at is not None:
            # 기존 Schedule timezone 설정을 사용합니다. PC timezone이나 현재 시각을 발명하지 않습니다.
            context = schedule_time_context(observed_at)
            if context["timezone"] is None:
                issues.append("timezone_unknown")
            else:
                local = datetime.fromisoformat(context["reference_datetime"]).date()
                activity_date = local + timedelta(days={"오늘": 0, "어제": -1, "내일": 1}[day])
                if activity_date > local:
                    activity_date = None
                    issues.append("future_activity_date")
        else:
            issues.append("timezone_unknown")
    return dict(activity_date=activity_date, start_time=start, end_time=end, duration_minutes=duration,
                reported_duration_minutes=reported, calculated_duration_minutes=calculated,
                time_issues=list(dict.fromkeys(issues)))


def is_explicit_completion_report(observation: ActivityObservation) -> bool:
    """일반 performed 보고를 완료 보고로 승격하지 않습니다. 검증된 원문 근거만 봅니다."""
    return observation.status == "performed" and bool(_FINISHED.search(observation.evidence.summary))


def analyze_activity(context: BehaviorContext) -> ActivityAnalysis:
    """기존 Behavior eligibility만 사용합니다. 원문은 읽기만 하고 Message를 변경하지 않습니다."""
    checked = BehaviorContext.model_validate(context.model_dump())
    text = checked.current_utterance
    if not automatic_memory_allowed(text):
        return ActivityAnalysis(reason="privacy_restricted")
    if any(mark in text for mark in ('"', "'", "“", "”", "‘", "’")):
        return ActivityAnalysis(reason="no_completed_activity")
    activities = []
    for sentence in re.finditer(r"[^.!?\n]+[.!?]*", text):
        raw = sentence.group().rstrip(".!?").strip()
        speaker = _SPEAKER.match(raw)
        cursor, terms = speaker.end() if speaker else 0, []
        while cursor < len(raw):
            match = _TERM.match(raw, cursor)
            if match is None:
                break
            terms.append((match.lastgroup, match.group()))
            cursor = match.end()
            while cursor < len(raw) and raw[cursor].isspace():
                cursor += 1
        remaining = raw[cursor:]
        finished = bool(_FINISHED.search(remaining))
        # 완료 동사만 기존 performed 문형에 연결합니다. 별도 행동명/status NLP는 만들지 않습니다.
        normalized = _FINISHED.sub("했어", remaining)
        normalized = (speaker.group() if speaker else "") + normalized
        if "?" in sentence.group():
            normalized += "?"
        behavior = BehaviorSpecialist().analyze(BehaviorContext(
            current_utterance=normalized or "unknown", source_message_id=checked.source_message_id,
            observed_at=checked.observed_at,
        ))
        # 한 절의 시간 범위를 여러 행동에 복제하지 않습니다. 복잡한 복합 문장은 REVIEW_LATER입니다.
        if terms and len(behavior.behaviors) != 1:
            continue
        for observation in behavior.behaviors:
            if observation.status not in {"performed", "ongoing"}:
                continue
            quote = raw if len(behavior.behaviors) == 1 else observation.evidence.summary
            if len(quote) > 500 or quote not in text:
                continue
            evidence = OpinionEvidence(source_type="utterance", summary=quote,
                evidence_ref=str(checked.source_message_id) if checked.source_message_id else "current_utterance",
                observed_at=checked.observed_at, interpretation=True)
            activities.append(ActivityObservation(action=observation.action, status=observation.status,
                confidence=observation.confidence, observed_at=checked.observed_at, evidence=evidence,
                **_times(terms, observed_at=checked.observed_at, status=observation.status, finished=finished)))
            if len(activities) == 16:
                return ActivityAnalysis(activities=activities, reason="recognized")
    return ActivityAnalysis(activities=activities, reason="recognized" if activities else "no_completed_activity")
