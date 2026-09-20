// 시장·노출 화면(지시서 04)의 표시 로직 — 순수 함수. 서버는 수치와 사유 코드만 주고, 문장은 여기서만 조립한다.
// 원칙: null 은 "-" 와 사유로 보여 주고 0 으로 바꾸지 않는다. 예측 표현을 쓰지 않는다(관측·가정 구분).
import { NULL_TEXT, fmtYears } from './withdrawalCheck.js'
import { marketInputFromForm } from './decisionText.js'
import { ratioToPctInput, pctInputToRatio } from './pct.js'

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const MINUS = '−'

// ── 값 포맷 ─────────────────────────────────────────────────────────
/** 부호 있는 원 단위: +1,200,000원 / −3,000,000원 (0 → 0원, null → '-') */
export const wonSigned = v => {
  if (!isNum(v)) return NULL_TEXT
  const r = Math.round(v)
  if (r === 0) return '0원'
  return `${r > 0 ? '+' : MINUS}${Math.abs(r).toLocaleString('ko-KR')}원`
}
export const wonPlain = v => (isNum(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : NULL_TEXT)
/** 비율(0~1) → 부호 있는 %: +3.2% / −1.0% */
export const pctSigned = (v, d = 1) => {
  if (!isNum(v)) return NULL_TEXT
  const s = (Math.abs(v) * 100).toFixed(d)
  return Number(s) === 0 ? `${(0).toFixed(d)}%` : `${v > 0 ? '+' : MINUS}${s}%`
}
export const pctPlain = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : NULL_TEXT)
/** 금리 변화 %p: +0.30%p */
export const ppSigned = (v, d = 2) => {
  if (!isNum(v)) return NULL_TEXT
  const s = Math.abs(v).toFixed(d)
  return Number(s) === 0 ? `${(0).toFixed(d)}%p` : `${v > 0 ? '+' : MINUS}${s}%p`
}
export const fmtLevel = v => (isNum(v) ? v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : NULL_TEXT)

export const CATEGORY_LABEL = { equity_index: '주가지수', etf_proxy: '주가(ETF 대용)', rate: '금리', fx: '환율', cpi: '물가' }
export const CATEGORY_ORDER = ['equity_index', 'etf_proxy', 'rate', 'fx', 'cpi']
export const SOURCE_LABEL = { fdr: 'FinanceDataReader', ecos: '한국은행 ECOS', fred: 'FRED' }

// ── 사유 코드 → 설명 (서버가 내는 모든 코드) ───────────────────────────
export const REASON_TEXT = {
  no_data: '관측값이 없습니다',
  stale: '최신 관측이 오래되어 제외했습니다',
  insufficient_history: '이력이 부족해 계산할 수 없습니다',
  invalid_reference: '기준 시점 값이 0이라 변화율을 계산할 수 없습니다',
  invalid_peak: '고점 값이 올바르지 않습니다',
  series_missing: '지표 정의가 없습니다',
  region_missing: '지역이 입력되지 않았습니다',
  region_no_benchmark: '대응하는 기준지수가 없는 지역입니다',
  no_bucket3_assets: '3버킷 자산이 없습니다',
  no_included_assets: '계산에 포함된 자산이 없습니다',
  no_duration_no_maturity: '듀레이션도 만기도 없어 금리 노출을 계산할 수 없습니다',
  maturity_passed: '만기가 지나 금리 노출에서 제외했습니다',
  no_equity_share: '주식 비중이 입력되지 않았습니다',
  no_duration: '듀레이션이 입력되지 않았습니다',
  no_rate_sensitivity: '금리 민감도가 입력되지 않았습니다',
  foreign_region_currency_krw: '해외 지역인데 통화가 원화로 되어 있어 환율 노출을 알 수 없습니다',
  rate_market_unclear: '채권의 통화·지역으로 대응 금리(한국/미국)를 정할 수 없습니다',
  no_fx_series: '이 통화의 환율 지표가 없습니다',
  no_affected_assets: '이 충격에 영향을 받는 자산이 없습니다',
  no_inflation_linked_items: '물가 연동 생활비 항목이 없어 필요액이 변하지 않습니다',
  // 수집
  no_sources: '수집 원천이 정의되어 있지 않습니다',
  ecos_key_missing: '한국은행 ECOS 키가 없어 수집하지 않았습니다',
  all_sources_failed: '모든 원천에서 조회에 실패했습니다',
  empty_response: '원천이 데이터를 돌려주지 않았습니다',
  time_budget_exceeded: '실행 시간 제한으로 이번에는 건너뛰었습니다',
  unknown_source: '알 수 없는 원천입니다',
  // 입력 오류
  delta_pp_out_of_range: '변화폭이 허용 범위를 벗어났습니다',
  pct_out_of_range: '비율이 허용 범위를 벗어났습니다',
  unknown_mode: '알 수 없는 방식입니다',
  invalid_params: '입력값이 올바르지 않습니다',
  unknown_kind: '알 수 없는 시나리오입니다',
  unknown_preset: '알 수 없는 프리셋입니다',
  kind_required: '시나리오 종류가 필요합니다',
}

