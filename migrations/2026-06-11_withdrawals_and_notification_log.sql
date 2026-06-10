-- =============================================================
-- 마이그레이션: 인출 기록 + 알림 이력 테이블 신설
-- 선행 조건: 2026-06-10_tax_account_type_and_account_name.sql 실행 완료
-- 실행 방법: Supabase Dashboard > SQL Editor 에서 순서대로 실행
-- 작성일: 2026-06-11
-- =============================================================

SET search_path = public;


-- ──────────────────────────────────────────────────────────────
-- STEP 1: 실행 전 확인 (읽기 전용, 안전)
-- ──────────────────────────────────────────────────────────────

-- [1-A] withdrawals 테이블 존재 여부 확인
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'withdrawals';
-- 결과 0행: 미존재 → STEP 2 실행
-- 결과 1행: 이미 존재 → STEP 2 건너뜀

-- [1-B] notification_log 테이블 존재 여부 확인
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'notification_log';
-- 결과 0행: 미존재 → STEP 3 실행


-- ──────────────────────────────────────────────────────────────
-- STEP 2: withdrawals 테이블 신설
-- ──────────────────────────────────────────────────────────────
-- 주의: 기존 테이블(assets, income_log 등)과 동일하게 단일 사용자 구조.
-- user_id / RLS 미적용 — 기존 아키텍처 일관성 유지.
-- 다중 사용자 확장 시 user_id 컬럼 추가 및 RLS 정책 설정 필요.

CREATE TABLE public.withdrawals (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  withdrawal_date  date    NOT NULL,
  amount           numeric NOT NULL CHECK (amount > 0),
  account_name     text    NOT NULL,
  tax_account_type text    NOT NULL CHECK (tax_account_type IN (
    'pension_savings',       -- 연금저축 (펀드/보험)
    'retirement_pension',    -- 퇴직연금 IRP / DC
    'isa',                   -- ISA
    'regular'                -- 일반
  )),
  memo             text,
  created_at       timestamptz DEFAULT now()
);

COMMENT ON TABLE public.withdrawals IS
  '연금 수령 인출 기록. pension_savings/retirement_pension 레코드가 연금소득세 한도(연 1,500만원) 계산에 사용됨.';

-- 생성 확인
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'withdrawals'
ORDER BY ordinal_position;


-- ──────────────────────────────────────────────────────────────
-- STEP 3: notification_log 테이블 신설 (알림 중복 방지)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE public.notification_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_type text    NOT NULL,  -- 'pension_80pct' | 'pension_100pct'
  year              integer NOT NULL,
  sent_at           timestamptz DEFAULT now(),
  UNIQUE (notification_type, year)     -- 연내 동일 유형 중복 발송 방지
);

COMMENT ON TABLE public.notification_log IS
  '이메일 알림 발송 이력. (notification_type, year) UNIQUE로 연내 중복 방지.';

-- 생성 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notification_log'
ORDER BY ordinal_position;
