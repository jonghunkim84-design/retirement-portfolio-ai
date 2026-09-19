-- =============================================================================
-- 비상 롤백 — 2026-09-19_enable_rls_all.sql 이 켠 RLS 를 끈다.
-- 운영 앱이 RLS 활성화 후 멈추는 비상 상황에서만 실행한다 (예: 서버 키가 service_role 이 아니어서
-- 백엔드가 모든 테이블에서 빈 결과를 받는 경우). 실행하면 다시 anon 키로 테이블에 접근할 수 있는
-- 무방비 상태가 되므로, 원인을 고친 뒤 enable 파일을 다시 실행해야 한다.
-- 이 파일을 아직 실행하지 않았다면 실행하지 마세요 (준비만 해 둔 파일).
--
-- health_insurance_simulations 는 원래 RLS + 정책 방식이므로 여기서도 건드리지 않는다.
-- =============================================================================

BEGIN;

ALTER TABLE public.assets                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_snapshots       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashflow_items         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_log           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_plans             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.holding_profiles       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_log             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ips_rules              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_assets            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_scores            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_allocation_targets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_config            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_baseline    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals            DISABLE ROW LEVEL SECURITY;

COMMIT;