const SIGNAL_PREFIX = /^(rate|equity|fx)_/

/** 사유 코드 → 문장. 지역 매칭 실패는 입력한 원래 값을 함께 보여 준다. 알 수 없는 코드는 그대로 반환. */
export function reasonText(code, original) {
  if (!code) return ''
  if (code === 'region_no_benchmark' && original != null && String(original).trim() !== '') {
    return `지역 값 "${String(original).trim()}"에 대응하는 기준지수가 없습니다`
  }
  if (REASON_TEXT[code]) return REASON_TEXT[code]
  const stripped = code.replace(SIGNAL_PREFIX, '')
  return REASON_TEXT[stripped] ?? code
}

export const BASIS_TEXT = {
  input: '입력값', assumed_maturity: '가정 (잔존만기를 듀레이션 대용)', assumed_sensitivity: '가정 (사용자 입력 민감도)',
}
export const RATE_KIND_LABEL = { cash: '현금(이자만 변동)', floating: '변동금리 채권(이자만 변동)', bond: '채권', bond_part: 'TDF·펀드의 채권 부분', income: '리츠·인컴' }
export const FLAG_TEXT = { jump_suspect: '전 관측 대비 급변 — 이상치일 수 있어 확인이 필요합니다(계산에는 포함)' }

// ── 지표 카드 ────────────────────────────────────────────────────────
/** 최신값 표시: 금리는 %, 환율·지수는 숫자 */
export function fmtSeriesValue(s) {
  if (!isNum(s.latest_value)) return NULL_TEXT
  return s.category === 'rate' ? `${s.latest_value.toFixed(2)}%` : fmtLevel(s.latest_value)
}
/** 변화 표시: 금리는 %p, 그 외는 % */
export function fmtSeriesChange(ch) {
  if (!ch || !isNum(ch.value)) return NULL_TEXT
  return ch.unit === 'pp' ? ppSigned(ch.value) : pctSigned(ch.value)
}

export function describeSeriesCard(s) {
  const badges = []
  if (s.is_proxy) badges.push({ key: 'proxy', label: '대용 지표', tone: 'info', help: 'ETF 가격 등 실제 지수 대신 쓰는 대용 지표입니다' })
  if (s.stale) badges.push({ key: 'stale', label: '지연', tone: 'warn', help: REASON_TEXT.stale })
  if (s.latest_flag) badges.push({ key: 'flag', label: '이상치 의심', tone: 'warn', help: FLAG_TEXT[s.latest_flag] ?? s.latest_flag })
  const dd = s.drawdown
  return {
    code: s.code, name: s.name, category: s.category,
    value: fmtSeriesValue(s), date: s.latest_date ?? NULL_TEXT,
    change1m: fmtSeriesChange(s.change_1m), change3m: fmtSeriesChange(s.change_3m),
    change1mReason: s.change_1m?.reason ? reasonText(s.change_1m.reason) : '',
    drawdown: dd ? (isNum(dd.value) ? pctPlain(dd.value) : NULL_TEXT) : null,
    drawdownReason: dd?.reason ? reasonText(dd.reason) : '',
    yoy: isNum(s.yoy) ? pctSigned(s.yoy) : null,
    source: SOURCE_LABEL[s.latest_source] ?? s.latest_source ?? '',
    reason: s.reason ? reasonText(s.reason) : '',
    badges,
  }
}

