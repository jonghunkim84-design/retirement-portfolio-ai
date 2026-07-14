-- 지출 기록 테이블 신설 (7단계)
CREATE TABLE IF NOT EXISTS expenses (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_date date    NOT NULL,
  amount       numeric NOT NULL CHECK (amount > 0),
  category     text    CHECK (category IN ('living','housing','medical','family','leisure','other')) DEFAULT 'other',
  memo         text,
  created_at   timestamptz DEFAULT now()
);

-- expense_date 기준 조회가 잦으므로 인덱스
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date DESC);