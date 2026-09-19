import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SUGGESTED_ROLE, DEFAULT_BUCKET, fieldEnabled, suggestedForm, formFromProfile,
  formsEqual, toPayload, bondWarning,
} from './holdingProfile.js'

const TODAY = '2026-09-19'
const asset = (asset_type, over = {}) => ({ id: 1, asset_type, maturity_date: null, ...over })

test('역할 제안값', () => {
  assert.deepEqual(SUGGESTED_ROLE, {
    cash: 'living_expense', bond: 'stability', tdf: 'stability', fund: 'stability',
    equity: 'growth', income: 'income',
  })
  assert.equal(suggestedForm(asset('equity'), TODAY).role, 'growth')
  assert.equal(suggestedForm(asset('bond'), TODAY).bucket, '')     // 버킷은 비워 둠 (기본값 안내만)
})

test('기본 버킷은 서버 BUCKET_MAP 과 동일', () => {
  assert.deepEqual(DEFAULT_BUCKET, { cash: 1, bond: 2, tdf: 2, fund: 2, equity: 3, income: 3 })
})

test('자산유형별 활성 필드', () => {
  assert.equal(fieldEnabled('bond', 'bond_modified_duration'), true)
  assert.equal(fieldEnabled('bond', 'credit_grade'), true)
  assert.equal(fieldEnabled('bond', 'equity_share_pct'), false)
  assert.equal(fieldEnabled('income', 'reit_property_type'), true)
  assert.equal(fieldEnabled('income', 'rate_sensitivity'), true)
  assert.equal(fieldEnabled('income', 'bond_modified_duration'), false)
  assert.equal(fieldEnabled('tdf', 'equity_share_pct'), true)
  assert.equal(fieldEnabled('fund', 'equity_share_pct'), true)
  assert.equal(fieldEnabled('equity', 'equity_share_pct'), false)
  assert.equal(fieldEnabled('cash', 'expense_ratio'), false)
  assert.equal(fieldEnabled('cash', 'role'), true)
})

test('toPayload: % → 0~1 변환, 빈 버킷은 null', () => {
  const f = { ...suggestedForm(asset('fund'), TODAY), equity_share_pct: '60', expense_ratio: '0.5' }
  const { payload, error } = toPayload(f, asset('fund'), TODAY)
  assert.equal(error, undefined)
  assert.equal(payload.equity_share_pct, 0.6)
  assert.equal(payload.expense_ratio, 0.005)
  assert.equal(payload.bucket, null)
  assert.equal(payload.role, 'stability')
})

test('toPayload: 버킷을 고르면 숫자로 저장', () => {
  const f = { ...suggestedForm(asset('cash'), TODAY), bucket: '2' }
  assert.equal(toPayload(f, asset('cash'), TODAY).payload.bucket, 2)
})

test('toPayload: 비활성 필드는 값이 남아 있어도 null/기본값', () => {
  const f = { ...suggestedForm(asset('equity'), TODAY), bond_modified_duration: '5', credit_grade: 'AAA',
    equity_share_pct: '50', rate_sensitivity: '2', value_source: 'observed' }
  const { payload } = toPayload(f, asset('equity'), TODAY)
  assert.equal(payload.bond_modified_duration, null)
  assert.equal(payload.credit_grade, null)
  assert.equal(payload.equity_share_pct, null)
  assert.equal(payload.rate_sensitivity, null)
  assert.equal(payload.value_source, 'assumed')
})

test('toPayload: 범위 오류', () => {
  const base = suggestedForm(asset('fund'), TODAY)
  assert.match(toPayload({ ...base, equity_share_pct: '120' }, asset('fund'), TODAY).error, /주식 비중/)
  assert.match(toPayload({ ...base, expense_ratio: '-1' }, asset('fund'), TODAY).error, /총보수/)
  assert.match(toPayload({ ...base, equity_share_pct: 'abc' }, asset('fund'), TODAY).error, /숫자/)
  const bond = suggestedForm(asset('bond'), TODAY)
  assert.match(toPayload({ ...bond, bond_modified_duration: '-1' }, asset('bond'), TODAY).error, /수정듀레이션/)
})

test('저장값 → 폼 → payload 왕복', () => {
  const profile = { role: 'growth', bucket: null, sub_class: '해외선진', currency: 'USD', fx_hedged: true,
    equity_share_pct: 0.6, expense_ratio: 0.0035, value_source: 'observed', as_of_date: '2026-09-01' }
  const form = formFromProfile(profile)
  assert.equal(form.equity_share_pct, '60')
  assert.equal(form.expense_ratio, '0.35')
  assert.equal(form.bucket, '')
  const { payload } = toPayload(form, asset('fund'), TODAY)
  assert.equal(payload.equity_share_pct, 0.6)
  assert.equal(payload.expense_ratio, 0.0035)
  assert.ok(formsEqual(form, formFromProfile(profile)))
  assert.ok(!formsEqual(form, { ...form, role: 'stability' }))
})

test('채권 경고 조건: bond 이고 듀레이션·만기가 모두 없을 때만', () => {
  const empty = suggestedForm(asset('bond'), TODAY)
  assert.equal(bondWarning(asset('bond'), empty).code, 'bond_duration_missing')
  assert.equal(bondWarning(asset('bond'), { ...empty, bond_modified_duration: '3.2' }), null)
  assert.equal(bondWarning(asset('bond', { maturity_date: '2028-01-01' }), empty), null)
  for (const t of ['tdf', 'fund', 'cash', 'equity', 'income']) {
    assert.equal(bondWarning(asset(t), suggestedForm(asset(t), TODAY)), null)
  }
})
