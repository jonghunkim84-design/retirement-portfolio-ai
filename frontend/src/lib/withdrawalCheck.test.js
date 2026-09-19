import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NULL_TEXT, fmtYears, fmtRate, fmtMultiple, fmtMan, fmtShare, REASON_TEXT, reasonText, pickReason,
  bucketRuleMeta, guardMeta, bucketLabel, cardModel, CARD_BASIS,
} from './withdrawalCheck.js'

test('null 은 "-" 로, 0 은 0 으로 표시한다 (null 을 0 으로 바꾸지 않는다)', () => {
  for (const f of [fmtYears, fmtRate, fmtMultiple, fmtMan, fmtShare]) {
    assert.equal(f(null), NULL_TEXT)
    assert.equal(f(undefined), NULL_TEXT)
    assert.equal(f(NaN), NULL_TEXT)
    assert.notEqual(f(0), NULL_TEXT)
  }
  assert.equal(fmtYears(0), '0.0년')
  assert.equal(fmtRate(0), '0.0%')
  assert.equal(fmtMan(0), '0만원')
})

test('연수·비율·금액 형식', () => {
  assert.equal(fmtYears(3.3333), '3.3년')
  assert.equal(fmtYears(10), '10.0년')
  assert.equal(fmtRate(0.04), '4.0%')
  assert.equal(fmtRate(0.01875), '1.9%')
  assert.equal(fmtMultiple(0.46875), '×0.47')
  assert.equal(fmtMan(18_000_000), '1,800만원')
  assert.equal(fmtMan(1_500_000), '150만원')
  assert.equal(fmtShare(0.3), '30%')
  assert.equal(fmtShare(1), '100%')
})

test('사유 코드는 모두 설명이 있다 (서버가 내는 코드 전체)', () => {
  const serverCodes = ['no_net_need', 'baseline_missing', 'baseline_portfolio_zero', 'no_assets', 'no_cashflow', 'initial_rate_zero',
    'no_withdrawals_12m', 'withdrawals_not_provided', 'rule_disabled', 'rule_missing', 'rule_parameters_invalid',
    'unassigned_assets']
  for (const c of serverCodes) assert.ok(REASON_TEXT[c], `설명 없음: ${c}`)
  assert.equal(reasonText('something_new'), 'something_new')    // 모르는 코드는 원문 노출
  assert.equal(reasonText(null), '')
})

test('pickReason', () => {
  const reasons = [{ field: 'net_need', code: 'no_net_need' }]
  assert.match(pickReason(reasons, 'net_need'), /0원/)
  assert.equal(pickReason(reasons, 'x'), '')
  assert.equal(pickReason(undefined, 'x'), '')
})

test('R-01 상태 색상: ok 기본색, below_target 주의, below_min 경고', () => {
  assert.deepEqual(bucketRuleMeta('ok'), { label: '충족', tone: 'neutral' })
  assert.equal(bucketRuleMeta('below_target').tone, 'warn')
  assert.equal(bucketRuleMeta('below_min').tone, 'danger')
  assert.deepEqual(bucketRuleMeta(null), { label: '-', tone: 'neutral' })
})

test('가드레일 상태', () => {
  assert.equal(guardMeta('within').label, '범위 안')
  assert.equal(guardMeta('upper_breach').tone, 'warn')
  assert.equal(guardMeta('lower_breach').tone, 'info')
  assert.equal(guardMeta(null).label, '-')
})

test('카드 기준 표시 문구', () => {
  assert.equal(CARD_BASIS.bucket, '재지정 반영 · 순인출 기준')
  assert.equal(CARD_BASIS.rate, '생활비 계획 기준')
  assert.match(CARD_BASIS.bucketHelp, /1버킷 개월 수/)      // 기존 지표와의 차이를 설명한다
  assert.match(CARD_BASIS.rateHelp, /기존 화면의 인출률/)
})

test('bucketLabel', () => {
  assert.equal(bucketLabel(2), '2버킷')
  assert.equal(bucketLabel(null), '-')
})

// ── 카드 모델 ────────────────────────────────────────────────────
const base = () => ({
  as_of: '2026-09-20',
  net_need: { annual_total: 18_000_000, monthly_total: 1_500_000 },
  buckets: [{ bucket: 1, years_total: 3.33 }, { bucket: 2 }, { bucket: 3 }],
  cumulative: { b1_b2_years_total: 14.4 },
  rules: {
    'R-01': { status: 'ok', reason: null }, 'R-05': { status: 'within', reason: null },
    'R-06': { status: 'within', reason: null }, guardrail: 'within',
  },
  withdrawal_rate: { initial: 0.04, current_plan: 0.02, ratio_to_initial: 0.5, reasons: {} },
  completeness: { default_bucket_count: 0, default_bucket_value_share: 0, baseline_set: true, cashflow_set: true },
  reasons: [],
})

test('카드 모델: 정상 데이터', () => {
  const m = cardModel(base())
  assert.equal(m.asOf, '2026-09-20')
  assert.equal(m.netAnnual, 18_000_000)
  assert.equal(m.b1Years, 3.33)
  assert.equal(m.b12Years, 14.4)
  assert.equal(m.r01.label, '충족')
  assert.equal(m.initialRate, 0.04)
  assert.equal(m.currentRate, 0.02)
  assert.equal(m.guardrail.label, '범위 안')
  assert.deepEqual(m.notices, [])
  assert.equal(m.needsSetup, false)
})

test('카드 모델: 미완성 데이터 안내', () => {
  const d = base()
  d.completeness = { default_bucket_count: 36, default_bucket_value_share: 1, baseline_set: false, cashflow_set: false }
  const m = cardModel(d)
  assert.deepEqual(m.notices.map(n => n.code), ['cashflow_missing', 'baseline_missing', 'default_bucket'])
  assert.deepEqual(m.notices.map(n => n.tab), ['cashflow', 'baseline', 'holdings'])     // 인출 설정의 해당 탭으로 이동
  assert.match(m.notices[2].text, /36개.*100%/)
  assert.equal(m.needsSetup, true)
})

test('카드 모델: 기본 버킷 안내만 있으면 설정 필요 아님', () => {
  const d = base()
  d.completeness.default_bucket_count = 3
  d.completeness.default_bucket_value_share = 0.3
  const m = cardModel(d)
  assert.equal(m.needsSetup, false)
  assert.match(m.notices[0].text, /3개 \(금액의 30%\)/)
})

test('카드 모델: null 은 null 로 두고 사유를 준다 (0 으로 바꾸지 않는다)', () => {
  const d = base()
  d.net_need = { annual_total: 0, monthly_total: 0 }
  d.buckets[0].years_total = null
  d.cumulative.b1_b2_years_total = null
  d.rules['R-01'] = { status: null, reason: 'no_net_need' }
  d.withdrawal_rate = { initial: null, current_plan: null, ratio_to_initial: null,
    reasons: { initial: 'baseline_missing', current_plan: 'no_assets', ratio: 'baseline_missing' } }
  d.rules.guardrail = null
  d.reasons = [{ field: 'net_need', code: 'no_net_need' }]
  const m = cardModel(d)
  assert.equal(m.b1Years, null)
  assert.equal(m.b12Years, null)
  assert.equal(fmtYears(m.b1Years), '-')
  assert.match(m.yearsReason, /0원/)
  assert.match(m.netReason, /0원/)
  assert.equal(m.r01.label, '-')
  assert.equal(m.initialRate, null)
  assert.match(m.initialReason, /기준점/)
  assert.match(m.currentReason, /자산/)
  assert.equal(m.guardrail.label, '-')
  assert.match(m.guardrailReason, /기준점/)
})
