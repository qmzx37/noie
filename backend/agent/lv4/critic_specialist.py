"""Critic v0.1의 제한된 결정론적 검토입니다. 최종 판단/재작성/실행은 하지 않습니다."""

import re
import json
from datetime import timedelta

from .critic_context import CriticContext
from .schemas import AgentOpinion, OpinionEvidence, OpinionRisk, SpecialistInput, SuggestedAction
from .specialist import SpecialistAgent
from .place_context import PlaceContext, related_place
from .recommendation_specialist import planned_duration_seconds, required_choice_question, unnecessary_relationship_question
from .recommendation_context import related_relationship, explicit_choice_labels, relationship_choice
from .schedule_ordering import ordering_issues, temporal_verdict


def _asserts_certainty(text: str) -> bool:
    """불확실성과 명시적 부정은 확신 단정으로 취급하지 않습니다. 완전한 의미 분석은 아닙니다."""
    bounded = re.sub(r"불확실\w*|(?:확실|분명)(?:하지\s*않\w*|한\s*것은\s*아\w*)|틀림없지\s*않\w*", "", text)
    return bool(re.search(r"확실|분명|틀림없|100%", bounded))


def _state_axes(opinion: AgentOpinion | None) -> dict[str, float | None]:
    """State v0.1의 명시적 axis=value만 읽습니다. 설명 문장에서 점수를 새로 추정하지 않습니다."""
    result = {}
    if opinion is not None:
        for item in opinion.evidence:
            if item.source_type != "state" or "현재 상태 종합에서 제외" in item.summary:
                continue
            for axis, value in re.findall(r"\b(fatigue|energy|physical_tension|focus|motivation|D)=(0(?:\.\d+)?|1(?:\.0+)?)(?=,|;|\s|$)", item.summary):
                # 상충하는 같은 축을 임의 평균하지 않습니다. 해당 축은 근거로 사용하지 않습니다.
                number = float(value)
                if axis not in result:
                    result[axis] = number
                elif result[axis] != number:
                    result[axis] = None
    return result


