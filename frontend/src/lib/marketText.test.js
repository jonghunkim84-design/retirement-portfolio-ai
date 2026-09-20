import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  wonSigned, pctSigned, ppSigned, reasonText, REASON_TEXT, describeSeriesCard, groupSeries, describeRefresh,
  autoFillFrom, buildMarketInput, describeRegimePanel, describeMarketInputSource, describeExposure,
  scenarioBodyFromForm, describeShock, describeCoverage, describeR01, describeScenarioChange, describeScenarioReasons,
  describeScenarioExcluded, describeSignals, scenarioErrorText,
} from './marketText.js'

// 백엔드(market_exposure·routers)가 실제로 낸 응답 — 계약 테스트 (backend/tests 의 데이터로 생성)
const F = JSON.parse(readFileSync(new URL('./fixtures/market-samples.json', import.meta.url), 'utf-8'))
const BAD = /undefined|NaN|null|\[object|Infinity/
// 표시용 문자열만 모아서 검사한다 (JSON 의 null 값 자체는 정상 — 문자열로 새어 나오는지가 문제)
const strs = o => (typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(strs) : [])
const noBad = o => assert.doesNotMatch(strs(o).join(' | '), BAD)

test('금액·비율·%p 부호 표기, 0 은 부호 없이, null 은 "-"', () => {
  assert.equal(wonSigned(1234567.4), '+1,234,567원')
  assert.equal(wonSigned(-3000000), '−3,000,000원')
  assert.equal(wonSigned(0), '0원')
  assert.equal(wonSigned(-0.2), '0원')
  assert.equal(wonSigned(null), '-')
  assert.equal(pctSigned(0.032), '+3.2%')
  assert.equal(pctSigned(-0.01), '−1.0%')
  assert.equal(pctSigned(-0.00001), '0.0%')
  assert.equal(ppSigned(0.3), '+0.30%p')
  assert.equal(ppSigned(-1, 1), '−1.0%p')
  assert.equal(ppSigned(undefined), '-')
})

test('서버가 내는 모든 사유 코드에 설명이 있다 (코드가 화면에 그대로 나오지 않는다)', () => {
  const codes = ['no_data', 'stale', 'insufficient_history', 'invalid_reference', 'invalid_peak', 'series_missing',
    'region_missing', 'region_no_benchmark', 'no_bucket3_assets', 'no_included_assets', 'no_duration_no_maturity',
    'maturity_passed', 'no_equity_share', 'no_duration', 'no_rate_sensitivity', 'foreign_region_currency_krw',
    'rate_market_unclear', 'no_fx_series', 'no_affected_assets', 'no_inflation_linked_items', 'no_sources',
    'ecos_key_missing', 'all_sources_failed', 'empty_response', 'time_budget_exceeded', 'unknown_source',
    'delta_pp_out_of_range', 'pct_out_of_range', 'unknown_mode', 'invalid_params', 'unknown_kind', 'unknown_preset', 'kind_required']
  for (const c of codes) assert.ok(REASON_TEXT[c], `설명 없음: ${c}`)
  // 신호 제외 사유는 rate_/equity_/fx_ 접두어가 붙어 온다
  for (const p of ['rate_', 'equity_', 'fx_']) for (const c of ['no_data', 'stale', 'insufficient_history', 'series_missing', 'no_fx_series']) {
    assert.notEqual(reasonText(p + c), p + c, p + c)
  }
  assert.equal(reasonText('something_new'), 'something_new')          // 알 수 없는 코드는 그대로(누락을 눈에 띄게)
  assert.equal(reasonText(null), '')
})

test('지역 매칭 실패 사유에는 사용자가 입력한 원래 값이 들어간다', () => {
  assert.match(reasonText('region_no_benchmark', ' 독일 '), /"독일".*대응하는 기준지수가 없습니다/)
  assert.equal(reasonText('region_no_benchmark'), REASON_TEXT.region_no_benchmark)
})

test('지표 카드: 값·변화 단위, 대용·지연·이상치 배지', () => {
  const by = Object.fromEntries(F.series.series.map(s => [s.code, describeSeriesCard(s)]))
  assert.equal(by.KR_10Y.change1m, '+0.40%p')                            // 금리는 %p
  assert.match(by.KR_10Y.value, /%$/)
  assert.match(by.USD_KRW.change1m, /%$/) ; assert.doesNotMatch(by.USD_KRW.change1m, /%p/)
  assert.ok(by.EEM.badges.some(b => b.key === 'proxy'))                    // 대용 지표 표시
  assert.equal(by.KS11.drawdown, '10.0%')
  assert.equal(by.KS11.drawdownNote, '이상치 1건 제외')         // 고점 계산에서 제외한 이상치 표시
  assert.equal(by.US500.drawdownNote, '')
  assert.equal(by.KR_CPI.yoy, '+2.6%')                                     // 전년 동월 대비
  const empty = F.series_empty.series.map(describeSeriesCard)
  assert.ok(empty.every(c => c.value === '-' && c.reason === REASON_TEXT.no_data))
  const flagged = describeSeriesCard({ ...F.series.series[0], latest_flag: 'jump_suspect' })
  assert.ok(flagged.badges.some(b => b.key === 'flag'))
  assert.ok(describeSeriesCard({ ...F.series.series[0], stale: true }).badges.some(b => b.key === 'stale'))
  const groups = groupSeries(F.series.series)
  assert.deepEqual(groups.map(g => g.category), ['equity_index', 'etf_proxy', 'rate', 'fx', 'cpi'])
})

test('수집 결과: 성공·실패·건너뜀과 ECOS 키 없음 사유', () => {
  const d = describeRefresh(F.refresh)
  assert.match(d.headline, /성공 1개 · 실패 1개 · 건너뜀 2개/)
  assert.equal(d.tone, 'red')
  const kr = d.rows.find(r => r.code === 'KR_3Y')
  assert.equal(kr.status.label, '건너뜀'); assert.match(kr.reason, /ECOS 키가 없어/)
  assert.equal(d.rows.find(r => r.code === 'KS11').stored, 3)
})

test('가중 하락률 패널: 값·판정 참고·지역별 내역·제외 사유(원래 지역 값)', () => {
  const p = describeRegimePanel(F.regime)
  assert.equal(p.available, true)
  assert.match(p.headline, /지역 가중 하락률 \d+\.\d%/)
  assert.match(p.judgement, /기준\(15\.0%\) 미만이라 .* 정상 국면/)
  assert.deepEqual(p.lines.map(l => l.region).sort(), ['미국', '한국'])
  assert.equal(p.lines.find(l => l.region === '한국').flaggedNote, '이상치 1건 제외')
  assert.equal(p.lines.find(l => l.region === '미국').flaggedNote, '')
  assert.equal(p.hasFlag, true)
  assert.ok(p.excluded.some(x => /"독일"/.test(x.text)), '독일이 원래 값으로 표시')
  assert.ok(p.excluded.some(x => x.reason === 'region_missing'))
  assert.equal(p.unreliable, false); assert.equal(p.unreliableText, '')
  noBad(p)
})

test('가중 하락률 패널: 모두 제외되면 값 없음과 신뢰 경고', () => {
  const p = describeRegimePanel(F.regime_all_excluded)
  assert.equal(p.available, false); assert.equal(p.value, '-')
  assert.equal(p.unreliable, true); assert.match(p.unreliableText, /절반을 넘어/)
  assert.ok(p.reasons.includes(REASON_TEXT.no_included_assets))
  assert.equal(autoFillFrom(F.regime_all_excluded), null)
})

test('자동 채움: 화면 값(소수 2자리 %)과 전송값이 같다', () => {
  const a = autoFillFrom(F.regime)
  assert.match(a.text, /^\d+(\.\d{1,2})?$/)
  const { marketInput } = buildMarketInput(a.indexName, a.text, a)
  assert.equal(marketInput.drawdown, Number(a.text) / 100)
})

test('시장 입력 조립: 그대로면 auto + 구성 내역, 수정하면 manual, 없으면 null', () => {
  const a = autoFillFrom(F.regime)
  const auto = buildMarketInput(a.indexName, a.text, a).marketInput
  assert.equal(auto.source, 'auto')
  assert.equal(auto.lookback_days, 365); assert.equal(auto.data_date, F.regime.latest_date)
  assert.equal(auto.unreliable, false); assert.ok(auto.excluded_share > 0)
  assert.deepEqual(auto.components.map(c => c.region).sort(), ['미국', '한국'])
  assert.deepEqual(Object.keys(auto.components[0]).sort(), ['drawdown', 'is_proxy', 'region', 'series_code', 'share'])

  const edited = buildMarketInput(a.indexName, '20', a).marketInput
  assert.deepEqual(edited, { drawdown: 0.2, source: 'manual' })     // 구성 내역과 자동 계산 이름은 남기지 않는다
  const renamed = buildMarketInput('KOSPI', a.text, a).marketInput
  assert.equal(renamed.source, 'manual')
  assert.deepEqual(buildMarketInput('', '12.5', null).marketInput, { drawdown: 0.125, source: 'manual' })    // 자동값이 없을 때 직접 입력
  assert.deepEqual(buildMarketInput('', '', a), { marketInput: null })                       // 지우면 정상 국면 간주
  assert.deepEqual(buildMarketInput('KOSPI', '', null), { marketInput: { index_name: 'KOSPI' } })
  assert.match(buildMarketInput('', 'abc', a).error, /고점 대비 하락률/)
  assert.match(buildMarketInput('', '101', a).error, /0~100%/)
})

test('판단 결과의 출처 표시: 자동·직접·옛 기록(출처 없음)', () => {
  const a = autoFillFrom(F.regime)
  const auto = describeMarketInputSource(buildMarketInput(a.indexName, a.text, a).marketInput)
  assert.equal(auto.label, '자동 계산'); assert.equal(auto.components.length, 2)
  assert.match(auto.detail, /지표 기준일 2026-09-18 · 고점 기간 365일/)
  assert.equal(describeMarketInputSource({ index_name: null, drawdown: 0.1, source: 'manual' }).label, '직접 입력')
  assert.equal(describeMarketInputSource({ index_name: 'KOSPI', drawdown: 0.1 }).label, '출처 기록 없음')   // 이전 로그 형식
  assert.equal(describeMarketInputSource({ index_name: null, drawdown: null }), null)
  assert.equal(describeMarketInputSource(null), null)
  assert.match(describeMarketInputSource({ drawdown: 0.1, source: 'auto', unreliable: true }).warning, /절반을 넘어/)
})

test('노출도: 문장·지역별 표·완성도·제외 사유', () => {
  const d = describeExposure(F.exposure)
  assert.match(d.lines.rate, /금리 1%p 상승 시 .*원 (감소|증가)합니다 \(가정에 따른 추정\)/)
  assert.match(d.lines.fx, /환헤지하지 않은 외화 자산 .*원/)
  const de = d.regions.find(r => r.region === '독일')
  assert.equal(de.hasBenchmark, false); assert.match(de.note, /기준지수가 없는 지역/)
  assert.ok(d.regions.some(r => r.region === '지역 미상'))
  assert.equal(d.completeness.length, 3)
  assert.ok(d.excludedRows.length > 0 && d.excludedRows.every(r => r.text && r.text !== '' && !/^[a-z_]+$/.test(r.text)))
  noBad(d)
})

test('시나리오 충격 문구', () => {
  const S = F.scenarios
  assert.equal(describeShock(S.rate_up), '금리 +1.0%p')
  assert.equal(describeShock(S.rate_down), '금리 −1.0%p')
  assert.equal(describeShock(S.equity_uniform), '주가 −20%')
  assert.match(describeShock(S.equity_region), /지역별 하락 \(미국 −30%, 한국 −10%, 나머지 −5%\)/)
  assert.equal(describeShock(S.fx_down), 'USD 환율(원) −10%')
  assert.equal(describeShock(S.inflation), '물가 +2.0%p (1년)')
})

test('시나리오 결과: 1버킷 연수 전후를 가장 크게, 필수 기준이 없으면 전체 기준 + 사유', () => {
  const infl = describeCoverage(F.scenarios.inflation)
  assert.equal(infl.headline.basis, 'essential')
  assert.match(infl.headline.label, /필수생활비 기준/)
  assert.notEqual(infl.headline.before, infl.headline.after)            // 물가 충격: 연수만 줄어든다
  assert.ok(infl.headline.delta < 0)
  const rate = describeCoverage(F.scenarios.rate_up)
  assert.ok(rate.headline.delta < 0 || rate.headline.delta === 0)
  const cover = describeCoverage(F.scenarios.rate_up_income_covers_essential)
  assert.equal(cover.headline.basis, 'total')
  assert.match(cover.headline.note, /정기수입이 필수생활비를 충당/)
  assert.equal(cover.essential.before, '-')                              // 0년이 아니라 '-'
  assert.equal(cover.buckets.length, 3)
  noBad(cover)
})

test('시나리오 결과: 금액 변화·물가는 자산 그대로·환헤지 영향 없음·상태 변화', () => {
  const S = F.scenarios
  const rate = describeScenarioChange(S.rate_up)
  assert.match(rate.total, /^−/); assert.match(rate.share, /^−/)
  assert.ok(rate.byAsset.length > 0 && rate.noteInterest.includes('연 이자'))
  const infl = describeScenarioChange(S.inflation)
  assert.equal(infl.total, '0원'); assert.match(infl.needChange, /연 필요액 .*원 → .*원/)
  assert.equal(describeScenarioChange(S.fx_down).byAsset.length, 2)     // USD 비헤지 자산만 (주식 1 + 채권 1)
  const none = F.scenario_no_effect
  assert.ok(describeScenarioReasons(none).includes(REASON_TEXT.no_affected_assets) || none.change.total !== 0)
  assert.match(describeR01({ before: 'ok', after: 'below_min', changed: true }).text, /상태가 바뀝니다: 충족 → 최소 미달/)
  assert.match(describeR01({ before: 'ok', after: 'ok', changed: false }).text, /바뀌지 않습니다 \(충족\)/)
  assert.equal(describeR01({ before: null, after: null, changed: false }).before, '판정 없음')
  const ex = describeScenarioExcluded(S.rate_up)
  assert.ok(ex.length > 0 && ex.every(x => !/^[a-z_]+$/.test(x.text)))
})

test('직접 입력 폼 → 요청 본문 (단위 변환과 검증)', () => {
  assert.deepEqual(scenarioBodyFromForm({ kind: 'rate', delta: '1.5' }), { body: { kind: 'rate', params: { delta_pp: 1.5 } } })
  assert.deepEqual(scenarioBodyFromForm({ kind: 'inflation', delta: '3' }), { body: { kind: 'inflation', params: { delta_pp: 3 } } })
  assert.match(scenarioBodyFromForm({ kind: 'rate', delta: '0' }).error, /0이 아닌/)
  assert.match(scenarioBodyFromForm({ kind: 'rate', delta: '' }).error, /숫자/)
  assert.deepEqual(scenarioBodyFromForm({ kind: 'equity', equityMode: 'uniform', pct: '20' }), { body: { kind: 'equity', params: { mode: 'uniform', pct: 0.2 } } })
  assert.match(scenarioBodyFromForm({ kind: 'equity', equityMode: 'uniform', pct: '0' }).error, /0 초과/)
  assert.match(scenarioBodyFromForm({ kind: 'equity', equityMode: 'uniform', pct: '101' }).error, /100%/)
  assert.deepEqual(scenarioBodyFromForm({ kind: 'equity', equityMode: 'by_region', byRegion: { 미국: '30', 한국: '', 일본: '10' }, defaultPct: '5' }),
    { body: { kind: 'equity', params: { mode: 'by_region', by_region: { 미국: 0.3, 일본: 0.1 }, default_pct: 0.05 } } })
  assert.match(scenarioBodyFromForm({ kind: 'equity', equityMode: 'by_region', byRegion: {} }).error, /입력한 지역이 없습니다/)
  assert.deepEqual(scenarioBodyFromForm({ kind: 'fx', currency: 'usd', pct: '-10' }), { body: { kind: 'fx', params: { currency: 'USD', pct: -0.1 } } })
  assert.match(scenarioBodyFromForm({ kind: 'fx', currency: 'USD', pct: '60' }).error, /±50%/)
  assert.match(scenarioBodyFromForm({ kind: 'x' }).error, /고르세요/)
})

test('422 오류 문구는 사유 코드를 설명으로 바꾼다', () => {
  assert.equal(scenarioErrorText([{ field: 'params', msg: 'pct_out_of_range' }]), REASON_TEXT.pct_out_of_range)
  assert.equal(scenarioErrorText('x'), '시나리오를 실행하지 못했습니다')
})

test('최근 변화의 영향: 변화 → 노출 → 추정 영향, 한국 금리 없음은 제외 + 사유', () => {
  const d = describeSignals(F.signals)
  const kr = d.cards.find(c => c.key === 'rate-KR')
  assert.equal(kr.title, '한국 10년 금리'); assert.equal(kr.observed, '1개월 +0.40%p')
  assert.match(kr.exposure, /금리 1%p당 −.*원/); assert.match(kr.impact, /^−/)
  assert.ok(d.cards.find(c => c.key === 'rate-US'))
  const fx = d.cards.find(c => c.kind === 'fx')
  assert.match(fx.title, /원\/USD 환율/)
  assert.match(d.disclaimer, /예측이 아니며/)
  assert.match(d.yearsRow, /1버킷 커버 연수\(전체 생활비 기준\)/)
  assert.ok(d.excluded.some(x => /"독일"/.test(x.text)))
  const nd = describeSignals(F.signals_no_data)
  assert.ok(nd.cards.every(c => c.impact === '-' && c.reason))
  assert.ok(nd.excluded.every(x => !/^[a-z_]+$/.test(x.text)), '접두어가 붙은 사유 코드도 설명으로 바뀐다')
  noBad([d, nd])
})
