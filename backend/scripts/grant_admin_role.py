"""DB 접근권이 있는 운영자만 실행하는 CLI입니다. 공개 endpoint나 token 입력은 없습니다."""

import argparse
from uuid import UUID

from database import SessionLocal
from admin_access_service import REASONS, ROLES, provision_admin_grant


class SafeArgumentParser(argparse.ArgumentParser):
    """잘못 입력된 값도 secret일 수 있어 argparse의 원문 echo를 차단합니다."""

    def error(self, message):
        self.exit(2, "Invalid admin grant arguments. Use --help for the contract.\n")


def main(argv=None):
    """성공/실패 상태만 출력하며 UUID/DB 오류/secret은 출력하지 않습니다."""
    parser = SafeArgumentParser(description="Provision or revoke a NOIE admin grant")
    parser.add_argument("--user-id", required=True, type=UUID)
    parser.add_argument("--role", required=True, choices=sorted(ROLES))
    parser.add_argument("--reason-code", required=True, choices=sorted(REASONS))
    parser.add_argument("--case-reference")
    parser.add_argument("--revoke", action="store_true")
    args = parser.parse_args(argv)
    try:
        if SessionLocal is None:
            raise RuntimeError
        with SessionLocal() as db:
            result = provision_admin_grant(db, user_id=args.user_id, role=args.role,
                reason_code=args.reason_code, case_reference=args.case_reference, revoke=args.revoke)
        print("Admin grant operation: " + result["status"])
        return 0
    except Exception:
        print("Admin grant operation failed; no grant change was committed.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
