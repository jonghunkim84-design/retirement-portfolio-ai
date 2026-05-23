import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import api, { fmt } from '../api/client.js'

// ── 수익률 계산기 ─────────────────────────────────────────────────
function SliderRow({ label, value, min, max, step, display, onChange, badge }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-gray-600 w-40 flex-shrink-0 flex items-center gap-1.5">
        {label}
        {badge && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-600 text-white">{badge}</span>}
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className="flex-1 h-1.5 accent-blue-600 cursor-pointer" />
      <span className="text-sm font-semibold text-gray-700 w-20 text-right">{display}</span>
    </div>
  )
}

const R_TABS = ['① 근사법 (간편식)', '② 피셔 방정식 (정확)', '③ 세후 실질수익률']

function ReturnCalc({ initNominal, initInflation, returnSource }) {
  const [nominal,   setNominal]   = useState(initNominal   ?? 7.0)
  const [inflation, setInflation] = useState(initInflation ?? 2.5)
  const [tax,       setTax]       = useState(0.5)
  const [principal, setPrincipal] = useState(10)
  const [years,     setYears]     = useState(10)
  const [tab,       setTab]       = useState(2)

  useEffect(() => { if (initNominal   != null) setNominal(initNominal)     }, [initNominal])
  useEffect(() => { if (initInflation != null) setInflation(initInflation) }, [initInflation])

  const n = nominal   / 100
  const i = inflation / 100
  const t = tax       / 100

  const realApprox   = nominal - inflation
  const realFisher   = ((1 + n) / (1 + i) - 1) * 100
  const realAfterTax = nominal - tax - inflation
  const realRate     = [realApprox, realFisher, realAfterTax][tab]

  const principalMan  = principal * 10000
  const nominalFuture = Math.round(principalMan * Math.pow(1 + n, years))
  const realFutures   = [
    Math.round(principalMan * Math.pow(1 + realApprox   / 100, years)),
    Math.round(principalMan * Math.pow(1 + realFisher   / 100, years)),
    Math.round(principalMan * Math.pow((1 + n - t) / (1 + i), years)),
  ]
  const realFuture = realFutures[tab]
  const rateColor  = realRate >= 3 ? 'text-green-600' : realRate >= 0 ? 'text-yellow-600' : 'text-red-600'

  const sourceBadge = returnSource === 'actual'
    ? { bg: 'bg-blue-50', text: 'text-blue-700', badge: '실현' }
    : { bg: 'bg-gray-50', text: 'text-gray-500', badge: '기대' }

  const formulas = [
    { text: `근사법 실질 수익률 = 명목 수익률 − 물가상승률`,
      calc: `= ${nominal.toFixed(1)}% − ${inflation.toFixed(1)}% = ${realRate.toFixed(2)}%`,
      sub:  '간편 계산 — 수익률이 낮을수록 오차 작음' },
    { text: `피셔 방정식: 실질 = (1 + 명목) ÷ (1 + 물가) − 1`,
      calc: `= (1 + ${n.toFixed(3)}) ÷ (1 + ${i.toFixed(3)}) − 1 = ${realRate.toFixed(2)}%`,
      sub:  '복리 효과 정확 반영 — 학술·금융 표준' },
    { text: `세후 실질 수익률 = 명목 수익률 − 세금·수수료 − 물가상승률`,
      calc: `= ${nominal.toFixed(1)}% − ${tax.toFixed(1)}% − ${inflation.toFixed(1)}% = ${realRate.toFixed(2)}%`,
      sub:  '실제 손에 남는 구매력 증가분' },
  ]

  return (
    <div className="space-y-4">
      {/* 출처 안내 */}
      <div className={`rounded-lg px-3 py-2 flex items-start gap-2 ${sourceBadge.bg}`}>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-600 text-white flex-shrink-0 mt-0.5">
          {sourceBadge.badge}
        </span>
        <span className={`text-[11px] ${sourceBadge.text}`}>
          명목 수익률은 <strong>{returnSource === 'actual' ? '실제 포트폴리오 연환산 수익률' : '자산 배분 기반 기대수익률'}</strong>({nominal.toFixed(1)}%)로 자동 반영됩니다.
          슬라이더로 직접 조정할 수 있습니다.
        </span>
      </div>

      <div className="space-y-3 py-1">
        <SliderRow label="명목 수익률 (%)" value={nominal}   min={-20} max={20} step={0.1}
          display={`${nominal.toFixed(1)}%`}     onChange={setNominal}   badge={sourceBadge.badge} />
        <SliderRow label="물가상승률 (%)"  value={inflation} min={0}   max={10} step={0.1}
          display={`${inflation.toFixed(1)}%`}   onChange={setInflation} />
        <SliderRow label="세금·수수료 (%)" value={tax}       min={0}   max={5}  step={0.1}
          display={`${tax.toFixed(1)}%`}         onChange={setTax} />
        <SliderRow label="투자금 (억 원)"  value={principal} min={1}   max={50} step={0.5}
          display={`${principal}억`}             onChange={setPrincipal} />
        <SliderRow label="운용 기간 (년)"  value={years}     min={1}   max={30} step={1}
          display={`${years}년`}                 onChange={setYears} />
      </div>

      {/* 탭 */}
      <div className="flex gap-2 flex-wrap">
        {R_TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
              ${tab === i
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
        <div className="text-gray-600">{formulas[tab].text}</div>
        <div className="font-semibold text-gray-800 mt-0.5">{formulas[tab].calc}</div>
        <div className="text-xs text-gray-400 mt-1">{formulas[tab].sub}</div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <div className="text-xs text-gray-500 mb-1">실질 수익률</div>
          <div className={`text-2xl font-bold ${rateColor}`}>{realRate.toFixed(2)}%</div>
          <div className="text-xs text-gray-400 mt-1">
            {tab === 0 ? '근사값' : tab === 1 ? '피셔 정확값' : '세금·수수료 반영'}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <div className="text-xs text-gray-500 mb-1">{principal}억 → {years}년 후 (명목)</div>
          <div className={`text-2xl font-bold ${nominal < 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {nominalFuture.toLocaleString()}만
          </div>
          <div className="text-xs text-gray-400 mt-1">명목 기준</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <div className="text-xs text-gray-500 mb-1">실질 구매력</div>
          <div className={`text-2xl font-bold ${realFuture < principalMan ? 'text-red-600' : 'text-blue-600'}`}>
            {realFuture.toLocaleString()}만
          </div>
          <div className="text-xs text-gray-400 mt-1">물가 차감 기준</div>
        </div>
      </div>

      <div className={`text-xs rounded-lg px-3 py-2 ${
        realRate >= 3 ? 'bg-green-50 text-green-700' :
        realRate >= 0 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-600'}`}>
        {realRate >= 3
          ? `✅ 실질 수익률 ${realRate.toFixed(2)}%로 물가·세금 차감 후에도 자산이 성장합니다.`
          : realRate >= 0
          ? `⚠️ 실질 수익률 ${realRate.toFixed(2)}%로 자산 유지 수준입니다. 비용 절감을 검토하세요.`
          : `🔴 실질 수익률 ${realRate.toFixed(2)}%로 물가 대비 자산이 감소합니다. 포트폴리오 조정이 필요할 수 있습니다.`}
      </div>
    </div>
  )
}

const ASSET_TYPE_LABEL = {
  cash: '현금성', bond: '채권', tdf: 'TDF', fund: '펀드', equity: '주식형', income: '리츠/인컴',
}

function ReturnBadge({ value }) {
  if (value == null) return <span className="text-gray-300 text-xs">-</span>
  const color = value >= 0 ? 'text-blue-600' : 'text-red-500'
  return <span className={`font-semibold ${color}`}>{value >= 0 ? '+' : ''}{value.toFixed(2)}%</span>
}

// 연환산 수익률 셀 — 1년 미만 보유 시 총수익률 + 안내 표시
function AnnualReturnCell({ annualReturn, totalReturn, underOneYear, holdingDays }) {
  if (!underOneYear) {
    // 1년 이상: 연환산 수익률 정상 표시
    return <ReturnBadge value={annualReturn} />
  }
  // 1년 미만: 총수익률 표시 + 참고 안내
  if (totalReturn == null) return <span className="text-gray-300 text-xs">-</span>
  const color = totalReturn >= 0 ? 'text-blue-600' : 'text-red-500'
  return (
    <div className="text-right">
      <span className={`font-semibold ${color}`}>
        {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%
      </span>
      <div className="text-[10px] text-amber-500 mt-0.5">총수익 ({holdingDays}일, 연환산 불가)</div>
    </div>
  )
}

function SummaryCard({ label, value, sub, color = 'blue' }) {
  const border = { blue: 'border-blue-500', green: 'border-green-500', red: 'border-red-500', gray: 'border-gray-300' }
  return (
    <div className={`card border-l-4 ${border[color]}`}>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function ReturnAnalysis() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.get('/returns/assets').then(r => r.data),
  })
  const { data: annualData = [] } = useQuery({
    queryKey: ['returns-annual'],
    queryFn: () => api.get('/returns/annual').then(r => r.data),
  })
  const { data: dash } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isLoading,
  })

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  if (error)    return <div className="text-red-500 p-4">오류: {error.message}</div>

  const { assets = [], total_current, total_invested,
          portfolio_total_return, portfolio_annual_return } = data

  // 차트용: 입금액 입력된 자산 전체 (slice 제거 — 손실 자산이 잘리는 버그 수정)
  // 1년 미만은 총수익률, 1년 이상은 연환산 수익률로 표시
  const chartAssets = assets
    .filter(a => a.investment_amount != null && a.total_return != null)
    .map(a => ({
      ...a,
      chart_return: (a.under_one_year || a.annual_return == null)
        ? a.total_return
        : a.annual_return,
      chart_label: (a.under_one_year || a.annual_return == null) ? '총수익' : '연환산',
    }))
    .filter(a => a.chart_return != null)
    .sort((a, b) => (b.chart_return ?? 0) - (a.chart_return ?? 0))  // 높은 순 → 손실은 하단

  const totalReturnColor = portfolio_total_return >= 0 ? 'green' : 'red'

  // 계산기 초기값
  const initNominal   = portfolio_annual_return != null
    ? Math.round(portfolio_annual_return * 10) / 10
    : (dash?.estimated_return_rate ?? 7.0)
  const initInflation = Math.round((dash?.config?.inflation?.assumed_rate ?? 0.025) * 1000) / 10
  const calcReturnSource = portfolio_annual_return != null ? 'actual' : 'estimated'

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4">
        <h1 className="text-xl font-bold">📈 수익률 분석</h1>
        <p className="text-blue-200 text-sm mt-1">입금액 대비 실제 수익률 · 연환산 기준</p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          label="총 투자 원금"
          value={fmt.eok(total_invested)}
          sub="입금액 합계"
          color="blue"
        />
        <SummaryCard
          label="현재 평가액"
          value={fmt.eok(total_current)}
          sub={`손익 ${fmt.won(total_current - total_invested)}`}
          color="blue"
        />
        <SummaryCard
          label="포트폴리오 총 수익률"
          value={portfolio_total_return != null ? `${portfolio_total_return >= 0 ? '+' : ''}${portfolio_total_return.toFixed(2)}%` : '-'}
          sub="투자 시점부터 누적"
          color={totalReturnColor}
        />
        <SummaryCard
          label="포트폴리오 연환산 수익률"
          value={portfolio_annual_return != null ? `${portfolio_annual_return >= 0 ? '+' : ''}${portfolio_annual_return.toFixed(2)}%` : '-'}
          sub="현재가 가중평균"
          color={portfolio_annual_return >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* 자산별 수익률 차트 */}
      {chartAssets.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-sm font-semibold text-gray-700">자산별 수익률 (입금액 입력된 자산)</h3>
            <div className="flex gap-3 text-xs text-gray-400">
              <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500 mr-1"/>1년 이상: 연환산</span>
              <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 mr-1"/>1년 미만: 총수익</span>
              <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400 mr-1"/>손실</span>
            </div>
          </div>
          {(() => {
            // 음수 포함 domain 계산 — Recharts auto domain은 음수 bar 미렌더링 버그 있음
            const vals = chartAssets.map(a => a.chart_return ?? 0)
            const minVal = Math.min(0, ...vals)
            const maxVal = Math.max(0, ...vals)
            const pad = Math.max(5, Math.abs(maxVal - minVal) * 0.1)
            const domain = [Math.floor(minVal - pad), Math.ceil(maxVal + pad)]
            return (
              <ResponsiveContainer width="100%" height={Math.max(200, chartAssets.length * 26)}>
                <BarChart data={chartAssets} layout="vertical"
                  barSize={13}
                  margin={{ top: 0, right: 90, bottom: 0, left: 160 }}>
                  <XAxis type="number" unit="%" tick={{ fontSize: 11 }} domain={domain} />
                  <YAxis type="category" dataKey="asset_name" tick={{ fontSize: 11 }} width={155} />
                  <Tooltip
                    formatter={(v, _name, props) => {
                      const label = props.payload.under_one_year ? '총수익률 (1년 미만)' : '연환산 수익률'
                      return [`${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`, label]
                    }}
                  />
                  <ReferenceLine x={0} stroke="#6b7280" strokeWidth={1.5} />
                  <Bar dataKey="chart_return" isAnimationActive={false} baseValue={0} radius={[3, 3, 3, 3]}>
                    {chartAssets.map((a, i) => {
                      const fill = (a.chart_return ?? 0) < 0 ? '#ef4444'
                        : a.under_one_year ? '#f59e0b'
                        : '#3b82f6'
                      return <Cell key={i} fill={fill} />
                    })}
                    <LabelList
                      dataKey="chart_return"
                      content={({ x, y, width, height, value }) => {
                        if (value == null) return null
                        const v = Number(value)
                        const isNeg = v < 0
                        // 음수 바: x가 바의 왼쪽 끝, x+width가 0선
                        // 양수 바: x가 0선, x+width가 바의 오른쪽 끝
                        const lx = isNeg
                          ? Math.max(x - 4, 2)   // 음수: 바 왼쪽 바깥, 최소 2px 확보
                          : x + Math.abs(width) + 4  // 양수: 바 오른쪽 바깥
                        const anchor = isNeg ? 'end' : 'start'
                        return (
                          <text x={lx} y={y + height / 2}
                            dominantBaseline="middle" textAnchor={anchor}
                            fontSize={11} fill={isNeg ? '#dc2626' : '#374151'}>
                            {v >= 0 ? '+' : ''}{v.toFixed(1)}%
                          </text>
                        )
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          })()}
        </div>
      )}

      {/* 자산별 수익률 테이블 */}
      <div className="card p-0 overflow-auto">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">자산별 수익률 상세</h3>
          <p className="text-xs text-gray-400 mt-0.5">입금액 미입력 자산은 수익률 계산 불가 — 자산 관리에서 입금액을 입력해 주세요</p>
        </div>
        <table>
          <thead><tr>
            <th>계좌</th>
            <th>자산명</th>
            <th>유형</th>
            <th className="text-right">입금액</th>
            <th className="text-right">현재 평가액</th>
            <th className="text-right">손익</th>
            <th className="text-right">총 수익률</th>
            <th className="text-right">연환산 수익률</th>
            <th className="text-right">보유 기간</th>
            <th>매입일</th>
          </tr></thead>
          <tbody>
            {assets.map(a => {
              const pnl = a.investment_amount
                ? (a.current_value - a.investment_amount)
                : null
              return (
                <tr key={a.id}>
                  <td className="text-gray-600 text-xs">{a.account_name}</td>
                  <td className="font-medium text-gray-800">{a.asset_name}</td>
                  <td><span className="badge-gray text-xs">{ASSET_TYPE_LABEL[a.asset_type] || a.asset_type}</span></td>
                  <td className="text-right text-blue-600">
                    {a.investment_amount ? fmt.won(a.investment_amount) : <span className="text-gray-300">미입력</span>}
                  </td>
                  <td className="text-right font-medium">{fmt.won(a.current_value)}</td>
                  <td className={`text-right font-medium ${pnl == null ? '' : pnl >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                    {pnl == null ? '-' : `${pnl >= 0 ? '+' : ''}${fmt.won(Math.abs(pnl))}`}
                  </td>
                  <td className="text-right"><ReturnBadge value={a.total_return} /></td>
                  <td className="text-right">
                    <AnnualReturnCell
                      annualReturn={a.annual_return}
                      totalReturn={a.total_return}
                      underOneYear={a.under_one_year}
                      holdingDays={a.holding_days}
                    />
                  </td>
                  <td className="text-right text-xs text-gray-500">
                    {a.holding_days != null ? `${a.holding_days}일` : '-'}
                  </td>
                  <td className="text-xs text-gray-400">{fmt.date(a.purchase_date)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 수익률 계산기 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">💡 수익률 계산기</h3>
        <ReturnCalc
          initNominal={initNominal}
          initInflation={initInflation}
          returnSource={calcReturnSource}
        />
      </div>

      {/* 연간 수익률 섹션 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">📅 연간 실제 수익률 (스냅샷 기반)</h3>
        {annualData.length === 0 ? (
          <div className="text-sm text-gray-400 py-4 text-center">
            <p>아직 데이터가 부족합니다.</p>
            <p className="mt-1 text-xs">대시보드를 매월 방문하면 스냅샷이 쌓이고, 내년 1월부터 2025년 수익률을 확인할 수 있습니다.</p>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={annualData} margin={{ top: 10, right: 30, bottom: 0, left: 0 }}>
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis unit="%" tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`} />
                <ReferenceLine y={0} stroke="#9ca3af" />
                <Bar dataKey="return_rate" radius={[4, 4, 0, 0]}>
                  {annualData.map((d, i) => (
                    <Cell key={i} fill={d.return_rate >= 0 ? '#3b82f6' : '#ef4444'} />
                  ))}
                  <LabelList dataKey="return_rate"
                    position="top"
                    formatter={v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                    style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="mt-3">
              <thead><tr>
                <th>연도</th>
                <th className="text-right">연초 자산</th>
                <th className="text-right">연말 자산</th>
                <th className="text-right">연간 인출액</th>
                <th className="text-right">연간 수익률</th>
              </tr></thead>
              <tbody>
                {annualData.map(d => (
                  <tr key={d.year}>
                    <td className="font-semibold">{d.year}년</td>
                    <td className="text-right">{fmt.eok(d.start_value)}</td>
                    <td className="text-right">{fmt.eok(d.end_value)}</td>
                    <td className="text-right text-gray-500">{fmt.won(d.withdrawals)}</td>
                    <td className="text-right">
                      <ReturnBadge value={d.return_rate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