/** 카드를 분류 순서대로 묶는다. */
export function groupSeries(list) {
  const groups = CATEGORY_ORDER.map(cat => ({ category: cat, label: CATEGORY_LABEL[cat], items: list.filter(s => s.category === cat) }))
  return groups.filter(g => g.items.length)
}

// ── 수집 결과 ────────────────────────────────────────────────────────
export const REFRESH_STATUS = { ok: { label: '성공', tone: 'ok' }, failed: { label: '실패', tone: 'danger' }, skipped: { label: '건너뜀', tone: 'warn' } }

export function describeRefresh(out) {
  const rows = (out.results || []).map(r => ({
    code: r.code, status: REFRESH_STATUS[r.status] ?? { label: r.status, tone: 'neutral' },
    stored: r.stored ?? 0, source: SOURCE_LABEL[r.source] ?? '',
    reason: r.reason ? reasonText(r.reason) : '', lastDate: r.last_date ?? '',
  }))
  const problems = rows.filter(r => r.status.tone !== 'ok').length
  return {
    headline: `수집 완료 — 성공 ${out.ok}개 · 실패 ${out.failed}개 · 건너뜀 ${out.skipped}개 (신규·갱신 ${out.stored}건)`,
    tone: out.failed > 0 ? 'red' : problems > 0 ? 'yellow' : 'blue',
    rows,
  }
}

// ── 가중 하락률 (시장 국면 자동 계산) ──────────────────────────────────
/** 입력칸에 채울 값 — 화면에 보이는 값(소수 2자리 %)과 실제 전송값이 같도록 반올림한다. */
export function autoFillFrom(regime) {
  const s = regime?.suggested_input
  if (!s || !isNum(s.drawdown)) return null
  return { indexName: s.index_name ?? '', text: ratioToPctInput(Math.round(s.drawdown * 10000) / 10000), suggested: s }
}

/** 요청의 market_input 조립. auto 는 autoFillFrom 결과.
 *  - 입력칸이 자동 채움 그대로면 출처 auto + 구성 내역, 수정했거나 직접 입력이면 manual.
 *  - 값이 없으면 null(정상 국면 간주). 검증 오류는 { error }. */
export function buildMarketInput(indexName, drawdownText, auto) {
  const base = marketInputFromForm(indexName, drawdownText)
  if (base.error || !base.marketInput) return base
  const mi = base.marketInput
  if (mi.drawdown === undefined) return base                       // 이름만 있고 하락률이 없으면 출처를 붙일 값이 없다
  const untouched = auto && String(drawdownText).trim() === auto.text && String(indexName ?? '').trim() === auto.indexName
  if (!untouched) {
    // 값을 고쳤는데 자동 계산 이름이 남아 있으면 스냅샷이 오해를 부르므로 이름을 뺀다
    const { index_name: name, ...rest } = mi
    const keepName = name && !(auto && name === auto.indexName)
    return { marketInput: { ...(keepName ? { index_name: name } : {}), ...rest, source: 'manual' } }
  }
  const s = auto.suggested
  const out = { ...mi, source: 'auto', lookback_days: s.lookback_days, data_date: s.data_date,
    unreliable: !!s.unreliable, excluded_share: s.excluded_share ?? 0,
    components: (s.components || []).map(c => ({ region: c.region, series_code: c.series_code, drawdown: c.drawdown, share: c.share, is_proxy: !!c.is_proxy })) }
  return { marketInput: out }
}

