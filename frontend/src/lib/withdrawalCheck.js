// 인출 점검(GET /withdrawal-check) 표시 로직 — 순수 함수. 대시보드 카드와 인출 설정 "점검 결과" 탭이 함께 쓴다.
// 원칙: null 은 "-" 와 사유 툴팁으로 보여 주고 절대 0 으로 바꾸지 않는다. 계산은 서버가 하고 여기서는 표시만 한다.

export const NULL_TEXT = '-'

// ── 값 포맷 (형식 함수는 이 파일 한 곳에만 둔다) ─────────────────
const isNum = v => typeof v === 'number' && Number.isFinite(v)

/** 연수: 3.3년 (null → '-') */
export const fmtYears = v => (isNum(v) ? `${v.toFixed(1)}년` : NULL_TEXT)

/** 인출률(0~1 소수 → %): 4.0% (null → '-') */
export const fmtRate = v => (isNum(v) ? `${(v * 100).toFixed(1)}%` : NULL_TEXT)

/** 초기 대비 배수: ×0.47 (null → '-') */
export const fmtMultiple = v => (isNum(v) ? `×${v.toFixed(2)}` : NULL_TEXT)

/** 만원 단위: 1,800만원 (null → '-') */
export const fmtMan = v => (isNum(v) ? `${Math.round(v / 10000).toLocaleString('ko-KR')}만원` : NULL_TEXT)

/** 비중(0~1 소수 → %): 30% (null → '-') */
export const fmtShare = v => (isNum(v) ? `${Math.round(v * 100)}%` : NULL_TEXT)

// ── 카드의 기준 표시 문구 (기존 카드의 '1버킷 개월 수'·인출률과 값이 달라 혼동되지 않게 기준을 밝힌다) ──
export const CARD_BASIS = {
  bucket: '재지정 반영 · 순인출 기준',
  bucketHelp: '재지정한 버킷을 반영하고, 순인출 필요액(지출 − 정기수입)으로 나눈 연수입니다. '
    + '기존 화면의 "1버킷 개월 수"는 자산유형 기준 버킷을 총 월 생활비(설정값)로 나눈 값이라 다릅니다.',
  rate: '생활비 계획 기준',
  rateHelp: '인출 설정의 생활비·정기수입 항목으로 계산한 순인출 필요액 ÷ 투자자산입니다. '
    + '기존 화면의 인출률은 설정의 월 생활비와 국민연금 기준이라 값이 다를 수 있습니다.',
}

// ── 사유 코드 → 설명 ─────────────────────────────────────────────
export const REASON_TEXT = {
  no_net_need: '순인출 필요액이 0원이라 연수를 계산할 수 없습니다 (생활비 항목이 없거나 정기수입이 지출 이상)',
  baseline_missing: '인출 기준점이 입력되지 않았습니다',
  baseline_portfolio_zero: '인출 기준점의 시작 시점 투자자산이 0원입니다',
  no_assets: '활성 투자자산이 없습니다',
  no_cashflow: '기준일에 유효한 생활비 항목이 없어 인출률을 계산할 수 없습니다',
  initial_rate_zero: '초기 인출률이 0% 라 비율을 계산할 수 없습니다',
  no_withdrawals_12m: '최근 12개월 인출 기록이 없습니다',
  withdrawals_not_provided: '인출 기록을 불러오지 못했습니다',
  rule_disabled: '규칙이 꺼져 있어 판정하지 않습니다',
  rule_missing: '규칙이 등록되어 있지 않습니다',
  rule_parameters_invalid: '규칙 값이 올바르지 않아 판정하지 않습니다',
  unassigned_assets: '버킷을 알 수 없는 자산이 있습니다',
}

export const reasonText = code => (code ? (REASON_TEXT[code] ?? code) : '')

/** reasons 배열([{field, code}])에서 필드의 사유 문구를 찾는다. */
export function pickReason(reasons, field) {
  const hit = (reasons || []).find(r => r.field === field)
  return hit ? reasonText(hit.code) : ''
}

// ── 상태 → 라벨·색상 ─────────────────────────────────────────────
// tone: neutral(기본색) | ok(녹색) | warn(주의) | danger(경고) | info(참고)
export const TONE_BADGE = {
  neutral: 'badge-gray', ok: 'badge-green', warn: 'badge-yellow', danger: 'badge-red', info: 'badge-blue',
}
export const TONE_TEXT = {
  neutral: 'text-gray-800', ok: 'text-green-700', warn: 'text-yellow-700', danger: 'text-red-600', info: 'text-blue-700',
}

const BUCKET_RULE_STATUS = {
  ok: { label: '충족', tone: 'neutral' },              // 기본색
  below_target: { label: '목표 미달', tone: 'warn' },   // 주의
  below_min: { label: '최소 미달', tone: 'danger' },    // 경고
}
const GUARD_STATUS = {
  within: { label: '범위 안', tone: 'ok' },
  upper_breach: { label: '상단 초과', tone: 'warn' },
  lower_breach: { label: '하단 미만', tone: 'info' },
}
const UNJUDGED = { label: NULL_TEXT, tone: 'neutral' }

export const bucketRuleMeta = status => BUCKET_RULE_STATUS[status] ?? UNJUDGED
export const guardMeta = status => GUARD_STATUS[status] ?? UNJUDGED

export const BUCKET_SOURCE_LABEL = { override: '재지정', default: '기본' }
export const bucketLabel = b => (b == null ? NULL_TEXT : `${b}버킷`)

// ── 대시보드 카드 모델 ───────────────────────────────────────────
/** 서버 응답 → 카드에 그릴 값. null 은 그대로 유지하고 사유 문구를 함께 준다. */
export function cardModel(d) {
  const net = d.net_need
  const wr = d.withdrawal_rate
  const r01 = d.rules['R-01']
  const c = d.completeness
  const noNeed = pickReason(d.reasons, 'net_need')

  const notices = []
  if (!c.cashflow_set) notices.push({ code: 'cashflow_missing', tab: 'cashflow', text: '생활비 항목이 입력되지 않았습니다' })
  if (!c.baseline_set) notices.push({ code: 'baseline_missing', tab: 'baseline', text: '인출 기준점이 입력되지 않았습니다' })
  if (c.default_bucket_count > 0) {
    notices.push({
      code: 'default_bucket', tab: 'holdings',
      text: `기본 버킷 적용 자산 ${c.default_bucket_count}개 (금액의 ${fmtShare(c.default_bucket_value_share)})`,
    })
  }

  return {
    asOf: d.as_of,
    netAnnual: net.annual_total, netMonthly: net.monthly_total, netReason: net.annual_total > 0 ? '' : noNeed,
    b1Years: d.buckets[0].years_total, b12Years: d.cumulative.b1_b2_years_total,
    yearsReason: noNeed,
    r01: bucketRuleMeta(r01.status), r01Reason: reasonText(r01.reason),
    initialRate: wr.initial, initialReason: reasonText(wr.reasons.initial),
    currentRate: wr.current_plan, currentReason: reasonText(wr.reasons.current_plan),
    ratio: wr.ratio_to_initial,
    guardrail: guardMeta(d.rules.guardrail),
    guardrailReason: reasonText(wr.reasons.ratio) || reasonText(d.rules['R-05'].reason),
    notices,
    needsSetup: notices.some(n => n.code !== 'default_bucket'),
  }
}
