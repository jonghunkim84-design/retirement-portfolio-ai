# 지시서 S1 — 데이터 접근 보안 강화 (RLS 활성화 + API 인증)

- 프로젝트: 은퇴포트폴리오 AI (retirement-portfolio-ai.vercel.app)
- 스택: React(Vite) + FastAPI(Vercel experimentalServices) + Supabase
- 실행: Claude Code 단일 세션 (서브에이전트 사용 안 함)
- 선행 조건: 지시서 01이 main에 병합된 상태. `feature/security-rls` 브랜치를 main에서 새로 만든다.
- 배치: 지시서 01 완료 후, 지시서 02 착수 전

---

## 1. 배경과 목적

현재 구조에는 구멍이 두 개 있다.

| 구멍 | 현재 상태 | 위험 |
|---|---|---|
| DB 직접 접근 | 전체 테이블 RLS 미적용, anon 키가 프론트엔드 번들에 포함 | 번들에서 키를 꺼내면 누구나 Supabase REST로 자산·인출 데이터를 읽고 쓸 수 있음 |
| API 무인증 | FastAPI에 인증 의존성 없음, 로그인은 화면만 보호 | `/api/...` 주소만 알면 로그인 없이 모든 데이터를 조회·수정할 수 있음 |

**목표 상태**
- 모든 public 테이블에 RLS를 켜고 정책은 두지 않는다. anon·authenticated 키로는 테이블에 접근할 수 없다.
- 백엔드는 서버 전용 키(service_role 또는 신형 secret 키)로 접속한다. 이 키는 RLS를 우회하며 서버에만 존재한다.
- 모든 API는 Supabase 로그인 토큰을 검증하고, 허용된 사용자 1명만 통과시킨다.
- 크론 엔드포인트는 사용자 토큰 대신 `CRON_SECRET`으로 보호한다.

두 구멍을 반드시 함께 막는다. RLS만 켜고 API를 열어 두면 데이터는 여전히 API로 노출된다.

---

## 2. 진행 방식 (단계별 중단점)

각 단계가 끝나면 **작업을 멈추고 보고한 뒤 사용자 승인을 받아 다음 단계로 넘어간다.**
**단계 순서가 곧 안전장치다.** RLS는 서버 전용 키로 동작하는 코드가 운영에 배포된 뒤 마지막에 켠다. 순서를 바꾸면 운영 앱이 즉시 멈춘다.

| 단계 | 내용 | 수행 주체 |
|---|---|---|
| A | 작업 전 조사 (3장), 코드 수정 없음 | Claude Code → 보고 후 중단 |
| B | 백엔드: 서버 전용 키 전환 + 인증 의존성 + 크론 보호 + pytest (4장) | Claude Code → 보고 후 중단 |
| C | 프론트엔드: API 호출에 토큰 첨부 (5장) | Claude Code → 보고 후 중단 |
| D | Vercel 환경변수 설정 → 프리뷰 배포 → 동작 확인 (6장) | **사용자** (Claude Code는 체크리스트 제공) |
| E | 운영 배포 (main 병합) 및 운영 동작 확인 | **사용자** |
| F | RLS 활성화 SQL 작성 → 사용자가 SQL Editor에서 실행 → 확인 쿼리 (7장) | Claude Code 작성, **사용자** 실행 |
| G | `schema.sql` 반영, 최종 보고 (9장) | Claude Code |

**Git 규칙**: 단계마다 커밋. main 직접 커밋·푸시 금지. 푸시는 사용자 승인 후 `feature/security-rls`로만 한다.

---

## 3. 작업 전 조사 (단계 A, 보고만)

1. **키 사용 현황**: 백엔드·프론트엔드에서 Supabase 키, Claude API 키, 이메일 발송 키 등을 읽는 모든 위치(환경변수 이름 포함). 프론트엔드는 `VITE_` 접두어가 붙은 변수만 번들에 포함되므로, 서버 전용 비밀값이 `VITE_` 변수로 노출돼 있지 않은지 확인한다.
2. **프론트엔드의 Supabase 직접 조회**: `supabase.from(...)`, `.rpc(...)`, `storage` 사용 위치. Auth 외의 직접 조회가 있으면 목록으로 보고한다. RLS를 켜면 모두 실패하므로 API 경유로 바꿔야 한다.
3. **Supabase 프로젝트의 키·JWT 방식**: 레거시 키(anon / service_role, JWT secret HS256)인지, 신형 키(publishable / secret, 비대칭 서명 키 JWKS)인지 코드와 설정으로 확인할 수 있는 범위에서 보고한다. 확인할 수 없는 부분은 사용자가 대시보드에서 확인할 항목으로 적는다.
4. **크론 엔드포인트**: `vercel.json`의 cron 설정과 대상 경로, 현재 보호 여부.
5. **라우터 목록**: `main.py`에 등록된 전체 라우터와 prefix. 인증 없이 열려 있어야 하는 경로가 있는지(헬스체크 등) 판단해 보고한다.
6. **비밀값 커밋 이력**: `.gitignore`에 `.env`가 있는지, git 이력에 키가 커밋된 적이 있는지(`git log -p` 검색). 커밋된 적이 있으면 해당 키 교체가 필요하다고 보고한다.
7. **Storage 버킷** 사용 여부.

