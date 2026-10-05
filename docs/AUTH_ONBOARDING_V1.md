# NOIE Auth Onboarding v0.1

## 경계와 저장 시점

- 일반 protected endpoint는 기존 JWT verifier -> AuthIdentity -> 활성 local User -> AuthPrincipal 경계를 그대로 사용한다. mapping이 없으면 403이며 일반 요청에서 계정을 생성하지 않는다.
- `POST /auth/bootstrap`만 verified Supabase identity로 onboarding한다. Auth OFF에서도 JWT 검증은 필수이며 body user_id/email/claims를 신원으로 받지 않는다.
- 최초/반복 호출 모두 HTTP 200, `{"status":"ready"}`만 반환한다. 외부 subject/token/email/local UUID를 응답하지 않는다.
- 신규 local UUID는 기존 ORM의 uuid4로 생성한다. Supabase subject를 local UUID로 복사하거나 같은 이메일/이름/dev-user를 검색해 연결하지 않는다.
- 기존 mapping은 그대로 재사용하고 연결된 User가 삭제되었으면 403이다. 누락된 DB/쓰기 실패는 안전한 503이다.
- 새 User와 AuthIdentity는 같은 transaction에서 commit한다. UNIQUE(provider, subject) 경쟁 패자는 두 행 모두 rollback한 뒤 승자의 활성 mapping을 재사용한다. 재연결/삭제/새 migration은 없다.
- 이메일 로그인, 즉시-session 회원가입, Google 로그인 모두 bootstrap 성공 후에만 `saveAuthSession`을 호출한다. 임시 token은 메모리에만 둔다.
- bootstrap 실패는 같은 revision의 세션만 정리한다. logout/다른 로그인 이후 늦은 응답은 새 계정을 덮어쓰거나 삭제하지 못한다.
- 기존 저장 session startup/refresh는 매번 bootstrap하지 않는다. 기존 매핑된 사용자의 startup 동작과 refresh/401 retry 계약은 유지한다.

## 이메일 회원가입

- 기존 Supabase REST `/auth/v1/signup`을 사용한다. 빈 이메일/비밀번호와 8자 미만 비밀번호를 거부하고 비밀번호 원문을 저장/출력하지 않는다.
- confirmation이 필요한 User-only 응답은 session을 저장하지 않고 "이메일을 확인한 뒤 로그인해 주세요."를 표시한다.
- 이메일 확인 후 앱에서 password login -> bootstrap을 수행한다. 확인 링크의 token을 앱 세션으로 자동 채택하지 않으며 확인 설정을 우회하지 않는다.
- 즉시 token이 반환되면 bootstrap 후 기존 안전 필드 세 개(accessToken, refreshToken, expiresAt)만 저장한다.

## Google 로그인

- Supabase Google provider로 브라우저 OAuth를 시작한다. 앱이 Google API나 Google secret에 직접 접근하지 않는다.
- Expo 48 SDK의 `expo-linking ~4.0.1`, `expo-web-browser ~12.1.1`과 기존 `expo-crypto ~12.2.1`을 사용한다.
- crypto 32-byte random으로 만든 64자 verifier와 SHA256/base64url challenge를 사용한다. authorize의 `code_challenge_method=s256`, 교환의 `grant_type=pkce`, `auth_code`, `code_verifier`는 Supabase REST 계약이다.
- verifier는 현재 시도의 메모리에만 있으며 URL/저장소/로그에 남기지 않는다. Google provider token이나 URL access token은 저장하지 않는다.
- callback URL은 같은 redirect를 확인하고 query의 단일 code만 허용한다. error/중복 code/implicit token fragment는 거부한다. Supabase가 자기 provider OAuth state를 관리하며 브라우저 SDK의 origin/redirect 검사도 끄지 않는다.
- cancel/dismiss는 앱 세션을 만들지 않는다. 재시도는 새 verifier를 만든다. 앱/브라우저가 종료되면 진행 중 시도를 복원하지 않고 새 로그인을 시작한다.
- SDK의 `maybeCompleteAuthSession`은 웹 popup callback에서 실행한다. callback은 같은 앱의 루트를 로드한다.

