"""PostgreSQL 연결과 SQLAlchemy 세션 생성을 담당합니다."""

from __future__ import annotations

import os
from collections.abc import Generator

from dotenv import load_dotenv
from fastapi import HTTPException, status
from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


# 로컬 개발에서는 backend/.env에 적은 값을 읽고, 배포 환경에서는
# Render 등에서 주입한 DATABASE_URL 환경변수를 그대로 사용합니다.
load_dotenv()


def normalize_database_url(database_url: str) -> str:
    """Render 형식의 PostgreSQL URL도 psycopg 3 드라이버로 연결합니다."""

    normalized_url = database_url.strip()
    if normalized_url.startswith("postgres://"):
        return normalized_url.replace("postgres://", "postgresql+psycopg://", 1)
    if normalized_url.startswith("postgresql://"):
        return normalized_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return normalized_url


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", ""))


# Alembic이 향후 constraint를 안정적으로 변경/삭제할 수 있도록 이름을 고정합니다.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(column_0_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """모든 ORM 모델이 공통으로 상속하는 SQLAlchemy 기본 클래스입니다."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


# DB 설정이 없어도 기존 감정 분석 API와 FastAPI 앱 import는 동작해야 합니다.
# 실제 DB가 필요한 요청이 들어왔을 때만 503 응답을 반환합니다.
engine = create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None

SessionLocal = (
    sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    if engine is not None
    else None
)


def get_db() -> Generator[Session, None, None]:
    """요청마다 DB 세션을 열고 응답이 끝나면 안전하게 닫습니다."""

    if SessionLocal is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL이 설정되지 않았습니다.",
        )

    db = SessionLocal()
    try:
        yield db
    except Exception:
        # 쓰기 요청 중 오류가 나면 미완료 transaction을 명시적으로 되돌립니다.
        db.rollback()
        raise
    finally:
        db.close()
