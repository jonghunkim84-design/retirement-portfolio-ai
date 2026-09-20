// IPS 규칙 탭의 폼 ↔ parameters 변환과 클라이언트 검증 — 순수 함수.
// 비율은 화면에서 %로 입력·표시하고 저장은 0~1 소수(01 의 변환 함수 pct.js 재사용). 연수는 "년", 배수는 "배".
// 검증 범위는 서버(ips_rules_validation.py)와 같다. 서버가 최종 판정하며 서버 오류는 필드별로 다시 표시한다.
import { ratioToPctInput, pctInputToRatio } from './pct.js'

// type: years(년) | multiple(배) | percent(%, 저장은 0~1)
export const RULE_SPECS = {
  'R-01': [
    { key: 'min_years', label: '최소 연수', unit: '년', type: 'years' },
    { key: 'target_years', label: '목표 연수', unit: '년', type: 'years' },
  ],
  'R-02': [{ key: 'target_years', label: '목표 연수', unit: '년', type: 'years' }],
  'R-03': [
    { key: 'relative', label: '목표 대비 상대 폭', unit: '%', type: 'percent', onlyMode: 'relative' },
    { key: 'min_abs', label: '최소 절대 폭', unit: '%p', type: 'percent', onlyMode: 'relative' },
  ],
  'R-04': [{ key: 'drawdown_threshold', label: '하락 국면 기준 (고점 대비 하락률)', unit: '%', type: 'percent' }],
  'R-05': [
    { key: 'upper_multiplier', label: '상단 배수 (초기 인출률 대비)', unit: '배', type: 'multiple' },
    { key: 'cut_ratio', label: '선택생활비 감액 비율', unit: '%', type: 'percent' },
  ],
  'R-06': [
    { key: 'lower_multiplier', label: '하단 배수 (초기 인출률 대비)', unit: '배', type: 'multiple' },
    { key: 'raise_ratio', label: '증액 여지 비율', unit: '%', type: 'percent' },
  ],
  'R-07': [],
}

const str = v => (v === null || v === undefined ? '' : String(v))

/** ips_rules 행 → 폼 상태. 폼 값은 모두 문자열(비율은 % 문자열). */
export function ruleToForm(rule) {
  const p = rule.parameters || {}
  const values = {}
  for (const f of RULE_SPECS[rule.rule_code] || []) {
    values[f.key] = f.type === 'percent' ? ratioToPctInput(p[f.key]) : str(p[f.key])
  }
  const form = { enabled: !!rule.enabled, values }
  if (rule.rule_code === 'R-03') form.mode = p.mode === 'relative' ? 'relative' : 'config'     // {} 는 config
  return form
}

export function formsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function toNumber(f, text) {
  const t = str(text).trim()
  if (t === '') return { error: '값이 필요합니다' }
  if (f.type === 'percent') {
    const r = pctInputToRatio(t)
    return Number.isNaN(r) ? { error: '숫자를 입력하세요' } : { value: r }
  }
  const n = Number(t)
  return Number.isFinite(n) ? { value: n } : { error: '숫자를 입력하세요' }
}

const RANGE = {
  min_years: [v => v > 0, '0보다 커야 합니다'],
  target_years: [v => v > 0, '0보다 커야 합니다'],
  relative: [v => v > 0 && v <= 1, '0보다 크고 100% 이하여야 합니다'],
  min_abs: [v => v >= 0 && v <= 1, '0% 이상 100% 이하여야 합니다'],
  drawdown_threshold: [v => v > 0 && v < 1, '0%보다 크고 100%보다 작아야 합니다'],
  upper_multiplier: [v => v > 1, '1보다 커야 합니다'],
  cut_ratio: [v => v > 0 && v < 1, '0%보다 크고 100%보다 작아야 합니다'],
  lower_multiplier: [v => v > 0 && v < 1, '0보다 크고 1보다 작아야 합니다'],
  raise_ratio: [v => v > 0 && v < 1, '0%보다 크고 100%보다 작아야 합니다'],
}

/** 폼 → { parameters } 또는 { errors: {field: 메시지} }. R-03 config 모드는 {"mode":"config"} 만 저장한다. */
export function formToParameters(code, form) {
  const errors = {}
  const params = {}
  if (code === 'R-03' && form.mode === 'config') return { parameters: { mode: 'config' } }
  if (code === 'R-03') params.mode = 'relative'

  for (const f of RULE_SPECS[code] || []) {
    const { value, error } = toNumber(f, form.values[f.key])
    if (error) { errors[f.key] = error; continue }
    const [ok, msg] = RANGE[f.key]
    if (!ok(value)) { errors[f.key] = msg; continue }
    params[f.key] = value
  }
  if (code === 'R-01' && params.min_years !== undefined && params.target_years !== undefined
      && params.min_years > params.target_years) {
    errors.min_years = '최소 연수는 목표 연수 이하여야 합니다'
  }
  return Object.keys(errors).length ? { errors } : { parameters: params }
}

/** 서버 422 detail([{field, msg}]) → { field: msg }. 필드를 알 수 없으면 _form. */
export function serverErrorsToFields(detail) {
  const out = {}
  if (Array.isArray(detail)) {
    for (const e of detail) {
      const key = e.field || '_form'
      out[key] = (e.msg || '').replace(/^Value error, /, '') || '입력값이 올바르지 않습니다'
    }
  } else if (typeof detail === 'string') {
    out._form = detail
  }
  return out
}
