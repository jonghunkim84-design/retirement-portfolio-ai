-- =============================================================
-- 마이그레이션: 자산 시세 갱신 상태 컬럼 추가
-- 목적: 일일 Cron 시세 자동 갱신의 기준 시각 표시 + 실패 종목 표시
-- 실행 방법: Supabase Dashboard > SQL Editor 에서 순서대로 실행
-- 작성일: 2026-06-12
-- 참고: 이 마이그레이션 실행 전에도 시세 갱신은 정상 동작함
--       (백엔드가 컬럼 부재 시 상태 기록만 건너뜀)
-- =============================================================

SET search_path = public;


-- ──────────────────────────────────────────────────────────────
-- STEP 1: 실행 전 확인 (읽기 전용, 안전)
-- ──────────────────────────────────────────────────────────────

-- [1-A] 컬럼 존재 여부 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'assets'
  AND column_name IN ('price_updated_at', 'price_update_failed');
-- 결과 0행: 미존재 → STEP 2 실행
-- 결과 2행: 이미 존재 → STEP 2 건너뜀


-- ──────────────────────────────────────────────────────────────
-- STEP 2: 컬럼 추가
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS price_updated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS price_update_failed boolean DEFAULT false;

COMMENT ON COLUMN public.assets.price_updated_at IS
  '마지막 시세 갱신 성공 시각 (수동 버튼/일일 Cron 공통). NULL = 갱신 이력 없음.';
COMMENT ON COLUMN public.assets.price_update_failed IS
  '마지막 시세 갱신 시도 실패 여부. true면 자산 목록에 ⚠️ 표시됨.';

-- 생성 확인
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'assets'
  AND column_name IN ('price_updated_at', 'price_update_failed');
