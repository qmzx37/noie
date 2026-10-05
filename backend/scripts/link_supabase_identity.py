"""검증된 계정 정보를 운영자가 확인한 뒤 실행하는 CLI입니다. token/email은 입력받지 않습니다."""

import argparse
import sys
from uuid import UUID

from auth_account_link_service import AccountLinkError, link_auth_identity
from database import SessionLocal


class SafeArgumentParser(argparse.ArgumentParser):
    """잘못 입력한 token/식별자가 argparse 오류 메시지에 반복 출력되지 않게 합니다."""

    def error(self, message):
        self.exit(2, "Invalid command arguments. Use --help.\n")


def main(argv=None) -> int:
    """전용 세션으로 dry-run은 rollback, 명시적 쓰기는 commit하며 내부 오류는 숨깁니다."""
    parser = SafeArgumentParser(description="Explicit Supabase account link; verify account ownership separately.")
    parser.add_argument("--user-id", required=True, metavar="LOCAL_USER_UUID")
    parser.add_argument("--subject", required=True, metavar="VERIFIED_SUPABASE_SUB")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--confirm-link", action="store_true", help="Confirm the verified account-to-local-user association.")
    args = parser.parse_args(argv)
    if not args.dry_run and not args.confirm_link:
        parser.error("Explicit confirmation required")
    try:
        user_id = UUID(args.user_id)
    except ValueError:
        parser.error("Invalid local user UUID")
    if SessionLocal is None:
        print("ACCOUNT_LINK_FAILED: DATABASE_UNAVAILABLE", file=sys.stderr)
        return 1
    try:
        with SessionLocal() as db:
            try:
                result = link_auth_identity(db, user_id=user_id, provider="supabase", subject=args.subject, dry_run=args.dry_run)
                if args.dry_run:
                    # read transaction까지 정리하고 DB에는 어떤 연결도 기록하지 않습니다.
                    db.rollback()
                else:
                    db.commit()
            except Exception:
                db.rollback()
                raise
        if args.dry_run:
            print("DRY_RUN: LINK_EXISTS" if result is not None else "DRY_RUN: LINK_AVAILABLE")
        else:
            print("ACCOUNT_LINK_OK")
        return 0
    except AccountLinkError as error:
        print("ACCOUNT_LINK_FAILED: " + error.code, file=sys.stderr)
    except Exception:
        # DB URL/원본 예외/식별자 대신 고정 상태만 출력합니다. traceback도 출력하지 않습니다.
        print("ACCOUNT_LINK_FAILED: DATABASE_ERROR", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