**보고 후 중단한다. 승인 전에는 어떤 파일도 만들거나 수정하지 않는다.**

---

## 4. 백엔드 (단계 B)

### 4.1 서버 전용 키 전환
- `database.py`가 새 환경변수 `SUPABASE_SERVICE_KEY`로 클라이언트를 만든다.
- 이 변수가 없으면 앱 시작 시 명확한 오류로 실패한다. anon 키로 조용히 대체하지 않는다.
- 기존 `SUPABASE_ANON_KEY`는 백엔드에서 더 이상 쓰지 않는다. 토큰 검증에 필요한 경우만 예외로 하고, 이 경우 보고한다.

### 4.2 인증 의존성
- `backend/auth.py`에 `require_user` 의존성을 만든다.
  - `Authorization: Bearer <access_token>` 헤더에서 토큰을 추출한다. 없거나 형식이 틀리면 401.
  - 토큰을 검증한다. 방식은 A단계 조사 결과에 따라 아래 중 하나를 제안하고 승인받는다.
    - (권장) 로컬 검증: 비대칭 키면 JWKS, 레거시면 JWT secret(HS256). 만료(`exp`)와 audience(`authenticated`)를 확인한다.
    - (대안) `supabase.auth.get_user(token)` 호출. 구현은 단순하지만 요청마다 네트워크 호출이 생긴다.
  - 검증된 사용자의 이메일이 환경변수 `ALLOWED_USER_EMAIL`과 일치하지 않으면 403.
- `main.py`에서 모든 라우터 등록에 `dependencies=[Depends(require_user)]`를 적용한다. 예외는 A단계에서 승인된 경로(헬스체크 등)와 크론뿐이다.
- 기존 라우터 파일 내부 로직은 수정하지 않는다. 등록부에서 일괄 적용한다.

### 4.3 크론 보호
- 크론 경로는 `require_user` 대신 `require_cron` 의존성을 쓴다. `Authorization: Bearer <CRON_SECRET>` 헤더가 환경변수 `CRON_SECRET`과 일치하지 않으면 401. (Vercel Cron은 `CRON_SECRET` 환경변수가 설정되어 있으면 이 헤더를 자동으로 붙인다.)
- 비교는 `secrets.compare_digest`로 한다.

### 4.4 테스트 (pytest)
- 기존 테스트는 FastAPI `dependency_overrides`로 인증을 통과시켜 그대로 통과해야 한다. 기존 테스트 파일은 수정하지 않는 것을 원칙으로 하고, 공통 `conftest.py`에서 처리한다. 불가피하게 수정해야 하면 사유를 보고한다.
- 신규 테스트:
  - 토큰 없음 → 401
  - 잘못된 형식이나 만료된 토큰 → 401
  - 유효하지만 허용되지 않은 이메일 → 403
  - 허용된 사용자 → 200
  - 크론: 시크릿 없음·불일치 → 401, 일치 → 통과
  - `SUPABASE_SERVICE_KEY` 미설정 시 시작 실패
- 운영 DB에 쓰는 테스트는 만들지 않는다.

---

## 5. 프론트엔드 (단계 C)

- `frontend/src/api/client.js`의 axios 인스턴스에 요청 인터셉터를 추가한다. 매 요청마다 `supabase.auth.getSession()`의 `access_token`을 `Authorization` 헤더로 붙인다.
- 응답 인터셉터: 401이면 세션 갱신을 1회 시도한 뒤 재요청하고, 그래도 401이면 로그인 화면으로 보낸다. 403이면 "허용되지 않은 계정" 안내를 띄우고 로그아웃한다.
- A단계에서 발견된 프론트엔드의 Supabase 직접 조회는 해당 API 호출로 교체한다. 필요한 API가 없으면 교체 목록과 필요한 엔드포인트를 보고하고 승인받는다.
- 로컬 빌드(`npm run build`) 성공을 확인한다.

---