/** 자동 계산 패널: 판정 참고·지역별 내역·제외·신뢰 경고 */
export function describeRegimePanel(regime) {
  if (!regime) return null
  const w = regime.weighted_drawdown
  const lines = (regime.regions || []).map(r => ({
    region: r.region, series: r.series_name ?? r.series_code, isProxy: !!r.is_proxy,
    drawdown: pctPlain(r.drawdown), share: pctPlain(r.share_of_bucket3, 0),
    flagged: (r.flagged_dates || []).length > 0,
  }))
  const excluded = (regime.excluded_by_reason || []).map(g => ({
    reason: g.reason, count: g.count, share: pctPlain(g.share_of_bucket3, 0),
    text: g.reason === 'region_no_benchmark' && g.regions?.length
      ? `${g.regions.map(x => `"${String(x).trim()}"`).join(', ')} — ${REASON_TEXT.region_no_benchmark}`
      : reasonText(g.reason),
  }))
  const j = regime.judgement
  const thr = regime.rule?.threshold
  let judgement = ''
  if (j && isNum(thr)) {
    judgement = j.status === 'downturn'
      ? `기준(${pctPlain(thr)}) 이상이라 판단 규칙 R-04에서는 하락 국면으로 판정됩니다`
      : `기준(${pctPlain(thr)}) 미만이라 판단 규칙 R-04에서는 정상 국면으로 판정됩니다`
  }
  return {
    available: isNum(w), value: isNum(w) ? pctPlain(w) : NULL_TEXT,
    headline: isNum(w) ? `3버킷 자산의 지역 가중 하락률 ${pctPlain(w)}` : '가중 하락률을 계산할 수 없습니다',
    reasons: (regime.reasons || []).map(r => reasonText(r.code)),
    judgement, lines, excluded,
    excludedShare: isNum(regime.excluded_share) ? pctPlain(regime.excluded_share, 0) : NULL_TEXT,
    unreliable: !!regime.unreliable,
    unreliableText: regime.unreliable ? `계산에서 제외된 자산이 3버킷의 ${pctPlain(regime.excluded_share, 0)}로 절반을 넘어 신뢰하기 어렵습니다. 지역 입력을 채운 뒤 다시 확인하세요` : '',
    dataDate: regime.latest_date ?? NULL_TEXT, lookbackDays: regime.lookback_days,
    hasFlag: lines.some(l => l.flagged),
  }
}

/** 판단 결과·로그의 입력 스냅샷(market_input) → 출처 표시 */
export function describeMarketInputSource(mi) {
  if (!mi || mi.drawdown == null) return null
  const label = mi.source === 'auto' ? '자동 계산' : mi.source === 'manual' ? '직접 입력' : '출처 기록 없음'
  const parts = (mi.components || []).map(c => `${c.region} ${pctPlain(c.drawdown)} (비중 ${pctPlain(c.share, 0)})`)
  return {
    label, tone: mi.source === 'auto' ? 'info' : 'neutral',
    detail: [
      mi.data_date ? `지표 기준일 ${mi.data_date}` : '',
      mi.lookback_days ? `고점 기간 ${mi.lookback_days}일` : '',
    ].filter(Boolean).join(' · '),
    components: parts,
    warning: mi.unreliable ? '제외 자산이 절반을 넘어 신뢰하기 어려운 값이었습니다' : '',
  }
}

