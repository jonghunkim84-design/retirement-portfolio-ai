import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  won, CONCLUSION_LABEL, ACCOUNT_ITEM_TEXT, describeSummary, describeReason, describeRegime, describeWarning,
  describeSkipped, describeSellRule, describeAccountItem, selectedPaymentText, marketInputFromForm, EXECUTED_LABEL,
} from './decisionText.js'

// 백엔드 엔진(backend/decision_engine.py)이 실제로 만든 출력 — 서버가 내는 모든 summary_code 를 포함한다 (계약 테스트)
const S = JSON.parse(readFileSync(new URL('./fixtures/decision-samples.json', import.meta.url), 'utf-8'))

const BAD = /undefined|NaN|null|\[object/

test('서버가 내는 summary_code 11종이 모두 샘플에 있고, 각각 문장이 만들어진다', () => {
  const codes = new Set(Object.values(S).map(r => r.conclusion.summary_code))
  for (const c of ['no_net_need', 'r01_not_applied', 'above_target', 'below_target_no_excess', 'downturn_above_min',
    'below_min_refill', 'below_target_excess_refill', 'downturn_refill_to_min', 'below_min_unresolved',
    'downturn_unresolved', 'below_target_excess_unfillable']) {
    assert.ok(codes.has(c), `샘플에 없음: ${c}`)
  }
  for (const [name, r] of Object.entries(S)) {
    const line = describeSummary(r)
    assert.ok(line.startsWith(`이번 분기(${r.period}): `), name)
    assert.doesNotMatch(line, BAD, `${name}: ${line}`)
  }
})

test('결론 한 줄: 보충이 없으면 "현재는 유지"와 이유를 포함한다', () => {
  for (const name of ['hold', 'above_target', 'below_target_no_excess', 'downturn_above_min']) {
    const line = describeSummary(S[name])
    assert.match(line, /현재는 유지/, name)
  }
  assert.match(describeSummary(S.above_target), /지급 후 1버킷 2\.3년.*목표 2\.0년 이상/)
  assert.match(describeSummary(S.below_target_no_excess), /1\.3년.*목표 2\.0년.*허용 폭을 초과한 자산군이 없어/)
  assert.match(describeSummary(S.downturn_above_min), /하락 국면.*최소 1\.0년 이상/)
})

test('결론 한 줄: 지급액과 매도 합계가 원 단위로 들어간다', () => {
  const r = S.below_min_refill
  const line = describeSummary(r)
  assert.match(line, /3,000,000원 지급/)
  assert.match(line, /1개 자산에서 13,000,000원 매도/)
  assert.match(line, /최소 1\.0년 미만/)
  const down = describeSummary(S.downturn_refill_to_min)
  assert.match(down, /하락 국면/); assert.match(down, /3버킷 매도 제외/); assert.match(down, /1,000,000원 보충/)
})

test('결론 한 줄: 해결 불가는 부족액과 사용자 판단을 안내하고 3버킷 매도를 제안하지 않는다', () => {
  assert.match(describeSummary(S.below_min_unresolved), /1,000,000원 부족.*사용자 판단/)
  const d = describeSummary(S.downturn_unresolved)
  assert.match(d, /500,000원 부족/); assert.match(d, /3버킷 매도는 제안하지 않으며/)
})

test('모든 결론 근거(reasons)와 경고·미적용·계좌 확인 항목이 문장으로 바뀐다', () => {
  for (const [name, r] of Object.entries(S)) {
    for (const reason of r.conclusion.reasons) {
      const t = describeReason(reason)
      assert.ok(t && t !== reason.code, `${name}: 문장이 없는 코드 ${reason.code}`)
      assert.doesNotMatch(t, BAD, `${name}: ${t}`)
    }
    for (const w of r.warnings) assert.notEqual(describeWarning(w), w.code)
    for (const s of r.skipped_rules) assert.doesNotMatch(describeSkipped(s), BAD)
    for (const c of r.account_checks) for (const item of c.items) assert.ok(ACCOUNT_ITEM_TEXT[item], `계좌 항목 문장 없음: ${item}`)
    for (const s of r.refill.sells) assert.notEqual(describeSellRule(s.rule), s.rule)
    assert.ok(CONCLUSION_LABEL[r.conclusion.type])
  }
  assert.match(describeReason({ code: 'payment_exceeds_bucket1', values: { shortfall: 1000000 } }), /부족액 1,000,000원/)
  assert.match(describeReason({ code: 'target_not_fully_covered', values: { shortfall: 7000000 } }), /7,000,000원/)
  assert.equal(describeReason({ code: 'new_unknown_code', values: {} }), 'new_unknown_code')           // 모르는 코드는 원문
  assert.equal(describeAccountItem('nope'), 'nope')
})

test('종합 샘플: 권고 지급액·경고·연금 한도 참고·미적용 규칙', () => {
  const r = S.full
  assert.equal(r.payment.recommended_quarterly, 2_940_000)
  assert.ok(r.warnings.some(w => w.code === 'threshold_zero'))
  assert.match(describeWarning({ code: 'threshold_zero' }), /0% 입니다/)
  const c = r.account_checks[0]
  assert.equal(c.reference.ytd_total, 7_000_000)
  assert.ok(c.items.includes('in_account_cash') && c.items.includes('pension_annual_limit'))
  assert.match(describeSkipped({ code: 'R-04', reason: 'no_market_input' }), /R-04 시장 국면 — 시장 입력이 없어 정상 국면으로 간주/)
})

test('시장 국면 표시', () => {
  assert.deepEqual(describeRegime({ status: 'downturn', drawdown: 0.2, threshold: 0.15, index_name: 'KOSPI' }),
    { label: '하락 국면', tone: 'danger', detail: '입력 하락률 20.0% (KOSPI) · 임계값 15.0%' })
  assert.equal(describeRegime({ status: 'normal', drawdown: 0.1, threshold: 0.15 }).label, '정상 국면')
  const assumed = describeRegime({ status: 'assumed_normal', drawdown: null, threshold: 0.15 })
  assert.equal(assumed.label, '정상 국면으로 간주'); assert.match(assumed.detail, /시장 입력이 없어/)
  assert.match(describeRegime({ status: 'not_applied', reason: 'rule_disabled' }).label, /미적용/)
})

test('원 단위·라벨·적용 지급액', () => {
  assert.equal(won(3000000), '3,000,000원')
  assert.equal(won(null), '-'); assert.equal(won(0), '0원')
  assert.equal(EXECUTED_LABEL(true), '실행함'); assert.equal(EXECUTED_LABEL(false), '다르게 실행함'); assert.equal(EXECUTED_LABEL(null), '미확인')
  assert.equal(selectedPaymentText({ selected_payment: { kind: 'base', amount: 3000000 } }), '3,000,000원 (기본)')
  assert.equal(selectedPaymentText({ selected_payment: { kind: 'recommended', amount: 2940000 } }), '2,940,000원 (가드레일 권고)')
  assert.equal(selectedPaymentText({}), '-')
})

test('시장 입력 폼 → 요청: % 를 0~1 로 변환, 비면 null(정상 국면 간주)', () => {
  assert.deepEqual(marketInputFromForm('', ''), { marketInput: null })
  assert.deepEqual(marketInputFromForm('  ', '  '), { marketInput: null })
  assert.deepEqual(marketInputFromForm('KOSPI', '15'), { marketInput: { index_name: 'KOSPI', drawdown: 0.15 } })
  assert.deepEqual(marketInputFromForm('', '0'), { marketInput: { drawdown: 0 } })
  assert.deepEqual(marketInputFromForm(' S&P500 ', ''), { marketInput: { index_name: 'S&P500' } })
  assert.deepEqual(marketInputFromForm('', '7.5'), { marketInput: { drawdown: 0.075 } })
  for (const bad of ['abc', '-1', '101', '100.5']) assert.match(marketInputFromForm('', bad).error, /고점 대비 하락률/)
  assert.deepEqual(marketInputFromForm('', '100'), { marketInput: { drawdown: 1 } })
})
