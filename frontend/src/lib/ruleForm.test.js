import test from 'node:test'
import assert from 'node:assert/strict'
import { RULE_SPECS, ruleToForm, formToParameters, formsEqual, serverErrorsToFields } from './ruleForm.js'

// 운영 시드와 같은 기본 규칙
const SEEDS = {
  'R-01': { min_years: 1.0, target_years: 2.0 },
  'R-02': { target_years: 5.0 },
  'R-03': { mode: 'config' },
  'R-04': { drawdown_threshold: 0.15 },
  'R-05': { upper_multiplier: 1.2, cut_ratio: 0.10 },
  'R-06': { lower_multiplier: 0.8, raise_ratio: 0.10 },
  'R-07': {},
}
const rule = (code, parameters, enabled = true) => ({ rule_code: code, parameters, enabled })

test('저장값 → 폼 → parameters 왕복이 값을 보존한다 (비율은 % ↔ 0~1)', () => {
  for (const [code, params] of Object.entries(SEEDS)) {
    const form = ruleToForm(rule(code, params))
    const { parameters, errors } = formToParameters(code, form)
    assert.equal(errors, undefined, code)
    assert.deepEqual(parameters, params, code)
  }
})

test('비율은 % 로, 연수·배수는 그대로 표시한다', () => {
  assert.deepEqual(ruleToForm(rule('R-04', SEEDS['R-04'])).values, { drawdown_threshold: '15', lookback_days: '' })
  assert.deepEqual(ruleToForm(rule('R-05', SEEDS['R-05'])).values, { upper_multiplier: '1.2', cut_ratio: '10' })
  assert.deepEqual(ruleToForm(rule('R-06', SEEDS['R-06'])).values, { lower_multiplier: '0.8', raise_ratio: '10' })
  assert.deepEqual(ruleToForm(rule('R-01', SEEDS['R-01'])).values, { min_years: '1', target_years: '2' })
  const f = ruleToForm(rule('R-04', { drawdown_threshold: 0.07 }))          // 부동소수 오차(7.000000000000001) 없이
  assert.equal(f.values.drawdown_threshold, '7')
})

test('% 입력은 0~1 소수로 저장된다', () => {
  const r = formToParameters('R-04', { enabled: true, values: { drawdown_threshold: '12.5' } })
  assert.deepEqual(r.parameters, { drawdown_threshold: 0.125 })
  const c = formToParameters('R-05', { enabled: true, values: { upper_multiplier: '1.5', cut_ratio: '20' } })
  assert.deepEqual(c.parameters, { upper_multiplier: 1.5, cut_ratio: 0.2 })
})

test('R-03: {} 는 config, config 저장은 {"mode":"config"} 만, relative 는 %로 입력', () => {
  assert.equal(ruleToForm(rule('R-03', {})).mode, 'config')
  assert.equal(ruleToForm(rule('R-03', { mode: 'relative', relative: 0.2, min_abs: 0.03 })).mode, 'relative')
  const relForm = ruleToForm(rule('R-03', { mode: 'relative', relative: 0.2, min_abs: 0.03 }))
  assert.deepEqual(relForm.values, { relative: '20', min_abs: '3' })
  assert.deepEqual(formToParameters('R-03', relForm).parameters, { mode: 'relative', relative: 0.2, min_abs: 0.03 })
  // config 로 되돌리면 relative 값이 폼에 남아 있어도 저장하지 않는다
  assert.deepEqual(formToParameters('R-03', { ...relForm, mode: 'config' }).parameters, { mode: 'config' })
  // relative 는 두 값이 모두 필요하고 범위가 있다
  assert.deepEqual(formToParameters('R-03', { mode: 'relative', values: { relative: '', min_abs: '' } }).errors,
    { relative: '값이 필요합니다', min_abs: '값이 필요합니다' })
  assert.ok(formToParameters('R-03', { mode: 'relative', values: { relative: '150', min_abs: '3' } }).errors.relative)
  assert.ok(formToParameters('R-03', { mode: 'relative', values: { relative: '20', min_abs: '-1' } }).errors.min_abs)
  assert.equal(formToParameters('R-03', { mode: 'relative', values: { relative: '100', min_abs: '0' } }).errors, undefined)   // 경계값
})