class CriticSpecialist(SpecialistAgent):
    """입력 opinion의 우려만 표시하는 검토자입니다. 자동 등록이나 외부 호출은 없습니다."""

    def __init__(self) -> None:
        """기존 Specialist 공통 검증과 registry 계약을 그대로 사용합니다."""
        super().__init__("critic", "State/Recommendation의 근거·의사·명시적 제약 검토")

    def _run(self, request: SpecialistInput) -> AgentOpinion:
        """명백한 계약/표현 경계를 검사합니다. PASS도 자연어 의미 전체의 보증은 아닙니다."""
        if not isinstance(request, CriticContext):
            raise TypeError("CriticContext가 필요합니다.")
        state, recommendation = request.state_opinion, request.recommendation_opinion
        risks, evidence, directions = [], [], []
        seen_evidence = set()
        needs_input = False

        def concern(code: str, summary: str, sources: list[OpinionEvidence], direction: str | None = None) -> None:
            """risk당 필요한 근거만 추가하며 사용자 행동이 아닌 검토 방향을 제안합니다."""
            if not any(item.code == code for item in risks):
                risks.append(OpinionRisk(code=code, summary=summary))
            for item in sources:
                key = (item.source_type, item.summary, item.observed_at)
                if key not in seen_evidence and len(evidence) < 16:
                    evidence.append(item)
                    seen_evidence.add(key)
            if direction and direction not in directions and len(directions) < 2:
                directions.append(direction)

        if state is None and recommendation is None:
            return AgentOpinion(agent_name="critic", conclusion="검토할 opinion이 없어 정보가 필요합니다.", confidence=None, risks=[OpinionRisk(code="insufficient_context", summary="State/Recommendation opinion이 없습니다.")], needs_user_input=True, result_status="NEEDS_INPUT")

        # 실패한 upstream 결과를 검토 성공으로 취급하지 않습니다. NO_RECOMMENDATION은 정상 결과입니다.
        for label, opinion in (("state", state), ("recommendation", recommendation)):
            if opinion is not None and opinion.result_status in {"ERROR", "NOT_RUN"}:
                needs_input = True
                concern("upstream_unavailable", "검토 대상의 처리 결과가 없어 추가 정보가 필요합니다.", [])
        axes = _state_axes(state)
        if state is not None and state.result_status not in {"ERROR", "NOT_RUN"}:
            # State의 결론도 근거보다 큰 인과/trait 단정으로 확대되지 않았는지 최소 검사합니다.
            state_text = re.sub(r"\s+", "", state.conclusion)
            state_quote = OpinionEvidence(source_type="opinion", evidence_ref="state", summary=state.conclusion)
            if ((re.search(r"몸이피곤|피곤하니", state_text) and axes.get("fatigue") is None)
                    or (re.search(r"에너지가높|몸상태가좋", state_text) and axes.get("energy") is None)):
                concern("unsupported_state_inference", "State가 해당 신체 관찰 없이 상태를 단정했습니다.", [state_quote], "State 결론을 직접 관찰 근거 범위로 제한하도록 검토")
            if re.search(r"원래.*성격|항상.*사람|영구.*성향", state.conclusion):
                concern("trait_inference", "한 시점 관찰을 성격/장기 성향으로 확대한 표현입니다.", [state_quote], "한 시점 관찰과 장기 성향 추론을 분리해 검토")
            if (state.confidence is None or state.confidence < 0.5) and _asserts_certainty(state.conclusion):
                concern("state_confidence_overstatement", "State confidence보다 결론이 지나치게 확정적입니다.", [state_quote], "근거에 맞는 불확실성 표현으로 검토")
        if recommendation is not None and recommendation.result_status == "NEEDS_INPUT":
            needs_input = True
            concern("upstream_needs_input", "Recommendation이 필수 사용자 정보가 필요하다고 표시했습니다.", [])
            if unnecessary_relationship_question(request.current_utterance, recommendation.conclusion):
                # 불필요한 관계 질문을 검토하되 새 답변/후보를 생성하지 않습니다.
                concern("unnecessary_relationship_clarification", "현재 선택에 필수라고 확인되지 않은 인물 탐색 질문입니다.",
                        [OpinionEvidence(source_type="utterance", summary=request.current_utterance),
                         OpinionEvidence(source_type="opinion", evidence_ref="recommendation", summary=recommendation.conclusion, interpretation=True)])
        if state is not None and state.suggested_actions:
            concern("state_role_violation", "State opinion이 상태 종합 범위를 넘어 행동 후보를 만들었습니다.", [OpinionEvidence(source_type="opinion", summary=state.conclusion)], "상태 관찰과 행동 제안의 분리를 검토")

        if recommendation is not None and recommendation.result_status == "OK":
            choices = recommendation.suggested_actions
            text = " ".join(dict.fromkeys([recommendation.conclusion, *(item.summary for item in choices)]))
            # rationale은 source of truth가 아니라 검토 대상입니다.
            rationale = "".join(item.summary for item in recommendation.evidence
                if item.source_type == "opinion" and (item.evidence_ref or "").startswith("recommendation_rationale_"))
            compact = re.sub(r"\s+", "", text)
            quoted = OpinionEvidence(source_type="opinion", evidence_ref="recommendation", summary=text[:500])
            user = OpinionEvidence(source_type="utterance", evidence_ref="current", summary=request.current_utterance)
            # 명시된 활동 쌍이 있는데 후보에 둘 다 없으면 일반론 품질 우려입니다. 후보를 발명/자동 취소하지 않습니다.
            labels = explicit_choice_labels(request.current_utterance)
            if labels and choices and not any(label in text for label in labels):
                concern("generic_choice_advice", "명시된 선택지를 짚지 않는 일반론 후보여서 선택 지원 품질이 부족할 수 있습니다.", [user, quoted])
            elif labels and choices and not any(label in choices[0].summary for label in labels):
                # 구체적인 대안이 있어도 일반론 주 후보를 구체 선택 성공이라고 인증하지 않습니다. 후보는 보존합니다.
                concern("generic_primary_choice", "대안과 별개로 주 후보가 명시 선택지를 짚지 못했습니다.", [user, quoted])
            # 현재 발화 기반 관계 선택의 rationale도 검토합니다. 긍정 사건은 canonical 관계 상태가 아닙니다.
            if rationale and relationship_choice(request.current_utterance):
                unsupported = False
                for clause in re.split(r"[.!?;]", re.sub(r"\s+", "", rationale)):
                    if re.search(r"단정.*않|확정.*부족|현재.*모르|만약|이라면", clause):
                        continue
                    claim = re.search(r"사이가안좋|관계가좋지않|관계가나쁘|매우좋은관계|매우친밀|친밀한사이|미해결갈등|싸움(?:의)?여파|관계회복|오해를풀", clause)
                    if claim:
                        # 동일 label의 현재 직접 관계 진술만 지원 근거로 인정합니다. 다른 사람/부정/질문은 제외합니다.
                        labels_in_scope = [item.person_label for item in request.relevant_constraints.relationships]
                        labels_in_scope += re.findall(r"([가-힣]{2,12})(?:랑|와|과)\s", request.current_utterance)
                        named_claims = [label for label in labels_in_scope if label in clause]
                        if named_claims:
                            labels_in_scope = named_claims
                        supported = any(re.search(rf"{re.escape(label)}[^.!?;]{{0,30}}{re.escape(claim.group())}", re.sub(r"\s+", "", part))
                            and not re.search(r"아니|않|모르|라면|[?？]", part)
                            for label in labels_in_scope for part in re.split(r"[.!;]", request.current_utterance) if label in part and claim.group() in re.sub(r"\s+", "", part))
                        unsupported = unsupported or not supported
                if unsupported:
                    concern("unsupported_relationship_rationale", "관찰된 사건만으로 현재 관계 상태/미해결 갈등을 확정할 수 없어 해당 이유를 근거로 쓰지 않습니다.", [user, quoted])
            # 주 검증은 Recommendation에 있습니다. 명백한 누락을 숨긴 주입/우회 opinion만 지적합니다.
            if required_choice_question(request.current_utterance):
                needs_input = True
                concern("missing_choice_input", "비교할 대상이 없어 확정 후보를 지지할 수 없습니다.", [user, quoted])
            if len(choices) > 2:
                concern("too_many_candidates", "후보가 두 개를 초과해 선택 부담이 늘어납니다.", [quoted], "후보를 최대 두 개로 줄이는 방향 검토")
            if any(item.mode != "suggest" for item in choices):
                concern("execution_boundary", "Recommendation 후보가 Suggest를 벗어났습니다.", [quoted], "실행 권한 없는 Suggest 후보로 분리 검토")
            if any(marker in compact for marker in ("무조건", "반드시해야", "해야한다", "해야해", "하지마라", "하지마", "금지한다")):
                concern("coercion", "명령/강제 표현이 사용자 선택권을 침해할 수 있습니다.", [quoted], "선택 가능한 제안 표현으로 검토")
            if any(marker in compact for marker in ("이번주못했으니", "안했으니", "게으르", "목표미달", "실패했으니")):
                concern("guilt_pressure", "실패/목표 미달을 행동 압박의 근거로 사용한 표현입니다.", [quoted], "죄책감 없이 현재 선택을 지원하도록 검토")
            rest_decision = bool(re.search(r"쉬기로\s*했|쉴래|쉬겠|쉴게", request.current_utterance))
            if rest_decision and any(re.search(r"개발|코딩|공부|운동|작업", item.summary) and not re.search(r"내일|다음", item.summary) for item in choices):
                concern("current_intent_violation", "명시적으로 결정한 휴식과 당장 작업 제안이 충돌합니다.", [user, quoted], "현재 사용자 결정을 존중하도록 검토")

            memory_sources = [item for item in recommendation.evidence if item.source_type == "memory" and (item.relevance is None or item.relevance >= 0.55)]
            if memory_sources and re.search(r"항상|반드시|과거.*때문|기억.*때문|예전에.*못|지난번.*실패", text):
                concern("memory_overapplication", "과거 Memory를 현재 선택의 절대 규칙으로 적용한 표현입니다.", [quoted, memory_sources[0]], "과거 근거를 참고 수준으로 낮춰 검토")
            # 대표적 직접 단정만 검사합니다. 조건부 제안과 독립 축의 동시 존재는 모순으로 보지 않습니다.
            claims = (
                ("fatigue", r"몸이피곤|몸이피로|피곤하니|피로하니", r"피곤|피로"),
                ("energy", r"에너지가높|몸상태가좋|활력이높", r"에너지가높|몸상태가좋|활력이높"),
                ("physical_tension", r"신체긴장이높|몸이긴장", r"몸이긴장|신체긴장"),
                ("D", r"우울하니|우울한상태", r"우울"),
                ("motivation", r"의욕이낮|동기가낮", r"의욕이낮|동기가낮"),
            )
            missing_claims, contradictions = [], []
            current = re.sub(r"\s+", "", request.current_utterance)
            for axis, claim, current_support in claims:
                if not re.search(claim, compact) or re.search(current_support, current):
                    continue
                value = axes.get(axis)
                if value is None:
                    missing_claims.append(axis)
                elif (axis == "motivation" and value >= 0.7) or (axis != "motivation" and value < 0.4):
                    contradictions.append(axis)
            state_sources = [item for item in state.evidence if item.source_type == "state"][:3] if state else []
            if missing_claims:
                concern("unsupported_inference", "해당 domain 관찰 없이 상태를 단정한 축: " + ", ".join(missing_claims), [quoted, *state_sources], "unknown을 보존하고 근거 범위로 결론을 제한하도록 검토")
            if contradictions:
                concern("opinion_conflict", "State 관찰과 추천의 상태 단정이 충돌하는 축: " + ", ".join(contradictions), [quoted, *state_sources], "서로 다른 관찰과 단정을 분리해 검토")
            if (recommendation.confidence is None or recommendation.confidence < 0.5) and (_asserts_certainty(text) or re.search(r"반드시|무조건", text)):
                concern("confidence_overstatement", "낮거나 unknown인 confidence에 비해 결론이 지나치게 확정적입니다.", [quoted], "근거에 맞는 불확실성 표현으로 검토")
            if not any(item.source_type in {"utterance", "state", "memory", "schedule", "relationship"} for item in recommendation.evidence) and (_asserts_certainty(text) or re.search(r"반드시|네상태|몸이|항상", compact)):
                concern("insufficient_evidence", "근거가 없는 개인 상태/확정 결론을 확인할 정보가 필요합니다.", [quoted])
                needs_input = True

            # 원시 Place 목록 대신 실제 사용한 구조화 evidence만 검토합니다.
            place_records = []
            for item in recommendation.evidence:
                if item.source_type != "place":
                    continue
                try:
                    record = PlaceContext.model_validate({**json.loads(item.summary), "relevance": item.relevance if item.relevance is not None else 0.0})
                except (ValueError, TypeError):
                    concern("invalid_place_evidence", "장소 근거의 구조를 확인할 수 없습니다.", [quoted, item])
                    continue
                place_records.append((record, item))
                if not related_place(record, request.current_utterance):
                    concern("unrelated_place", "현재 질문과 무관한 장소 근거를 사용했습니다.", [quoted, item])
                when = record.occurred_at or record.created_at
                stale = request.reference_time is not None and ((record.kind == "context" and when < request.reference_time-timedelta(minutes=120)) or (record.kind == "visit" and when < request.reference_time-timedelta(hours=24)))
                if stale or (record.kind == "preference" and re.search(r"항상|반드시|현재도|지금도", compact)):
                    concern("stale_place_overapplication", "과거 장소 기록을 현재 사실/선택 규칙으로 확대했습니다.", [quoted, item])
                if record.place_name in text and re.search(r"방문.*(?:행복|우울|친밀|관계)|갔.*(?:행복|우울|친밀|관계)", compact):
                    concern("place_cross_domain_inference", "장소 관찰만으로 감정/관계를 추론한 표현입니다.", [quoted, item])
            for record, item in place_records:
                if record.kind != "preference" and record.place_name in text and re.search(r"좋아하|선호하|마음에들", compact) and not any(other.place_name == record.place_name and other.kind == "preference" for other, _ in place_records):
                    concern("place_preference_inference", "방문/장소 context를 명시적 선호로 바꾼 표현입니다.", [quoted, item])

            for item in request.relevant_constraints.relationships:
                if item.relevance >= 0.55 and item.person_label in request.current_utterance and item.person_label in text and re.search(r"널싫어|너를싫어|속마음|배신할|친밀도가|신뢰도가", compact):
                    concern("relationship_overinterpretation", "사용자 관계 근거를 상대의 속마음/관계 강도로 확대했습니다.", [quoted, OpinionEvidence(source_type="relationship", summary=item.summary, observed_at=item.observed_at, interpretation=True)], "관계 진술과 상대 의도 추론을 분리해 검토")

            # 직접 주입된 opinion도 현재 typed 근거에 연결되어야 합니다. 인물 동일성 resolver는 아닙니다.
            for source in (item for item in recommendation.evidence if item.source_type == "relationship"):
                matches = [item for item in request.relevant_constraints.relationships
                           if source.summary in (item.summary, f"{item.temporal_scope}/{item.record_kind}: {item.summary[:350]}")]
                if not matches or not any(related_relationship(item, request.current_utterance) for item in matches):
                    concern("unrelated_relationship", "현재 질문에 연결되지 않는 관계 근거입니다.", [user, quoted, source])
                    continue
                for item in matches:
                    for clause in re.split(r"[.!?;]", compact):
                        if re.search(r"단정.*않|확정.*부족|현재.*모르|만약|이라면", clause):
                            continue
                        promoted = ((item.record_kind == "observation" and re.search(r"사이가안좋|관계가나쁘|친밀한사이", clause))
                                    or (item.record_kind == "meaning_relation" and item.person_label in clause and re.search(r"친구|친한사이", clause))
                                    or (re.search(r"어떤|그날|만난\s*사람", item.person_label) and re.search(r"실명은|본명은|동일인|동일한사람|정체는", clause)))
                        if promoted:
                            # 같은 상태를 사용자가 현재 직접 진술했다면 과거 근거의 승격이라고 오인하지 않습니다.
                            explicit = any(item.person_label in part and re.search(r"사이가\s*안\s*좋|관계가\s*나쁘|친밀한\s*사이|내\s*친구", part)
                                           and "?" not in part and "？" not in part
                                           and not re.search(r"아니|않|모르|라면", part)
                                           for part in re.split(r"[.!;]", request.current_utterance))
                            if not explicit:
                                concern("relationship_overinterpretation", "관찰/의미/임시 표현을 현재 관계나 인물 정답으로 승격했습니다.", [user, quoted, source])
                    if item.record_kind == "observation" and re.search(r"싸웠|다퉜|갈등", item.summary) and re.search(
                        r"관계.{0,12}(?:개선|회복)|싸움.{0,15}(?:감정\s*정리|우울|불안|슬픔)|문제를\s*풀|미해결\s*갈등", rationale):
                        # 이유의 약한 과대 적용은 supported 대화 후보를 자동 취소하지 않습니다.
                        concern("relationship_explanation_caution", "과거 관찰만으로 현재 갈등/회복 필요성을 확정할 수 없습니다.",
                                [user, quoted, source], "관계 관찰과 현재 상태 해석을 분리해 검토")

            # Memory 위험 하나만으로 STOP하지 않고 장시간 제안의 재평가 필요성만 남깁니다.
            past_memories = memory_sources + [OpinionEvidence(source_type="memory", summary=item.content, observed_at=item.observed_at, interpretation=True) for item in request.relevant_constraints.memories if item.relevance >= 0.55 and (item.observed_at is None or request.reference_time is None or item.observed_at <= request.reference_time)]
            long_choice = any(planned_duration_seconds(item.summary) >= 7200 for item in choices)
            fatigue_memory = next((item for item in past_memories if re.search(r"피로|피곤", item.summary)), None)
            if long_choice and fatigue_memory is not None:
                concern("historical_risk", "과거 피로 경험은 참고할 위험이며 현재 선택을 금지하는 근거는 아닙니다.", [quoted, fatigue_memory], "짧은 시간 경계 후 재평가하는 후보를 검토")

            schedules = [item for item in request.relevant_constraints.schedules if item.relevance >= 0.55]
            # 명시 시간표 요청에 event가 없으면 candidate의 시각을 일정 사실로 대신 쓰지 않습니다.
            if not schedules and any(temporal_verdict(choice.summary, request.current_utterance, request.reference_time, None) is not None for choice in choices):
                concern("insufficient_temporal_info", "시간표 검증에 필요한 명시 일정/소요 정보가 부족합니다.", [user, quoted])
            if schedules and request.reference_time is None:
                concern("missing_reference_time", "일정 제약을 비교할 기준 시각이 없습니다.", [])
                needs_input = True
            elif schedules:
                horizon = timedelta(hours=24 if "지금" not in request.current_utterance and any(word in request.current_utterance for word in ("오늘", "내일", "하루")) else 2)
                for item in schedules:
                    if not request.reference_time <= item.start_at <= request.reference_time+horizon:
                        continue
                    available = (item.start_at-request.reference_time).total_seconds()
                    # Schedule은 시작/종료의 소유자입니다. Critic은 기존 시간 근거의 불가능한 순서만 검토합니다.
                    for choice in choices:
                        for code in sorted(ordering_issues(choice.summary, request.current_utterance, request.reference_time, item.start_at)):
                            concern(code, "준비/출발/일정 시작 순서 또는 명시 소요 근거를 확인해야 합니다. 시간을 새로 만들지 않습니다.", [user, quoted, OpinionEvidence(source_type="schedule", summary=f"{item.title[:120]}: {item.start_at.isoformat()}")])
                        if temporal_verdict(choice.summary, request.current_utterance, request.reference_time, item.start_at) == "INSUFFICIENT_TEMPORAL_INFO":
                            concern("insufficient_temporal_info", "명시 시간표의 준비/출발 시각 또는 소요 근거가 부족하여 유효하다고 인증하지 않습니다.", [user, quoted, OpinionEvidence(source_type="schedule", summary=f"{item.title[:120]}: {item.start_at.isoformat()}")])
                    if any(planned_duration_seconds(choice.summary) > available for choice in choices):
                        concern("schedule_conflict", "명시적 제안 시간이 가까운 일정 시작을 초과합니다. 이동 소요는 추측하지 않습니다.", [quoted, OpinionEvidence(source_type="schedule", summary=f"{item.title[:120]}: {item.start_at.isoformat()}")], "일정 전 시간 범위를 줄여 재평가하도록 검토")

        # 공통 risk 8개 한도 초과 시 나머지 코드도 요약해 검토 누락을 숨기지 않습니다.
        if len(risks) > 8:
            overflow = ", ".join(item.code for item in risks[7:])
            risks = risks[:7] + [OpinionRisk(code="additional_concerns", summary="추가 검토 항목: " + overflow)]
        reviewed = [item.confidence for item in (state, recommendation) if item is not None]
        confidence = min(reviewed) if reviewed and all(value is not None for value in reviewed) else None
        conclusion = "concerns: 전달된 의견의 근거/제약을 재검토할 항목이 있습니다. 최종 선택은 사용자에게 있습니다." if risks else "PASS: 지원하는 검사 범위에서 추가 우려를 찾지 못했습니다. 의미 전체의 보증은 아닙니다."
        return AgentOpinion(agent_name="critic", conclusion=conclusion, confidence=confidence, evidence=evidence, risks=risks, suggested_actions=[SuggestedAction(type="reflection", intent="review_opinion", mode="suggest", summary=direction) for direction in directions], needs_user_input=needs_input, result_status="NEEDS_INPUT" if needs_input else "OK")
