-- =============================================================================
-- S1 단계 F — public 스키마 전체 테이블 RLS 활성화 (정책 없음)
-- =============================================================================
-- 효과: anon · authenticated 키로는 아래 테이블에 접근할 수 없다 (SELECT 는 빈 결과, 쓰기는 거부).
--       백엔드는 서버 전용 키(service_role / secret)로 접속하므로 RLS 를 우회해 정상 동작한다.
--
-- ※ 실행 전 조건 (모두 충족 확인됨):
--    · 백엔드가 SUPABASE_SERVICE_KEY 로 접속하고 운영에 배포되어 정상 동작 (PR #3)
--    · 모든 API 가 로그인 토큰 검증을 거침
--
-- 제외: health_insurance_simulations
--    사용자 토큰 + RLS 정책(auth.uid() = user_id, 조회·삽입·삭제 3개)으로 프론트가 직접 접근하는 예외.
--    이 파일은 그 테이블의 RLS 와 정책을 변경하지 않는다 (마지막에 정책 3개가 그대로인지 검증만 한다).
--
-- 대상 테이블 (schema.sql + migrations 기준 18개):
--    assets, bucket_snapshots, cashflow_items, decision_log, expenses, gift_plans,
--    holding_profiles, income_log, ips_rules, notification_log, portfolio_snapshots,
--    real_assets, recommendations, risk_scores, sub_allocation_targets, user_config,
--    withdrawal_baseline, withdrawals
--
-- 전체가 하나의 트랜잭션이다. 목록에 없는 public 테이블이 남아 있으면 마지막 검증에서
-- 예외가 발생해 전부 롤백되고, 메시지에 누락된 테이블 이름이 나온다 (그 이름의 ALTER 를 추가해 다시 실행).
-- 재실행해도 안전하다 (이미 켜진 테이블은 변화 없음).
--
-- 비상 롤백: migrations/rollback/2026-09-19_enable_rls_all_ROLLBACK.sql
-- =============================================================================

BEGIN;

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

-- 검증 1: RLS 가 꺼진 public 테이블이 하나라도 남아 있으면 전체 롤백
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS 가 꺼진 public 테이블이 남아 있습니다: %. 이 파일에 ALTER TABLE ... ENABLE ROW LEVEL SECURITY 를 추가해 다시 실행하세요.', missing;
  END IF;
END $$;

-- 검증 2: health_insurance_simulations 의 기존 정책 3개가 그대로 있는지
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'health_insurance_simulations';

  IF n <> 3 THEN
    RAISE EXCEPTION 'health_insurance_simulations 정책이 3개가 아닙니다 (현재 %개). 이 테이블의 정책은 변경하지 않는 것이 원칙입니다.', n;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- 적용 후 확인 쿼리 (각각 따로 실행)
-- =============================================================================
-- (a) public 테이블 전체 — relrowsecurity 가 모두 true 여야 함
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
--   ORDER BY c.relname;
--
-- (b) RLS 가 꺼진 public 테이블 — 0행이어야 함
--   SELECT c.relname
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
--
-- (c) health_insurance_simulations 정책 3개(조회·삽입·삭제)가 그대로 있는지 — 3행
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'health_insurance_simulations'
--   ORDER BY cmd;
--
-- (d) 그 외 테이블에는 정책이 하나도 없어야 함 — 0행
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND tablename <> 'health_insurance_simulations';
--
-- (e) 역할별 RLS 우회 권한 — service_role 만 true, anon·authenticated 는 false
--   SELECT rolname, rolbypassrls FROM pg_roles
--   WHERE rolname IN ('anon', 'authenticated', 'service_role') ORDER BY rolname;
