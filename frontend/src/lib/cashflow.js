// 생활비·정기수입 항목의 유효 기간 판정과 합계 (인출 설정 › 생활비·정기수입 탭)
// 날짜는 'YYYY-MM-DD' 문자열 비교. 합계는 오늘 기준 유효한 항목만.

/** 로컬 시간대 기준 오늘 (toISOString 은 UTC 라 KST 새벽에 하루 어긋남) */
export function localToday(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * active   : start_date ≤ 오늘 (없으면 즉시) 이고, end_date 없음 또는 ≥ 오늘
 * upcoming : start_date > 오늘 (예정)
 * ended    : end_date < 오늘
 */
export function classifyItem(item, today) {
  const start = item.start_date ? String(item.start_date).slice(0, 10) : null
  const end = item.end_date ? String(item.end_date).slice(0, 10) : null
  if (start && start > today) return 'upcoming'
  if (end && end < today) return 'ended'
  return 'active'
}

const EXPENSE_TYPES = ['expense_essential', 'expense_discretionary']

function totalsOf(items) {
  const monthly = { expense_essential: 0, expense_discretionary: 0, income_regular: 0 }
  for (const it of items) monthly[it.item_type] += Number(it.monthly_amount) || 0
  const expenseMonthly = monthly.expense_essential + monthly.expense_discretionary
  const incomeMonthly = monthly.income_regular
  return {
    essentialMonthly: monthly.expense_essential,
    discretionaryMonthly: monthly.expense_discretionary,
    expenseMonthly,
    incomeMonthly,
    expenseAnnual: expenseMonthly * 12,
    incomeAnnual: incomeMonthly * 12,
  }
}

/**
 * 오늘 기준 합계(유효 항목만)와 예정 항목 소계를 분리해서 반환.
 * netWithdrawalAnnual = 연간 지출 − 연간 정기수입 (유효 항목 기준, 단순 합산만)
 */
export function summarizeCashflow(items, today) {
  const active = items.filter(i => classifyItem(i, today) === 'active')
  const upcoming = items.filter(i => classifyItem(i, today) === 'upcoming')
  const a = totalsOf(active)
  return {
    active: { ...a, netWithdrawalAnnual: a.expenseAnnual - a.incomeAnnual },
    upcoming: totalsOf(upcoming),
    counts: {
      active: active.length,
      upcoming: upcoming.length,
      ended: items.length - active.length - upcoming.length,
    },
  }
}

export { EXPENSE_TYPES }
