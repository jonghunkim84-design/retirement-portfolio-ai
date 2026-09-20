-- =============================================================================
-- 지시서 04 단계 B — 시장 지표·노출도 테이블 3개 + R-04 lookback_days
-- =============================================================================
-- 새 테이블 (기존 테이블은 R-04 한 행의 parameters 추가 외에 건드리지 않는다):
--   market_series       지표 정의 (코드, 분류, 주기, 프록시 여부, 원천 우선순위)
--   market_observations 지표 관측값 (일자별 1행, 실제 가져온 원천·이상치 플래그 기록)
--   region_benchmarks   지역 → 기준 지표 매핑 (한국·미국·글로벌·신흥국·일본·중국·유럽)
--
-- 설계 결정
--   · RLS 는 켜고 정책은 만들지 않는다 (S1 과 동일: 서버 전용 키만 접근).
--   · market_series.sources = 원천 우선순위 배열(앞이 우선). 각 원소:
--       {"source": "fdr"|"ecos"|"fred", "symbol": "...", "params": {...}, "frequency": "daily"|"monthly"}
--     원소의 frequency 는 선택이며, 없으면 series.frequency 를 쓴다
--     (ECOS 는 일별, FRED 폴백은 월별인 시리즈의 지연 판정을 원천별로 하기 위함).
--     심볼·ECOS 통계코드는 C 단계에서 실측 검증하며, 틀린 값은 이 시드가 아니라 DB 에서 고친다.
--   · market_observations.source 는 "실제로 값을 가져온 원천"(sources 의 우선순위와 무관).
--   · market_observations.flag: NULL=정상. 이상치(예: 'jump_suspect')는 저장하되 플래그를 달고
--     계산에는 포함, 화면에 경고 표시. 0 이하·결측은 저장하지 않는다 (지수·환율 기준).
--     금리·CPI 계열은 0 이나 음수가 유효할 수 있어 DB CHECK 를 두지 않고 수집 코드가 분류별로 검증한다.
--   · 지연 기준(수집 코드/화면): daily 5영업일, monthly 60일.
--   · CPI 는 지수 수준(index)을 저장하고 전년비는 계산 모듈이 만든다.
--   · 재실행 안전: IF NOT EXISTS / ON CONFLICT DO NOTHING / 조건부 UPDATE.
-- 전체가 하나의 트랜잭션이며, 마지막 검증이 실패하면 전부 롤백된다.
-- 비상 롤백: migrations/rollback/2026-09-20_market_exposure_ROLLBACK.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. market_series
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_series (
  code        text        PRIMARY KEY,
  name        text        NOT NULL,
  category    text        NOT NULL
    CHECK (category IN ('equity_index', 'etf_proxy', 'rate', 'fx', 'cpi')),
  frequency   text        NOT NULL
    CHECK (frequency IN ('daily', 'monthly')),
  currency    text,
  unit        text        NOT NULL DEFAULT 'level'
    CHECK (unit IN ('level', 'percent', 'index')),
  is_proxy    boolean     NOT NULL DEFAULT false,
  sources     jsonb       NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(sources) = 'array'),
  enabled     boolean     NOT NULL DEFAULT true,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_series IS
  '시장 지표 정의. sources=원천 우선순위 배열(fdr/ecos/fred). RLS 켬·정책 없음(서버 키 전용).';
COMMENT ON COLUMN public.market_series.currency IS
  '지표의 현지 통화(낙폭은 현지 통화 기준). 금리·CPI 는 국가 통화.';
COMMENT ON COLUMN public.market_series.is_proxy IS
  '대용 지표 여부(예: 글로벌=ACWI ETF). 화면에 그대로 표시한다.';

-- ---------------------------------------------------------------------------
-- 2. market_observations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_observations (
  series_code text        NOT NULL
                          REFERENCES public.market_series(code) ON DELETE CASCADE,
  obs_date    date        NOT NULL,
  value       numeric     NOT NULL,
  source      text        NOT NULL,
  flag        text,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_code, obs_date)
);

COMMENT ON TABLE public.market_observations IS
  '지표 관측값(일자별 1행). source=실제 원천, flag=NULL 정상/이상치 표시(계산 포함·화면 경고).';
COMMENT ON COLUMN public.market_observations.flag IS
  'NULL=정상. 예: jump_suspect(전일 대비 급변). 0 이하·결측은 저장하지 않는다.';

