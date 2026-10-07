# NOIE Security Phase 11.10.4: Supply-Chain Closure

Date: 2026-10-07. Repository: `C:\noie`. Working-tree HEAD: `fcf9a3429c14ab5269a14c45fb3a31d24b42c611`.

## Verdict And Scope

**LOCAL_SECURITY_GATE_PASS. PRODUCTION_RELEASE_NOT_APPROVED. `release_approved=false`.**

이 판정은 현재 working tree의 **로컬 Windows CPython 3.14.3 / Node 24.13.0 / npm 11.6.2** 검증에 한정한다.
공급망 위험 전체 제거, 깨끗한 운영 설치, 실제 빌드, 실제 DB/Auth/device 검증, 운영 출시 승인을 의미하지 않는다.
현재 확인된 운영/로컬 업무 경로의 exploitable C/H는 0건이다. 취약 패키지가 0개라는 뜻이 아니다.

Phase 11.10.3 HOLD 이후 바뀐 근거:
- Host 비용 분류의 현재 application mitigation과 12개 regression을 다시 확인했다.
- 직접/전이 Python 버전 선택을 실제 requirements에서 제한하고 새 resolver dry-run으로 대조했다.
- 누락됐던 HTTP/2 전이 패키지까지 포함해 inventory와 OSV 검사를 보완했다.
- C/H를 운영 요청 위험으로 일괄 취급하지 않고 실제 빌드/개발 기능과 공격 전제로 재분류했다.
- npm registry signatures/attestations를 실제 검증했다.
- 현재 Backend/Security/Mobile 회귀가 다시 통과했다.

운영 설치 환경 미확인은 PRE_PRODUCTION_REQUIRED로 분리한다. 이를 확인했다고 가정하지 않는다.
빌드 입력이 신뢰되지 않거나 dev server를 외부에 노출하는 워크플로에는 이 Local PASS를 적용하지 않는다.
표준 SBOM의 전체 schema 검증 미완료도 별도로 남긴다. 최소 inventory 계약 검증을 formal conformance와 혼동하지 않는다.

## Starlette Final Disposition

