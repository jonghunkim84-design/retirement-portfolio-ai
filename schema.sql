-- =============================================================================
-- 은퇴포트폴리오 AI — 완전 초기화용 스키마
-- =============================================================================
-- 새로 설치하는 경우 Supabase Dashboard › SQL Editor 에서 이 파일 하나만 실행하면
-- DB가 완전히 초기화됩니다.
--
-- 포함 내용:
--   ① 테이블 CREATE (8개 + 보조 2개)
--   ② 인덱스
--   ③ COMMENT
--   ④ user_config 기본값 1행 INSERT
--
-- 마이그레이션 누적 반영:
--   2026-06-10  assets.tax_account_type 추가
--   2026-06-11  withdrawals, notification_log 신설
--   2026-06-12  assets.price_updated_at / price_update_failed 추가
--   2026-06-13  user_config plan.target_annual_return 키 (초기값 시드 반영)
--   2026-06-15  expenses 신설
--   2026-06-16  income_log income_type 'earned' 허용 (CHECK 없음 — 코드 레벨 제어)
--
-- 단일 사용자 구조 — RLS 미적용. 다중 사용자 확장 시 user_id + RLS 추가 필요.
-- =============================================================================

SET search_path = public;


-- ── 1. assets ─────────────────────────────────────────────────────────────────
-- 포트폴리오 자산 목록. is_active=false 는 만기·매도된 자산.
CREATE TABLE IF NOT EXISTS public.assets (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_name         text        NOT NULL,
  asset_name           text        NOT NULL,
  ticker               text,
  asset_type           text        NOT NULL,
  -- cash | bond | tdf | fund | equity | income
  quantity             numeric     NOT NULL DEFAULT 0,
  unit_price           numeric     NOT NULL DEFAULT 0,
  current_value        numeric     NOT NULL DEFAULT 0,
  purchase_date        date,
  is_active            boolean     NOT NULL DEFAULT true,
  maturity_date        date,
  investment_amount    numeric,
  tax_account_type     text
    CHECK (tax_account_type IN (
      'pension_savings',       -- 연금저축 (펀드/보험)
      'retirement_pension',    -- 퇴직연금 IRP / DC
      'isa',                   -- ISA
      'regular'                -- 일반 위탁/예금
    )),
  price_updated_at     timestamptz,           -- 마지막 시세 갱신 성공 시각
  price_update_failed  boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.assets IS '포트폴리오 자산 목록. is_active=false 는 만기·매도된 자산.';
COMMENT ON COLUMN public.assets.tax_account_type IS
  'pension_savings=연금저축, retirement_pension=퇴직연금IRP/DC, isa=ISA, regular=일반, NULL=미분류';
COMMENT ON COLUMN public.assets.price_updated_at IS
  '마지막 시세 갱신 성공 시각 (수동 버튼/일일 Cron 공통). NULL=갱신 이력 없음.';
COMMENT ON COLUMN public.assets.price_update_failed IS
  '마지막 시세 갱신 실패 여부. true 면 자산 목록에 ⚠️ 표시.';


-- ── 2. income_log ─────────────────────────────────────────────────────────────
-- 수입 기록 (이자·배당·근로소득·기타).
-- income_type 허용값: interest | dividend | earned | other
--   금융소득종합과세 합산 대상: interest + dividend + other
--   합산 제외: earned (근로소득)
CREATE TABLE IF NOT EXISTS public.income_log (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  income_date   date        NOT NULL,
  asset_name    text        NOT NULL DEFAULT '',
  account_name  text                 DEFAULT '',
  asset_type    text                 DEFAULT '',
  income_type   text        NOT NULL DEFAULT 'interest',
  amount        numeric     NOT NULL,
  note          text                 DEFAULT ''
);

COMMENT ON TABLE  public.income_log IS
  '수입 기록. interest+dividend+other → 금융소득종합과세 합산. earned(근로소득) 제외.';
COMMENT ON COLUMN public.income_log.income_type IS
  'interest=이자, dividend=배당, earned=근로소득(종합과세 제외), other=기타';


-- ── 3. user_config ────────────────────────────────────────────────────────────
-- 앱 설정 — key='config' 단일 행 JSON 구조.
CREATE TABLE IF NOT EXISTS public.user_config (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text        NOT NULL UNIQUE,
  value      jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_config IS
  '앱 설정. key=''config'' 단일 행 구조. RLS 미적용 (단일 사용자).';

-- 기본값 행 삽입 (이미 존재하면 무시)
INSERT INTO public.user_config (key, value)
VALUES (
  'config',
  '{
    "user": {
      "monthly_expense": 5000000
    },
    "portfolio": {
      "target_cash":   0.25,
      "target_bond":   0.25,
      "target_equity": 0.35,
      "target_income": 0.15
    },
    "inflation": {
      "assumed_rate": 0.025
    },
    "income": {
      "national_pension": {
        "start_date":         null,
        "base_amount":        0,
        "inflation_adjusted": true
      }
    },
    "pension_plan": {},
    "plan": {
      "target_annual_return": null
    }
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;


-- ── 4. withdrawal_log ─────────────────────────────────────────────────────────
-- 포트폴리오 월간 인출 계획 (date 는 항상 1일: YYYY-MM-01).
-- ※ 실제 연금 수령 기록은 withdrawals 테이블 사용.
CREATE TABLE IF NOT EXISTS public.withdrawal_log (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date              date        NOT NULL UNIQUE,   -- YYYY-MM-01 (월 대표일)
  amount            numeric     NOT NULL DEFAULT 0,  -- 권장 인출액
  actual_amount     numeric,                          -- 실제 인출액 (NULL=미기록)
  guardrail_applied boolean     NOT NULL DEFAULT false,
  note              text                 DEFAULT ''
);

COMMENT ON TABLE public.withdrawal_log IS
  '월별 포트폴리오 인출 계획. date=YYYY-MM-01 UNIQUE. actual_amount=NULL이면 미기록.';


-- ── 5. withdrawals ────────────────────────────────────────────────────────────
-- 실제 연금 수령 인출 기록 — 연금소득세 한도(연 1,500만원) 계산에 사용.
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  withdrawal_date  date        NOT NULL,
  amount           numeric     NOT NULL CHECK (amount > 0),
  account_name     text        NOT NULL,
  tax_account_type text        NOT NULL
    CHECK (tax_account_type IN (
      'pension_savings',
      'retirement_pension',
      'isa',
      'regular'
    )),
  memo             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.withdrawals IS
  '연금 수령 인출 기록. pension_savings·retirement_pension 레코드가 연 1,500만원 한도 계산에 사용됨.';


-- ── 6. notification_log ───────────────────────────────────────────────────────
-- 이메일 알림 발송 이력 — (notification_type, year) UNIQUE 로 연내 중복 방지.
CREATE TABLE IF NOT EXISTS public.notification_log (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_type text        NOT NULL,   -- 'pension_80pct' | 'pension_100pct'
  year              integer     NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_type, year)
);

COMMENT ON TABLE public.notification_log IS
  '이메일 알림 발송 이력. (notification_type, year) UNIQUE 로 연내 중복 방지.';


-- ── 7. portfolio_snapshots ────────────────────────────────────────────────────
-- 날짜별 포트폴리오 총자산 스냅샷. snapshot_date UNIQUE — upsert 로 당일 갱신.
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_date date        NOT NULL UNIQUE,
  total_value   numeric     NOT NULL DEFAULT 0,
  b1_value      numeric              DEFAULT 0,   -- 버킷1 현금성
  b2_value      numeric              DEFAULT 0,   -- 버킷2 채권/TDF/펀드
  b3_value      numeric              DEFAULT 0,   -- 버킷3 주식형/리츠
  note          text                 DEFAULT ''
);

COMMENT ON TABLE public.portfolio_snapshots IS
  '날짜별 포트폴리오 총자산 스냅샷. snapshot_date UNIQUE — upsert 로 당일값 갱신.';


-- ── 8. expenses ───────────────────────────────────────────────────────────────
-- 생활 지출 기록.
CREATE TABLE IF NOT EXISTS public.expenses (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_date date        NOT NULL,
  amount       numeric     NOT NULL CHECK (amount > 0),
  category     text                 DEFAULT 'other'
    CHECK (category IN ('living', 'housing', 'medical', 'family', 'leisure', 'other')),
  memo         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.expenses IS
  '생활 지출 기록. category: living=생활비, housing=주거·관리, medical=의료·건강, family=경조사·가족, leisure=여행·여가, other=기타.';

CREATE INDEX IF NOT EXISTS idx_expenses_expense_date
  ON public.expenses (expense_date DESC);


-- ── 9. risk_scores ────────────────────────────────────────────────────────────
-- 포트폴리오 위험 점수 이력 (날짜별 1건).
CREATE TABLE IF NOT EXISTS public.risk_scores (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date        date        NOT NULL UNIQUE,
  total_score numeric,
  cash_score  numeric,
  seq_score   numeric,
  conc_score  numeric,
  level       text        -- 'green' | 'yellow' | 'red'
);

COMMENT ON TABLE public.risk_scores IS
  '날짜별 포트폴리오 위험 점수. level: green=안전(≤25점), yellow=주의(≤55점), red=위험(>55점).';


-- ── 10. bucket_snapshots ──────────────────────────────────────────────────────
-- 날짜별 버킷별 자산 금액 스냅샷.
CREATE TABLE IF NOT EXISTS public.bucket_snapshots (
  id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date    date        NOT NULL UNIQUE,
  bucket1 numeric,   -- 현금성 (버킷1)
  bucket2 numeric,   -- 채권/TDF/펀드 (버킷2)
  bucket3 numeric,   -- 주식형/리츠 (버킷3)
  total   numeric
);

COMMENT ON TABLE public.bucket_snapshots IS
  '날짜별 버킷별 자산 금액 스냅샷. risk_scores 계산 시 함께 저장됨.';


-- ── 11. recommendations ───────────────────────────────────────────────────────
-- AI 생성 포트폴리오 요약 및 추천 (날짜 + rule_id 복합 UNIQUE).
CREATE TABLE IF NOT EXISTS public.recommendations (
  id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date     date        NOT NULL,
  rule_id  text        NOT NULL,   -- 'ai_summary' 등
  message  text,
  status   text,
  UNIQUE (date, rule_id)
);

COMMENT ON TABLE public.recommendations IS
  'AI 포트폴리오 요약 및 추천. (date, rule_id) UNIQUE — 당일 같은 rule_id 는 upsert 처리.';


-- ── 12. real_assets ───────────────────────────────────────────────────────────
-- 실물자산 (부동산·전세보증금 등 비금융자산). 금융자산(assets)과 분리 —
-- 리밸런싱·인출률·위험점수 계산에서 제외, 순자산 합산·건보료 과세표준 추정에 사용.
CREATE TABLE IF NOT EXISTS public.real_assets (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              text        NOT NULL,                    -- 명칭 (예: 잠실 아파트)
  category          text        NOT NULL DEFAULT 'house',    -- house | building | jeonse | other
  market_value      numeric     NOT NULL DEFAULT 0,          -- 시세 (원)
  official_price    numeric,                                 -- 공시가격 (원)
  loan_amount       numeric     NOT NULL DEFAULT 0,          -- 담보대출 잔액 (원)
  acquisition_price numeric,                                 -- 취득가 (원)
  acquisition_date  date,
  address           text,
  memo              text,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.real_assets IS
  '실물자산 (부동산·전세보증금 등). category: house=주택, building=건물·상가·토지, jeonse=전세보증금, other=기타(건보료 재산 미부과).';


-- ── 13. gift_plans ────────────────────────────────────────────────────────────
-- 사전증여 계획. 연금 계획 시뮬레이션에서 해당 연도 자산 유출로 반영.
CREATE TABLE IF NOT EXISTS public.gift_plans (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_name text        NOT NULL,                      -- 수증자 (예: 첫째)
  relationship   text        NOT NULL DEFAULT 'adult_child',-- spouse | adult_child | minor_child | grandchild | other_relative | other
  gift_type      text        NOT NULL DEFAULT 'one_time',   -- one_time(일회성) | recurring(정기)
  amount         numeric     NOT NULL DEFAULT 0,            -- 1회(연간) 증여 금액 (원)
  start_year     integer     NOT NULL,
  end_year       integer,                                   -- 정기 증여 종료 연도 (일회성은 NULL)
  memo           text,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gift_plans IS
  '사전증여 계획. relationship 별 10년 합산 증여재산공제 적용, 손자녀(grandchild)는 세대생략 30% 할증.';
