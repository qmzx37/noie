"""환경값/앱을 읽지 않고 필요한 Python closure와 npm lock inventory만 생성합니다."""

import argparse
import base64
import importlib.metadata as metadata
import json
import platform
from pathlib import Path
from urllib.parse import quote, urlsplit

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def requirements(path):
    """고정된 manifest의 패키지 줄만 읽습니다. 임의 URL/추가 index는 허용하지 않습니다."""
    result = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line == "-c requirements.constraints.txt":
            continue
        item = Requirement(line)
        if item.url:
            raise ValueError("NON_REGISTRY_REQUIREMENT")
        result.append(item)
    return result


def python_inventory(roots, pins, get_distribution=metadata.distribution):
    """extras/환경 marker를 따라가며 전체 공유 환경 대신 필요한 패키지만 검증합니다."""
    constraints = {canonicalize_name(r.name): r for r in pins
                   if r.marker is None or r.marker.evaluate()}
    direct = {canonicalize_name(r.name) for r in roots}
    queue = list(roots)
    visited = set()
    components = {}
    while queue:
        req = queue.pop(0)
        name = canonicalize_name(req.name)
        dist = get_distribution(name)
        pin = constraints.get(name)
        if pin is None or str(pin.specifier) != "==" + dist.version:
            raise ValueError("UNPINNED_OR_DRIFTED_DEPENDENCY")
        if dist.version not in req.specifier:
            raise ValueError("UNSATISFIED_REQUIREMENT")
        # source URL 대신 provenance 상태만 기록해 로컬 경로나 credentials를 출력하지 않습니다.
        if dist.read_text("direct_url.json"):
            raise ValueError("NON_REGISTRY_INSTALL")
        if name not in components:
            components[name] = {
                "package": name, "version": dist.version, "ecosystem": "PyPI",
                "direct": name in direct,
                "usage": "maintenance" if name in {"alembic", "mako", "markupsafe"} else "runtime",
                "source": "installed-metadata; registry origin not attested",
                "dependencies": [],
            }
        for extra in {"", *req.extras}:
            if (name, extra) in visited:
                continue
            visited.add((name, extra))
            for declaration in dist.requires or []:
                child = Requirement(declaration)
                if child.url:
                    raise ValueError("NON_REGISTRY_REQUIREMENT")
                if child.marker and not child.marker.evaluate({"extra": extra}):
                    continue
                child_name = canonicalize_name(child.name)
                if child_name not in components[name]["dependencies"]:
                    components[name]["dependencies"].append(child_name)
                queue.append(child)
    for component in components.values():
        component["dependencies"].sort()
    return [components[name] for name in sorted(components)]


def npm_inventory(lock, manifest):
    """lock의 출처/무결성을 검사합니다. install 분류를 실제 runtime 도달성으로 과장하지 않습니다."""
    if lock.get("lockfileVersion") != 3:
        raise ValueError("UNSUPPORTED_LOCK_FORMAT")
    root = lock["packages"][""]
    for section in ("dependencies", "devDependencies"):
        if root.get(section, {}) != manifest.get(section, {}):
            raise ValueError("MANIFEST_LOCK_DRIFT")
    direct = set(manifest.get("dependencies", {})) | set(manifest.get("devDependencies", {}))
    result = []
    for location, item in sorted(lock["packages"].items()):
        if not location:
            continue
        name = location.rsplit("node_modules/", 1)[-1]
        source = item.get("resolved", "")
        parsed = urlsplit(source)
        if (parsed.scheme != "https" or parsed.hostname != "registry.npmjs.org"
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or not item.get("integrity", "").startswith("sha512-")):
            raise ValueError("UNVERIFIED_LOCK_SOURCE")
        # 형식 검사일 뿐 다운로드 bytes 검증이나 서명/악성 여부 판정은 아닙니다.
        if len(base64.b64decode(item["integrity"][7:], validate=True)) != 64:
            raise ValueError("INVALID_INTEGRITY_FORMAT")
        usage = "dev" if item.get("dev") else "runtime_or_build_unresolved"
        if name == "@expo/webpack-config":
            usage = "build"
        result.append({"package": name, "version": item["version"], "ecosystem": "npm",
                       "location": location, "direct": location == "node_modules/" + name and name in direct,
                       "usage": usage, "source": source, "integrity": item["integrity"],
                       "install_script": bool(item.get("hasInstallScript")),
                       "optional": bool(item.get("optional"))})
    return result


def inventory(root):
    """환경별 marker/버전을 명시합니다. production SBOM이나 다운로드 검증으로 오해하지 않습니다."""
    python = python_inventory(requirements(root / "backend/requirements.txt"),
                              requirements(root / "backend/requirements.constraints.txt"))
    npm = npm_inventory(json.loads((root / "mobile/package-lock.json").read_text(encoding="utf-8")),
                        json.loads((root / "mobile/package.json").read_text(encoding="utf-8")))
    return {"format": "NOIE_DEPENDENCY_INVENTORY_V1", "python_version": platform.python_version(),
            "platform": platform.system(), "scope": "local installed Python closure + mobile lock",
            "production_verified": False, "components": python + npm}


def cyclonedx(result):
    """추가 도구 없이 표준 component SBOM을 만듭니다. 실제 운영 배포/빌드 결과로 과장하지 않습니다."""
    components = []
    for item in result["components"]:
        ecosystem = "pypi" if item["ecosystem"] == "PyPI" else "npm"
        ref = ecosystem + ":" + item.get("location", item["package"])
        component = {"type": "library", "bom-ref": ref, "name": item["package"],
                     "version": item["version"],
                     "purl": "pkg:" + ecosystem + "/" + quote(item["package"], safe="/") + "@" + item["version"],
                     "properties": [{"name": "noie:direct", "value": str(item["direct"]).lower()},
                                    {"name": "noie:usage", "value": item["usage"]},
                                    {"name": "noie:source", "value": item["source"]}]}
        if "integrity" in item:
            component["hashes"] = [{"alg": "SHA-512", "content": base64.b64decode(item["integrity"][7:]).hex()}]
            component["externalReferences"] = [{"type": "distribution", "url": item["source"]}]
        components.append(component)
    return {"$schema": "http://cyclonedx.org/schema/bom-1.5.schema.json", "bomFormat": "CycloneDX",
            "specVersion": "1.5", "version": 1, "metadata": {"properties": [
                {"name": "noie:scope", "value": result["scope"]},
                {"name": "noie:python", "value": result["python_version"]},
                {"name": "noie:platform", "value": result["platform"]},
                {"name": "noie:production_verified", "value": "false"}]}, "components": components}


def main():
    """출력 경로를 명시한 경우만 raw artifact를 만듭니다. 기본값은 stdout입니다."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--format", choices=("inventory", "cyclonedx"), default="inventory")
    args = parser.parse_args()
    try:
        result = inventory(Path(__file__).resolve().parents[2])
        if args.format == "cyclonedx":
            result = cyclonedx(result)
    except Exception:
        # 오류에 설치 source/로컬 경로가 포함될 수 있어 고정 메시지만 출력합니다.
        print("DEPENDENCY_INVENTORY_FAILED")
        return 1
    encoded = json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
    if args.output:
        # 기존 파일을 덮어쓰지 않아 사용자 변경과 기존 raw artifact를 보호합니다.
        with args.output.open("x", encoding="utf-8") as output:
            output.write(encoded)
    else:
        print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
