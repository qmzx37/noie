"""11.9 격리 실행기: 환경/통신을 먼저 차단하고 결과는 원문 없이 출력합니다."""

import argparse
import ast
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sys
import unittest


def isolate(*, legacy_fixtures=False):
    """실제 비밀 설정과 dotenv를 제거합니다. Windows 이벤트 루프의 내부 연결만 허용합니다."""
    for key in list(os.environ):
        if key.startswith(("NOIE_", "SUPABASE_", "OPENAI_", "DATABASE_", "EXPO_PUBLIC_")):
            os.environ.pop(key, None)
    os.environ.update(PYTHON_DOTENV_DISABLED="1", DATABASE_URL="", OPENAI_API_KEY="",
                      NOIE_SECURITY119_ISOLATED="1",
                      NOIE_AUTH_ENABLED="false" if legacy_fixtures else "true", NOIE_RATE_LIMIT_ENABLED="false",
                      NOIE_LV4_SHADOW_ENABLED="false")
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False
    original = socket.socket.connect

    def connect(sock, address):
        # asyncio Windows socketpair는 자체 루프백을 사용합니다. 외부 주소는 허용하지 않습니다.
        if isinstance(address, tuple) and address[0] in {"127.0.0.1", "::1"}:
            return original(sock, address)
        raise RuntimeError("EXTERNAL_NETWORK_BLOCKED")

    socket.socket.connect = connect
    socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("NETWORK_BLOCKED"))
    socket.socket.connect_ex = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("NETWORK_BLOCKED"))
    socket.socket.sendto = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("NETWORK_BLOCKED"))
    import httpx
    httpx.HTTPTransport.handle_request = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("HTTP_NETWORK_BLOCKED"))

    async def no_async_http(*args, **kwargs):
        raise RuntimeError("HTTP_NETWORK_BLOCKED")

    httpx.AsyncHTTPTransport.handle_async_request = no_async_http
    import psycopg
    psycopg.connect = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("POSTGRES_NOT_AUTHORIZED"))
    psycopg.Connection.connect = psycopg.connect


class SafeResult(unittest.TestResult):
    """예외 본문에는 합성/실제 원문이 포함될 수 있어 종류와 테스트 ID만 기록합니다."""

    def __init__(self):
        super().__init__()
        self.records = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.records.append({"test": test.id(), "status": "PASS"})

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.records.append({"test": test.id(), "status": "FAIL", "error_type": err[0].__name__})

    def addError(self, test, err):
        super().addError(test, err)
        record = {"test": test.id(), "status": "ERROR", "error_type": err[0].__name__}
        if isinstance(err[1], ModuleNotFoundError):
            record["missing_module"] = err[1].name
        self.records.append(record)

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.records.append({"test": test.id(), "status": "NOT_RUN"})

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err:
            self.records.append({"test": test.id(), "status": "FAIL", "error_type": err[0].__name__})


def route_inventory(app):
    """중첩 dependency까지 조사합니다. 공개 상태 endpoint는 별도 구분합니다."""
    from fastapi.routing import APIRoute

    def dependencies(node):
        return ({getattr(node.call, "__name__", "")}
                | set().union(*(dependencies(child) for child in node.dependencies)))

    return [{"path": route.path, "methods": sorted(route.methods),
             "dependencies": sorted(dependencies(route.dependant))}
            for route in app.routes if isinstance(route, APIRoute)]


def main():
    """archive/working tree를 구분하며 실제 PostgreSQL 검사 옵션은 제공하지 않습니다."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-root", required=True)
    parser.add_argument("--suite", choices=("baseline", "attacks", "security"), default="attacks")
    args = parser.parse_args()
    root = Path(args.backend_root).resolve()
    # 과거 /chat fixture는 명시적 개발 OFF를 전제로 합니다. 보안 테스트는 자체 ON을 설정합니다.
    isolate(legacy_fixtures=args.suite != "attacks")
    sys.path.insert(0, str(root))
    loader = unittest.TestLoader()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        import main as api
        from sqlalchemy.orm import configure_mappers
        configure_mappers()
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        config = Config(str(root / "alembic.ini"))
        config.set_main_option("script_location", str(root / "migrations"))
        scripts = ScriptDirectory.from_config(config)
        migration_heads = scripts.get_heads()
        migration_chain = [revision.revision for revision in scripts.walk_revisions()]
        for source in root.rglob("*.py"):
            ast.parse(source.read_text(encoding="utf-8-sig"))
        if args.suite == "attacks":
            spec = importlib.util.spec_from_file_location("security119_attacks", Path(__file__).with_name("run_security_adversarial_tests.py"))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            suite = loader.loadTestsFromModule(module)
        else:
            pattern = "run_*tests.py" if args.suite == "baseline" else "run_security_*tests.py"
            suite = loader.discover(str(root / "evals"), pattern=pattern)
        result = SafeResult()
        suite.run(result)
    report = {"backend_root": str(root), "suite": args.suite, "tests_run": result.testsRun,
              "failures": len(result.failures), "errors": len(result.errors), "skipped": len(result.skipped),
              "syntax_import_mapper": "PASS", "external_network": "blocked", "postgres": "blocked",
              "migration_heads": migration_heads, "migration_chain": migration_chain,
              "routes": route_inventory(api.app),
              "records": result.records if args.suite != "baseline" else [r for r in result.records if r["status"] != "PASS"]}
    print(json.dumps(report, ensure_ascii=True))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
