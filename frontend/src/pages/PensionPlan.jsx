import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import api, { fmt } from '../api/client.js'

// ── 추이 계산 ────────────────────────────────────────────────────
function calcProjections(config, initialBalance, returnRate) {
  const birthYear   = config.user.birth_year
  const baseMonthly = config.user.monthly_expense
  const inflation   = config.inflation?.assumed_rate ?? 0.025

  const pensionRaw       = config.income?.national_pension ?? {}
  const pensionStartStr  = typeof pensionRaw === 'object' ? pensionRaw.start_date : null
  const pensionStartYear = pensionStartStr ? parseInt(pensionStartStr.split('-')[0]) : 9999
  const pensionBase      = typeof pensionRaw === 'object' ? (pensionRaw.base_amount ?? 0) : 0

  const currentYear = new Date().getFullYear()
  const endYear     = birthYear + 95

  let balance = initialBalance
  const rows  = []

  for (let year = currentYear; year <= endYear; year++) {
    const age         = year - birthYear
    const yearsFromNow = year - currentYear

    // ── 월 생활비 (물가 상승 + 나이별 감액) ──
    let monthlyExpense
    if (age < 70) {
      monthlyExpense = baseMonthly * (1 + inflation) ** yearsFromNow
    } else if (age < 80) {
      // 70세: 현재 생활비 × 0.9 기준, 이후 물가 반영
      monthlyExpense = baseMonthly * 0.9 * (1 + inflation) ** (age - 70)
    } else {
      // 80세: 79세 생활비 × 0.9 기준, 이후 물가 반영
      const expense79 = baseMonthly * 0.9 * (1 + inflation) ** 9   // 70세 기준 + 9년
      monthlyExpense  = expense79 * 0.9 * (1 + inflation) ** (age - 80)
    }

    // ── 국민연금 (오늘 금액 기준 → 개시년도까지 물가 반영 후, 이후 매년 물가 연동) ──
    // base_amount는 현재(입력 시점) 가격 기준이므로 개시까지의 기간만큼 먼저 인플레 적용
    let pensionMonthly = 0
    if (year >= pensionStartYear) {
      const yearsToStart      = Math.max(0, pensionStartYear - currentYear)
      const effectivePensionBase = pensionBase * (1 + inflation) ** yearsToStart
      pensionMonthly = effectivePensionBase * (1 + inflation) ** (year - pensionStartYear)
    }

    const annualExpense    = monthlyExpense * 12
    const annualPension    = pensionMonthly * 12
    const annualWithdrawal = Math.max(0, annualExpense - annualPension)

    // ── 포트폴리오: 연초 잔액 기준 수익 후 인출 ──
    const balanceStart = balance
    balance = Math.max(0, balanceStart * (1 + returnRate) - annualWithdrawal)

    let note = ''
    if (year === pensionStartYear) note = '🏛 국민연금 수령 시작'
    else if (age === 70)           note = '📉 생활비 10% 감액'
    else if (age === 80)           note = '📉 생활비 추가 10% 감액'

    rows.push({
      year, age, note,
      monthlyExpense:    Math.round(monthlyExpense),
      pensionMonthly:    Math.round(pensionMonthly),
      monthlyWithdrawal: Math.round(annualWithdrawal / 12),
      annualWithdrawal:  Math.round(annualWithdrawal),
      portfolioBalance:  Math.round(balanceStart),
    })
  }
  return rows
}

// ── 툴팁 ────────────────────────────────────────────────────────
function FlowTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs min-w-[180px]">
      <div className="font-bold text-gray-700 mb-2">{label}년</div>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-4 py-0.5" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-semibold">{Number(p.value).toLocaleString()}만원</span>
        </div>
      ))}
    </div>
  )
}

function BalTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs">
      <div className="font-bold text-gray-700 mb-1">{label}년</div>
      <div style={{ color: '#3b82f6' }}>
        포트폴리오 잔액: <span className="font-semibold">{payload[0].value}억원</span>
      </div>
    </div>
  )
}

