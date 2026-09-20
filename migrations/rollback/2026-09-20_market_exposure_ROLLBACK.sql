-- 지시서 04 B단계 비상 롤백: 새 테이블 3개 삭제 + R-04 lookback_days 제거.
-- 새로 만든 테이블만 지우며 기존 테이블 데이터는 건드리지 않는다 (R-04 한 행 제외).
-- 수집된 관측값이 있으면 함께 사라진다. 실행 전 필요하면 market_observations 를 백업하세요.
BEGIN;

DROP TABLE IF EXISTS public.region_benchmarks;
DROP TABLE IF EXISTS public.market_observations;
DROP TABLE IF EXISTS public.market_series;

UPDATE public.ips_rules
SET parameters  = parameters - 'lookback_days',
    description = replace(description, ' 고점은 최근 lookback_days(30~1095일) 안의 최고가를 기준으로 한다.', ''),
    updated_at  = now()
WHERE rule_code = 'R-04';

COMMIT;
