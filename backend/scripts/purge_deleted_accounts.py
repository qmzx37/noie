"""비활성 NOIE 계정 한 건만 재시도하는 operator-only CLI입니다. 사용자 목록은 출력하지 않습니다."""

import argparse
from uuid import UUID
from database import SessionLocal
from account_lifecycle_service import purge_deleted_account


class SafeParser(argparse.ArgumentParser):
    """잘못 입력한 UUID/secret를 argparse 오류에 echo하지 않습니다."""

    def error(self, message):
        self.exit(2, "계정 삭제 재시도 인자를 확인해 주세요.\n")


def main():
    """정확한 UUID를 운영자가 명시하며 active 계정 삭제는 service에서 차단합니다."""
    parser = SafeParser(description="비활성 계정 purge 재시도")
    parser.add_argument("--user-id", type=UUID, required=True)
    args = parser.parse_args()
    try:
        if SessionLocal is None:
            raise RuntimeError
        with SessionLocal() as db:
            status = purge_deleted_account(db, args.user_id)
        print("account_purge " + status)
        return 0
    except Exception:
        print("account_purge retry_required")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
