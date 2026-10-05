"""Critic 전용 시간 검토입니다. 일정 생성/재계산이나 모르는 소요시간 채우기는 하지 않습니다."""

import re
from datetime import timedelta

from .recommendation_specialist import planned_duration_seconds


def _asserted_clauses(text):
    """과거/부정/가정의 숫자를 현재 시간 계획으로 승격하지 않습니다."""
    return [part for part in re.split(r"[.!?;\n]", text)
        if not re.search(r"어제|지난|과거|했어|했었|했습니다|않|아니|안\s|다면|라면|걸리면|경우|내일", part)]


def _duration(text, role):
    """명시된 준비/이동 소요만 읽습니다. 충돌한 값 또는 없는 값은 unknown입니다."""
    values = []
    for part in _asserted_clauses(text):
        # 시각의 분 부분은 소요시간이 아닙니다. 기존 duration guard와 동일한 구분을 유지합니다.
        part = re.sub(r"\d{1,2}\s*시(?!간)\s*(?:\d{1,2}\s*분)?|\d{1,2}:\d{2}", "", part)
        for pattern in (rf"{role}\s*(?:시간|소요)?\s*(?:은|는|이|가|에|:)?\s*(\d+)\s*분",
                        rf"(?<![-\d])(\d+)\s*분\s*(?:(?:동안|간)\s*)?(?:수업\s*)?{role}"):
            values.extend(int(value) for value in re.findall(pattern, part))
    return values[0] if values and len(set(values)) == 1 else None


def _clock_points(candidate, anchor):
    """명시 시각을 문장 간 함께 읽되 마감/복수 역할/지원 밖 표현은 확정 시각으로 쓰지 않습니다."""
    points, ambiguous = {}, False
    clock_pattern = r"(?<![\d-])(?P<h>\d{1,2})(?::(?P<m>\d{2})|\s*시(?!간)(?:\s*(?P<km>\d{1,2})\s*분)?)"
    for part in _asserted_clauses(candidate):
        clocks = list(re.finditer(clock_pattern, part))
        for index, match in enumerate(clocks):
            hour, minute = int(match['h']), int(match['m'] or match['km'] or 0)
            end = clocks[index+1].start() if index+1 < len(clocks) else len(part)
            action = part[match.end():end]
            if hour > 23 or minute > 59 or re.search(r"오전|오후|모레|\d+일", part) or re.match(r"\s*까지", action):
                ambiguous = True
                continue
            roles = []
            if re.search(r"준비", action):
                roles.append("prepared" if re.search(r"준비\s*완료", action) else "prepare")
            if re.search(r"출발|이동\s*시작", action):
                roles.append("departure")
            if not roles and re.search(r"수업|일정|약속|회의|행사|도착", action):
                roles.append("event")
            if len(roles) != 1:
                ambiguous = True
                continue
            points.setdefault(roles[0], []).append(anchor.replace(hour=hour, minute=minute, second=0, microsecond=0))
    if any(len(set(values)) > 1 for values in points.values()):
        ambiguous = True
    return points, ambiguous


def ordering_issues(candidate, utterance, reference_time, event_start):
    """현재 동일 날짜의 명시 시각/순서만 검사합니다. 새 시각이나 duration은 반환하지 않습니다."""
    issues = set()
    known_prep = _duration(utterance, "준비")
    known_travel = _duration(utterance, "이동")
    # 기존 set 계약은 유지합니다. 별도 verdict가 오류 없음과 정보 충분을 구분합니다.
    if event_start is None or reference_time is None:
        return issues
    points, ambiguous = _clock_points(candidate, event_start)
    if not ambiguous:
        prep = points.get("prepare", [None])[0]
        prepared = points.get("prepared", [None])[0]
        depart = points.get("departure", [None])[0]
        if any(point is not None and (point > event_start or point < reference_time) for point in (prep, prepared, depart)):
            issues.add("schedule_ordering")
        if any(point != event_start for point in points.get("event", [])):
            issues.add("schedule_ordering")
        if prepared is not None and ((prep is not None and prep > prepared) or (depart is not None and prepared > depart)):
            issues.add("schedule_ordering")
        if prep is not None and depart is not None:
            if prep > depart or known_prep is not None and prep+timedelta(minutes=known_prep) > depart:
                issues.add("schedule_ordering")
        if depart is not None and known_travel is not None and depart+timedelta(minutes=known_travel) > event_start:
            issues.add("schedule_ordering")
        if prep is not None and known_prep is not None and prep+timedelta(minutes=known_prep) > (prepared or depart or event_start):
            issues.add("schedule_ordering")
    for part in _asserted_clauses(candidate):
        # 과거 Gate의 '지금부터 한 시간 작업 후 일정 시각에 준비 시작' 경계를 검사합니다.
        sequence = re.search(r"(?:그\s*후|그\s*뒤|후에?|이후|하고\s*나서).{0,30}준비", part)
        if sequence:
            before = part[:sequence.start()]
            # 명시 작업→준비 순서에서 이미 제공된 소요만 더합니다. unknown을 임의 분으로 채우지 않습니다.
            work = planned_duration_seconds(before)
            remaining = (event_start-reference_time).total_seconds()
            if work and ("지금" in before or re.search(r"개발|작업", before)):
                required = work + 60*((known_prep or 0)+(known_travel or 0))
                if required > remaining or work >= remaining:
                    issues.add("schedule_ordering")
        for role, known in (("준비", known_prep), ("이동", known_travel)):
            stated = _duration(part, role)
            if stated is not None and (known is None or stated != known):
                issues.add("unsupported_schedule_duration")
    return issues


def temporal_verdict(candidate, utterance, reference_time, event_start):
    """검증 결과만 반환합니다. None은 시간표 검증 대상 아님이며 VALID를 뜻하지 않습니다."""
    # 일반 작업 duration을 새 Schedule fact로 승격하지 않습니다. 시간표 요청/후보에만 적용합니다.
    requested = bool(re.search(r"준비|출발|이동", utterance) and re.search(r"시간|시각|몇\s*시", utterance))
    planned = bool(re.search(r"준비|출발|이동", candidate) and re.search(r"\d{1,2}:\d{2}|\d+\s*시(?!간)", candidate))
    if not requested and not planned:
        return None
    if ordering_issues(candidate, utterance, reference_time, event_start):
        return "INVALID"
    if event_start is None or reference_time is None:
        return "INSUFFICIENT_TEMPORAL_INFO"
    points, ambiguous = _clock_points(candidate, event_start)
    # 정보 없는 duration을 0으로 검증하지 않습니다. 조건/과거 시각은 points에 포함되지 않습니다.
    if ambiguous or not points.get("prepare") or not points.get("departure") or _duration(utterance, "준비") is None or _duration(utterance, "이동") is None:
        return "INSUFFICIENT_TEMPORAL_INFO"
    return "VALID"
