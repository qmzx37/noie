"""기존 사용자/원문을 변경하지 않고 외부 인증 연결 테이블만 추가합니다."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261005_0018"
down_revision = "20261003_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """두 유일성 제약의 인덱스가 identity 조회와 user FK 조회를 지원합니다."""
    op.create_table(
        "auth_identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_auth_identities"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_auth_identities_user_id_users", ondelete="RESTRICT"),
        sa.UniqueConstraint("provider", "subject", name="uq_auth_identities_provider_subject"),
        sa.UniqueConstraint("user_id", "provider", name="uq_auth_identities_user_provider"),
    )


def downgrade() -> None:
    """연결 데이터가 사라져 인증이 차단될 수 있습니다. users/원문/기억은 삭제하지 않습니다."""
    op.drop_table("auth_identities")
