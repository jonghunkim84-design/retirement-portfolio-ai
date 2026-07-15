-- 인출 데이터 일원화: withdrawal_log(월간 계획) → withdrawals(건별 기록) 통합 후 폐지.
--
-- 배경: 인출 데이터가 두 테이블에 이원화되어 있었음.
--   - withdrawal_log: 월간 실제 인출액 (인출 관리 화면)
--   - withdrawals:    건별 인출 기록 (연금소득세 한도 계산)
-- 이제 withdrawals가 단일 소스이며, 월별 집계는 백엔드에서 계산한다.
--
-- 1) 기존 월간 실적을 건별 기록으로 이전.
--    이중 계산 방지: 같은 달에 withdrawals 기록이 이미 있으면 이전하지 않음.
INSERT INTO public.withdrawals (withdrawal_date, amount, account_name, tax_account_type, memo)
SELECT
  wl.date,
  wl.actual_amount,
  '이전 월간 기록',
  'regular',
  TRIM(COALESCE(wl.note, '') || ' (withdrawal_log 이전)')
FROM public.withdrawal_log wl
WHERE wl.actual_amount IS NOT NULL
  AND wl.actual_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.withdrawals w
    WHERE to_char(w.withdrawal_date, 'YYYY-MM') = to_char(wl.date, 'YYYY-MM')
  );

-- 2) 테이블 폐지
DROP TABLE IF EXISTS public.withdrawal_log;
