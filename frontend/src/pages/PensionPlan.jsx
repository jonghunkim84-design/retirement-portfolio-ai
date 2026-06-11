import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import api, { fmt } from '../api/client.js'

// ── 주택연금 월지급금 요율표 (한국주택금융공사 정액형 기준, 만원/월 per 1억원) ──
// 출처: hf.go.kr 공시 자료 (70세 3억→92.3만원 기준으로 검증)
const HOME_PENSION_RATE = {
  55: 15.4, 56: 16.0, 57: 16.7, 58: 17.4, 59: 18.1,
  60: 18.9, 61: 19.7, 62: 20.5, 63: 21.5, 64: 22.5,
  65: 23.5, 66: 24.6, 67: 25.8, 68: 27.1, 69: 28.5,
  70: 30.8, 71: 32.3, 72: 33.9, 73: 35.6, 74: 37.5,
  75: 39.5, 76: 41.6, 77: 43.9, 78: 46.4, 79: 49.1,
  80: 52.0,
}

// 주택연금 월지급금 계산 (만원)
function calcHomePensionMonthly(houseValueEok, age, paymentType, yearsFromStart = 0) {
  const clampedAge = Math.min(80, Math.max(55, Math.round(age)))
  const rate = HOME_PENSION_RATE[clampedAge] ?? HOME_PENSION_RATE[70]
  const base = rate * houseValueEok  // 만원/월
  if (paymentType === 'increasing') {
    // 정기증가형: 3년마다 4.5% 증가
    const periods = Math.floor(yearsFromStart / 3)
    return Math.round(base * (1.045 ** periods))
  }
  return Math.round(base)  // 정액형
}