// ── 메인 ────────────────────────────────────────────────────────
export default function PensionPlan() {
  const [returnRate, setReturnRate] = useState(4)
  const [returnSource, setReturnSource] = useState('default') // 'actual' | 'estimated' | 'default' | 'manual'

  const { data: dash, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
  })

  // 실제 포트폴리오 수익률 조회
  const { data: returnsData } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.get('/returns/assets').then(r => r.data),
    enabled: !isLoading,
  })

  // 수익률 데이터가 로드되면 자동 반영 (최초 1회)
  useEffect(() => {
    if (returnsData && returnSource === 'default') {
      const actual    = returnsData.portfolio_annual_return
      const estimated = dash?.estimated_return_rate
      if (actual !== null && actual !== undefined) {
        setReturnRate(Math.round(actual * 10) / 10)
        setReturnSource('actual')
      } else if (estimated !== null && estimated !== undefined) {
        setReturnRate(Math.round(estimated * 10) / 10)
        setReturnSource('estimated')
      }
    }
  }, [returnsData, dash, returnSource])

  const rows = useMemo(() => {
    if (!dash) return []
    return calcProjections(dash.config, dash.buckets.total, returnRate / 100)
  }, [dash, returnRate])

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  if (error)     return <div className="text-red-500 p-4">오류: {error.message}</div>

  const { config, buckets } = dash
  const currentYear  = new Date().getFullYear()
  const birthYear    = config.user.birth_year
  const currentAge   = currentYear - birthYear
  const inflation    = config.inflation?.assumed_rate ?? 0.025

  // 출처 뱃지 설정
  const srcMeta = {
    actual:    { label: '실현 수익률',   bg: 'bg-blue-600',  text: '포트폴리오 실제 연환산 수익률 자동 반영' },
    estimated: { label: '기대 수익률',   bg: 'bg-gray-400',  text: '자산 배분 기반 기대수익률 자동 반영'    },
    manual:    { label: '수동 입력',     bg: 'bg-orange-400',text: '직접 입력한 수익률'                     },
    default:   { label: '기본값',        bg: 'bg-gray-300',  text: '기본값 4%'                             },
  }
  const src = srcMeta[returnSource] || srcMeta.default

  // 자동값으로 되돌리기
  const resetToAuto = () => {
    const actual    = returnsData?.portfolio_annual_return
    const estimated = dash?.estimated_return_rate
    if (actual !== null && actual !== undefined) {
      setReturnRate(Math.round(actual * 10) / 10)
      setReturnSource('actual')
    } else if (estimated !== null && estimated !== undefined) {
      setReturnRate(Math.round(estimated * 10) / 10)
      setReturnSource('estimated')
    }
  }

  const pensionRaw       = config.income?.national_pension ?? {}
  const pensionStartStr  = typeof pensionRaw === 'object' ? pensionRaw.start_date : ''
  const pensionStartYear = pensionStartStr ? parseInt(pensionStartStr.split('-')[0]) : 9999
  const yearsToP         = pensionStartYear - currentYear

  const age70year = birthYear + 70
  const age80year = birthYear + 80

  const exhaustRow = rows.find(r => r.portfolioBalance === 0)
  const lastRow    = rows[rows.length - 1]

  // 차트 데이터 (만원 / 억원 단위)
  const chartData = rows.map(r => ({
    year:       r.year,
    expense:    Math.round(r.monthlyExpense / 10000),
    pension:    Math.round(r.pensionMonthly / 10000),
    withdrawal: Math.round(r.monthlyWithdrawal / 10000),
    balance:    +(r.portfolioBalance / 1e8).toFixed(1),
  }))

  const refLines = [
    { x: pensionStartYear, color: '#16a34a', label: '연금시작' },
    { x: age70year,        color: '#d97706', label: '70세'    },
    { x: age80year,        color: '#ea580c', label: '80세'    },
  ]

  return (
    <div className="space-y-5">

      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-800">📊 연금 계획</h1>

        {/* 수익률 입력 + 출처 뱃지 */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
            <span className="text-gray-500">포트폴리오 연 수익률 가정</span>
            {/* 출처 뱃지 */}
            <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded ${src.bg}`}>
              {src.label}
            </span>
            <input
              type="number" min={-20} max={20} step={0.1}
              value={returnRate}
              onChange={e => {
                setReturnRate(Math.max(-20, Math.min(20, +e.target.value)))
                setReturnSource('manual')
              }}
              className="w-16 text-center border border-gray-300 rounded px-1 py-0.5 font-semibold"
            />
            <span className="text-gray-500 font-medium">%</span>
            {/* 수동 입력 시 자동값 복원 버튼 */}
            {returnSource === 'manual' && (
              <button
                onClick={resetToAuto}
                className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-300 rounded px-1.5 py-0.5 ml-1">
                ↺ 자동
              </button>
            )}
          </div>
          {/* 출처 설명 */}
          <p className="text-[11px] text-gray-400">{src.text}</p>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '현재 나이',       value: `${currentAge}세`,          sub: `${currentYear}년생 ${birthYear}년`,      icon: '👤', color: 'border-blue-500'  },
          { label: '국민연금까지',    value: yearsToP > 0 ? `${yearsToP}년 후` : '수령 중',  sub: `${pensionStartYear}년 개시`,  icon: '🏛', color: 'border-green-500' },
          { label: '현재 포트폴리오', value: fmt.eok(buckets.total),     sub: '총 자산',                                 icon: '💼', color: 'border-blue-500'  },
          exhaustRow
            ? { label: '포트폴리오 소진',  value: `${exhaustRow.year}년 (${exhaustRow.age}세)`, sub: '⚠️ 추가 수입원 필요', icon: '🚨', color: 'border-red-500' }
            : { label: '95세 잔액',        value: fmt.eok(lastRow.portfolioBalance), sub: '✅ 95세까지 유지',             icon: '✅', color: 'border-green-500' },
        ].map(({ label, value, sub, icon, color }) => (
          <div key={label} className={`card border-l-4 ${color}`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-gray-500 font-medium">{label}</p>
                <p className="text-lg font-bold text-gray-800 mt-0.5">{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
              </div>
              <span className="text-2xl opacity-50">{icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 월 현금흐름 차트 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">월 현금흐름 추이</h3>
        <p className="text-xs text-gray-400 mb-4">
          물가상승률 {(inflation * 100).toFixed(1)}% 반영 &nbsp;·&nbsp;
          70세 생활비 10% 감액 &nbsp;·&nbsp;
          80세 생활비 추가 10% 감액 &nbsp;·&nbsp;
          국민연금 물가연동
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} interval={4} />
            <YAxis unit="만" tick={{ fontSize: 11 }} tickFormatter={v => v.toLocaleString()} width={60} />
            <Tooltip content={<FlowTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            {refLines.map(({ x, color, label }) => (
              <ReferenceLine key={x} x={x} stroke={color} strokeDasharray="5 3"
                label={{ value: label, position: 'insideTopLeft', fontSize: 9, fill: color, dy: -10 }} />
            ))}
            <Line type="monotone" dataKey="expense"    name="월 생활비"       stroke="#ef4444" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="pension"    name="국민연금 수입"   stroke="#22c55e" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="withdrawal" name="포트폴리오 인출" stroke="#f97316" strokeWidth={2} strokeDasharray="6 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500 border-t pt-2">
          <span>🟥 생활비 = 포트폴리오에서 써야 할 전체 비용</span>
          <span>🟩 연금 수입 = 국민연금으로 충당되는 금액</span>
          <span>🟧 포트폴리오 인출 = 생활비 – 연금 (실제로 빼는 금액)</span>
        </div>
      </div>

      {/* 포트폴리오 잔액 차트 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">포트폴리오 잔액 추이</h3>
        <p className="text-xs text-gray-400 mb-4">연 수익률 {returnRate}% 가정 · 매년 인출 후 잔액</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 15 }}>
            <defs>
              <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} interval={4} />
            <YAxis unit="억" tick={{ fontSize: 11 }} width={45} />
            <Tooltip content={<BalTooltip />} />
            {refLines.map(({ x, color }) => (
              <ReferenceLine key={x} x={x} stroke={color} strokeDasharray="5 3" />
            ))}
            {exhaustRow && (
              <ReferenceLine x={exhaustRow.year} stroke="#dc2626" strokeWidth={2}
                label={{ value: '소진', position: 'top', fontSize: 10, fill: '#dc2626' }} />
            )}
            <Area type="monotone" dataKey="balance" name="포트폴리오 잔액"
              stroke="#3b82f6" fill="url(#balGrad)" strokeWidth={2.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 연도별 상세 표 */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">📋 연도별 상세 계획</h3>
        <table className="text-xs w-full whitespace-nowrap">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="text-left py-2 px-3 font-semibold">연도</th>
              <th className="text-center py-2 px-3 font-semibold">나이</th>
              <th className="text-right py-2 px-3 font-semibold">월 생활비</th>
              <th className="text-right py-2 px-3 font-semibold">국민연금/월</th>
              <th className="text-right py-2 px-3 font-semibold">포트폴리오 인출/월</th>
              <th className="text-right py-2 px-3 font-semibold">포트폴리오 잔액</th>
              <th className="text-center py-2 px-3 font-semibold">비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isEvent    = !!r.note
              const isLow      = r.portfolioBalance > 0 && r.portfolioBalance < 2e8
              const isDepleted = r.portfolioBalance === 0 && r.age > currentAge

              return (
                <tr key={r.year}
                  className={`border-t border-gray-100 transition-colors
                    ${isDepleted ? 'bg-red-50' : isLow ? 'bg-orange-50' : isEvent ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                  <td className="py-2 px-3 font-semibold text-gray-800">{r.year}</td>
                  <td className="py-2 px-3 text-center text-gray-500">{r.age}세</td>
                  <td className="py-2 px-3 text-right">{fmt.won(r.monthlyExpense)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${r.pensionMonthly > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                    {r.pensionMonthly > 0 ? fmt.won(r.pensionMonthly) : '—'}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${r.monthlyWithdrawal === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                    {r.monthlyWithdrawal === 0 ? '연금으로 충당' : fmt.won(r.monthlyWithdrawal)}
                  </td>
                  <td className={`py-2 px-3 text-right font-semibold
                    ${isDepleted ? 'text-red-600' : isLow ? 'text-orange-500' : 'text-gray-800'}`}>
                    {fmt.eok(r.portfolioBalance)}
                  </td>
                  <td className="py-2 px-3 text-center">{r.note || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

    </div>
  )
}
