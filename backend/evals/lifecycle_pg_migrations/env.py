"""기존 migration을 테스트 전용 스키마/버전 테이블에만 적용합니다."""

import os

from alembic import context
from sqlalchemy import text

from evals.run_activity_lifecycle_pg import check_container, check_schema, check_url, DATABASE, USER


config = context.config
schema = check_schema(config.attributes.get("test_schema"))
check_url(os.environ.get("NOIE_SECURITY_TEST_DATABASE_URL"))
if os.environ.get("NOIE_PG_TEST_WRITE_ACK") != "yes":
    raise RuntimeError("test_migration_denied")
if check_container() != config.attributes.get("container_id"):
    raise RuntimeError("test_container_changed")
connection = config.attributes.get("connection")
if connection is None or context.is_offline_mode():
    raise RuntimeError("test_connection_required")
row = connection.execute(text("SELECT current_database(), current_user, current_schema(), current_schemas(false)")).one()
if tuple(row[:3]) != (DATABASE, USER, schema) or row[3] != [schema]:
    raise RuntimeError("test_schema_denied")

from database import Base
import models  # noqa: E402,F401

context.configure(connection=connection, target_metadata=Base.metadata,
                  version_table_schema=schema, compare_type=True)
with context.begin_transaction():
    context.run_migrations()
