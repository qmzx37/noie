"""Alembic이 모델 metadata와 DATABASE_URL을 읽도록 연결합니다."""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from database import Base, normalize_database_url
import models  # noqa: F401  # 모든 모델을 Base.metadata에 등록합니다.


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

load_dotenv()
database_url = normalize_database_url(os.getenv("DATABASE_URL", ""))
if not database_url:
    raise RuntimeError("Alembic 실행 전에 DATABASE_URL을 설정해 주세요.")

# ConfigParser가 URL 안의 % 문자를 보간하지 않도록 이스케이프합니다.
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """DB 연결 없이 SQL 스크립트만 생성할 때 사용합니다."""

    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """실제 PostgreSQL에 연결해 migration을 적용합니다."""

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