-- ---------------------------------------------------------------------------
-- 3. region_benchmarks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.region_benchmarks (
  region      text        PRIMARY KEY
    CHECK (region IN ('한국', '미국', '글로벌', '신흥국', '일본', '중국', '유럽')),
  series_code text        NOT NULL
                          REFERENCES public.market_series(code),
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.region_benchmarks IS
  '지역 → 낙폭 계산 기준 지표. holding_profiles.region 값과 같은 문자열을 쓴다.';

-- ---------------------------------------------------------------------------
-- 4. RLS 활성화 (정책 없음)
-- ---------------------------------------------------------------------------
ALTER TABLE public.market_series       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.region_benchmarks   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. 시드: 지표 정의 15개
-- ---------------------------------------------------------------------------
INSERT INTO public.market_series (code, name, category, frequency, currency, unit, is_proxy, sources, note) VALUES
  ('KS11',    'KOSPI',                   'equity_index', 'daily',   'KRW', 'level', false,
     '[{"source":"fdr","symbol":"KS11"}]'::jsonb, NULL),
  ('US500',   'S&P 500',                 'equity_index', 'daily',   'USD', 'level', false,
     '[{"source":"fdr","symbol":"US500"}]'::jsonb, NULL),
  ('N225',    '닛케이 225',              'equity_index', 'daily',   'JPY', 'level', false,
     '[{"source":"fdr","symbol":"^N225"}]'::jsonb, NULL),
  ('SSEC',    '상하이종합',              'equity_index', 'daily',   'CNY', 'level', false,
     '[{"source":"fdr","symbol":"SSEC"}]'::jsonb, NULL),
  ('STOXX50E','유로스톡스 50',           'equity_index', 'daily',   'EUR', 'level', false,
     '[{"source":"fdr","symbol":"^STOXX50E"}]'::jsonb, '캐럿(^) 표기 필수'),
  ('ACWI',    '글로벌 주식 (ACWI ETF)',  'etf_proxy',    'daily',   'USD', 'level', true,
     '[{"source":"fdr","symbol":"ACWI"}]'::jsonb, '글로벌 지수 대용 ETF (달러 표시)'),
  ('EEM',     '신흥국 주식 (EEM ETF)',   'etf_proxy',    'daily',   'USD', 'level', true,
     '[{"source":"fdr","symbol":"EEM"}]'::jsonb, '신흥국 지수 대용 ETF (달러 표시)'),
  ('US10Y',   '미국 국채 10년 금리',     'rate',         'daily',   'USD', 'percent', false,
     '[{"source":"fdr","symbol":"US10YT"},{"source":"fred","symbol":"DGS10"}]'::jsonb, NULL),
  ('KR_BASE', '한국은행 기준금리',       'rate',         'monthly', 'KRW', 'percent', false,
     '[{"source":"ecos","symbol":"722Y001","params":{"item":"0101000","cycle":"M"}},{"source":"fred","symbol":"IRSTCB01KRM156N","frequency":"monthly"}]'::jsonb,
     'ECOS 통계코드·FRED 심볼은 C 단계에서 실측 검증'),
  ('KR_3Y',   '한국 국고채 3년',         'rate',         'daily',   'KRW', 'percent', false,
     '[{"source":"ecos","symbol":"817Y002","params":{"item":"010200000","cycle":"D"}}]'::jsonb,
     'FRED 폴백 없음 → ECOS 키 없으면 수집 안 됨(사유 표시)'),
  ('KR_10Y',  '한국 국고채 10년',        'rate',         'daily',   'KRW', 'percent', false,
     '[{"source":"ecos","symbol":"817Y002","params":{"item":"010210000","cycle":"D"}},{"source":"fred","symbol":"IRLTLT01KRM156N","frequency":"monthly"}]'::jsonb,
     'FRED 폴백은 월별 장기금리'),
  ('KR_CPI',  '한국 소비자물가지수',     'cpi',          'monthly', 'KRW', 'index', false,
     '[{"source":"ecos","symbol":"901Y009","params":{"item":"0","cycle":"M"}},{"source":"fred","symbol":"KORCPIALLMINMEI","frequency":"monthly"}]'::jsonb,
     '지수 수준 저장, 전년비는 계산 모듈에서 산출'),
  ('USD_KRW', '원/달러 환율',            'fx',           'daily',   'KRW', 'level', false,
     '[{"source":"fdr","symbol":"USD/KRW"}]'::jsonb, NULL),
  ('EUR_KRW', '원/유로 환율',            'fx',           'daily',   'KRW', 'level', false,
     '[{"source":"fdr","symbol":"EUR/KRW"}]'::jsonb, NULL),
  ('JPY_KRW', '원/엔 환율',              'fx',           'daily',   'KRW', 'level', false,
     '[{"source":"fdr","symbol":"JPY/KRW"}]'::jsonb, '100엔당인지 1엔당인지 C 단계에서 확인')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. 시드: 지역 → 기준 지표 7개
-- ---------------------------------------------------------------------------
INSERT INTO public.region_benchmarks (region, series_code, note) VALUES
  ('한국',   'KS11',     NULL),
  ('미국',   'US500',    NULL),
  ('글로벌', 'ACWI',     '대용 ETF'),
  ('신흥국', 'EEM',      '대용 ETF'),
  ('일본',   'N225',     NULL),
  ('중국',   'SSEC',     NULL),
  ('유럽',   'STOXX50E', NULL)
ON CONFLICT (region) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. R-04: lookback_days 추가 (없을 때만. 기존 drawdown_threshold 는 유지)
-- ---------------------------------------------------------------------------
UPDATE public.ips_rules
SET parameters  = parameters || '{"lookback_days": 365}'::jsonb,
    description = description
                  || ' 고점은 최근 lookback_days(30~1095일) 안의 최고가를 기준으로 한다.',
    updated_at  = now()
WHERE rule_code = 'R-04'
  AND NOT (parameters ? 'lookback_days');

-- ---------------------------------------------------------------------------
-- 8. 검증 (실패 시 전체 롤백)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('market_series', 'market_observations', 'region_benchmarks')
    AND NOT c.relrowsecurity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS 가 꺼져 있는 테이블: %', bad;
  END IF;

  IF (SELECT count(*) FROM public.market_series) < 15 THEN
    RAISE EXCEPTION 'market_series 시드가 15개 미만입니다.';
  END IF;
  IF (SELECT count(*) FROM public.region_benchmarks) < 7 THEN
    RAISE EXCEPTION 'region_benchmarks 시드가 7개 미만입니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ips_rules
                 WHERE rule_code = 'R-04' AND parameters ? 'lookback_days'
                   AND parameters ? 'drawdown_threshold') THEN
    RAISE EXCEPTION 'R-04 parameters 에 lookback_days/drawdown_threshold 가 없습니다.';
  END IF;
END $$;

COMMIT;
