import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyItem, summarizeCashflow, localToday } from './cashflow.js'

const TODAY = '2026-09-19'
const item = (over) => ({ item_type: 'expense_essential', monthly_amount: 100, start_date: null, end_date: null, ...over })

test('classifyItem: 경계 — 시작일·종료일 당일은 유효', () => {
  assert.equal(classifyItem(item({}), TODAY), 'active')
  assert.equal(classifyItem(item({ start_date: TODAY }), TODAY), 'active')
  assert.equal(classifyItem(item({ end_date: TODAY }), TODAY), 'active')
  assert.equal(classifyItem(item({ start_date: '2026-09-20' }), TODAY), 'upcoming')
  assert.equal(classifyItem(item({ end_date: '2026-09-18' }), TODAY), 'ended')
  assert.equal(classifyItem(item({ start_date: '2020-01-01', end_date: '2030-01-01' }), TODAY), 'active')
})

test('summarizeCashflow: 유효 항목만 합산, 예정은 별도 소계', () => {
  const items = [
    item({ monthly_amount: 2_000_000 }),                                                        // 필수 (유효)
    item({ item_type: 'expense_discretionary', monthly_amount: 500_000 }),                      // 선택 (유효)
    item({ item_type: 'income_regular', monthly_amount: 1_000_000, start_date: '2025-01-01' }), // 국민연금 (유효)
    item({ item_type: 'income_regular', monthly_amount: 1_500_000, start_date: '2028-01-01' }), // 예정
    item({ monthly_amount: 300_000, end_date: '2026-01-01' }),                                  // 종료
    item({ item_type: 'expense_discretionary', monthly_amount: 200_000, start_date: '2027-01-01' }), // 예정
  ]
  const s = summarizeCashflow(items, TODAY)
  assert.equal(s.active.essentialMonthly, 2_000_000)
  assert.equal(s.active.discretionaryMonthly, 500_000)
  assert.equal(s.active.expenseMonthly, 2_500_000)
  assert.equal(s.active.incomeMonthly, 1_000_000)
  assert.equal(s.active.netWithdrawalAnnual, (2_500_000 - 1_000_000) * 12)
  assert.equal(s.upcoming.incomeMonthly, 1_500_000)
  assert.equal(s.upcoming.expenseMonthly, 200_000)
  assert.deepEqual(s.counts, { active: 3, upcoming: 2, ended: 1 })
})

test('summarizeCashflow: 빈 목록과 문자열 금액', () => {
  const s = summarizeCashflow([], TODAY)
  assert.equal(s.active.netWithdrawalAnnual, 0)
  const t = summarizeCashflow([item({ monthly_amount: '150000.0' })], TODAY)
  assert.equal(t.active.expenseMonthly, 150000)
})

test('localToday: 로컬 날짜 형식', () => {
  assert.equal(localToday(new Date(2026, 8, 5)), '2026-09-05')
})
