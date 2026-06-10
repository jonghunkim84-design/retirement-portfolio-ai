-- =============================================================
-- 마이그레이션: 세제 분류 컬럼 추가 + 계좌명 정정
-- 실행 방법: Supabase Dashboard > SQL Editor 에서 아래 구문을 순서대로 실행
-- 작성일: 2026-06-10
-- =============================================================

-- search_path 명시 (Supabase SQL Editor 기본값 대응)
SET search_path = public;


-- ──────────────────────────────────────────────────────────────
-- STEP 1: 실행 전 확인 — 영향 행 수 조회 (읽기 전용, 안전)
-- ──────────────────────────────────────────────────────────────

-- [1-A] tax_account_type 컬럼이 이미 존재하는지 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assets'
  AND column_name = 'tax_account_type';
-- 결과가 0행이면 컬럼 없음 → STEP 2 실행 필요
-- 결과가 1행이면 이미 존재 → STEP 2 건너뜀

-- [1-B] 계좌명 "연금저축"인 행 수 확인 (변경 예상: 약 15건)
SELECT COUNT(*) AS affected_rows, account_name
FROM public.assets
WHERE account_name = '연금저축'
GROUP BY account_name;
-- 결과를 확인한 후 STEP 3 실행 여부 결정


-- ──────────────────────────────────────────────────────────────
-- STEP 2: tax_account_type 컬럼 추가
-- ──────────────────────────────────────────────────────────────
-- 이미 컬럼이 존재하면 에러 발생 — STEP 1-A에서 확인 후 실행할 것

ALTER TABLE public.assets
  ADD COLUMN tax_account_type text
    CHECK (tax_account_type IN (
      'pension_savings',       -- 연금저축 (펀드/보험)
      'retirement_pension',    -- 퇴직연금 IRP / DC
      'isa',                   -- 개인종합자산관리계좌 ISA
      'regular'                -- 일반 위탁/예금
    ))
    DEFAULT NULL;

COMMENT ON COLUMN public.assets.tax_account_type IS
  'pension_savings=연금저축, retirement_pension=퇴직연금IRP/DC, isa=ISA, regular=일반, NULL=미분류';


-- ──────────────────────────────────────────────────────────────
-- STEP 3: 계좌명 "연금저축" → "퇴직연금" 일괄 변경
-- 반드시 STEP 1-B 결과를 확인한 후 실행할 것
-- ──────────────────────────────────────────────────────────────

UPDATE public.assets
SET account_name = '퇴직연금'
WHERE account_name = '연금저축';

-- 변경 후 확인
SELECT id, account_name, asset_name
FROM public.assets
WHERE account_name = '퇴직연금'
ORDER BY asset_name;
