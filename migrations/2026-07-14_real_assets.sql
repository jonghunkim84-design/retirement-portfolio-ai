-- 실물자산 (부동산 등 비금융자산) 테이블
-- 금융자산(assets)과 분리 — 리밸런싱·인출률·위험점수 계산에서 제외되고
-- 순자산 합산·건보료 재산 과세표준 추정에만 사용된다.

CREATE TABLE IF NOT EXISTS public.real_assets (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              text        NOT NULL,                    -- 명칭 (예: 잠실 아파트)
  category          text        NOT NULL DEFAULT 'house',    -- house | building | jeonse | other
  market_value      numeric     NOT NULL DEFAULT 0,          -- 시세 (원)
  official_price    numeric,                                 -- 공시가격 (원) — 건보료·재산세 참고
  loan_amount       numeric     NOT NULL DEFAULT 0,          -- 담보대출 잔액 (원)
  acquisition_price numeric,                                 -- 취득가 (원)
  acquisition_date  date,                                    -- 취득일
  address           text,                                    -- 소재지 (선택)
  memo              text,
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.real_assets IS
  '실물자산 (부동산·전세보증금 등). category: house=주택, building=건물·상가·토지, jeonse=전세보증금, other=기타(건보료 재산 미부과).';
