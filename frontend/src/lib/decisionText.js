// 분기 인출 판단 결과(POST /decision-engine/run)의 사람이 읽는 문장 조립 — 순수 함수.
// 서버는 summary_code 와 reasons 를 코드와 수치로만 주고, 문장은 여기(프론트)에서 한 곳에서만 만든다 (06 의 AI 설명과 분리).
import { REASON_TEXT, fmtRate, NULL_TEXT } from './withdrawalCheck.js'
import { pctInputToRatio, validateRatio } from './pct.js'

const isNum = v => typeof v === 'number' && Number.isFinite(v)

/** 원 단위: 3,000,000원 (null → '-') */
export const won = v => (isNum(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : NULL_TEXT)
const yrs = v => (isNum(v) ? `${v.toFixed(1)}년` : NULL_TEXT)

export const CONCLUSION_LABEL = {
  pay_only: '지급만', pay_and_refill: '지급 + 보충', hold: '판단 대상 없음', needs_user_judgment: '사용자 판단 필요',
}
export const CONCLUSION_TONE = {
  pay_only: 'ok', pay_and_refill: 'info', hold: 'neutral', needs_user_judgment: 'danger',
}

export const ACCOUNT_TYPE_LABEL = {
  pension_savings: '연금저축', retirement_pension: '퇴직연금(IRP)', isa: 'ISA', regular: '일반', null: '-', undefined: '-',
}

export const ACCOUNT_ITEM_TEXT = {
  pension_annual_limit: '연금수령한도를 넘지 않는지 확인 (아래 올해 사용액·잔여 한도 참고)',
  private_pension_separate_tax: '사적연금 분리과세 기준 확인',
  early_withdrawal_restriction: '중도인출 제약(연금 외 수령 시 불이익) 확인',
  in_account_cash: '계좌 안에서 매도하면 현금이 계좌에 남습니다 — 생활비로 쓰려면 별도 인출이 필요합니다',
  isa_holding_period: 'ISA 의무가입기간 확인',
  isa_early_termination_penalty: '중도해지 시 불이익 확인',
  capital_gain_and_dividend_tax: '매매차익·배당 과세 확인',
}

export const SELL_RULE_TEXT = {
  'R-03': '허용 폭을 초과한 자산군의 초과분',
  'R-01': '목표를 넘는 자산군 (1버킷 최소 연수 보충)',
  'R-04': '하락 국면 — 2버킷 자산',
}

export const RULE_LABEL = {
  'R-01': '1버킷 최소·목표 연수', 'R-02': '2버킷 목표 연수', 'R-03': '자산군 허용 폭', 'R-04': '시장 국면',
  'R-05': '인출률 상단 가드레일', 'R-06': '인출률 하단 가드레일', 'R-07': '계좌 제약 확인',
}

export const WARNING_TEXT = {
  threshold_zero: '리밸런싱 허용 폭(rebalance_threshold)이 0% 입니다 — 모든 자산군이 허용 폭 초과로 판정되어 작은 이탈도 매도 후보가 됩니다. 설정 화면에서 값을 바로잡으세요.',
  pension_usage_unavailable: '연금 계획 값을 읽지 못해 올해 연금 한도 사용액 참고 정보를 생략했습니다.',
}

export const SKIP_REASON_TEXT = {
  ...REASON_TEXT,
  no_market_input: '시장 입력이 없어 정상 국면으로 간주했습니다',
}

export const EXECUTED_LABEL = executed => (executed === true ? '실행함' : executed === false ? '다르게 실행함' : '미확인')

const reasonOf = (result, code) => (result.conclusion.reasons || []).find(r => r.code === code)?.values || {}

/** 결론 한 줄. 보충이 없으면 반드시 "현재는 유지"와 그 이유를 포함한다. */
export function describeSummary(result) {
  const c = result.conclusion
  const head = `이번 분기(${result.period}): `
  const pay = won(result.payment.base_quarterly)
  const v = reasonOf(result, c.summary_code)
  const sells = result.refill.sells || []
  const sum = won(sells.reduce((a, s) => a + s.amount, 0))
  const n = sells.length
  const y = yrs(v.years_after_payment)
  const min = yrs(v.min_years)
  const target = yrs(v.target_years)
  switch (c.summary_code) {
    case 'no_net_need':
      return `${head}순인출 필요액이 없어 지급할 금액이 없습니다 — 현재는 유지`
    case 'r01_not_applied':
      return `${head}1버킷에서 ${pay} 지급 — 1버킷 규칙(R-01)이 적용되지 않아 보충 여부는 판단하지 않았습니다`
    case 'above_target':
      return `${head}1버킷에서 ${pay} 지급, 보충 없음 — 현재는 유지 (지급 후 1버킷 ${y}, 목표 ${target} 이상)`
    case 'below_target_no_excess':
      return `${head}1버킷에서 ${pay} 지급, 보충 없음 — 현재는 유지 (지급 후 1버킷 ${y} — 목표 ${target}에 못 미치지만 허용 폭을 초과한 자산군이 없어 보충하지 않습니다)`
    case 'downturn_above_min':
      return `${head}1버킷에서 ${pay} 지급, 보충 없음 — 현재는 유지 (하락 국면, 지급 후 1버킷 ${y} — 최소 ${min} 이상)`
    case 'below_min_refill':
      return `${head}1버킷에서 ${pay} 지급, ${n}개 자산에서 ${sum} 매도해 1버킷 보충 (지급 후 1버킷 ${y} — 최소 ${min} 미만)`
    case 'below_target_excess_refill':
      return `${head}1버킷에서 ${pay} 지급, 허용 폭을 초과한 자산군의 초과분에서 ${n}개 자산 ${sum} 보충 (지급 후 1버킷 ${y}, 목표 ${target})`
    case 'downturn_refill_to_min':
      return `${head}1버킷에서 ${pay} 지급, 하락 국면 — 2버킷 ${n}개 자산에서 최소 ${min}까지 ${sum} 보충 (3버킷 매도 제외)`
    case 'below_min_unresolved':
      return `${head}1버킷에서 ${pay} 지급 — 규칙 범위 안에서 해결할 수 없습니다: 최소 ${min}까지 ${won(v.shortfall_to_min)} 부족, 사용자 판단이 필요합니다`
    case 'downturn_unresolved':
      return `${head}1버킷에서 ${pay} 지급 — 하락 국면에서 2버킷만으로 최소 ${min}까지 ${won(v.shortfall_to_min)} 부족합니다. 3버킷 매도는 제안하지 않으며 사용자 판단이 필요합니다`
    case 'below_target_excess_unfillable':
      return `${head}1버킷에서 ${pay} 지급, 보충 없음 — 허용 폭을 초과한 자산군은 있으나 매도할 수 있는 자산이 없습니다`
    default:
      return `${head}${CONCLUSION_LABEL[c.type] ?? c.type}`
  }
}

/** 결론 근거(reasons) 한 항목 → 문장. 모르는 코드는 코드 원문. */
export function describeReason(r) {
  const v = r.values || {}
  switch (r.code) {
    case 'no_net_need': return '순인출 필요액이 0원이라 판단할 대상이 없습니다'
    case 'r01_not_applied': return `1버킷 규칙(R-01)을 적용할 수 없어 보충을 판단하지 않았습니다 (${SKIP_REASON_TEXT[v.reason] ?? v.reason})`
    case 'above_target': return `지급 후 1버킷 ${yrs(v.years_after_payment)} — 목표 ${yrs(v.target_years)} 이상이라 보충하지 않습니다`
    case 'below_target_no_excess': return `지급 후 1버킷 ${yrs(v.years_after_payment)} — 최소 ${yrs(v.min_years)} 이상이지만 목표 ${yrs(v.target_years)} 미만입니다. 허용 폭을 초과한 자산군이 없어 보충하지 않습니다${v.r03_applied === false ? ' (자산군 허용 폭 규칙 R-03 미적용)' : ''}`
    case 'downturn_above_min': return `하락 국면(하락률 ${fmtRate(v.drawdown)}, 임계값 ${fmtRate(v.threshold)}) — 지급 후 1버킷 ${yrs(v.years_after_payment)} (최소 ${yrs(v.min_years)} 이상)이라 보충하지 않습니다`
    case 'below_min_refill': return `지급 후 1버킷 ${yrs(v.years_after_payment)} (최소 ${yrs(v.min_years)} 미만) — 목표 ${yrs(v.target_years)}까지 보충이 필요합니다. 필요 금액 ${won(v.need)}, 매도 금액 ${won(v.covered)}`
    case 'below_target_excess_refill': return `지급 후 1버킷 ${yrs(v.years_after_payment)} (목표 ${yrs(v.target_years)} 미만) — 허용 폭을 초과한 자산군의 초과분에서 보충합니다. 필요 금액 ${won(v.need)}, 매도 금액 ${won(v.covered)}`
    case 'downturn_refill_to_min': return `하락 국면 — 지급 후 1버킷 ${yrs(v.years_after_payment)} (최소 ${yrs(v.min_years)} 미만)이라 2버킷에서 최소까지만 보충합니다. 매도 금액 ${won(v.covered)} (목표 ${yrs(v.target_years)}까지 채우지 않음)`
    case 'below_min_unresolved': return `규칙 범위 안에서 최소 ${yrs(v.min_years)}까지 부족합니다. 부족액 ${won(v.shortfall_to_min)} (매도 가능 ${won(v.covered)})`
    case 'downturn_unresolved': return `하락 국면에서 2버킷만으로는 최소 ${yrs(v.min_years)}까지 부족합니다. 부족액 ${won(v.shortfall_to_min)} (매도 가능 ${won(v.covered)}). 3버킷 매도는 제안하지 않습니다`
    case 'below_target_excess_unfillable': return '허용 폭을 초과한 자산군이 있으나 매도할 수 있는 자산(1버킷 밖)이 없습니다'
    case 'payment_exceeds_bucket1': return `1버킷 잔액이 분기 지급액보다 부족해 지급 전에 먼저 보충이 필요합니다 (부족액 ${won(v.shortfall)})`
    case 'target_not_fully_covered': return `목표 연수까지 채우지 못했습니다. 부족액 ${won(v.shortfall)} (규칙 범위 안에서 매도할 수 있는 금액이 부족)`
    default: return r.code
  }
}

/** 시장 국면 표시: { label, tone, detail } */
export function describeRegime(regime) {
  const detail = regime.drawdown == null
    ? '입력 하락률 없음'
    : `입력 하락률 ${fmtRate(regime.drawdown)}${regime.index_name ? ` (${regime.index_name})` : ''}`
  const thr = regime.threshold == null ? '' : ` · 임계값 ${fmtRate(regime.threshold)}`
  switch (regime.status) {
    case 'downturn': return { label: '하락 국면', tone: 'danger', detail: detail + thr }
    case 'normal': return { label: '정상 국면', tone: 'ok', detail: detail + thr }
    case 'assumed_normal': return { label: '정상 국면으로 간주', tone: 'neutral', detail: '시장 입력이 없어 정상 국면으로 간주했습니다' + thr }
    default: return { label: 'R-04 미적용 (정상으로 처리)', tone: 'neutral', detail: SKIP_REASON_TEXT[regime.reason] ?? '' }
  }
}

export const describeWarning = w => WARNING_TEXT[w.code] ?? w.code
export const describeSkipped = s => `${s.code} ${RULE_LABEL[s.code] ?? ''} — ${SKIP_REASON_TEXT[s.reason] ?? s.reason}`.replace('  ', ' ')
export const describeSellRule = code => SELL_RULE_TEXT[code] ?? code
export const describeAccountItem = code => ACCOUNT_ITEM_TEXT[code] ?? code

/** 로그 행 → 적용 지급액 표시 */
export function selectedPaymentText(engineOutput) {
  const sp = engineOutput?.selected_payment
  if (!sp) return NULL_TEXT
  return `${won(sp.amount)} (${sp.kind === 'recommended' ? '가드레일 권고' : '기본'})`
}

/** 입력 폼(지수 이름·하락률 %) → 요청의 market_input. 둘 다 비면 null(정상 국면으로 간주). */
export function marketInputFromForm(indexName, drawdownText) {
  const name = String(indexName ?? '').trim()
  const ratio = pctInputToRatio(drawdownText)
  const err = validateRatio(ratio, '고점 대비 하락률')
  if (err) return { error: err }
  if (!name && ratio === null) return { marketInput: null }
  const marketInput = {}
  if (name) marketInput.index_name = name
  if (ratio !== null) marketInput.drawdown = ratio
  return { marketInput }
}
