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
--   2026-07-14  real_assets 신설 / 2026-07-15 gift_plans 신설
--   2026-09-19  RLS 전 테이블 활성화 (S1 단계 F, 20번 참조)
--   2026-09-19  인출 판단 시스템 데이터 기반 6개 신설 (holding_profiles, cashflow_items,
--               withdrawal_baseline, sub_allocation_targets, ips_rules(+시드 7건), decision_log)
--
-- 단일 사용자 구조. 모든 public 테이블은 RLS 활성화 + 정책 없음 (파일 끝 '20. RLS' 참조):
--   anon · authenticated 키로는 접근할 수 없고, 백엔드는 서버 전용 키(SUPABASE_SERVICE_KEY)로 접속한다.
--   예외: health_insurance_simulations — 사용자 토큰 + auth.uid() = user_id 정책으로 프론트가 직접 접근
--         (migrations/2026-06-25_health_insurance_simulations.sql, 이 파일에는 포함되지 않음).
--   다중 사용자 확장 시 user_id 컬럼과 정책 추가 필요.
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
  '앱 설정. key=''config'' 단일 행 구조. RLS 활성화(정책 없음) — 서버 전용 키로만 접근.';

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


-- ── 4. withdrawals ────────────────────────────────────────────────────────────
-- 인출 기록 단일 소스 (건별). 연금소득세 한도(연 1,500만원) 계산 및
-- 현금흐름·대시보드·수익률의 월별 인출 집계에 사용.
-- ※ 구 withdrawal_log(월간 계획) 테이블은 2026-07 폐지 — migrations 참조.
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
  marriage_deduction boolean NOT NULL DEFAULT false,        -- 혼인·출산 공제 적용 (직계비속 +1억)
  memo           text,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gift_plans IS
  '사전증여 계획. relationship 별 10년 합산 증여재산공제 적용, 손자녀(grandchild)는 세대생략 30% 할증.';


-- ── 14. holding_profiles ───────────────────────────────────────────────────────
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
  '보유상품 속성(assets 1:1). 인출 판단 시스템의 노출도·버킷 계산 입력. RLS 활성화(정책 없음) — 서버 전용 키로만 접근.';
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


-- ── 15. cashflow_items ─────────────────────────────────────────────────────────
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


-- ── 16. withdrawal_baseline ────────────────────────────────────────────────────
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


-- ── 17. sub_allocation_targets ─────────────────────────────────────────────────
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


-- ── 18. ips_rules ──────────────────────────────────────────────────────────────
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


-- ── 19. decision_log ───────────────────────────────────────────────────────────
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


-- ── 20. RLS (Row Level Security) ─────────────────────────────────────────────
-- 위 18개 테이블 전부 RLS 를 켜고 정책은 만들지 않는다.
--   → anon · authenticated 키로는 조회 0행, 쓰기 거부. 백엔드의 서버 전용 키(RLS 우회)만 접근한다.
-- 새 테이블을 추가할 때는 반드시 같은 방식으로 RLS 를 켠다 (migrations/2026-09-19_enable_rls_all.sql 마지막 검증이
-- 켜지 않은 public 테이블을 잡아낸다).
-- health_insurance_simulations 는 별도 마이그레이션에서 RLS + 본인 정책 3개로 이미 보호 (변경하지 않음).
ALTER TABLE public.assets                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holding_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ips_rules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_assets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_scores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_allocation_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_baseline    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals            ENABLE ROW LEVEL SECURITY;
