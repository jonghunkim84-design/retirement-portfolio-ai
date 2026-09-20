-- =============================================================================
-- 지시서 03 단계 B — R-03(자산군 허용 폭) 파라미터에 mode 도입
-- =============================================================================
-- 이전: R-03 parameters = {}  (허용 폭은 user_config.portfolio.rebalance_threshold 공통값)
-- 이후: R-03 parameters = {"mode": "config"}  — 동작은 그대로이며 방식을 명시할 뿐이다.
--
-- mode 의미 (판단 엔진이 해석. 엔진은 {} 도 "config" 로 해석하므로 하위 호환):
--   "config"   기존 rebalance_threshold 공통값을 허용 폭(절대 %p, 0~1 소수)으로 사용. 기본값.
--              판정은 기존 리밸런싱과 같은 "이상(>=)" 이며 0 이면 모든 자산군이 초과로 판정되므로
--              엔진이 threshold_zero 경고를 표시한다.
--   "relative" 자산군별 허용 폭 = max(목표 비중 × relative, min_abs)
--              예: {"mode": "relative", "relative": 0.2, "min_abs": 0.03}
--                  → 목표 25% 자산군은 ±5%p, 목표 10% 자산군은 ±3%p(최소값 적용)
--
-- 이 파일은 R-03 한 행의 parameters·description 만 바꾼다. 다른 규칙·테이블은 건드리지 않는다.
-- 이미 값이 {} 가 아닌 경우(사용자가 이미 수정했거나 이 파일을 다시 실행한 경우)에는 덮어쓰지 않는다.
-- 트랜잭션이므로 마지막 검증에서 R-03 이 없거나 mode 가 없으면 전체 롤백된다.
-- =============================================================================

BEGIN;

UPDATE public.ips_rules
SET parameters  = '{"mode": "config"}'::jsonb,
    description = '허용 폭을 초과한 자산군이 있으면 그 초과분에서 먼저 인출·보충한다. '
                  || '판정은 기존 리밸런싱과 같이 |현재 비중 − 목표 비중| ≥ 허용 폭(이상)이다. '
                  || 'mode=config: 기존 user_config.portfolio.rebalance_threshold 공통값을 사용한다(기본값). '
                  || 'mode=relative: 자산군별 허용 폭 = max(목표 비중 × relative, min_abs).',
    updated_at  = now()
WHERE rule_code = 'R-03'
  AND parameters = '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ips_rules
    WHERE rule_code = 'R-03' AND parameters ? 'mode'
  ) THEN
    RAISE EXCEPTION 'R-03 규칙이 없거나 parameters 에 mode 가 없습니다. 이 파일을 적용하기 전 상태를 확인하세요.';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- 적용 후 확인 쿼리 (파일 밖에서 따로 실행)
-- =============================================================================
--   SELECT rule_code, parameters, enabled, left(description, 60) AS description
--   FROM public.ips_rules ORDER BY rule_code;
--   → R-03 의 parameters 가 {"mode": "config"} 이고 나머지 6개 규칙은 변경 전과 같아야 한다.
