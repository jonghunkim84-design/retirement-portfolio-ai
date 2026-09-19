import test from 'node:test'
import assert from 'node:assert/strict'
import { ratioToPctInput, pctInputToRatio, validateRatio, sumTargets } from './pct.js'

test('ratioToPctInput: 0~1 → % 문자열', () => {
  assert.equal(ratioToPctInput(0.05), '5')
  assert.equal(ratioToPctInput(0.075), '7.5')
  assert.equal(ratioToPctInput(0), '0')
  assert.equal(ratioToPctInput(1), '100')
  assert.equal(ratioToPctInput('0.4'), '40')          // API 가 문자열/numeric 으로 줘도 처리
})

test('ratioToPctInput: 부동소수 오차 제거', () => {
  assert.equal(ratioToPctInput(0.07), '7')            // 0.07*100 = 7.000000000000001
  assert.equal(ratioToPctInput(0.29), '29')           // 0.29*100 = 28.999999999999996
  assert.equal(ratioToPctInput(0.0015), '0.15')
})

test('ratioToPctInput: 빈 값', () => {
  for (const v of [null, undefined, '', NaN, 'abc']) assert.equal(ratioToPctInput(v), '')
})

test('pctInputToRatio: % → 0~1', () => {
  assert.equal(pctInputToRatio('5'), 0.05)
  assert.equal(pctInputToRatio('7.5'), 0.075)
  assert.equal(pctInputToRatio(' 100 '), 1)
  assert.equal(pctInputToRatio('0'), 0)
  assert.equal(pctInputToRatio(29), 0.29)
  assert.equal(pctInputToRatio('0.15'), 0.0015)
})

test('pctInputToRatio: 빈 입력은 null, 잘못된 입력은 NaN', () => {
  assert.equal(pctInputToRatio(''), null)
  assert.equal(pctInputToRatio('   '), null)
  assert.equal(pctInputToRatio(null), null)
  assert.ok(Number.isNaN(pctInputToRatio('abc')))
})

test('왕복 변환이 값을 보존한다', () => {
  for (const s of ['0', '1', '5', '7.5', '33.33', '100', '0.01']) {
    assert.equal(ratioToPctInput(pctInputToRatio(s)), s)
  }
})

test('validateRatio', () => {
  assert.equal(validateRatio(null), null)
  assert.equal(validateRatio(0), null)
  assert.equal(validateRatio(1), null)
  assert.match(validateRatio(1.01, '주식 비중'), /주식 비중.*0~100%/)
  assert.match(validateRatio(-0.01), /0~100%/)
  assert.match(validateRatio(NaN), /숫자/)
})

test('sumTargets: 합계 100% 검증 (부동소수 오차 허용)', () => {
  assert.deepEqual(sumTargets([0.4, 0.3, 0.3]), { sum: 1, warning: false })
  assert.deepEqual(sumTargets([0.1, 0.2, 0.7]), { sum: 1, warning: false })
  assert.deepEqual(sumTargets([0.5, 0.4]), { sum: 0.9, warning: true })
  assert.deepEqual(sumTargets([0.7, 0.5]), { sum: 1.2, warning: true })
  assert.deepEqual(sumTargets([]), { sum: 0, warning: true })
})