// ── 노출도 ───────────────────────────────────────────────────────────
export function describeExposure(e) {
  const total = e.total_assets
  const rate = e.rate.price_change_per_1pp
  const fxTotal = e.fx.total
  const lines = {
    rate: `금리 1%p 상승 시 채권·리츠 등 평가액이 약 ${wonPlain(Math.abs(rate))} ${rate < 0 ? '감소' : '증가'}합니다 (가정에 따른 추정)`,
    rateInterest: `현금·변동금리 채권은 금리 1%p 상승 시 연 이자가 약 ${wonPlain(e.rate.interest_change_per_1pp)} 늘어납니다 (참고)`,
    fx: fxTotal > 0
      ? `환헤지하지 않은 외화 자산 ${wonPlain(fxTotal)} — 원/달러가 10% 하락하면 이 중 USD 자산이 약 ${wonPlain((e.fx.by_currency.USD || 0) * 0.1)} 줄어듭니다`
      : '환헤지하지 않은 외화 자산이 없습니다',
  }
  const regions = (e.equity.by_region || []).map(g => ({
    region: g.region ?? '지역 미상', amount: wonPlain(g.amount), shareOfEquity: pctPlain(g.share_of_equity, 0),
    shareOfTotal: pctPlain(g.share_of_total, 0), hasBenchmark: g.region == null ? false : g.has_benchmark,
    note: g.region == null ? '지역이 입력되지 않은 주식성 자산' : g.has_benchmark ? '' : '대응하는 기준지수가 없는 지역',
  }))
  const c = e.completeness
  const completeness = [
    { key: 'rate', label: '금리 노출에서 제외', count: c.rate_excluded.count, share: pctPlain(c.rate_excluded.share_of_total, 0) },
    { key: 'equity', label: '주가 노출에서 제외', count: c.equity_excluded.count, share: pctPlain(c.equity_excluded.share_of_total, 0) },
    { key: 'fx', label: '환율 노출 불명확', count: c.fx_unclear.count, share: pctPlain(c.fx_unclear.share_of_total, 0) },
  ]
  const excludedRows = [
    ...e.rate.excluded.map(x => ({ ...x, area: '금리' })),
    ...e.equity.excluded.map(x => ({ ...x, area: '주가' })),
    ...e.fx.unclear.map(x => ({ ...x, area: '환율' })),
  ].map(x => ({ id: `${x.area}-${x.asset_id}`, area: x.area, name: x.asset_name, value: wonPlain(x.value), text: reasonText(x.reason) }))
  return { lines, regions, completeness, excludedRows, assumedCount: e.rate.assumed_count, total: wonPlain(total) }
}

export const rateRowText = r => `${RATE_KIND_LABEL[r.kind] ?? r.kind} · 듀레이션 ${isNum(r.duration) ? r.duration.toFixed(1) : NULL_TEXT}`

// ── 시나리오 ─────────────────────────────────────────────────────────
export const KIND_LABEL = { rate: '금리', equity: '주가', fx: '환율', inflation: '물가' }

/** 직접 입력 폼 → 요청 본문. 단위는 화면 그대로(%p, %)이고 서버 규격(비율)으로 바꾼다. */
export function scenarioBodyFromForm(f) {
  const num = s => (String(s ?? '').trim() === '' ? NaN : Number(s))
  if (f.kind === 'rate' || f.kind === 'inflation') {
    const d = num(f.delta)
    if (!Number.isFinite(d) || d === 0) return { error: '변화폭(%p)을 0이 아닌 숫자로 입력하세요' }
    return { body: { kind: f.kind, params: { delta_pp: d } } }
  }
  if (f.kind === 'equity') {
    if (f.equityMode === 'by_region') {
      const by = {}
      for (const [region, txt] of Object.entries(f.byRegion || {})) {
        if (String(txt).trim() === '') continue
        const r = pctInputToRatio(txt)
        if (!Number.isFinite(r) || r < 0 || r > 1) return { error: `${region} 하락률은 0~100% 로 입력하세요` }
        by[region.trim()] = r
      }
      if (!Object.keys(by).length) return { error: '하락률을 입력한 지역이 없습니다' }
      const def = String(f.defaultPct ?? '').trim() === '' ? 0 : pctInputToRatio(f.defaultPct)
      if (!Number.isFinite(def) || def < 0 || def > 1) return { error: '나머지 지역 하락률은 0~100% 로 입력하세요' }
      return { body: { kind: 'equity', params: { mode: 'by_region', by_region: by, default_pct: def } } }
    }
    const r = pctInputToRatio(f.pct)
    if (r === null || !Number.isFinite(r) || r <= 0 || r > 1) return { error: '하락률은 0 초과 100% 이하로 입력하세요' }
    return { body: { kind: 'equity', params: { mode: 'uniform', pct: r } } }
  }
  if (f.kind === 'fx') {
    const r = pctInputToRatio(f.pct)
    if (r === null || !Number.isFinite(r) || r === 0 || Math.abs(r) > 0.5) return { error: '환율 변화는 0이 아닌 ±50% 이내로 입력하세요' }
    return { body: { kind: 'fx', params: { currency: String(f.currency || 'USD').trim().toUpperCase(), pct: r } } }
  }
  return { error: '시나리오 종류를 고르세요' }
}

