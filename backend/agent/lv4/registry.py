"""Specialist 등록/조회만 담당합니다. 실행·DB·OpenAI·routing은 하지 않습니다."""

from inspect import isasyncgenfunction, iscoroutinefunction, isgeneratorfunction, signature
from threading import Lock

from pydantic import TypeAdapter

from .schemas import Name, ShortText, SpecialistInput
from .specialist import SpecialistAgent


class DuplicateSpecialistError(ValueError):
    """기존 등록을 덮어쓰려는 요청입니다."""


class UnknownSpecialistError(LookupError):
    """등록되지 않은 이름입니다."""


class SpecialistRegistry:
    """인스턴스별 독립 registry입니다. 제품 Specialist의 자동 등록은 없습니다."""

    def __init__(self) -> None:
        """빈 목록으로 시작하고 중복 등록 경쟁만 짧은 lock으로 보호합니다."""
        self._agents: dict[str, SpecialistAgent] = {}
        self._lock = Lock()

    def register(self, specialist: SpecialistAgent) -> None:
        """실행하지 않고 구현/이름/호출 signature만 검증합니다."""
        if not isinstance(specialist, SpecialistAgent):
            raise TypeError("SpecialistAgent 구현만 등록할 수 있습니다.")
        name = TypeAdapter(Name).validate_python(specialist.name)
        TypeAdapter(ShortText).validate_python(specialist.description)
        # 공통 run 검증을 우회한 subclass와 잘못된 판단 함수의 등록을 거부합니다.
        if type(specialist).run is not SpecialistAgent.run or not callable(specialist._run):
            raise TypeError("공통 run 계약을 유지해야 합니다.")
        if any(check(specialist._run) for check in (iscoroutinefunction, isasyncgenfunction, isgeneratorfunction)):
            raise TypeError("Phase 1은 동기 AgentOpinion 반환만 지원합니다.")
        try:
            signature(specialist._run).bind(SpecialistInput(current_utterance="signature check"))
        except (TypeError, ValueError) as error:
            raise TypeError("_run은 SpecialistInput 하나로 호출 가능해야 합니다.") from error
        with self._lock:
            if name in self._agents:
                raise DuplicateSpecialistError(name)
            self._agents[name] = specialist

    def get(self, name: str) -> SpecialistAgent:
        """암묵적 fallback 없이 이름으로 조회합니다."""
        with self._lock:
            if name not in self._agents:
                raise UnknownSpecialistError(name)
            return self._agents[name]

    def list(self) -> tuple[SpecialistAgent, ...]:
        """실행 순서가 아닌 이름순 snapshot을 반환합니다. 원본 dict는 노출하지 않습니다."""
        with self._lock:
            return tuple(self._agents[name] for name in sorted(self._agents))
