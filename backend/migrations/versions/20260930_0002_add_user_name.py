"""개발용 사용자 이름 컬럼을 추가합니다.

Revision ID: 20260930_0002
Revises: 20260930_0001
Create Date: 2026-09-30
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260930_0002"
down_revision: str | None = "20260930_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """기존 사용자 데이터를 유지하면서 선택적 name 컬럼을 추가합니다."""

    op.add_column("users", sa.Column("name", sa.String(length=100), nullable=True))


def downgrade() -> None:
    """name 컬럼만 제거하고 기존 채팅 테이블은 유지합니다."""

    op.drop_column("users", "name")