## 6. 사용자 작업 체크리스트 (단계 D·E, Claude Code는 이 목록을 보고서에 제시)

**Vercel 환경변수 (Production과 Preview 모두)**
- [ ] `SUPABASE_SERVICE_KEY`: Supabase 대시보드 → Project Settings → API Keys의 service_role 키(또는 secret 키). **`VITE_` 접두어를 붙이지 않는다.**
- [ ] `ALLOWED_USER_EMAIL`: 로그인에 쓰는 본인 이메일
- [ ] `CRON_SECRET`: 16자 이상 임의 문자열
- [ ] (로컬 검증 방식이면) JWT secret 또는 JWKS 관련 변수. 필요한 변수는 B단계 보고서에 명시한다.

**Supabase 대시보드**
- [ ] Authentication 설정에서 **신규 가입(Sign up) 비활성화**. 본인 외 계정이 만들어지는 것을 막는다.

**프리뷰 확인 (D)**
- [ ] 로그인 후 대시보드, 리밸런싱, 건보료 시뮬레이터, 세금 가이드, AI 어드바이저, Excel 내보내기, 인출 설정 화면 정상 동작
- [ ] 로그아웃 상태에서 브라우저 주소창에 `/api/assets`(또는 대표 조회 경로) 직접 접근 → 401

**운영 배포 (E)**
- [ ] main 병합 후 운영에서 위 항목 동일하게 확인
- [ ] 다음 크론 실행 후 Vercel 로그에서 크론 정상 실행 확인 (또는 수동 호출 테스트)

**E 확인이 끝나기 전에는 F단계로 넘어가지 않는다.**

---

## 7. RLS 활성화 (단계 F)

- `migrations/YYYY-MM-DD_enable_rls_all.sql` 작성:
  - `BEGIN; … COMMIT;`으로 감싼다.
  - public 스키마의 **모든 테이블**에 `ALTER TABLE … ENABLE ROW LEVEL SECURITY;`. 테이블 목록은 실제 DB 기준이며, 파일 상단 주석에 목록을 적는다.
  - 정책(`CREATE POLICY`)은 만들지 않는다. anon·authenticated는 전면 차단되고, 서버 전용 키만 접근한다.
- 확인 쿼리 (파일 하단 주석):
  - (a) public 테이블 전체의 `relrowsecurity`가 모두 `true`인지
  - (b) RLS가 꺼진 public 테이블 0건
- **사용자 추가 확인**: 브라우저 개발자도구 콘솔 등에서 anon 키로 `assets`를 조회하면 빈 결과나 권한 오류가 나와야 한다. Claude Code는 이 확인용 코드 스니펫을 제공만 하고 직접 실행하지 않는다.
- 롤백 SQL(`DISABLE ROW LEVEL SECURITY`)을 별도 파일로 준비만 해 둔다. 운영 앱이 멈추는 비상시에만 사용한다.

---

## 8. 수정 금지

- 기존 라우터 파일의 비즈니스 로직 (인증은 `main.py` 등록부에서 일괄 적용)
- 계산 로직: 리밸런싱, 건보료, 세금, 시뮬레이션, 인출 전략, `BUCKET_MAP`
- 기존 테이블의 컬럼·데이터
- AI 어드바이저의 프롬프트·모델 설정
- `vercel.json`의 cron 일정 (경로 보호 외 변경 금지)
- 운영 DB에 대한 직접 SQL 실행 (SQL은 파일로만 작성, 실행은 사용자)

---

## 9. 완료 기준

**Claude Code 확인**
- [ ] pytest 전체 통과 (기존 + 신규 보안 테스트)
- [ ] 프론트엔드 빌드 성공
- [ ] 번들 검사: `npm run build` 결과물에서 service 키·Claude API 키 문자열이 검색되지 않음 (키 값이 아니라 환경변수 이름과 접두어 패턴으로 검사)
- [ ] `git diff main --stat`으로 8장 수정 금지 대상이 바뀌지 않았음을 확인

**사용자 확인**
- [ ] 6장 체크리스트 전부
- [ ] 7장 확인 쿼리 (a)(b)와 anon 키 조회 차단 확인

---

## 10. 보고 형식

1. A단계 조사 결과와 토큰 검증 방식 제안
2. 변경 파일 목록 (신규/수정 구분, 수정 사유)
3. 필요한 환경변수 전체 목록 (이름, 용도, 설정 위치. 값은 적지 않는다)
4. pytest 결과 (기존/신규 구분)
5. 사용자 작업 체크리스트 (6장)
6. RLS SQL 파일과 롤백 파일 경로
7. 미해결 사항과 교체가 필요한 키 여부
