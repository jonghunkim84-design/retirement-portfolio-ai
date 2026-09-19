-- =============================================================================
-- 지시서 01 — 인출 판단 시스템 데이터 기반 (신규 테이블 6개)
-- 참조: docs/withdrawal-system/00_design.md 4.1, 4.2, 4.3, 4.8, 4.10
-- =============================================================================
-- 기존 테이블은 변경하지 않는다 (CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING 만 사용).
-- 기존 패턴을 따름: RLS 미적용(단일 사용자), bigint identity PK, text + CHECK, created_at/updated_at.
-- updated_at 은 기존 테이블과 동일하게 API 에서 갱신한다 (트리거 없음).
-- 비율 컬럼(target_pct, band_pct, equity_share_pct, expense_ratio 및 ips_rules.parameters 의 *_ratio/*_threshold)은 0~1 소수.
-- 전체를 하나의 트랜잭션으로 실행 — 중간에 오류가 나면 전부 롤백된다.
-- =============================================================================

BEGIN;

SET search_path = public;


-- ── 1. holding_profiles ───────────────────────────────────────────────────────
-- 보유상품(assets) 속성. assets 와 1:1.
-- 계좌 유형은 assets.tax_account_type, 채권 만기는 assets.maturity_date 를 단일 기준으로 사용
-- (여기에 중복 컬럼을 두지 않는다).
-- bucket 은 재지정 값: NULL 이면 utils.BUCKET_MAP(자산유형 기준) 기본값을 따른다.
CREATE TABLE IF NOT EXISTS public.holding_profiles (
  id                     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  holding_id             bigint      NOT NULL UNIQUE
                                     REFERENCES public.assets(id) ON DELETE CASCADE,
  role                   text        NOT NULL
    CHECK (role IN ('living_expense', 'stability', 'income', 'growth')),
  bucket                 smallint
    CHECK (bucket IN (1, 2, 3)),
  sub_class              text,
  equity_share_pct       numeric
    CHECK (equity_share_pct >= 0 AND equity_share_pct <= 1),
  currency               text        NOT NULL DEFAULT 'KRW',
  fx_hedged              boolean     NOT NULL DEFAULT false,
  region                 text,
  sector                 text,
  bond_modified_duration numeric     CHECK (bond_modified_duration >= 0),
  bond_rate_type         text
    CHECK (bond_rate_type IN ('fixed', 'floating')),
  credit_grade           text,
  reit_property_type     text,
  rate_sensitivity       numeric,
  expense_ratio          numeric     CHECK (expense_ratio >= 0),
  liquidity_note         text,
  value_source           text        NOT NULL DEFAULT 'assumed'
    CHECK (value_source IN ('observed', 'assumed')),
  as_of_date             date        NOT NULL DEFAULT CURRENT_DATE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.holding_profiles IS
  '보유상품 속성(assets 1:1). 인출 판단 시스템의 노출도·버킷 계산 입력. RLS 미적용(단일 사용자).';
COMMENT ON COLUMN public.holding_profiles.bucket IS
  '버킷 재지정 값(1/2/3). NULL=utils.BUCKET_MAP 기본값(자산유형 기준)을 따름.';
COMMENT ON COLUMN public.holding_profiles.equity_share_pct IS
  'TDF·혼합형 펀드의 주식 비중 (0~1 소수). 해당 없으면 NULL.';
COMMENT ON COLUMN public.holding_profiles.rate_sensitivity IS
  '리츠 등 금리 민감도. 사용자 입력 가정값이 일반적 — value_source 로 관측/가정 구분.';
COMMENT ON COLUMN public.holding_profiles.value_source IS
  'observed=관측값, assumed=가정값 (듀레이션·금리 민감도 등 민감도 값 기준)';
COMMENT ON COLUMN public.holding_profiles.as_of_date IS
  '속성 기준일';


-- ── 2. cashflow_items ─────────────────────────────────────────────────────────
-- 월 정액 생활비·정기수입 계획. (기존 expenses/income_log 는 실적 기록이며 별개)
CREATE TABLE IF NOT EXISTS public.cashflow_items (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_type       text        NOT NULL
    CHECK (item_type IN ('expense_essential', 'expense_discretionary', 'income_regular')),
  name            text        NOT NULL,
  monthly_amount  numeric     NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  start_date      date,
  end_date        date,
  inflation_linked boolean    NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

COMMENT ON TABLE public.cashflow_items IS
  '월 정액 생활비·정기수입 계획. expense_essential=필수생활비, expense_discretionary=선택생활비, income_regular=정기수입(국민연금 등).';


-- ── 3. withdrawal_baseline ────────────────────────────────────────────────────
-- 인출 기준점. 단일 행만 허용 (id = 1 고정). 초기 인출률은 저장하지 않고 계산한다.
CREATE TABLE IF NOT EXISTS public.withdrawal_baseline (
  id                        smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  withdrawal_start_date     date        NOT NULL,
  initial_portfolio_value   numeric     NOT NULL CHECK (initial_portfolio_value >= 0),
  initial_annual_withdrawal numeric     NOT NULL CHECK (initial_annual_withdrawal >= 0),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.withdrawal_baseline IS
  '인출 기준점 (단일 행, id=1). 초기 인출률 = initial_annual_withdrawal / initial_portfolio_value 는 조회 시 계산.';


-- ── 4. sub_allocation_targets ─────────────────────────────────────────────────
-- 자산군 내부 목표 비중. asset_class 는 user_config.portfolio 의 4개 키와 동일
-- (tdf·fund 는 bond 로 묶는 기존 리밸런싱 관례).
CREATE TABLE IF NOT EXISTS public.sub_allocation_targets (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_class  text        NOT NULL
    CHECK (asset_class IN ('cash', 'bond', 'equity', 'income')),
  sub_class    text        NOT NULL,
  target_pct   numeric     NOT NULL CHECK (target_pct >= 0 AND target_pct <= 1),
  band_pct     numeric     NOT NULL DEFAULT 0 CHECK (band_pct >= 0 AND band_pct <= 1),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_class, sub_class)
);

COMMENT ON TABLE public.sub_allocation_targets IS
  '자산군 내부 목표. target_pct=자산군 내 비중(0~1), band_pct=허용 폭(±, 0~1). 같은 자산군 합 1.0 미달·초과는 저장 허용, 화면에서 경고.';


-- ── 5. ips_rules ──────────────────────────────────────────────────────────────
-- 행동 규칙(IPS). 이번 단계는 테이블 + 기본값 시드만 (설정 화면·판단 엔진은 지시서 03).
CREATE TABLE IF NOT EXISTS public.ips_rules (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_code    text        NOT NULL UNIQUE,
  category     text        NOT NULL
    CHECK (category IN ('bucket', 'rebalance', 'market_regime', 'guardrail', 'account', 'pre_trade')),
  name         text        NOT NULL,
  parameters   jsonb       NOT NULL DEFAULT '{}',
  enabled      boolean     NOT NULL DEFAULT true,
  description  text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ips_rules IS
  'IPS 행동 규칙. parameters 는 규칙별 임계값 JSON. 기본값은 예시이며 사용자가 이후 수정.';

INSERT INTO public.ips_rules (rule_code, category, name, parameters, enabled, description) VALUES
  ('R-01', 'bucket',        '1버킷 최소 수준',
     '{"min_years": 1.0, "target_years": 2.0}'::jsonb, true,
     '1버킷(현금·단기채)이 순인출 필요액 기준 최소 연수 미만이면 보충 대상. 목표는 target_years.'),
  ('R-02', 'bucket',        '2버킷 목표',
     '{"target_years": 5.0}'::jsonb, true,
     '2버킷(중기채·인컴)의 목표 커버 연수.'),
  ('R-03', 'rebalance',     '자산군 허용 폭 초과 시 초과분에서 우선 인출',
     '{}'::jsonb, true,
     '허용 폭을 초과한 자산군이 있으면 그 초과분에서 먼저 인출한다. 허용 폭은 기존 user_config.portfolio.rebalance_threshold(자산군 공통, 미설정 시 0.1)를 사용하며 이 규칙은 별도 값을 갖지 않는다.'),
  ('R-04', 'market_regime', '하락 국면 판정·3버킷 매도 금지',
     '{"drawdown_threshold": 0.15}'::jsonb, true,
     '주식 기준지수가 고점 대비 drawdown_threshold(0~1, 0.15=15%) 이상 하락하면 하락 국면. 3버킷 매도를 금지하고 1버킷에서 인출.'),
  ('R-05', 'guardrail',     '인출률 상단 가드레일',
     '{"upper_multiplier": 1.2, "cut_ratio": 0.10}'::jsonb, true,
     '현재 인출률이 초기 인출률 × upper_multiplier 초과 시 선택생활비를 cut_ratio(0~1, 0.10=10%) 감액 권고. 필수생활비는 제외.'),
  ('R-06', 'guardrail',     '인출률 하단 가드레일',
     '{"lower_multiplier": 0.8, "raise_ratio": 0.10}'::jsonb, true,
     '현재 인출률이 초기 인출률 × lower_multiplier 미만이면 raise_ratio(0~1, 0.10=10%) 증액 여지 표시.'),
  ('R-07', 'pre_trade',     '매매 전 세금·수수료·계좌 제약 확인',
     '{}'::jsonb, true,
     '매매 전 세금·수수료·중도해지·계좌 제약을 확인한다.')
ON CONFLICT (rule_code) DO NOTHING;


-- ── 6. decision_log ───────────────────────────────────────────────────────────
-- 의사결정 로그. 이번 단계는 테이블만 생성 (사용은 지시서 03).
CREATE TABLE IF NOT EXISTS public.decision_log (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period           text        NOT NULL,
  engine_output    jsonb       NOT NULL DEFAULT '{}',
  applied_rules    text[]      NOT NULL DEFAULT '{}',
  executed         boolean,
  deviation_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_log_period ON public.decision_log(period);

COMMENT ON TABLE public.decision_log IS
  '분기별 엔진 판단·실행 여부·이탈 사유 기록. period 예: 2026-Q4. executed NULL=미확인.';

COMMIT;


-- =============================================================================
-- 적용 후 확인용 쿼리 (아래를 SQL Editor 에서 실행해 결과를 알려 주세요)
-- =============================================================================
-- (a) 신규 테이블 6개 존재 + RLS 상태 (relrowsecurity 는 모두 false 여야 백엔드 anon 키로 접근 가능)
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('holding_profiles','cashflow_items','withdrawal_baseline',
--                       'sub_allocation_targets','ips_rules','decision_log')
--   ORDER BY c.relname;
--
-- (c) anon 역할 권한 (모두 true 여야 함. false 면 아래 GRANT 는 실행하지 말고 먼저 알려 주세요 — 필요 시 별도 제시)
--   SELECT t, has_table_privilege('anon', 'public.'||t, 'SELECT,INSERT,UPDATE,DELETE')
--   FROM unnest(array['holding_profiles','cashflow_items','withdrawal_baseline',
--                     'sub_allocation_targets','ips_rules','decision_log']) t;
--
--   [참고용 · 실행 SQL 아님] false 가 나온 경우에만 검토:
--   -- GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO anon;
--   -- (bigint identity 시퀀스 사용 테이블은 GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon; 도 필요할 수 있음)
--
-- (b) 시드 7건
--   SELECT rule_code, category, name, parameters, enabled FROM public.ips_rules ORDER BY rule_code;
