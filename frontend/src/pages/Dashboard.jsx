import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api, { fmt, LEVEL_COLOR } from '../api/client.js'

const ASSET_TYPE_KO = {
  cash: '현금성', bond: '채권', tdf: 'TDF',
  fund: '펀드', equity: '주식형', income: '리츠/인컴',
}

// ── 알림 목록 생성 ────────────────────────────────────────────────
function buildAlerts(data, nominalReturn) {
  const alerts = []
  const {
    risk, emergency_liquidity, maturing_60d,
    bucket_deviations, withdrawal_rate, config,
  } = data
  const inflation = (config?.inflation?.assumed_rate ?? 0.025) * 100

  // 만기 30일 이내 → 🔴
  ;(maturing_60d || []).filter(a => a.days_left <= 30).forEach(a =>
    alerts.push({
      level:  'red',
      icon:   '📅',
      title:  `만기 D-${a.days_left} · ${a.asset_name}`,
      detail: `${Math.round(a.current_value / 10000).toLocaleString()}만원 · ${a.maturity_date} · 즉시 재배분 결정 필요`,
      link:   '/maturity-guide',
    })
  )

  // 만기 31-60일 → 🟡
  ;(maturing_60d || []).filter(a => a.days_left > 30).forEach(a =>
    alerts.push({
      level:  'yellow',
      icon:   '📅',
      title:  `만기 D-${a.days_left} · ${a.asset_name}`,
      detail: `${Math.round(a.current_value / 10000).toLocaleString()}만원 · ${a.maturity_date} · 재배분 계획 수립 권장`,
      link:   '/maturity-guide',
    })
  )

  // 인출률
  const wr = withdrawal_rate ?? 0
  if (wr > 5)
    alerts.push({ level: 'red',    icon: '💸', title: `인출률 ${wr.toFixed(1)}% — 위험 수준`,
      detail: '4% 안전 기준의 1.25배 초과. 지출 즉시 조정 필요', link: '/withdrawal' })
  else if (wr > 4)
    alerts.push({ level: 'yellow', icon: '💸', title: `인출률 ${wr.toFixed(1)}% — 주의`,
      detail: '4% 안전 기준 초과. 지출 패턴 점검 권장', link: '/withdrawal' })

  // 비상자금
  const em = emergency_liquidity?.months ?? 0
  if (em < 6)
    alerts.push({ level: 'red',    icon: '🛡️', title: `비상자금 ${em}개월 — 부족`,
      detail: `권장 6개월 미만 (${fmt.won(emergency_liquidity?.cash_amount)}). B1 현금성 보충 필요`, link: '/rebalance' })
  else if (em < 12)
    alerts.push({ level: 'yellow', icon: '🛡️', title: `비상자금 ${em}개월 — 점검 권장`,
      detail: '권장 기준 12개월 대비 부족. 추가 적립 검토', link: '/rebalance' })

  // 리밸런싱 편차
  const devs   = bucket_deviations ?? {}
  const maxDev = Math.max(0, ...Object.values(devs).map(Math.abs))
  if (maxDev >= 10)
    alerts.push({ level: 'yellow', icon: '⚖️',
      title:  `리밸런싱 필요 — 최대 편차 ${maxDev.toFixed(1)}%p`,
      detail: '목표 배분 대비 10%p 이상 이탈. 리밸런싱 실행 권장', link: '/rebalance' })

  // 위험점수
  if (risk?.level === 'red')
    alerts.push({ level: 'red',    icon: '⚠️', title: `위험점수 ${risk.total_score}점 — 위험 구간 진입`,
      detail: '종합 위험 점수 위험 수준(56점+). 포트폴리오 조정 필요', link: '/risk' })
  else if (risk?.level === 'yellow' && (risk?.total_score ?? 0) >= 40)
    alerts.push({ level: 'yellow', icon: '⚠️', title: `위험점수 ${risk.total_score}점 — 주의`,
      detail: '위험 점수 40점 이상. 자산 배분 재검토 권장', link: '/risk' })

  // 세후 실질수익률 마이너스
  const realAfterTax = nominalReturn - 0.5 - inflation
  if (realAfterTax < 0)
    alerts.push({ level: 'yellow', icon: '📉',
      title:  `세후 실질수익률 ${realAfterTax.toFixed(1)}% — 자산 실질 감소`,
      detail: '물가·세금 차감 후 마이너스. 포트폴리오 수익성 점검 필요', link: '/returns' })

  // 🔴 먼저 정렬
  return alerts.sort((a, b) => {
    const ord = { red: 0, yellow: 1 }
    return (ord[a.level] ?? 9) - (ord[b.level] ?? 9)
  })
}

