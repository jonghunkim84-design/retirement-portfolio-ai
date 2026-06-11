-- =============================================================
-- 마이그레이션: 계획용 목표 연수익률 (target_annual_return) 추가
-- 목적: 연금 계획 시뮬레이션의 수익률 가정 기본값을
--       실현 수익률 → 사용자 저장 목표 수익률로 전환
-- 실행 방법: Supabase Dashboard > SQL Editor 에서 순서대로 실행
-- 작성일: 2026-06-13
-- 참고: 지시서는 "config에 컬럼 추가"로 기술했으나, 본 프로젝트의
--       config는 user_config 테이블의 value(JSON) 단일 행 구조이므로
--       (inflation.assumed_rate 등과 동일) JSON 키로 구현함.
--       키 위치: value -> 'plan' -> 'target_annual_return' (%, null = 미저장)
--       이 마이그레이션 실행 전에도 앱은 정상 동작함
--       (키 부재 시 실현 수익률 제안값으로 폴백)
-- =============================================================

SET search_path = public;


-- ──────────────────────────────────────────────────────────────
-- STEP 1: 실행 전 확인 (읽기 전용, 안전)
-- ──────────────────────────────────────────────────────────────

-- [1-A] plan 키 존재 여부 확인
SELECT value -> 'plan' AS plan
FROM public.user_config
WHERE key = 'config';
-- 결과 NULL: 미존재 → STEP 2 실행
-- 결과 {"target_annual_return": ...}: 이미 존재 → STEP 2 건너뜀


-- ──────────────────────────────────────────────────────────────
-- STEP 2: plan.target_annual_return 키 시드 (초기값 NULL)
-- ──────────────────────────────────────────────────────────────

UPDATE public.user_config
SET value      = jsonb_set(value::jsonb, '{plan}',
                           '{"target_annual_return": null}'::jsonb, true),
    updated_at = now()
WHERE key = 'config'
  AND (value::jsonb -> 'plan') IS NULL;

-- 생성 확인
SELECT value -> 'plan' -> 'target_annual_return' AS target_annual_return
FROM public.user_config
WHERE key = 'config';
-- 결과 null (JSON null)이면 정상 — 사용자가 저장하기 전까지 미설정 상태