/** 충격의 크기를 한 줄로 */
export function describeShock(r) {
  const p = r.params || {}
  switch (r.kind) {
    case 'rate': return `금리 ${ppSigned(p.delta_pp, 1)}`
    case 'inflation': return `물가 ${ppSigned(p.delta_pp, 1)} (1년)`
    case 'fx': return `${p.currency} 환율(원) ${pctSigned(p.pct, 0)}`
    case 'equity': return p.mode === 'by_region'
      ? `주가 지역별 하락 (${Object.entries(p.by_region).map(([k, v]) => `${k} ${MINUS}${(v * 100).toFixed(0)}%`).join(', ')}${p.default_pct ? `, 나머지 ${MINUS}${(p.default_pct * 100).toFixed(0)}%` : ''})`
      : `주가 ${MINUS}${(p.pct * 100).toFixed(0)}%`
    default: return r.kind
  }
}

/** 결과의 가장 큰 표시: 1버킷 커버 연수 전후. 필수생활비 기준이 없으면 전체 기준으로 보여 주고 사유를 밝힌다. */
export function describeCoverage(r) {
  const b = r.before.buckets['1'], a = r.after.buckets['1']
  const essential = isNum(b.years_essential) && isNum(a.years_essential)
  const total = isNum(b.years_total) && isNum(a.years_total)
  const row = key => ({ before: fmtYears(b[key]), after: fmtYears(a[key]), delta: isNum(b[key]) && isNum(a[key]) ? a[key] - b[key] : null })
  const ess = row('years_essential'), tot = row('years_total')
  let headline
  if (essential) headline = { label: '필수생활비 기준 1버킷', ...ess, basis: 'essential' }
  else if (total) headline = { label: '전체 생활비 기준 1버킷', ...tot, basis: 'total',
    note: '정기수입이 필수생활비를 충당해 필수생활비 기준 연수는 계산되지 않습니다' }
  else headline = { label: '1버킷 커버 연수', before: NULL_TEXT, after: NULL_TEXT, delta: null, basis: 'none',
    note: '순인출 필요액이 0원이라 연수를 계산할 수 없습니다' }
  const buckets = [1, 2, 3].map(n => {
    const x = r.before.buckets[String(n)], y = r.after.buckets[String(n)]
    return { bucket: n, valueBefore: wonPlain(x.value), valueAfter: wonPlain(y.value),
      totalBefore: fmtYears(x.years_total), totalAfter: fmtYears(y.years_total),
      essentialBefore: fmtYears(x.years_essential), essentialAfter: fmtYears(y.years_essential) }
  })
  return { headline, essential: ess, total: tot, buckets }
}

export const R01_LABEL = { ok: '충족', below_target: '목표 미달', below_min: '최소 미달' }
export function describeR01(r01) {
  const l = s => (s == null ? '판정 없음' : R01_LABEL[s] ?? s)
  return { before: l(r01.before), after: l(r01.after), changed: !!r01.changed,
    text: r01.changed ? `1버킷 규칙(R-01) 상태가 바뀝니다: ${l(r01.before)} → ${l(r01.after)}` : `1버킷 규칙(R-01) 상태는 바뀌지 않습니다 (${l(r01.after)})` }
}

export function describeScenarioChange(r) {
  const total = r.before.total_assets
  const share = isNum(total) && total > 0 ? r.change.total / total : null
  const noteInterest = r.need_note && isNum(r.need_note.interest_change_per_year_ref)
    ? `현금·변동금리 채권의 연 이자는 약 ${wonSigned(r.need_note.interest_change_per_year_ref)} 변합니다 (참고)` : ''
  const needChange = r.kind === 'inflation'
    ? `연 필요액 ${wonPlain(r.before.annual_need_total)} → ${wonPlain(r.after.annual_need_total)}` : ''
  return {
    total: wonSigned(r.change.total), share: share == null ? NULL_TEXT : pctSigned(share, 2),
    byBucket: ['1', '2', '3'].map(k => ({ bucket: k, amount: wonSigned(r.change.by_bucket[k]) })),
    byAsset: r.change.by_asset.map(x => ({ id: x.asset_id, name: x.asset_name, before: wonPlain(x.before), change: wonSigned(x.change), after: wonPlain(x.after) })),
    noteInterest, needChange,
  }
}

