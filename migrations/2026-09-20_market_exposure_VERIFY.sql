-- 지시서 04 B단계 적용 후 확인 쿼리. 하나씩 따로 실행하세요.

-- (a) RLS: 3개 테이블 모두 true 여야 함
SELECT c.relname, c.relrowsecurity AS rls_on
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('market_series', 'market_observations', 'region_benchmarks')
ORDER BY c.relname;

-- (b) 정책: 결과 0행이어야 함 (정책 없음)
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('market_series', 'market_observations', 'region_benchmarks');

-- (c) 지역 매핑 7행 + 지표 정의 연결 확인
SELECT r.region, r.series_code, s.name, s.is_proxy, s.currency
FROM public.region_benchmarks r JOIN public.market_series s ON s.code = r.series_code
ORDER BY r.region;

-- (d) 지표 15행 (코드, 분류, 주기, 원천 우선순위 개수)
SELECT code, category, frequency, is_proxy, jsonb_array_length(sources) AS n_sources
FROM public.market_series ORDER BY category, code;

-- (e) R-04: {"drawdown_threshold": 0.15, "lookback_days": 365}, 나머지 규칙은 변경 없음
SELECT rule_code, parameters, enabled FROM public.ips_rules ORDER BY rule_code;

-- (f) 관측값 테이블은 비어 있어야 함 (초기 적재는 C 단계)
SELECT count(*) AS observations FROM public.market_observations;