// ── 자산배분 편차 행 ──────────────────────────────────────────────
function DeviationRow({ label, currentRatio, targetRatio }) {
  const dev = Math.round((currentRatio - targetRatio) * 1000) / 10
  const abs = Math.abs(dev)
  const sev = abs >= 10 ? 'red' : abs >= 5 ? 'yellow' : 'green'
  const C = {
    red:    { bar: 'bg-red-400',    badge: 'bg-red-100 text-red-700' },
    yellow: { bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700' },
    green:  { bar: 'bg-green-400',  badge: 'bg-green-100 text-green-700' },
  }[sev]

  const barW = Math.min(Math.round(currentRatio * 100), 100)
  const tgtW = Math.min(Math.round(targetRatio  * 100), 100)

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs text-gray-600 w-16 flex-shrink-0">{label}</span>
      {/* 막대 영역 */}
      <div className="flex-1 relative h-3">
        <div className="absolute inset-0 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${C.bar} opacity-75 transition-all`}
               style={{ width: `${barW}%` }} />
        </div>
        {/* 목표 위치 마커 */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-gray-500 z-10 rounded"
             style={{ left: `${tgtW}%` }} />
      </div>
      {/* 수치 */}
      <div className="flex items-center gap-1.5 flex-shrink-0 w-36 justify-end">
        <span className="text-[11px] text-gray-500">
          {(currentRatio * 100).toFixed(0)}% / {(targetRatio * 100).toFixed(0)}%
        </span>
        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${C.badge}`}>
          {dev >= 0 ? '+' : ''}{dev.toFixed(1)}%p
        </span>
      </div>
    </div>
  )
}

// ── 비상 유동성 카드 ──────────────────────────────────────────────
function LiquidityCard({ liquidity }) {
  const months         = liquidity?.months ?? null
  const cashTotal      = liquidity?.cash_total      ?? 0
  const monthlyExpenses = liquidity?.monthly_expenses ?? 0

  const pct = months != null ? Math.min(Math.round((months / 12) * 100), 100) : 0

  const status =
    months == null  ? { label: '계산 불가', badge: 'bg-gray-100 text-gray-500',    border: 'border-gray-400',  bar: 'bg-gray-300',   text: 'text-gray-500' }
    : months >= 12  ? { label: '안전',      badge: 'bg-green-100 text-green-700',  border: 'border-green-500', bar: 'bg-green-400',  text: 'text-green-600' }
    : months >= 6   ? { label: '주의',      badge: 'bg-yellow-100 text-yellow-700',border: 'border-yellow-400',bar: 'bg-yellow-400', text: 'text-yellow-600' }
                    : { label: '위험',      badge: 'bg-red-100 text-red-700',      border: 'border-red-500',   bar: 'bg-red-400',    text: 'text-red-600' }

  return (
    <div className={`card border-l-4 ${status.border}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">💧 비상 유동성 비율</h3>
        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${status.badge}`}>
          {status.label}
        </span>
      </div>

      {/* 대형 개월 수 */}
      <div className="flex items-end gap-2 mb-4">
        <span className={`text-5xl font-bold leading-none ${status.text}`}>
          {months != null ? months.toFixed(1) : '—'}
        </span>
        <div className="mb-1 leading-tight">
          <div className="text-lg text-gray-600 font-medium">개월</div>
          <div className="text-[11px] text-gray-400">/ 권장 12개월</div>
        </div>
      </div>

      {/* 프로그레스바 */}
      <div className="mb-4">
        <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${status.bar} transition-all duration-500`}
               style={{ width: `${pct}%` }} />
          {/* 6개월(50%) · 12개월(100%) 마커 */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10 opacity-60"
               style={{ left: '50%' }} />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-0.5">
          <span>0</span>
          <span>6개월</span>
          <span>12개월</span>
        </div>
      </div>

      {/* 현금성 자산 / 월 생활비 상세 */}
      <div className="space-y-2 text-xs border-t border-gray-100 pt-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-500">현금성 자산 합계</span>
          <span className="font-semibold text-gray-800">
            {Math.round(cashTotal / 10000).toLocaleString()}만원
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-500">월 생활비</span>
          <span className="font-semibold text-gray-800">
            {Math.round(monthlyExpenses / 10000).toLocaleString()}만원
          </span>
        </div>
      </div>
    </div>
  )
}

// ── KPI 카드 ──────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, borderColor, onClick }) {
  return (
    <div onClick={onClick}
      className={`card border-l-4 ${borderColor} p-3 cursor-pointer
                  hover:shadow-md transition-shadow select-none`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-gray-500 font-medium leading-tight">{label}</span>
        <span className="text-lg">{icon}</span>
      </div>
      <div className="text-xl font-bold text-gray-800 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  )
}

// ── 메인 대시보드 ─────────────────────────────────────────────────
export default function Dashboard() {
  const qc  = useQueryClient()
  const nav = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn:  () => api.get('/dashboard').then(r => r.data),
  })

  const { data: returnsData } = useQuery({
    queryKey: ['returns'],
    queryFn:  () => api.get('/returns/assets').then(r => r.data),
    staleTime: 5 * 60 * 1000,
    enabled:  !!data,
  })

  const { data: cfData } = useQuery({
    queryKey: ['cashflow'],
    queryFn:  () => api.get('/cashflow/monthly').then(r => r.data),
    staleTime: 5 * 60 * 1000,
    enabled:  !!data,
  })

  const genSummary = useMutation({
    mutationFn: () => api.post('/summary/generate'),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  )
  if (error) return (
    <div className="text-red-500 p-4">오류: {error.message}</div>
  )

  const {
    config, buckets, risk, ai_summary, pension,
    recommended_withdrawal, emergency_liquidity,
    estimated_return_rate, withdrawal_rate,
    bucket_deviations, maturing_60d, liquidity,
  } = data

  const name      = config?.user?.name          || '종헌'
  const monthly   = config?.user?.monthly_expense || 5000000
  const targets   = config?.portfolio            || {}
  const inflation = (config?.inflation?.assumed_rate ?? 0.025) * 100

  // 수익률
  const nominalReturn = returnsData?.portfolio_annual_return != null
    ? Math.round(returnsData.portfolio_annual_return * 10) / 10
    : (estimated_return_rate ?? 7.0)
  const returnSource  = returnsData?.portfolio_annual_return != null ? 'actual' : 'estimated'
  const realAfterTax  = nominalReturn - 0.5 - inflation

  // 날짜
  const today   = new Date()
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`

  // 알림 목록
  const alerts      = buildAlerts(data, nominalReturn)
  const redCount    = alerts.filter(a => a.level === 'red').length
  const yellowCount = alerts.filter(a => a.level === 'yellow').length

  // 이번달 현금흐름
  const thisMonth = cfData?.months?.find(m => m.is_current)

  // 버킷 타겟
  const tgtCash   = targets.target_cash   ?? 0.25
  const tgtBond   = targets.target_bond   ?? 0.25
  const tgtEquity = targets.target_equity ?? 0.35
  const tgtIncome = targets.target_income ?? 0.15

  // KPI 색상
  const wr = withdrawal_rate ?? 0
  const wrBorder = wr > 5 ? 'border-red-500' : wr > 4 ? 'border-yellow-400' : 'border-green-500'
  const wrText   = wr > 5 ? 'text-red-600'   : wr > 4 ? 'text-yellow-600'   : 'text-green-600'

  const em = emergency_liquidity?.months ?? 0
  const emBorder = em < 6  ? 'border-red-500' : em < 12  ? 'border-yellow-400' : 'border-green-500'
  const emText   = em < 6  ? 'text-red-600'   : em < 12  ? 'text-yellow-600'   : 'text-green-600'

  const riskBorder = risk?.level === 'red'    ? 'border-red-500'
                   : risk?.level === 'yellow' ? 'border-yellow-400' : 'border-green-500'
  const riskText   = risk?.level === 'red'    ? 'text-red-600'
                   : risk?.level === 'yellow' ? 'text-yellow-600'   : 'text-green-600'

  const realBorder = realAfterTax < 0 ? 'border-red-500'
                   : realAfterTax < 2 ? 'border-yellow-400' : 'border-green-500'
  const realText   = realAfterTax < 0 ? 'text-red-600'
                   : realAfterTax < 2 ? 'text-yellow-600'   : 'text-green-600'

  // ── 렌더 ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ─── 헤더 ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl
                      px-4 md:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">🏦 은퇴 포트폴리오 대시보드</h1>
          <p className="text-blue-200 text-sm mt-0.5">
            {name}님 · {dateStr}
            {pension.income > 0
              ? ` · 국민연금 ${Math.round(pension.income / 10000).toLocaleString()}만원 수령 중`
              : ` · 국민연금 개시까지 D-${pension.months_to_start}개월`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {redCount > 0 && (
            <span className="bg-red-500 text-white text-sm font-bold px-3 py-1.5 rounded-full">
              🔴 즉시 조치 {redCount}건
            </span>
          )}
          {yellowCount > 0 && (
            <span className="bg-yellow-400 text-gray-900 text-sm font-bold px-3 py-1.5 rounded-full">
              🟡 점검 필요 {yellowCount}건
            </span>
          )}
          {alerts.length === 0 && (
            <span className="bg-green-500 text-white text-sm font-bold px-3 py-1.5 rounded-full">
              ✅ 모든 지표 정상
            </span>
          )}
        </div>
      </div>

      {/* ─── Zone 1: 액션 알림 ─────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-700">🚨 지금 대응해야 할 항목</h3>
          <span className="text-xs text-gray-400">{alerts.length}건</span>
        </div>

        {alerts.length === 0 ? (
          <div className="px-5 py-6 flex items-center gap-3">
            <span className="text-3xl">✅</span>
            <div>
              <p className="font-semibold text-green-700">현재 대응 필요 항목이 없습니다</p>
              <p className="text-xs text-gray-400 mt-0.5">모든 지표가 안전 범위 내에 있습니다</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {alerts.map((alert, i) => {
              const L = alert.level === 'red'
                ? { border: 'border-red-400',    hover: 'hover:bg-red-50',    badge: 'bg-red-100 text-red-700',    label: '즉시 조치' }
                : { border: 'border-yellow-400', hover: 'hover:bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700', label: '점검 필요' }
              return (
                <div key={i}
                  onClick={() => nav(alert.link)}
                  className={`flex items-center gap-4 px-5 py-3.5 border-l-4
                               ${L.border} ${L.hover} cursor-pointer transition-colors`}>
                  <span className="text-xl flex-shrink-0">{alert.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{alert.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{alert.detail}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${L.badge}`}>
                      {L.label}
                    </span>
                    <span className="text-gray-400 text-sm">→</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Zone 2: KPI 6개 ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">

        {/* 총 자산 */}
        <KpiCard
          icon="💰" label="총 자산"
          value={fmt.eok(buckets.total)}
          sub={`B1 ${(buckets.b1 / 1e8).toFixed(1)}억 · B2 ${(buckets.b2 / 1e8).toFixed(1)}억 · B3 ${(buckets.b3 / 1e8).toFixed(1)}억`}
          borderColor="border-blue-500"
          onClick={() => nav('/networth')}
        />

        {/* 인출률 */}
        <div className={`card border-l-4 ${wrBorder} p-3 cursor-pointer hover:shadow-md transition-shadow`}
             onClick={() => nav('/withdrawal')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-gray-500 font-medium">인출률 (연)</span>
            <span className="text-lg">💸</span>
          </div>
          <div className={`text-xl font-bold ${wrText}`}>{wr.toFixed(1)}%</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {wr <= 4 ? '✅ 4% 기준 이하' : wr <= 5 ? '⚠️ 4% 기준 초과' : '🔴 위험 수준'}
          </div>
        </div>

        {/* 비상자금 */}
        <div className={`card border-l-4 ${emBorder} p-3 cursor-pointer hover:shadow-md transition-shadow`}
             onClick={() => nav('/rebalance')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-gray-500 font-medium">비상자금</span>
            <span className="text-lg">🛡️</span>
          </div>
          <div className={`text-xl font-bold ${emText}`}>{em}개월</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {em >= 12 ? '✅ 충분' : em >= 6 ? '⚠️ 양호 (권장 12M)' : '🔴 부족 (권장 6M+)'}
          </div>
        </div>

        {/* 세후 실질수익률 */}
        <div className={`card border-l-4 ${realBorder} p-3 cursor-pointer hover:shadow-md transition-shadow`}
             onClick={() => nav('/returns')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-gray-500 font-medium">세후 실질수익률</span>
            <span className="text-lg">📈</span>
          </div>
          <div className={`text-xl font-bold ${realText}`}>
            {realAfterTax >= 0 ? '+' : ''}{realAfterTax.toFixed(1)}%
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            명목 {nominalReturn.toFixed(1)}% · {returnSource === 'actual' ? '실현' : '기대'}
          </div>
        </div>

        {/* 위험점수 */}
        <div className={`card border-l-4 ${riskBorder} p-3 cursor-pointer hover:shadow-md transition-shadow`}
             onClick={() => nav('/risk')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-gray-500 font-medium">위험점수</span>
            <span className="text-lg">⚠️</span>
          </div>
          <div className={`text-xl font-bold ${riskText}`}>{risk?.total_score ?? 0}점</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {LEVEL_COLOR[risk?.level]?.label ?? '🟢 안전'} · /100점
          </div>
        </div>

        {/* 국민연금 */}
        <div className="card border-l-4 border-purple-500 p-3 cursor-pointer hover:shadow-md transition-shadow"
             onClick={() => nav('/pension-plan')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-gray-500 font-medium">국민연금</span>
            <span className="text-lg">🏛</span>
          </div>
          {pension.income > 0 ? (
            <>
              <div className="text-xl font-bold text-purple-600">
                {Math.round(pension.income / 10000).toLocaleString()}만원
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">월 수령 중</div>
            </>
          ) : (
            <>
              <div className="text-xl font-bold text-purple-600">
                D-{pension.months_to_start}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                {pension.start_date} 개시
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Zone 3: 3개 패널 ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* 패널 1: 자산배분 편차 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">📐 자산배분 편차</h3>
            <button onClick={() => nav('/rebalance')}
              className="text-[11px] text-blue-500 hover:text-blue-700">
              리밸런싱 →
            </button>
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mb-1 px-1">
            <span>항목</span>
            <span>현재% / 목표%&nbsp;&nbsp;편차</span>
          </div>
          <DeviationRow label="현금성"    currentRatio={buckets.cash_ratio}   targetRatio={tgtCash} />
          <DeviationRow label="채권/TDF"  currentRatio={buckets.bond_ratio}   targetRatio={tgtBond} />
          <DeviationRow label="주식형"    currentRatio={buckets.equity_ratio} targetRatio={tgtEquity} />
          <DeviationRow label="리츠/인컴" currentRatio={buckets.income_ratio} targetRatio={tgtIncome} />
          <div className="mt-3 text-[10px] text-gray-400 border-t border-gray-100 pt-2">
            세로선 = 목표 비중 ·{' '}
            <span className="text-green-600">■ 정상</span>{' '}
            <span className="text-yellow-600">■ ±5~10%p</span>{' '}
            <span className="text-red-600">■ ±10%p+</span>
          </div>
        </div>

        {/* 패널 2: 이번달 현금흐름 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">📅 이번달 현금흐름</h3>
            <button onClick={() => nav('/cashflow')}
              className="text-[11px] text-blue-500 hover:text-blue-700">
              상세 →
            </button>
          </div>

          {thisMonth ? (
            <div className="space-y-2.5">
              {/* 유입 */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">유입</p>
                {thisMonth.pension_income > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">🏛 국민연금</span>
                    <span className="font-semibold text-green-600">
                      +{Math.round(thisMonth.pension_income / 10000).toLocaleString()}만
                    </span>
                  </div>
                )}
                {thisMonth.maturity_count > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">📅 만기 자산 ({thisMonth.maturity_count}건)</span>
                    <span className="font-semibold text-green-600">
                      +{Math.round(thisMonth.maturity_total / 10000).toLocaleString()}만
                    </span>
                  </div>
                )}
                {thisMonth.pension_income === 0 && thisMonth.maturity_count === 0 && (
                  <div className="text-xs text-gray-400">수입 없음</div>
                )}
              </div>

              <div className="border-t border-gray-100" />

              {/* 지출 */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">지출</p>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">
                    💸 포트폴리오 인출 {thisMonth.has_actual ? '(실제)' : '(계획)'}
                  </span>
                  <span className="font-semibold text-red-500">
                    -{Math.round(thisMonth.display_withdrawal / 10000).toLocaleString()}만
                  </span>
                </div>
              </div>

              <div className="border-t border-gray-100" />

              {/* 순흐름 */}
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-700">순 현금흐름</span>
                <span className={`text-base font-bold ${
                  thisMonth.net_cashflow >= 0 ? 'text-blue-600' : 'text-orange-500'
                }`}>
                  {thisMonth.net_cashflow >= 0 ? '+' : ''}
                  {Math.round(thisMonth.net_cashflow / 10000).toLocaleString()}만원
                </span>
              </div>

              {/* 생활비 안내 */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-[11px] text-gray-500">
                월 생활비 {Math.round(monthly / 10000).toLocaleString()}만원 ·
                인출 {Math.round(thisMonth.display_withdrawal / 10000).toLocaleString()}만 +
                자기부담 {Math.max(0, Math.round((monthly - thisMonth.display_withdrawal) / 10000)).toLocaleString()}만
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 py-4 text-center">
              현금흐름 데이터 로딩 중...
            </div>
          )}
        </div>

        {/* 패널 3: 향후 60일 만기 자산 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">⏳ 향후 60일 만기 자산</h3>
            <button onClick={() => nav('/maturity-guide')}
              className="text-[11px] text-blue-500 hover:text-blue-700">
              재배분 가이드 →
            </button>
          </div>

          {(!maturing_60d || maturing_60d.length === 0) ? (
            <div className="py-6 text-center">
              <div className="text-3xl mb-2">✅</div>
              <p className="text-sm text-gray-500">60일 내 만기 자산 없음</p>
              <p className="text-xs text-gray-400 mt-1">별도 재배분 결정이 필요하지 않습니다</p>
            </div>
          ) : (
            <div className="space-y-2">
              {maturing_60d.map(a => {
                const urgent = a.days_left <= 30
                return (
                  <div key={a.id}
                    onClick={() => nav('/maturity-guide')}
                    className={`rounded-lg px-3 py-2.5 border cursor-pointer transition-colors ${
                      urgent
                        ? 'border-red-200 bg-red-50 hover:bg-red-100'
                        : 'border-yellow-200 bg-yellow-50 hover:bg-yellow-100'
                    }`}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">
                          {a.asset_name}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {a.account_name} · {ASSET_TYPE_KO[a.asset_type] || a.asset_type}
                        </p>
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                          urgent ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          D-{a.days_left}
                        </span>
                        <p className="text-xs font-semibold text-gray-700 mt-1">
                          {Math.round(a.current_value / 10000).toLocaleString()}만원
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">{a.maturity_date}</p>
                  </div>
                )
              })}

              {/* 합계 */}
              <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                <span className="text-xs text-gray-500">총 {maturing_60d.length}건</span>
                <span className="text-xs font-bold text-gray-700">
                  {Math.round(
                    maturing_60d.reduce((s, a) => s + a.current_value, 0) / 10000
                  ).toLocaleString()}만원
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Zone 4: 비상 유동성 비율 ─────────────────────────── */}
      <LiquidityCard liquidity={liquidity} />

      {/* ─── Zone 5: AI 요약 (접이식) ──────────────────────────── */}
      <div className="card border-l-4 border-blue-400">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-700">🤖 AI 포트폴리오 요약</h3>
            {ai_summary && (
              <span className="text-[11px] text-gray-400">{ai_summary.date} 기준</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => genSummary.mutate()}
              disabled={genSummary.isPending}
              className="text-xs text-blue-500 hover:text-blue-700 border border-blue-200
                         rounded-lg px-3 py-1 disabled:opacity-50">
              {genSummary.isPending ? '생성 중...' : '새로 생성'}
            </button>
            <button
              onClick={() => setAiOpen(v => !v)}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200
                         rounded-lg px-3 py-1">
              {aiOpen ? '접기 ▲' : '펼치기 ▼'}
            </button>
          </div>
        </div>

        {aiOpen && (
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
            {ai_summary ? (
              ai_summary.message.split('\n').filter(Boolean).map((line, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed">
                  <span className="font-semibold text-blue-600">{i + 1}.</span> {line}
                </p>
              ))
            ) : (
              <p className="text-sm text-gray-400">
                아직 AI 요약이 없습니다. "새로 생성" 버튼을 눌러주세요.
              </p>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
