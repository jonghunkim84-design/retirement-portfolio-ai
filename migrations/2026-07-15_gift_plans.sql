-- 증여 계획 테이블 (상속·증여 계획 기능)
-- 연금 계획 시뮬레이션에서 해당 연도 자산 유출로 반영된다.
-- 상속 목표 금액·배우자 유무는 user_config JSON의 estate_plan 키에 저장 (별도 테이블 없음).

CREATE TABLE IF NOT EXISTS public.gift_plans (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient_name text        NOT NULL,                      -- 수증자 (예: 첫째)
  relationship   text        NOT NULL DEFAULT 'adult_child',-- spouse | adult_child | minor_child | grandchild | other_relative | other
  gift_type      text        NOT NULL DEFAULT 'one_time',   -- one_time(일회성) | recurring(정기)
  amount         numeric     NOT NULL DEFAULT 0,            -- 1회(연간) 증여 금액 (원)
  start_year     integer     NOT NULL,                      -- 증여 (시작) 연도
  end_year       integer,                                   -- 정기 증여 종료 연도 (일회성은 NULL)
  memo           text,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gift_plans IS
  '사전증여 계획. relationship 별 10년 합산 증여재산공제 적용, 손자녀(grandchild)는 세대생략 30% 할증.';