test('필드별 검증 오류 (서버와 같은 범위)', () => {
  const v = (code, values) => formToParameters(code, { enabled: true, values }).errors
  assert.deepEqual(Object.keys(v('R-01', { min_years: '0', target_years: '2' })), ['min_years'])
  assert.equal(v('R-01', { min_years: '3', target_years: '2' }).min_years, '최소 연수는 목표 연수 이하여야 합니다')
  assert.equal(v('R-01', { min_years: '2', target_years: '2' }), undefined)                     // 같으면 허용
  assert.ok(v('R-02', { target_years: '0' }).target_years)
  assert.ok(v('R-04', { drawdown_threshold: '0' }).drawdown_threshold)
  assert.ok(v('R-04', { drawdown_threshold: '100' }).drawdown_threshold)
  assert.ok(v('R-05', { upper_multiplier: '1', cut_ratio: '10' }).upper_multiplier)
  assert.ok(v('R-05', { upper_multiplier: '1.2', cut_ratio: '100' }).cut_ratio)
  assert.ok(v('R-06', { lower_multiplier: '1', raise_ratio: '10' }).lower_multiplier)
  assert.ok(v('R-06', { lower_multiplier: '0.8', raise_ratio: '0' }).raise_ratio)
})

test('빈 값과 숫자가 아닌 값', () => {
  const e = formToParameters('R-01', { enabled: true, values: { min_years: '', target_years: 'abc' } }).errors
  assert.deepEqual(e, { min_years: '값이 필요합니다', target_years: '숫자를 입력하세요' })
  assert.equal(formToParameters('R-04', { enabled: true, values: { drawdown_threshold: '1e' } }).errors.drawdown_threshold, '숫자를 입력하세요')
})

test('R-07 은 입력이 없다', () => {
  assert.deepEqual(RULE_SPECS['R-07'], [])
  assert.deepEqual(formToParameters('R-07', { enabled: true, values: {} }).parameters, {})
})

test('폼 변경 감지', () => {
  const base = ruleToForm(rule('R-01', SEEDS['R-01']))
  assert.ok(formsEqual(base, ruleToForm(rule('R-01', SEEDS['R-01']))))
  assert.ok(!formsEqual(base, { ...base, enabled: false }))
  assert.ok(!formsEqual(base, { ...base, values: { ...base.values, min_years: '1.5' } }))
})

test('서버 422 detail → 필드별 메시지', () => {
  assert.deepEqual(serverErrorsToFields([{ field: 'min_years', msg: '최소 연수는 목표 연수 이하여야 합니다' }, { field: 'target_years', msg: 'Value error, 0보다 커야 합니다' }]),
    { min_years: '최소 연수는 목표 연수 이하여야 합니다', target_years: '0보다 커야 합니다' })
  assert.deepEqual(serverErrorsToFields('규칙을 찾을 수 없습니다'), { _form: '규칙을 찾을 수 없습니다' })
  assert.deepEqual(serverErrorsToFields([{ msg: '오류' }]), { _form: '오류' })
  assert.deepEqual(serverErrorsToFields(undefined), {})
})

test('R-04 고점 기간(lookback_days): 기존 값 보존, 비우면 저장하지 않음, 범위·정수 검증', () => {
  const f = ruleToForm(rule('R-04', { drawdown_threshold: 0.15, lookback_days: 180 }))
  assert.deepEqual(f.values, { drawdown_threshold: '15', lookback_days: '180' })
  // 하락 기준만 고쳐 저장해도 고점 기간이 사라지지 않는다
  assert.deepEqual(formToParameters('R-04', { enabled: true, values: { drawdown_threshold: '12', lookback_days: '180' } }).parameters,
    { drawdown_threshold: 0.12, lookback_days: 180 })
  assert.deepEqual(formToParameters('R-04', { enabled: true, values: { drawdown_threshold: '12', lookback_days: '' } }).parameters,
    { drawdown_threshold: 0.12 })
  const v = t => formToParameters('R-04', { enabled: true, values: { drawdown_threshold: '12', lookback_days: t } })
  for (const ok of ['30', '365', '1095']) assert.ok(v(ok).parameters, ok)
  for (const bad of ['29', '1096', '365.5', 'abc', '-5']) assert.ok(v(bad).errors?.lookback_days, bad)
})
