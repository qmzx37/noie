"""공급망 목록/버전 고정 계약을 합성 metadata와 로컬 lock으로 검증합니다. 설치/통신은 없습니다."""

from pathlib import Path
from types import SimpleNamespace
import unittest

from packaging.requirements import Requirement
from scripts.dependency_inventory import cyclonedx, inventory, npm_inventory, python_inventory, requirements


def fake_distribution(version="1.0", dependencies=(), source=None):
    """실제 앱/DB import 없이 dependency metadata만 대체합니다."""
    return SimpleNamespace(version=version, requires=list(dependencies), read_text=lambda _: source)


class SupplyChainTests(unittest.TestCase):
    """범위를 벗어난 설치/비밀 source를 받아들이지 않는지 검사합니다."""

    def graph(self, dependencies=(), pins=("root==1.0",), child=None):
        """공유 환경의 무관한 패키지가 포함되지 않도록 작은 closure를 사용합니다."""
        items = {"root": fake_distribution(dependencies=dependencies), "child": child or fake_distribution()}
        return python_inventory([Requirement("root")], [Requirement(p) for p in pins], items.__getitem__)

    def lock(self):
        """외부 tarball을 내려받지 않는 합성 공식 registry lock입니다."""
        return {"lockfileVersion": 3, "packages": {"": {"dependencies": {"pkg": "1.0.0"}},
                "node_modules/pkg": {"version": "1.0.0", "resolved": "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
                                     "integrity": "sha512-" + "A" * 86 + "=="}}}

    def test_only_required_closure(self):
        self.assertEqual([c["package"] for c in self.graph()], ["root"])

    def test_extra_dependencies_are_followed(self):
        items = {"root": fake_distribution(dependencies=['child; extra == "binary"']), "child": fake_distribution()}
        result = python_inventory([Requirement("root[binary]")],
                                  [Requirement("root==1.0"), Requirement("child==1.0")], items.__getitem__)
        self.assertEqual(len(result), 2)

    def test_nonrequested_extra_is_excluded(self):
        self.assertEqual(len(self.graph(['child; extra == "test"'])), 1)

    def test_unpinned_transitive_rejected(self):
        with self.assertRaises(ValueError):
            self.graph(["child"])

    def test_installed_version_drift_rejected(self):
        with self.assertRaises(ValueError):
            self.graph(pins=("root==2.0",))

    def test_unsatisfied_parent_range_rejected(self):
        with self.assertRaises(ValueError):
            self.graph(["child>=2"], pins=("root==1.0", "child==1.0"))

    def test_python_exotic_install_rejected(self):
        with self.assertRaises(ValueError):
            self.graph(["child"], pins=("root==1.0", "child==1.0"), child=fake_distribution(source="{}"))

    def test_python_url_dependency_rejected(self):
        with self.assertRaises(ValueError):
            self.graph(["child @ https://example.invalid/child.whl"])

    def test_npm_lock_is_not_runtime_reachability_claim(self):
        result = npm_inventory(self.lock(), {"dependencies": {"pkg": "1.0.0"}})
        self.assertEqual(result[0]["usage"], "runtime_or_build_unresolved")
        self.assertTrue(result[0]["direct"])

    def test_manifest_lock_drift_rejected(self):
        with self.assertRaises(ValueError):
            npm_inventory(self.lock(), {"dependencies": {"pkg": "2.0.0"}})

    def test_untrusted_registry_and_missing_integrity_rejected(self):
        for value in ("git+https://example.invalid/pkg", "file:../pkg", "https://credential@example.invalid/pkg",
                      "https://registry.npmjs.org/pkg?token=fixture"):
            lock = self.lock()
            lock["packages"]["node_modules/pkg"]["resolved"] = value
            with self.subTest(source_type=value.split(":")[0]), self.assertRaises(ValueError):
                npm_inventory(lock, {"dependencies": {"pkg": "1.0.0"}})
        lock = self.lock()
        del lock["packages"]["node_modules/pkg"]["integrity"]
        with self.assertRaises(ValueError):
            npm_inventory(lock, {"dependencies": {"pkg": "1.0.0"}})

    def test_actual_inventory_reproducible_without_environment_secrets(self):
        root = Path(__file__).resolve().parents[2]
        first = inventory(root)
        self.assertEqual(first, inventory(root))
        self.assertFalse(first["production_verified"])
        # Windows 전용 colorama/tzdata marker를 적용해 다른 OS에서도 같은 계약을 검사합니다.
        active = [r for r in requirements(root / "backend/requirements.constraints.txt")
                  if r.marker is None or r.marker.evaluate()]
        self.assertEqual(sum(c["ecosystem"] == "PyPI" for c in first["components"]), len(active))
        self.assertEqual(sum(c["ecosystem"] == "npm" for c in first["components"]), 1401)
        self.assertEqual(sum(c["direct"] and c["ecosystem"] == "PyPI" for c in first["components"]), 9)

    def test_invalid_integrity_encoding_rejected(self):
        lock = self.lock()
        lock["packages"]["node_modules/pkg"]["integrity"] = "sha512-invalid!"
        with self.assertRaises(ValueError):
            npm_inventory(lock, {"dependencies": {"pkg": "1.0.0"}})

    def test_cyclonedx_is_deterministic_and_has_unique_component_refs(self):
        data = inventory(Path(__file__).resolve().parents[2])
        bom = cyclonedx(data)
        self.assertEqual(bom, cyclonedx(data))
        self.assertEqual(bom["bomFormat"], "CycloneDX")
        self.assertEqual(len({c["bom-ref"] for c in bom["components"]}), len(data["components"]))

    def test_cyclonedx_preserves_usage_and_registry_digest_not_attestation(self):
        components = npm_inventory(self.lock(), {"dependencies": {"pkg": "1.0.0"}})
        bom = cyclonedx({"components": components, "scope": "fixture", "python_version": "3.14", "platform": "fixture"})
        self.assertEqual(bom["components"][0]["hashes"][0]["content"], "00" * 64)
        self.assertIn({"name": "noie:usage", "value": "runtime_or_build_unresolved"}, bom["components"][0]["properties"])


if __name__ == "__main__":
    unittest.main()