export const describeScenarioReasons = r => (r.reasons || []).map(x => reasonText(x.code))
export const describeScenarioExcluded = r => (r.excluded || []).map(x => ({
  id: `${x.asset_id}-${x.reason}`, name: x.asset_name, value: wonPlain(x.value), text: reasonText(x.reason),
}))

// ── 최근 변화의 영향 (신호 → 내 자산) ────────────────────────────────
const MARKET_LABEL = { KR: '한국', US: '미국' }
export function describeSignal(sig) {
  if (sig.kind === 'rate') {
    const name = `${MARKET_LABEL[sig.market] ?? sig.market} 10년 금리`
    return {
      key: `rate-${sig.market}`, title: name, kind: 'rate',
      observed: isNum(sig.observed_change_pp) ? `1개월 ${ppSigned(sig.observed_change_pp)}` : NULL_TEXT,
      exposure: `금리 1%p당 ${wonSigned(sig.exposure_per_1pp)} (${sig.asset_count}개 자산, 가정 포함)`,
      impact: isNum(sig.estimated_impact) ? wonSigned(sig.estimated_impact) : NULL_TEXT,
      reason: sig.reason ? reasonText(sig.reason) : '',
    }
  }
  if (sig.kind === 'equity') {
    const region = sig.region ?? '지역 미상'
    return {
      key: `equity-${region}`, title: `${region} 주식`, kind: 'equity',
      observed: isNum(sig.observed_change) ? `1개월 ${pctSigned(sig.observed_change)} (현지 통화 기준)` : NULL_TEXT,
      exposure: `주식성 자산 ${wonPlain(sig.exposure)} (${sig.asset_count}개)`,
      impact: isNum(sig.estimated_impact) ? wonSigned(sig.estimated_impact) : NULL_TEXT,
      reason: sig.reason ? reasonText(sig.reason, sig.region) : '', isProxy: !!sig.is_proxy,
    }
  }
  return {
    key: `fx-${sig.currency}`, title: `원/${sig.currency} 환율`, kind: 'fx',
    observed: isNum(sig.observed_change) ? `1개월 ${pctSigned(sig.observed_change)}` : NULL_TEXT,
    exposure: `환헤지하지 않은 ${sig.currency} 자산 ${wonPlain(sig.exposure)} (${sig.asset_count}개)`,
    impact: isNum(sig.estimated_impact) ? wonSigned(sig.estimated_impact) : NULL_TEXT,
    reason: sig.reason ? reasonText(sig.reason) : '',
  }
}

export function describeSignals(out) {
  const cards = (out.signals || []).map(describeSignal)
  const b = out.before.buckets['1'], a = out.after.buckets['1']
  const yearsRow = isNum(b.years_total) && isNum(a.years_total)
    ? `1버킷 커버 연수(전체 생활비 기준) ${fmtYears(b.years_total)} → ${fmtYears(a.years_total)}` : ''
  return {
    cards, total: wonSigned(out.total_impact), yearsRow,
    disclaimer: '관측된 변화에 현재 보유 구성을 곱한 추정치입니다. 예측이 아니며 실제 손익과 다를 수 있습니다.',
    excluded: (out.excluded || []).map((x, i) => ({ id: `${x.signal}-${x.asset_id}-${i}`, name: x.asset_name, value: wonPlain(x.value), text: reasonText(x.reason, x.region) })),
  }
}

// ── 입력 오류 문구 (422 detail: [{field, msg: 사유코드}]) ─────────────────
export function scenarioErrorText(detail) {
  if (Array.isArray(detail)) {
    const t = detail.map(d => reasonText(d.msg)).filter(Boolean)
    if (t.length) return t.join(' / ')
  }
  return '시나리오를 실행하지 못했습니다'
}