// ── 추이 계산 ────────────────────────────────────────────────────
function calcProjections(config, initialBalance, returnRate, homePension) {
  const birthYear   = config.user.birth_year
  const baseMonthly = config.user.monthly_expense
  const inflation   = config.inflation?.assumed_rate ?? 0.025

  const pensionRaw       = config.income?.national_pension ?? {}
  const pensionStartStr  = typeof pensionRaw === 'object' ? pensionRaw.start_date : null
  const pensionStartYear = pensionStartStr ? parseInt(pensionStartStr.split('-')[0]) : 9999
  const pensionBase      = typeof pensionRaw === 'object' ? (pensionRaw.base_amount ?? 0) : 0

  const currentYear = new Date().getFullYear()
  const endYear     = birthYear + 95

  // 주택연금 시작 연도
  const hpStartYear = homePension.enabled
    ? birthYear + homePension.startAge
    : 9999

  let balance = initialBalance
  const rows  = []

  for (let year = currentYear; year <= endYear; year++) {
    const age          = year - birthYear
    const yearsFromNow = year - currentYear

    // 월 생활비 (물가 상승 + 나이별 감액)
    let monthlyExpense
    if (age < 70) {
      monthlyExpense = baseMonthly * (1 + inflation) ** yearsFromNow
    } else if (age < 80) {
      monthlyExpense = baseMonthly * 0.9 * (1 + inflation) ** (age - 70)
    } else {
      const expense79 = baseMonthly * 0.9 * (1 + inflation) ** 9
      monthlyExpense  = expense79 * 0.9 * (1 + inflation) ** (age - 80)
    }

    // 국민연금 (물가연동)
    let pensionMonthly = 0
    if (year >= pensionStartYear) {
      const yearsToStart         = Math.max(0, pensionStartYear - currentYear)
      const effectivePensionBase = pensionBase * (1 + inflation) ** yearsToStart
      pensionMonthly = effectivePensionBase * (1 + inflation) ** (year - pensionStartYear)
    }

    // 주택연금 (정액형 = 고정, 정기증가형 = 3년마다 +4.5%)
    let homePensionMonthly = 0
    if (homePension.enabled && year >= hpStartYear) {
      const yearsFromStart = year - hpStartYear
      homePensionMonthly = calcHomePensionMonthly(
        homePension.houseValueEok,
        homePension.startAge,
        homePension.paymentType,
        yearsFromStart
      ) * 10_000  // 만원 → 원
    }

    const annualExpense    = monthlyExpense * 12
    const annualPension    = pensionMonthly * 12
    const annualHomePension = homePensionMonthly * 12
    const annualWithdrawal = Math.max(0, annualExpense - annualPension - annualHomePension)

    const balanceStart = balance
    balance = Math.max(0, balanceStart * (1 + returnRate) - annualWithdrawal)

    let note = ''
    if (year === hpStartYear && homePension.enabled) note = '🏠 주택연금 수령 시작'
    else if (year === pensionStartYear)              note = '🏛 국민연금 수령 시작'
    else if (age === 70)                             note = '📉 생활비 10% 감액'
    else if (age === 80)                             note = '📉 생활비 추가 10% 감액'

    rows.push({
      year, age, note,
      monthlyExpense:     Math.round(monthlyExpense),
      pensionMonthly:     Math.round(pensionMonthly),
      homePensionMonthly: Math.round(homePensionMonthly),
      monthlyWithdrawal:  Math.round(annualWithdrawal / 12),
      annualWithdrawal:   Math.round(annualWithdrawal),
      portfolioBalance:   Math.round(balanceStart),
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

// ── 주택연금 계산기 패널 ────────────────────────────────────────
function HomePensionPanel({ homePension, onChange, currentAge }) {
  const preview = homePension.enabled
    ? calcHomePensionMonthly(
        homePension.houseValueEok,
        homePension.startAge,
        homePension.paymentType,
        0
      )
    : 0

  return (
    <div className="card border-l-4 border-amber-400">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏠</span>
          <div>
            <h3 className="text-sm font-bold text-gray-800">주택연금 시뮬레이션</h3>
            <p className="text-[11px] text-gray-400">한국주택금융공사 정액형 기준 추정값</p>
          </div>
        </div>
        {/* 토글 스위치 */}
        <button
          onClick={() => onChange({ ...homePension, enabled: !homePension.enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            homePension.enabled ? 'bg-amber-500' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            homePension.enabled ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {homePension.enabled && (
        <div className="space-y-4">
          {/* 가입 조건 안내 */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            <strong>가입 조건</strong> · 부부 중 1명 이상 만 55세 이상 · 공시가격 12억원 이하 주택 보유
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* 주택 시세 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">주택 시세 (억원)</label>
              <input
                type="number" min={0.5} max={12} step={0.5}
                value={homePension.houseValueEok}
                onChange={e => onChange({ ...homePension, houseValueEok: +e.target.value })}
                className="w-full text-center font-semibold"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">공시가 기준 12억 이하</p>
            </div>

            {/* 가입 나이 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                가입 나이 ({homePension.startAge}세)
              </label>
              <input
                type="range" min={55} max={80} step={1}
                value={homePension.startAge}
                onChange={e => onChange({ ...homePension, startAge: +e.target.value })}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>55세</span>
                {currentAge >= 55 && currentAge <= 80 && (
                  <button
                    onClick={() => onChange({ ...homePension, startAge: currentAge })}
                    className="text-amber-600 font-medium">현재({currentAge}세)</button>
                )}
                <span>80세</span>
              </div>
            </div>

            {/* 지급 방식 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">지급 방식</label>
              <select
                value={homePension.paymentType}
                onChange={e => onChange({ ...homePension, paymentType: e.target.value })}
                className="w-full text-sm"
              >
                <option value="fixed">정액형 (고정)</option>
                <option value="increasing">정기증가형 (3년마다 +4.5%)</option>
              </select>
            </div>

            {/* 예상 월지급금 */}
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex flex-col justify-center">
              <p className="text-[11px] text-amber-700 font-medium">예상 월지급금</p>
              <p className="text-xl font-bold text-amber-700 mt-0.5">
                {preview.toLocaleString()}<span className="text-sm font-normal">만원</span>
              </p>
              <p className="text-[10px] text-amber-600 mt-0.5">
                가입 시 기준 · 정확한 금액은{' '}
                <a href="https://www.hf.go.kr/ko/sub03/sub03_02_02.do"
                   target="_blank" rel="noopener noreferrer"
                   className="underline">HF 홈페이지</a>{' '}
                조회 권장
              </p>
            </div>
          </div>

          {/* 주요 특징 안내 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            {[
              { icon: '🏡', text: '집에 계속 거주 가능' },
              { icon: '♾️', text: '사망 시까지 종신 지급' },
              { icon: '📊', text: '집값 하락해도 지급 보장' },
              { icon: '👶', text: '남은 가치는 자녀 상속' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1.5">
                <span>{icon}</span>
                <span className="text-gray-600">{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 ────────────────────────────────────────────────────────
export default function PensionPlan() {
  const qc = useQueryClient()
  const [returnRate,   setReturnRate]   = useState(4)
  const [returnSource, setReturnSource] = useState('default')
  const [homePension,  setHomePension]  = useState({
    enabled:      false,
    houseValueEok: 5,
    startAge:     70,
    paymentType:  'fixed',
  })

  const { data: dash, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
  })

  const { data: returnsData } = useQuery({
    queryKey: ['returns'],
    queryFn: () => api.get('/returns/assets').then(r => r.data),
    enabled: !isLoading,
  })

  // 저장된 계획용 목표 수익률 (단일 출처: config.plan.target_annual_return)
  const savedTarget = dash?.config?.plan?.target_annual_return ?? null

  // 기본값 우선순위: ① 저장된 목표 수익률 → ② 실현 수익률 제안 → ③ 자산 배분 기대수익률
  useEffect(() => {
    if (returnSource !== 'default') return
    if (savedTarget !== null) {
      setReturnRate(Math.round(savedTarget * 10) / 10)
      setReturnSource('target')
    } else if (returnsData) {
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
  }, [returnsData, dash, returnSource, savedTarget])

  // 목표 수익률 저장 (config.plan.target_annual_return — 설정 화면과 공유)
  const saveTargetMut = useMutation({
    mutationFn: rate => {
      const next = JSON.parse(JSON.stringify(dash.config))
      next.plan  = { ...(next.plan || {}), target_annual_return: rate }
      return api.put('/config', next)
    },
    onSuccess: () => {
      setReturnSource('target')
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['config'] })
    },
  })

  const rows = useMemo(() => {
    if (!dash) return []
    return calcProjections(dash.config, dash.buckets.total, returnRate / 100, homePension)
  }, [dash, returnRate, homePension])

  // ⚠️ useMemo는 early return 이전에 선언 (Rules of Hooks)
  const rowsWithout = useMemo(() => {
    if (!dash || !homePension.enabled) return []
    return calcProjections(dash.config, dash.buckets.total, returnRate / 100, { ...homePension, enabled: false })
  }, [dash, returnRate, homePension])

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  if (error)     return <div className="text-red-500 p-4">오류: {error.message}</div>

  const { config, buckets } = dash
  const currentYear  = new Date().getFullYear()
  const birthYear    = config.user.birth_year
  const currentAge   = currentYear - birthYear
  const inflation    = config.inflation?.assumed_rate ?? 0.025

  const srcMeta = {
    target:    { label: '저장된 목표',  bg: 'bg-emerald-600', text: '저장한 계획용 목표 수익률 기준'          },
    actual:    { label: '실현 수익률 제안', bg: 'bg-blue-600', text: '목표 미저장 — 실현 수익률을 초기 제안값으로 사용' },
    estimated: { label: '기대 수익률',  bg: 'bg-gray-400',   text: '자산 배분 기반 기대수익률 자동 반영'    },
    manual:    { label: '수동 입력',    bg: 'bg-orange-400', text: '직접 입력한 수익률 (저장 전까지 일시 적용)' },
    default:   { label: '기본값',       bg: 'bg-gray-300',   text: '기본값 4%'                             },
  }
  const src = srcMeta[returnSource] || srcMeta.default

  const resetToDefault = () => {
    if (savedTarget !== null) {
      setReturnRate(Math.round(savedTarget * 10) / 10)
      setReturnSource('target')
      return
    }
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

  // 실현 수익률 (참고 표시용)
  const actualReturn = returnsData?.portfolio_annual_return != null
    ? Math.round(returnsData.portfolio_annual_return * 10) / 10
    : null
  const canSaveTarget = returnRate >= 0 && returnRate <= 15

  const pensionRaw       = config.income?.national_pension ?? {}
  const pensionStartStr  = typeof pensionRaw === 'object' ? pensionRaw.start_date : ''
  const pensionStartYear = pensionStartStr ? parseInt(pensionStartStr.split('-')[0]) : 9999
  const yearsToP         = pensionStartYear - currentYear

  const exhaustRow = rows.find(r => r.portfolioBalance === 0)
  const lastRow    = rows[rows.length - 1]

  // 주택연금 없는 시나리오와 비교
  const exhaustWithout = rowsWithout.find(r => r.portfolioBalance === 0)

  // 주택연금 활성화 시 예상 월지급금 (시작 시점)
  const hpMonthly = homePension.enabled
    ? calcHomePensionMonthly(homePension.houseValueEok, homePension.startAge, homePension.paymentType, 0)
    : 0

  const chartData = rows.map(r => ({
    year:         r.year,
    expense:      Math.round(r.monthlyExpense    / 10000),
    pension:      Math.round(r.pensionMonthly    / 10000),
    homePension:  Math.round(r.homePensionMonthly / 10000),
    withdrawal:   Math.round(r.monthlyWithdrawal / 10000),
    balance:      +(r.portfolioBalance / 1e8).toFixed(1),
  }))

  const retireAge  = config.user?.retirement_age
  const retireYear = retireAge ? birthYear + retireAge : null

  const age70year   = birthYear + 70
  const age80year   = birthYear + 80
  const hpStartYear = homePension.enabled ? birthYear + homePension.startAge : null

  const refLines = [
    retireYear             && { x: retireYear,         color: '#7c3aed', label: `은퇴(${retireAge}세)` },
    pensionStartYear < 9999 && { x: pensionStartYear, color: '#16a34a', label: '국민연금' },
    hpStartYear            && { x: hpStartYear,       color: '#d97706', label: '주택연금' },
    { x: age70year,          color: '#9ca3af',         label: '70세'    },
    { x: age80year,          color: '#6b7280',         label: '80세'    },
  ].filter(Boolean)

  return (
    <div className="space-y-5">

      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-800">📊 연금 계획</h1>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
            <span className="text-gray-500">포트폴리오 연 수익률 가정</span>
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
            {returnSource === 'manual' && (
              <button onClick={resetToDefault}
                className="text-[11px] text-blue-500 hover:text-blue-700 border border-blue-300 rounded px-1.5 py-0.5 ml-1">
                ↺ 기본값
              </button>
            )}
            <button
              onClick={() => canSaveTarget && saveTargetMut.mutate(returnRate)}
              disabled={!canSaveTarget || saveTargetMut.isPending}
              title={canSaveTarget
                ? '이 수익률을 계획 기본값으로 저장합니다 (이후 화면 진입 시 항상 이 값으로 시작)'
                : '0~15% 범위만 저장할 수 있습니다'}
              className="text-[11px] text-emerald-600 hover:text-emerald-700 border border-emerald-300 rounded px-1.5 py-0.5 ml-1 disabled:opacity-40 disabled:cursor-not-allowed">
              {saveTargetMut.isPending ? '저장 중...' : saveTargetMut.isSuccess && returnSource === 'target' ? '✓ 저장됨' : '💾 기본값으로 저장'}
            </button>
          </div>
          <p className="text-[11px] text-gray-400">{src.text}</p>
          {returnRate > 8 && canSaveTarget && (
            <p className="text-[11px] text-amber-600">⚠️ 장기 계획 가정으로는 높은 수익률입니다</p>
          )}
          {!canSaveTarget && (
            <p className="text-[11px] text-red-500">저장 가능 범위: 0~15% (일시 변경은 계속 가능)</p>
          )}
          {actualReturn !== null && (
            <p className="text-[11px] text-gray-400">
              참고: 최근 실현 수익률 {actualReturn}%
              <span
                className="cursor-help ml-1"
                title="과거 성과는 미래 수익률을 보장하지 않습니다. 계획은 보수적인 목표 수익률 기준을 권장합니다">
                ⓘ
              </span>
            </p>
          )}
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '현재 나이',       value: `${currentAge}세`,         sub: `${birthYear}년생`,                      icon: '👤', color: 'border-blue-500'  },
          { label: '국민연금까지',    value: yearsToP > 0 ? `${yearsToP}년 후` : '수령 중', sub: `${pensionStartYear}년 개시`, icon: '🏛', color: 'border-green-500' },
          homePension.enabled
            ? { label: '주택연금 월지급금', value: `${hpMonthly.toLocaleString()}만원`, sub: `${homePension.startAge}세 가입 기준`, icon: '🏠', color: 'border-amber-500' }
            : { label: '현재 포트폴리오', value: fmt.eok(buckets.total), sub: '총 자산',                              icon: '💼', color: 'border-blue-500'  },
          exhaustRow
            ? { label: '포트폴리오 소진',  value: `${exhaustRow.year}년 (${exhaustRow.age}세)`,
                sub: homePension.enabled && exhaustWithout
                  ? `⚠️ 주택연금 없으면 ${exhaustWithout.year}년 소진`
                  : '⚠️ 추가 수입원 필요',
                icon: '🚨', color: 'border-red-500' }
            : { label: '95세 잔액',        value: fmt.eok(lastRow.portfolioBalance),
                sub: homePension.enabled && exhaustWithout
                  ? `✅ 주택연금으로 소진 방어 (${exhaustWithout.year}년→95세+)`
                  : '✅ 95세까지 유지',
                icon: '✅', color: 'border-green-500' },
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

      {/* 주택연금 시뮬레이션 패널 */}
      <HomePensionPanel
        homePension={homePension}
        onChange={setHomePension}
        currentAge={currentAge}
      />

      {/* 월 현금흐름 차트 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">월 현금흐름 추이</h3>
        <p className="text-xs text-gray-400 mb-4">
          가정: 물가상승률 연 {(inflation * 100).toFixed(1)}% (생활비·국민연금 인상 반영, 사적연금 정액 수령은 명목 고정) &nbsp;·&nbsp;
          70세 생활비 10% 감액 &nbsp;·&nbsp;
          80세 생활비 추가 10% 감액
          {homePension.enabled && ' · 주택연금 포함'}
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
            <Line type="monotone" dataKey="pension"    name="국민연금"        stroke="#22c55e" strokeWidth={2.5} dot={false} />
            {homePension.enabled && (
              <Line type="monotone" dataKey="homePension" name="주택연금"     stroke="#f59e0b" strokeWidth={2.5} dot={false} />
            )}
            <Line type="monotone" dataKey="withdrawal" name="포트폴리오 인출" stroke="#f97316" strokeWidth={2} strokeDasharray="6 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500 border-t pt-2">
          <span>🟥 생활비 = 포트폴리오에서 써야 할 전체 비용</span>
          <span>🟩 국민연금 = 국민연금으로 충당</span>
          {homePension.enabled && <span>🟡 주택연금 = 주택연금으로 충당</span>}
          <span>🟧 포트폴리오 인출 = 생활비 – 연금 수입 (실제로 빼는 금액)</span>
        </div>
      </div>

      {/* 포트폴리오 잔액 차트 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">포트폴리오 잔액 추이</h3>
        <p className="text-xs text-gray-400 mb-4">
          연 수익률 {returnRate}% 가정 · 매년 인출 후 잔액
          {homePension.enabled && ' · 주택연금 수령 포함'}
        </p>
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
              {homePension.enabled && (
                <th className="text-right py-2 px-3 font-semibold text-amber-700">주택연금/월</th>
              )}
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
                  {homePension.enabled && (
                    <td className={`py-2 px-3 text-right font-medium ${r.homePensionMonthly > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                      {r.homePensionMonthly > 0 ? fmt.won(r.homePensionMonthly) : '—'}
                    </td>
                  )}
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