- 현재 Starlette **0.52.1**, FastAPI **0.128.4**.
- [maintainer advisory GHSA-86qp-5c8j-p5mr](https://github.com/Kludex/starlette/security/advisories/GHSA-86qp-5c8j-p5mr): affected `<=1.0.0`, fixed **1.0.1**.
- 설치된 FastAPI metadata: `starlette>=0.40.0,<1.0.0`. fixed version을 강제 설치하면 현재 계약 밖이다.
- 현재 `enforce_user_limit`은 **`request.scope["path"]`**로 그룹을 계산한다.
  Host/forwarded host/absolute URL/request.url/base_url은 security group authority가 아니다.
- production application source에서 다른 Request URL 기반 auth/ownership/resource authority를 찾지 못했다.
  `security_config.py`와 `supabase_auth_verifier.py`의 urlsplit은 설정 origin/provider URL 검증이며 request Host가 아니다.
- Starlette 자체 자동 trailing-slash redirect는 여전히 `URL(scope=...)`를 사용한다.
  이것을 patched라고 주장하지 않는다. LIVE proxy/Host/redirect 정책은 별도 운영 검증 대상이다.
- 알려진 NOIE 비용 분류 경로는 mitigation + 12개 regression으로 고정돼 현재 local blocker가 아니다.
  다른 URL-sensitive 기능을 추가하면 재감사한다. 패키지 advisory와 framework upgrade debt는 남는다.
- **FastAPI/Starlette upgrade 0**. compatibility 밖의 major 변경을 자동 수행하지 않았다.

## Fresh Advisory Snapshot And Classification

공식 registry에서 새로 수행한 `npm audit --package-lock-only --ignore-scripts --json`:
- affected families **95** = Critical 3 / High 55 / Moderate 36 / Low 1.
- unique GHSA **89** = Critical 3 / High 55 / Moderate 27 / Low 4.
- family와 advisory는 다른 단위다. 새 advisory ID 집합은 11.10.2의 89개와 동일하다.
- 모든 현재 lock location/설치 버전을 재대조했다. 이전 JSON의 range/chain 상세를 재사용할 근거가 유지된다.

| Current classification | All unique npm advisory | C/H unique advisory |
|---|---:|---:|
| Production runtime reachable, demonstrated exploit | 0 | 0 |
| Build/install-time feature only | 75 | 54 |
| Development tooling only | 10 | 4 |
| Vulnerable feature not reachable in inspected usage | 1 | 0 |
| Runtime callback path exists, exploitability uncertain | 3 | 0 |

89개의 ID/package/chain/feature/fixed/class는 이번 RESULTS.json에 있다.
raw range/advisory/maintainer 세부 자료는 보존된 11.10.2 JSON을 참조한다.
`production runtime reachable=0`은 관측된 exploit 경로 기준이다. 잠재 공격/zero-day 부재를 보장하지 않는다.

### Build / Development Risk

- build/install: tar, xmldom/plist, braces/glob, CSS/PostCSS/SVGO/source-map,
  serialize-javascript, image-size/Metro, config/CLI parser 등.
- development only: shell-quote/editor utilities, proxy-addr/Express trust proxy,
  compression/dev server, webpack-dev-middleware/server.
- Critical 3개는 tar의 build archive DoS 1개, shell-quote 개발용 command injection 1개,
  proxy-addr 개발용 trusted proxy spoofing 1개다. FastAPI runtime의 인증 구현이 이 JS proxy library를 사용하지 않는다.
- serializer RCE, tar file overwrite, CSS source-map disclosure는 **조건부이지만 의미 있는 supply-chain 위험**이다.
  악성 archive/assets/config/serialization object, 외부 노출 dev server, 빌드 계정 권한/비밀값이 공격 전제다.
- NOIE API가 사용자 message/Memory를 Node build serializer/archive/SVG compiler에 넣는 경로는 확인하지 못했다.
  source-controlled asset/build 입력과 production API의 사용자 원문을 같은 경계로 취급하지 않는다.
- 실제 CI 입력/credentials/provenance policy를 검사하지 않았다. 이 C/H를 harmless나 false positive로 처리하지 않는다.
  공개 입력을 빌드하거나 credential-bearing CI를 운영하기 전에는 격리/최소 권한 및 별도 toolchain 검증이 필요하다.

### Safe Minor/Patch Candidates Versus Major Debt

| Candidate / current | Review disposition |
|---|---|
| proxy-addr 2.0.7 -> 2.0.8 | patch 후보. 개발용 Express trust-proxy 입력 전제; 실제 dev/build 호환 검증 전 자동 적용하지 않음 |
| shell-quote 1.9.0 -> 1.11.0 | minor 후보. quote comment-token 입력 계약/CLI 검증 필요 |
| postcss 8.5.16 -> 8.5.23 | minor 후보. CSS/map input과 asset build regression 필요 |
| qs 6.15.3 -> 6.16.0 | 실제 callback parser의 minor 후보. SDK/web/native 호환 및 bounded malformed callback 검사 필요 |
| tar 6 -> 7 / image-size 0 -> 2 / serializer 6 -> 7 / WDS 4 -> 5 | major/호환 위험. 별도 migration; 강제 override 금지 |
| Starlette 0.52.1 -> 1.0.1+ | 현재 FastAPI `<1.0.0` 범위 밖. coordinated framework 작업 필요 |

fixed version이 존재한다는 것만으로 모든 실제 수정 조건이 충족되지는 않는다.
이번 검사에는 clean native/web asset build 검증이 없다. 안전성을 검증하지 않은 transitive lock 교체를 하지 않았다.
**실제 version 변경/설치/upgrade/override/fix --force 0.**

## Python Version Reproducibility

선택: 기존 `requirements.txt` 9개 직접 요구사항을 유지하고 `-c requirements.constraints.txt`를 연결한다.
별도 package manager/tool dependency를 추가하지 않는다. 이미 필요한 `packaging`만 검사 스크립트에서 사용한다.

- 현재 환경에서 필요한 **50개**의 직접/전이 버전만 exact pin. 공유 환경 전체 pip freeze가 아니다.
- `psycopg[binary]`, `httpx[http2]`, `pyjwt[crypto]` extras를 실제 marker/metadata로 추적한다.
- 이전 47개 closure에는 `h2 4.4.1 / hpack 4.2.0 / hyperframe 6.1.0`이 누락됐다.
  이번 generator는 extras를 전파하고 누락 pin/버전 drift/부모 range 불일치/비-registry 설치를 거부한다.
- OSV에 실제 50개 name/version만 재조회했다. 보완된 3개에서 새 affected package는 0;
  기존과 동일한 19 alias ID / unique 10 advisory가 확인됐다.
- Windows-only colorama/tzdata marker를 적용한다. 임의 extras나 다른 Python/OS가 추가되면 새 profile 검증이 필요하다.
- constraints는 **version lock이며 artifact hash lock은 아니다**. package 내용의 진위까지 보장하지 않는다.

Fresh public-PyPI resolver dry-run:
```powershell
cd C:\noie\backend
python -m pip --isolated install --dry-run --ignore-installed --only-binary=:all: --no-cache-dir --disable-pip-version-check --index-url https://pypi.org/simple --report "$env:TEMP\noie-python-resolve.json" -r requirements.txt
```
이 명령은 실제 설치를 하지 않는다. 이번 결과의 50개 버전은 현재 설치 inventory와 정확히 일치했다.
모두 wheel, `files.pythonhosted.org` source, 공개 report에 SHA256 50개. sdist build/hook 실행 0.
첫 sandbox network 차단은 resolver incompatibility 증거가 아니며, 읽기 전용 metadata escalation 후 통과했다.

현재 검증 profile에서는 같은 source revision이 같은 version graph를 선택한다.
Linux/Render Python 버전과 실제 build command는 확인되지 않았다. 로컬 3.14 snapshot을 운영 검증으로 부르지 않는다.
배포 전 목표 환경에서 새 clean resolution/install을 실행하고 marker closure와 wheel availability를 확인해야 한다.
기존 version pin 중 알려진 advisory 예외는 이 문서와 11.10.2 상세 근거에 기록했고 해결됐다고 주장하지 않는다.

모바일 설치 재현성은 `mobile/package-lock.json` v3 기준이다. `npm ci --ignore-scripts`는 깨끗한 CI에서 검토 후 사용할 정책이며
이번 작업에서 설치하지 않았다. native OS에 필요한 hook까지 영구 차단하라는 뜻이 아니다.
root legacy package.json은 lock이 없고 RN/TS 버전도 다르다. 검증된 명령의 실행 root는 backend/mobile이며 root install은 지원 근거가 없다.
manifest 삭제로 이를 숨기지 않고 운영 entrypoint 확인을 남긴다.

## Reproducible Inventory / SBOM

새 `backend/scripts/dependency_inventory.py`는 private .env/DB/앱/외부 API를 import하지 않는다.
패키지 목록을 동적으로 설치하지 않는다. Python metadata와 mobile lock 두 가지를 읽는다.

정보: name/version/direct-transitive/ecosystem/source/integrity/usage/optional/install hook flag.
Python dependency edges도 기록한다. npm 설치의 `dev=false`를 실제 runtime 도달성으로 오해하지 않고
알 수 없는 부분은 `runtime_or_build_unresolved`로 남긴다. 실제 C/H 도달성 분류는 이번 JSON의 별도 근거다.

- Python 50 + npm lock locations 1,401 = **1,451 components**.
- JSON inventory와 CycloneDX **1.5 component inventory** 생성 기능.
- 같은 environment/lock에서 같은 출력; timestamp/random serial/개인값 없음.
- `--output`은 새 파일만 생성하며 기존 파일을 덮어쓰지 않는다.
- Python 기존 설치 source는 metadata만으로 attestation할 수 없어 UNKNOWN을 명시한다.
  공개 wheel resolver source 확인이 기존 설치 파일의 진위 검증은 아니다.
- npm registry URL/credentials/query/fragment와 SHA512 encoding/길이 형식 검사.
  실제 downloaded bytes를 새로 설치해 검증했다고 주장하지 않는다.

```powershell
cd C:\noie\backend
python -B scripts/dependency_inventory.py --output "$env:TEMP\noie-inventory-new.json"
python -B scripts/dependency_inventory.py --format cyclonedx --output "$env:TEMP\noie-sbom-new.json"
cd C:\noie\mobile
npm sbom --package-lock-only --sbom-format=cyclonedx --ignore-scripts
```
native npm SBOM 생성도 실제 통과: **CycloneDX1.5 / unique components1,210 / dependency records1,211 / pre-build**.
이는 1,401 location을 고유 name/version 단위로 합치는 출력이며 수량 불일치가 아니다.

**전체 JSON schema 검증: NOT_COMPLETED.** 기존 AJV8 검증에서 `wrapper0.validate is not a function`이 발생했다.
초기 `$schema` 식별자 mismatch는 공식 schema의 HTTP literal에 맞췄으나 이후 검사 완료는 증명하지 못했다.
IRI/email format 지원도 불완전했다. 새 validator를 설치하거나 기존 JS graph를 바꾸지 않았다.
이를 formal conformance PASS로 기록하지 않는다. inventory의 closure/source/digest/동일 출력 계약 15개 테스트는 별도 통과했다.

대형 raw artifact는 Git에 넣지 않는다. CI artifact 저장소에 profile/revision/manifest hash와 함께 보존하고
이번 요약 JSON에서 고정 버전/분류/검사 근거를 유지한다. 운영 SBOM은 실제 배포 환경과 실제 web/native artifact에서 다시 생성해야 한다.

참조: [pip repeatable installs](https://pip.pypa.io/en/stable/topics/repeatable-installs/),
[npm SBOM](https://docs.npmjs.com/cli/v11/commands/npm-sbom/),
[CycloneDX JSON schema](https://cyclonedx.org/schema/bom-1.5.schema.json).

## OAuth / JWT / Provider Provenance

- Backend: Supabase2.32.0 -> supabase-auth2.32.0 -> PyJWT2.15.1 / cryptography50.0.2.
- 읽은 SDK의 get_claims: asymmetric key signature verify; symmetric/no-kid는 get_user 검증 경로.
  NOIE의 issuer/audience/role/anonymous/expiry/canonical subject 검증과 fail-closed 동작을 바꾸지 않았다.
- Mobile는 자체 fetch/PKCE + Expo Crypto/Linking/WebBrowser 사용. Google/Kakao/custom:naver 전용 추가 helper package 없음.
- WebBrowser.web -> compare-urls2.0.0 -> normalize-url2.0.1 -> query-string5.1.1 -> decode-uri-component0.2.2.
- Linking4.0.1 -> qs6.15.3. parser 권고 Moderate3개를 build-only로 숨기지 않는다.
  실제 callback parse 경로는 존재하지만 해당 취약 옵션/입력 전제로 exploit이 성립하는지는 이번에 재현하지 않았다.
- qs/decoder의 bounded malformed web/native 검사는 PRE_PRODUCTION_REQUIRED이며 token 탈취/PKCE bypass 성공으로 보고하지 않는다.
- npm lock의 공식 registry/SHA512 source 1,401개; Git/file/auth-bearing exotic dependency0.
- 로컬 설치 1,400개 version은 lock과 일치. 누락1개는 Windows에서 설치되지 않은 optional darwin fsevents.
- **npm audit signatures: registry signature1,400 검증 / attestations133 검증**, exit0.
  signature/integrity는 무악성 보증이 아니고 attestation 없는 나머지를 악성이라고 단정하지 않는다.
- Python closure에 direct_url Git/file 설치0. 새 wheel metadata는 공식 PyPI에서 확인했지만 기존 설치 byte provenance는 별도 확인 필요.
- token/key/email/DB URL 등 실제 credential 값을 읽거나 출력/전송하지 않았다. 실제 provider 공격/canary0.

[npm signature verification](https://docs.npmjs.com/cli/v11/commands/npm-audit/),
[Supabase install security guidance](https://supabase.com/docs/guides/security/npm-security).
공식 Supabase changelog markdown은 web fetch content-type 오류로 확인하지 못했다. SDK/API 기능을 바꾸지 않았다.

## Install Hooks And Unused Dependencies

- 앱 root/mobile preinstall/install/postinstall/prepare0.
- 설치된 dependency manifests: prepare 정의130, preinstall/install/postinstall0.
- prepare 정의를 실제 실행 증거로 취급하지 않는다.
- lock hasInstallScript: **fsevents2.3.3 / optional / darwin-only** 1개. 정상 native hook 검토 대상이며 Windows 설치 없음.
- 이번 lifecycle 실행0. least-privilege clean CI, build credentials 분리, OS별 필요한 hook 명시적 검토를 남긴다.
- `@expo/webpack-config`는 app bundler=metro만으로 모든 CLI/build/test에서 미사용이라고 증명하지 못했다.
  제거 시 큰 transitive chain이 바뀌므로 삭제0. root legacy manifest도 보존한다.

## Fresh Verification

| Check | Result |
|---|---|
| New inventory/constraints/SBOM contracts | **15/15 PASS** |
| Host / Resource Budget / Rate Limit | **12/12, 44/44, 24/24 PASS** |
| V1 / V2 / V3 / V3 additional / Adversarial | **20/20, 24/24, 11/11, 17/17, 15/15 PASS** |
| Full Security | **399/399 PASS** (384 + new15) |
| Full Backend | **1050/1050 PASS** (1035 + new15) |
| Mobile auth/accountStorage | **96/96 PASS**, code unchanged |
| TypeScript / pip check | **PASS / PASS** |
| Python syntax / FastAPI import / SQLAlchemy mapper | **PASS** |
| Static Alembic | single head20261006_0020 /20 revisions; no migration |
| Fresh Python wheel-only resolver | **50 versions matched**, actual install0 |
| npm signatures / native npm SBOM | **PASS / PASS** |
| Unified full schema validation | **NOT_COMPLETED**, not counted as PASS |
| Expo public config static check | **PASS**, SDK48/web metro; not a real build |
| Actual DB / OpenAI / external Auth / production / native device | **NOT_RUN** |
| git diff --check | **PASS**, existing LF/CRLF notices are not errors |

Backend runner blocks actual network/PostgreSQL and ignores private dotenv before app import.
Its mock/local PASS is not real provider/DB proof. Public npm/PyPI/OSV/schema metadata requests are separate audit commands,
not production or provider requests. Initial sandbox network failures were recorded; installs/hooks were not used as workarounds.

## Remaining Work And Release Boundary

**PRE_PRODUCTION_REQUIRED**:
1. Actual Render Python/OS/build root/install command; clean target-profile binary resolution/install with exact constraints.
2. Actual deployed backend/web/native SBOM, compatible full schema validation, artifact-origin/hash comparison.
3. Isolated credential-free CI and web/native build proof; safe minor candidates and separate coordinated major toolchain/framework migration.
   Avoid untrusted templates/assets/archives and exposed dev servers until those workflows are secured.
4. Bounded malformed OAuth callback web/native tests and compatible parser remediation.
5. Dedicated PG concurrency, actual migration/drift, Native SecureStore device, production auth/CORS/proxy/redirect/provider canaries.

**ONGOING_SECURITY_WORK**: periodic npm/OSV/provenance review; per-platform hash locks/approved wheel mirror;
Node/npm and required native-hook policy; supplier/release maintenance; unused root/webpack dependency cleanup after evidence;
re-evaluate any new URL-sensitive consumer or untrusted build input.

No proven runtime C/H finding was reclassified merely to force PASS. All npm85 build/development advisories remain in the results,
including RCE/disclosure/file-write concerns. They are not permission to ship an unverified build pipeline.
Local criteria cover this current local source/profile and deterministic regressions only; pre-production work remains mandatory.

## Changes And Protection

- Modified only existing `backend/requirements.txt`: comment + constraints include.
- New: constraints, inventory CLI, deterministic test file, this document, RESULTS JSON.
- Installed package versions, mobile, business auth/ownership/Memory/Lv4/Host mitigation/migration untouched.
- Baseline422 files: requirements allowed delta only; **421 original files SHA256-identical** including appStyles and old audit/security docs.
- Status: modified38 / untracked89 / staged0; expected scoped additions5. Full status is in RESULTS.json after verification.
- stage/commit/push/deploy/reset/clean/restore/add0. Existing unrelated changes are preserved.

**LOCAL_SECURITY_GATE_PASS / PRODUCTION_RELEASE_NOT_APPROVED**
