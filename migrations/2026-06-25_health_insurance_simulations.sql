-- 건강보험료 시뮬레이션 저장 테이블
CREATE TABLE health_insurance_simulations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  label         TEXT        NOT NULL,

  -- 입력값 전체 (항목 추가 시 마이그레이션 불필요)
  inputs        JSONB       NOT NULL,
  -- inputs 구조:
  -- {
  --   np: 1200,            // 국민연금 (만원)
  --   pp: 600,             // 개인연금·IRP (만원)
  --   fi: 800,             // 이자·배당 (만원)
  --   ws: 0,               // 근로·사업 (만원)
  --   property_items: [],  // 재산 항목 배열
  --   mortgage_loan: 0,    // 주택담보대출 잔액 (만원)
  --   year: 2026
  -- }

  -- 계산 결과 (다른 페이지에서 JOIN 없이 바로 사용 가능)
  health_premium        INT     NOT NULL,
  long_care_premium     INT     NOT NULL,
  total_monthly         INT     NOT NULL,
  total_annual          INT     NOT NULL,
  income_score          INT     NOT NULL,
  property_score        INT     NOT NULL,
  total_score           INT     NOT NULL,
  is_dependent_eligible BOOLEAN NOT NULL
);

-- RLS: 본인 데이터만 접근
ALTER TABLE health_insurance_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "본인만 조회" ON health_insurance_simulations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "본인만 삽입" ON health_insurance_simulations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "본인만 삭제" ON health_insurance_simulations
  FOR DELETE USING (auth.uid() = user_id);
