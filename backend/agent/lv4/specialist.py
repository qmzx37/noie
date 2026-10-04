"""작은 Specialist 인터페이스입니다. 실제 Agent나 실행 프레임워크는 아닙니다."""

from abc import ABC, abstractmethod

from pydantic import TypeAdapter

from .schemas import AgentOpinion, Name, ShortText, SpecialistInput


class SpecialistAgent(ABC):
    """새 Specialist는 _run을 구현합니다. 공통 run은 입출력 계약을 검사합니다."""

    def __init__(self, name: str, description: str) -> None:
        """등록용 이름과 역할 설명을 검증하며 사용자 context를 보관하지 않습니다."""
        self._name = TypeAdapter(Name).validate_python(name)
        self._description = TypeAdapter(ShortText).validate_python(description)

    @property
    def name(self) -> str:
        """registry에서 사용하는 읽기 전용 이름입니다."""
        return self._name

    @property
    def description(self) -> str:
        """Specialist의 역할 설명이며 실행 권한을 뜻하지 않습니다."""
        return self._description

    def run(self, request: SpecialistInput) -> AgentOpinion:
        """실제 호출자는 명시적으로 실행합니다. registry는 이 메서드를 호출하지 않습니다."""
        if not isinstance(request, SpecialistInput):
            raise TypeError("SpecialistInput이 필요합니다.")
        # 중첩 list의 변경이나 model_construct로 우회한 입력도 다시 검사합니다.
        checked_request = SpecialistInput.model_validate(request.model_dump())
        result = self._run(checked_request)
        if not isinstance(result, AgentOpinion):
            raise TypeError("Specialist는 AgentOpinion을 반환해야 합니다.")
        checked_result = AgentOpinion.model_validate(result.model_dump())
        if checked_result.agent_name != self.name:
            raise ValueError("반환한 agent_name이 Specialist 이름과 다릅니다.")
        return checked_result

    @abstractmethod
    def _run(self, request: SpecialistInput) -> AgentOpinion:
        """후속 Specialist가 구현할 판단 함수입니다. Phase 1에서는 fake만 사용합니다."""
        raise NotImplementedError