## 사용자가 직접 설정할 항목

1. Google Cloud / Google Auth Platform에서 Branding, Audience, Data Access를 구성한다. 테스트 상태이면 canary Google 계정을 test user로 등록한다. 최소 scope는 openid/email/profile이다.
2. OAuth client를 **Web application**으로 생성한다. 이 구현은 native Google SDK 대신 Supabase의 브라우저 flow를 사용하므로 앱에 iOS/Android Google secret을 넣지 않는다.
3. Google client의 Authorized redirect URIs에 **Supabase callback** `<SUPABASE_URL>/auth/v1/callback`을 등록한다. 앱의 `noie://...` 주소를 Google callback으로 등록하는 것이 아니다.
4. Authorized JavaScript origins에는 실제 NOIE 웹 origin을 등록한다. 개발 origin은 개발에만 등록한다.
5. Supabase Dashboard -> Authentication -> Sign In / Providers -> Google에서 provider를 켜고 Google Web client ID와 client secret을 입력한다. secret은 Supabase 설정에만 두고 mobile/.env/git/log에 넣지 않는다.
6. Supabase Authentication -> URL Configuration의 Site URL은 실제 NOIE 웹 주소로 설정한다. Redirect URLs에는 실제 웹 루트 URL(예: `https://<NOIE_WEB_HOST>/`)과 `noie://auth/callback`을 각각 명시적으로 추가한다. 전체 도메인 wildcard는 피한다.
7. 웹 redirect는 `googleRedirectUri()`에서 현재 origin + `/`로 생성한다. localhost 주소를 배포 코드에 하드코딩하지 않는다. 로컬 테스트 origin도 정확히 allowlist에 등록하고 HTTPS 또는 localhost secure context를 사용한다.
8. Native는 app.json의 `scheme=noie`가 적용된 새 development/standalone build를 설치한다. 기존 바이너리는 scheme 추가가 자동 적용되지 않으므로 재빌드가 필요하다. Expo Go callback은 환경에 따라 exp://...로 달라지므로 v0.1 native canary는 development build를 우선한다.
9. Supabase의 이메일 가입 허용/confirmation 정책과 SMTP를 확인한다. confirmation-required 상태를 실제로 테스트한다.
10. backend `/auth/bootstrap` 코드 배포와 기존 auth_identities migration 0018 적용 여부를 먼저 확인한다. 이번 단계는 새 migration이나 production Auth 환경변수 변경을 수행하지 않는다.

## 검증과 남은 과제

- 로컬 SQLite 실제 ORM/UNIQUE 테스트 및 mock HTTP/browser 검증은 실제 PostgreSQL 동시성/Google provider/Supabase signup 성공 증거와 구분한다.
- LIVE canary에서는 새 subject 반복/동시 bootstrap의 User/identity count, 기존 수동-linked 계정 보존, 다른 계정 데이터 격리, confirmation, Google 취소/성공, Safari popup 및 native deep link를 확인한다.
- popup이 차단되면 안전한 오류가 표시된다. 앱 reload/닫힘으로 사라진 PKCE 시도를 URL token으로 복원하지 않는다.
- 앱 저장소는 기존 AsyncStorage다. 암호화 token 저장, 계정별 기존 로컬 NOIE 데이터 분리, rate limiting/CAPTCHA, 보안 헤더와 provider session revoke는 별도 보안 과제다.
- Expo 48은 오래된 의존성 기반이다. 이번 설치의 npm audit 보고는 80개(critical 1 포함)이며 대규모 자동 audit fix는 하지 않았다. 공개 출시 전 의존성 보안 점검/업그레이드 계획이 필요하다.
- stage/commit/push, production 환경변수 변경, 실제 계정 생성/DB write는 자동 수행하지 않는다.

## 공식 자료

- [Supabase Google 설정](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Auth REST 계약](https://github.com/supabase/auth/blob/master/openapi.yaml)
- Expo 호환 버전은 설치된 SDK 48 `bundledNativeModules.json`과 해당 버전의 SDK 소스를 기준으로 확인했다.
