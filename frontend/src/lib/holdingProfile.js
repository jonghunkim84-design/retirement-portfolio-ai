// 보유상품 속성 그리드의 순수 로직 (기본값 제안, 자산유형별 활성 필드, 저장 payload 변환, 채권 경고)
import { ratioToPctInput, pctInputToRatio, validateRatio } from './pct.js'

export const ROLES = ['living_expense', 'stability', 'income', 'growth']
export const ROLE_LABEL = {
  living_expense: '생활비', stability: '안정', income: '인컴', growth: '성장',
}

// 자산유형 → 역할 제안값 (화면에 미리 채울 뿐, 사용자가 저장해야 DB 에 기록)
export const SUGGESTED_ROLE = {
  cash: 'living_expense', bond: 'stability', tdf: 'stability', fund: 'stability',
  equity: 'growth', income: 'income',
}

// backend/utils.py BUCKET_MAP 과 동일 (표시용 안내값. 계산 기준은 서버).
export const DEFAULT_BUCKET = { cash: 1, bond: 2, tdf: 2, fund: 2, equity: 3, income: 3 }

// 자산유형별로 활성화되는 필드. 여기에 없는 필드는 입력 불가(저장 시 null/기본값).
const ALWAYS = ['role', 'bucket', 'sub_class', 'currency', 'liquidity_note', 'as_of_date']
const BY_TYPE = {
  cash:   [],
  bond:   ['fx_hedged', 'region', 'expense_ratio', 'bond_modified_duration', 'bond_rate_type', 'credit_grade', 'value_source'],
  tdf:    ['fx_hedged', 'region', 'sector', 'expense_ratio', 'equity_share_pct'],
  fund:   ['fx_hedged', 'region', 'sector', 'expense_ratio', 'equity_share_pct'],
  equity: ['fx_hedged', 'region', 'sector', 'expense_ratio'],
  income: ['fx_hedged', 'region', 'sector', 'expense_ratio', 'reit_property_type', 'rate_sensitivity', 'value_source'],
}

export function fieldEnabled(assetType, field) {
  return ALWAYS.includes(field) || (BY_TYPE[assetType] || []).includes(field)
}

export const ALL_FIELDS = [
  ...ALWAYS,
  'fx_hedged', 'region', 'sector', 'expense_ratio', 'equity_share_pct',
  'bond_modified_duration', 'bond_rate_type', 'credit_grade',
  'reit_property_type', 'rate_sensitivity', 'value_source',
]

const str = v => (v === null || v === undefined ? '' : String(v))

/** 속성이 아직 없는 자산의 초기 폼 — 역할만 제안값으로 채운다. */
export function suggestedForm(asset, today) {
  return {
    role: SUGGESTED_ROLE[asset.asset_type] || 'stability',
    bucket: '', sub_class: '', currency: 'KRW', fx_hedged: false, region: '', sector: '',
    bond_modified_duration: '', bond_rate_type: '', credit_grade: '',
    reit_property_type: '', rate_sensitivity: '',
    equity_share_pct: '', expense_ratio: '', liquidity_note: '',
    value_source: 'assumed', as_of_date: today,
  }
}

/** 저장된 profile(API 응답) → 폼. 비율(equity_share_pct, expense_ratio)은 % 문자열. */
export function formFromProfile(p) {
  return {
    role: p.role, bucket: p.bucket == null ? '' : String(p.bucket),
    sub_class: str(p.sub_class), currency: p.currency || 'KRW', fx_hedged: !!p.fx_hedged,
    region: str(p.region), sector: str(p.sector),
    bond_modified_duration: str(p.bond_modified_duration), bond_rate_type: str(p.bond_rate_type),
    credit_grade: str(p.credit_grade), reit_property_type: str(p.reit_property_type),
    rate_sensitivity: str(p.rate_sensitivity),
    equity_share_pct: ratioToPctInput(p.equity_share_pct), expense_ratio: ratioToPctInput(p.expense_ratio),
    liquidity_note: str(p.liquidity_note), value_source: p.value_source || 'assumed',
    as_of_date: str(p.as_of_date).slice(0, 10),
  }
}

export function formsEqual(a, b) {
  return ALL_FIELDS.every(k => a[k] === b[k])
}

function num(s, label, { min } = {}) {
  const t = str(s).trim()
  if (t === '') return { value: null }
  const n = Number(t)
  if (!Number.isFinite(n)) return { error: `${label}: 숫자를 입력하세요` }
  if (min !== undefined && n < min) return { error: `${label}: ${min} 이상이어야 합니다` }
  return { value: n }
}

/**
 * 폼 → PUT /holding-profiles/{id} body. 비율은 % → 0~1 변환(pct.js 한 곳).
 * 해당 자산유형에서 비활성인 필드는 null/기본값으로 보낸다. 오류가 있으면 { error }.
 */
export function toPayload(form, asset, today) {
  const on = f => fieldEnabled(asset.asset_type, f)
  const text = f => (on(f) && str(form[f]).trim() !== '' ? str(form[f]).trim() : null)

  const dur = on('bond_modified_duration') ? num(form.bond_modified_duration, '수정듀레이션', { min: 0 }) : { value: null }
  const sens = on('rate_sensitivity') ? num(form.rate_sensitivity, '금리 민감도') : { value: null }
  const eq = on('equity_share_pct') ? pctInputToRatio(form.equity_share_pct) : null
  const exp = on('expense_ratio') ? pctInputToRatio(form.expense_ratio) : null

  const error = dur.error || sens.error
    || validateRatio(eq, '주식 비중') || validateRatio(exp, '총보수')
  if (error) return { error }

  return {
    payload: {
      role: form.role,
      bucket: form.bucket === '' ? null : Number(form.bucket),   // 빈 값 = 기본(자산유형 기준) 유지
      sub_class: text('sub_class'),
      equity_share_pct: eq,
      currency: str(form.currency).trim() || 'KRW',
      fx_hedged: on('fx_hedged') ? !!form.fx_hedged : false,
      region: text('region'),
      sector: text('sector'),
      bond_modified_duration: dur.value,
      bond_rate_type: text('bond_rate_type'),
      credit_grade: text('credit_grade'),
      reit_property_type: text('reit_property_type'),
      rate_sensitivity: sens.value,
      expense_ratio: exp,
      liquidity_note: text('liquidity_note'),
      value_source: on('value_source') ? form.value_source : 'assumed',
      as_of_date: str(form.as_of_date).trim() || today,
    },
  }
}

export const BOND_WARNING = {
  code: 'bond_duration_missing',
  message: '채권인데 수정듀레이션과 만기(assets.maturity_date)가 모두 비어 있습니다.',
}

/** 서버와 같은 규칙: asset_type='bond' 이고 듀레이션·만기가 모두 없을 때만 (tdf·fund 제외). 입력 중에도 즉시 반영. */
export function bondWarning(asset, form) {
  if (asset.asset_type !== 'bond') return null
  if (str(form.bond_modified_duration).trim() !== '') return null
  if (asset.maturity_date) return null
  return BOND_WARNING
}
