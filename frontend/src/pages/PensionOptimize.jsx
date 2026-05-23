import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import api, { fmt } from '../api/client.js'

// ── 시나리오 정의 ─────────────────────────────────────────────────
const SCENARIOS = [
  { offset: -5, label: '조기 5년', shortLabel: '조기5', color: '#ef4444', dash: '6 3' },
  { offset: -3, label: '조기 3년', shortLabel: '조기3', color: '#f97316', dash: '6 3' },
  { offset: -1, label: '조기 1년', shortLabel: '조기1', color: '#fbbf24', dash: '4 2' },
  { offset:  0, label: '정상 수령', shortLabel: '정상',  color: '#3b82f6', dash: null, bold: true },
  { offset:  1, label: '연기 1년', shortLabel: '연기1', color: '#4ade80', dash: '4 2' },
  { offset:  3, label: '연기 3년', shortLabel: '연기3', color: '#22c55e', dash: '6 3' },
  { offset:  5, label: '연기 5년', shortLabel: '연기5', color: '#059669', dash: '6 3' },
]

// ── 핵심 계산 함수 ────────────────────────────────────────────────
/** 시나리오별 월 수령액 */
function calcMonthly(base, offset) {
  if (offset < 0) return Math.round(base * (1 + 0.06 * offset))   // 감액 6%/년
  if (offset > 0) return Math.round(base * (1 + 0.072 * offset))  // 증액 7.2%/년
  return base
}

/** 특정 나이까지 누적 수령액 (원) */
function cumulative(monthly, startAge, atAge) {
  if (atAge <= startAge) return 0
  return monthly * 12 * (atAge - startAge)
}

/** 두 시나리오의 손익분기 나이 (소수점 1자리) */
function breakeven(monthlyA, startA, monthlyB, startB) {
  // cumA = cumB
  // monthlyA*(age-startA) = monthlyB*(age-startB)
  const denom = monthlyA - monthlyB
  if (Math.abs(denom) < 1) return null
  const age = (monthlyA * startA - monthlyB * startB) / denom
  return age > startA && age > startB && age < 120 ? Math.round(age * 10) / 10 : null
}

// ── 툴팁 ──────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs min-w-[200px]">
      <p className="font-bold text-gray-700 mb-2">{label}세 기준 누적 수령액</p>
      {[...payload].reverse().map((p, i) => (
        <div key={i} className="flex justify-between gap-4 py-0.5" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-semibold">{Number(p.value).toFixed(2)}억</span>
        </div>
      ))}
    </div>
  )
}

// ── 시나리오 비교 카드 ────────────────────────────────────────────
function ScenarioCard({ s, monthly, startAge, normalMonthly, normalStartAge, isNormal,
                        isSelected, isCurrent, isPast, onSelect }) {
  const be = isNormal ? null : breakeven(monthly, startAge, normalMonthly, normalStartAge)
  const cum80 = cumulative(monthly, startAge, 80)
  const cum85 = cumulative(monthly, startAge, 85)
  const cum90 = cumulative(monthly, startAge, 90)
  const pct   = ((monthly - normalMonthly) / normalMonthly * 100)

  return (
    <div className={`rounded-xl border-2 p-3 relative transition-all ${
      isNormal && !isSelected ? 'border-blue-500 bg-blue-50'
      : isSelected            ? 'bg-white'
      :                         'border-gray-200 bg-white'
    }`}
    style={isSelected ? { borderColor: s.color, boxShadow: `0 0 0 3px ${s.color}30` } : {}}>

      {/* 현재 적용 중 배지 */}
      {isCurrent && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-green-500 text-white
                        text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap z-10">
          ✓ 적용 중
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-sm" style={{ color: s.color }}>{s.label}</span>
        {!isNormal && (
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
            pct > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
          }`}>
            {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
          </span>
        )}
        {isNormal && <span className="text-[11px] bg-blue-600 text-white px-1.5 py-0.5 rounded">기준</span>}
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">개시 연령</span>
          <span className="font-semibold">{startAge}세</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">월 수령액</span>
          <span className="font-bold text-gray-800">{Math.round(monthly/10000).toLocaleString()}만원</span>
        </div>
        <div className="border-t border-gray-100 pt-1.5 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">80세까지 합계</span>
            <span className={cum80 > 0 ? 'font-medium' : 'text-gray-300'}>
              {cum80 > 0 ? `${(cum80/1e8).toFixed(1)}억` : '미개시'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">85세까지 합계</span>
            <span className="font-medium">{(cum85/1e8).toFixed(1)}억</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">90세까지 합계</span>
            <span className="font-medium">{(cum90/1e8).toFixed(1)}억</span>
          </div>
        </div>
        {!isNormal && (
          <div className={`mt-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium ${
            s.offset > 0 ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
          }`}>
            {be
              ? `정상 수령 대비 ${s.offset > 0 ? '우위 시작' : '역전'}: ${be}세`
              : (s.offset > 0 ? '95세 이후 손익분기' : '정상 수령이 항상 우위')
            }
          </div>
        )}
      </div>

      {/* 선택 버튼 */}
      <button
        onClick={e => { e.stopPropagation(); onSelect(s.offset) }}
        disabled={isPast}
        className={`mt-2.5 w-full text-[11px] py-1.5 rounded-lg font-semibold transition-colors ${
          isPast
            ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
            : isSelected
              ? 'text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
        style={isSelected ? { backgroundColor: s.color } : {}}>
        {isPast ? '지난 날짜' : isSelected ? '✓ 선택됨' : '선택'}
      </button>
    </div>
  )
}

// ── 메인 ─────────────────────────────────────────────────────────
export default function PensionOptimize() {
  const qc = useQueryClient()

  const { data: dash, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
  })

  // 사용자 조정 파라미터
  const [baseOverride,      setBaseOverride]      = useState(null)
  const [startAgeOverride,  setStartAgeOverride]  = useState(null)
  const [lifeExpect,        setLifeExpect]        = useState(85)
  const [activeScenarios,   setActiveScenarios]   = useState(new Set([-5, -3, 0, 3, 5]))
  // 확정 기능
  const [selectedScenario,  setSelectedScenario]  = useState(null)   // null | offset
  const [confirmSuccess,    setConfirmSuccess]    = useState(false)
  const [confirmError,      setConfirmError]      = useState(null)    // null | string

  const confirmMut = useMutation({
    mutationFn: (offset) => api.post('/config/pension-scenario', { offset }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setSelectedScenario(null)
      setConfirmSuccess(true)
      setConfirmError(null)
      setTimeout(() => setConfirmSuccess(false), 3500)
    },
    onError: (err) => {
      const msg = err?.response?.data?.detail
              ?? err?.message
              ?? '알 수 없는 오류가 발생했습니다'
      setConfirmError(String(msg))
    },
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  )

  const config     = dash?.config ?? {}
  const birthYear  = config.user?.birth_year ?? 1965
  const pensionRaw = config.income?.national_pension ?? {}
  const inflation  = config.inflation?.assumed_rate ?? 0.025
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1

  // ── 표준 기준값 (시나리오 계산의 불변 기준) ──────────────────────
  // standard_base / standard_start_date 가 없으면 base_amount / start_date 로 폴백
  const standardBase      = pensionRaw.standard_base       ?? pensionRaw.base_amount ?? 0
  const standardStartStr  = pensionRaw.standard_start_date ?? pensionRaw.start_date  ?? ''
  const standardYear      = standardStartStr ? parseInt(standardStartStr.split('-')[0]) : birthYear + 65
  const standardMonth     = standardStartStr ? parseInt(standardStartStr.split('-')[1]) : 5
  const standardAge       = standardYear - birthYear
  const currentOffset     = pensionRaw.scenario_offset ?? 0   // 현재 적용된 시나리오

  // 슬라이더 오버라이드 없으면 표준 기준으로 계산
  const yearsToStart  = Math.max(0, standardYear - currentYear)
  const inflatedBase  = Math.round(standardBase * (1 + inflation) ** yearsToStart)
  const base          = baseOverride      ?? inflatedBase
  const normalAge     = startAgeOverride  ?? standardAge

  // 정상 수령 수치
  const normalMonthly = calcMonthly(base, 0)

  // 과거 날짜 여부 판단 (조기 시나리오의 시작일이 이미 지났는지)
  const isPastScenario = (offset) => {
    const yr = standardYear + offset
    const mo = standardMonth
    return yr < currentYear || (yr === currentYear && mo < currentMonth)
  }

  // 활성화된 시나리오만 필터
  const visibleScenarios = SCENARIOS.filter(s => activeScenarios.has(s.offset))

  // ── 차트 데이터 생성 ─────────────────────────────────────────
  const chartData = useMemo(() => {
    const ageMin = Math.max(normalAge - 6, 55)
    const rows   = []
    for (let age = ageMin; age <= 95; age++) {
      const row = { age }
      visibleScenarios.forEach(s => {
        const monthly  = calcMonthly(base, s.offset)
        const startAge = normalAge + s.offset
        row[s.shortLabel] = +(cumulative(monthly, startAge, age) / 1e8).toFixed(2)
      })
      rows.push(row)
    }
    return rows
  }, [base, normalAge, activeScenarios])

  // ── 손익분기점 계산 (vs 정상 수령) ───────────────────────────
  const breakevenData = SCENARIOS.filter(s => s.offset !== 0).map(s => {
    const monthly  = calcMonthly(base, s.offset)
    const startAge = normalAge + s.offset
    const be = breakeven(monthly, startAge, normalMonthly, normalAge)
    const cum_be  = be ? cumulative(monthly, startAge, be) : null
    const cum_le  = cumulative(monthly, startAge, lifeExpect)
    const cum_n_le = cumulative(normalMonthly, normalAge, lifeExpect)
    return { ...s, monthly, startAge, be, cum_le, cum_n_le,
             advantage: cum_le - cum_n_le }
  })

  // 최적 시나리오 (기대 수명 기준)
  const bestScenario = [...breakevenData, {
    offset: 0, label: '정상 수령', shortLabel: '정상',
    monthly: normalMonthly, startAge: normalAge,
    advantage: 0, cum_le: cumulative(normalMonthly, normalAge, lifeExpect)
  }].reduce((best, s) => s.cum_le > best.cum_le ? s : best)

  const toggleScenario = (offset) => {
    setActiveScenarios(prev => {
      const next = new Set(prev)
      if (next.has(offset)) { if (next.size > 1) next.delete(offset) }
      else next.add(offset)
      return next
    })
  }

  return (
    <div className="space-y-5">

      {/* 성공 토스트 */}
      {confirmSuccess && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white rounded-xl
                        px-5 py-3 shadow-2xl text-sm font-semibold flex items-center gap-2">
          ✅ 연금 계획이 업데이트되었습니다
          <button onClick={() => setConfirmSuccess(false)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* 오류 토스트 */}
      {confirmError && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-600 text-white rounded-xl
                        px-5 py-3 shadow-2xl text-sm font-semibold flex items-center gap-2 max-w-sm">
          ❌ 저장 실패: {confirmError}
          <button onClick={() => setConfirmError(null)} className="ml-2 opacity-70 hover:opacity-100 flex-shrink-0">✕</button>
        </div>
      )}

      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4">
        <h1 className="text-xl font-bold">🏛 국민연금 수령 시기 최적화</h1>
        <p className="text-blue-200 text-sm mt-1">
          조기 수령 (최대 5년, 6%/년 감액) · 연기 수령 (최대 5년, 7.2%/년 증액) · 손익분기점 분석
        </p>
      </div>

      {/* 현재 설정 + 조정 슬라이더 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">⚙️ 시뮬레이션 파라미터</h3>
        <div className="grid grid-cols-2 gap-6">
          {/* 왼쪽: 설정 정보 */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">출생연도</span>
              <span className="font-semibold">{birthYear}년 ({currentYear - birthYear}세)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">정상 수령 기준</span>
              <span className="font-semibold">{standardAge}세 ({standardYear}년 {standardMonth}월)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">기준 월 수령액 (오늘 가격)</span>
              <span className="font-semibold">{Math.round(standardBase/10000).toLocaleString()}만원</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">개시 시점 예상 수령액</span>
              <span className="font-semibold text-green-700">{Math.round(inflatedBase/10000).toLocaleString()}만원</span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-gray-100">
              <span className="text-gray-500">현재 적용 시나리오</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                currentOffset === 0 ? 'bg-blue-100 text-blue-700' :
                currentOffset > 0  ? 'bg-green-100 text-green-700' :
                                     'bg-orange-100 text-orange-700'
              }`}>
                {SCENARIOS.find(s => s.offset === currentOffset)?.label ?? '정상 수령'}
              </span>
            </div>
          </div>

          {/* 오른쪽: 슬라이더 */}
          <div className="space-y-3">
            {/* 기준 월 수령액 */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-28 flex-shrink-0">기준 월 수령액</span>
              <input type="range"
                min={500000} max={5000000} step={50000}
                value={base}
                onChange={e => setBaseOverride(+e.target.value)}
                className="flex-1 h-1.5 accent-blue-600 cursor-pointer" />
              <span className="text-xs font-semibold text-gray-700 w-20 text-right">
                {Math.round(base/10000).toLocaleString()}만원
              </span>
            </div>
            {/* 기준 개시 연령 */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-28 flex-shrink-0">기준 개시 연령</span>
              <input type="range"
                min={60} max={70} step={1}
                value={normalAge}
                onChange={e => setStartAgeOverride(+e.target.value)}
                className="flex-1 h-1.5 accent-blue-600 cursor-pointer" />
              <span className="text-xs font-semibold text-gray-700 w-20 text-right">
                {normalAge}세
              </span>
            </div>
            {/* 기대 수명 */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-28 flex-shrink-0">기대 수명 가정</span>
              <input type="range"
                min={70} max={100} step={1}
                value={lifeExpect}
                onChange={e => setLifeExpect(+e.target.value)}
                className="flex-1 h-1.5 accent-purple-600 cursor-pointer" />
              <span className="text-xs font-semibold text-purple-600 w-20 text-right">
                {lifeExpect}세
              </span>
            </div>
            {(baseOverride !== null || startAgeOverride !== null) && (
              <button
                onClick={() => { setBaseOverride(null); setStartAgeOverride(null) }}
                className="text-xs text-blue-500 hover:text-blue-700">
                ↺ 설정값으로 초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 최적 결론 배너 */}
      <div className={`rounded-xl px-5 py-4 flex items-center gap-4 ${
        bestScenario.offset > 0 ? 'bg-green-50 border border-green-200' :
        bestScenario.offset < 0 ? 'bg-orange-50 border border-orange-200' :
        'bg-blue-50 border border-blue-200'
      }`}>
        <span className="text-3xl">
          {bestScenario.offset > 0 ? '🟢' : bestScenario.offset < 0 ? '🟡' : '🔵'}
        </span>
        <div>
          <p className="font-bold text-gray-800 text-sm">
            기대 수명 {lifeExpect}세 기준 최적 전략: <span style={{ color: SCENARIOS.find(s => s.offset === bestScenario.offset)?.color ?? '#3b82f6' }}>
              {bestScenario.label}
            </span>
          </p>
          <p className="text-xs text-gray-600 mt-0.5">
            {lifeExpect}세까지 누적 수령 예상 <strong>{(bestScenario.cum_le/1e8).toFixed(1)}억원</strong>
            {bestScenario.offset !== 0 && ` (정상 수령 대비 ${bestScenario.advantage >= 0 ? '+' : ''}${(bestScenario.advantage/1e8).toFixed(1)}억)`}
          </p>
        </div>
      </div>

      {/* 시나리오 카드 7개 */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-700">시나리오별 비교</h3>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>상단 클릭 → 차트 표시/숨김</span>
            <span className="text-gray-300">|</span>
            <span>하단 [선택] 버튼 → 확정 적용</span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {SCENARIOS.map(s => {
            const monthly  = calcMonthly(base, s.offset)
            const startAge = normalAge + s.offset
            if (startAge < 55 || startAge > 75) return null
            const isPast = isPastScenario(s.offset)
            return (
              <div key={s.offset}
                onClick={() => toggleScenario(s.offset)}
                className={`cursor-pointer transition-opacity ${
                  activeScenarios.has(s.offset) ? 'opacity-100' : 'opacity-50'
                }`}>
                <ScenarioCard
                  s={s} monthly={monthly} startAge={startAge}
                  normalMonthly={normalMonthly} normalStartAge={normalAge}
                  isNormal={s.offset === 0}
                  isSelected={selectedScenario === s.offset}
                  isCurrent={currentOffset === s.offset}
                  isPast={isPast}
                  onSelect={(offset) =>
                    setSelectedScenario(prev => prev === offset ? null : offset)
                  }
                />
              </div>
            )
          })}
        </div>

        {/* 확정 배너 */}
        {selectedScenario !== null && (() => {
          const sel = SCENARIOS.find(s => s.offset === selectedScenario)
          const selAge = normalAge + selectedScenario
          const selYear = standardYear + selectedScenario
          const selBase = calcMonthly(standardBase, selectedScenario)
          return (
            <div className="mt-4 flex items-center justify-between flex-wrap gap-3
                            bg-[#1e3a5f]/5 border border-[#1e3a5f]/25 rounded-xl px-5 py-4">
              <div>
                <p className="text-sm font-bold text-gray-800">
                  📌 <span style={{ color: sel?.color }}>{sel?.label}</span> 시나리오 선택됨
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  개시 {selAge}세 ({selYear}년 {standardMonth}월) ·
                  월 {Math.round(selBase / 10000).toLocaleString()}만원 (오늘 가격 기준) ·
                  실제 수령 예상액: 약 {Math.round(selBase * (1 + inflation) ** Math.max(0, selYear - currentYear) / 10000).toLocaleString()}만원
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {confirmError && (
                  <span className="text-xs text-red-600 font-medium mr-2">❌ {confirmError}</span>
                )}
                <button
                  onClick={() => { setSelectedScenario(null); setConfirmError(null) }}
                  className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200
                             rounded-lg px-3 py-1.5 bg-white">
                  취소
                </button>
                <button
                  onClick={() => { setConfirmError(null); confirmMut.mutate(selectedScenario) }}
                  disabled={confirmMut.isPending}
                  className="text-xs bg-[#1e3a5f] text-white rounded-lg px-4 py-1.5
                             font-semibold hover:bg-[#16304f] disabled:opacity-50">
                  {confirmMut.isPending ? '⏳ 저장 중...' : '✓ 연금 계획에 확정 적용'}
                </button>
              </div>
            </div>
          )
        })()}
      </div>

      {/* 누적 수령액 차트 */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-700">나이별 누적 수령액 (억원)</h3>
          <div className="flex gap-1 flex-wrap justify-end">
            {SCENARIOS.map(s => {
              const startAge = normalAge + s.offset
              if (startAge < 55 || startAge > 75) return null
              return (
                <button key={s.offset}
                  onClick={() => toggleScenario(s.offset)}
                  className="text-[10px] px-2 py-0.5 rounded-full border transition-all"
                  style={{
                    borderColor: s.color,
                    backgroundColor: activeScenarios.has(s.offset) ? s.color + '20' : 'transparent',
                    color: s.color,
                  }}>
                  {s.shortLabel}
                </button>
              )
            })}
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-4">세로 점선: 80·85·90세 기준선 / 보라 점선: 기대 수명({lifeExpect}세)</p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 11 }} unit="세" interval={4} />
            <YAxis tick={{ fontSize: 11 }} unit="억" width={45} />
            <Tooltip content={<ChartTooltip />} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            {[80, 85, 90].map(age => (
              <ReferenceLine key={age} x={age} stroke="#d1d5db" strokeDasharray="4 2"
                label={{ value: `${age}세`, position: 'top', fontSize: 9, fill: '#9ca3af' }} />
            ))}
            <ReferenceLine x={lifeExpect} stroke="#a855f7" strokeDasharray="5 3" strokeWidth={1.5}
              label={{ value: `기대 수명 ${lifeExpect}세`, position: 'insideTopLeft',
                       fontSize: 9, fill: '#a855f7', dy: -12 }} />
            {visibleScenarios.map(s => (
              <Line key={s.offset}
                type="monotone"
                dataKey={s.shortLabel}
                stroke={s.color}
                strokeWidth={s.bold ? 3 : 1.8}
                strokeDasharray={s.dash ?? undefined}
                dot={false}
                name={s.label}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 손익분기점 테이블 */}
      <div className="card p-0 overflow-auto">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">
            정상 수령 대비 손익분기점 분석
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            기준 월 수령액 {Math.round(normalMonthly/10000).toLocaleString()}만원 ({normalAge}세 개시)
          </p>
        </div>
        <table>
          <thead><tr>
            <th>시나리오</th>
            <th className="text-center">개시 연령</th>
            <th className="text-right">월 수령액</th>
            <th className="text-center">감/증액</th>
            <th className="text-center">손익분기점</th>
            <th className="text-right">{lifeExpect}세까지 합계</th>
            <th className="text-right">정상 대비 손익</th>
          </tr></thead>
          <tbody>
            {/* 정상 수령 기준행 */}
            <tr className="bg-blue-50">
              <td><span className="font-bold text-blue-700">정상 수령 (기준)</span></td>
              <td className="text-center">{normalAge}세</td>
              <td className="text-right font-bold">{Math.round(normalMonthly/10000).toLocaleString()}만원</td>
              <td className="text-center text-gray-400">—</td>
              <td className="text-center text-gray-400">—</td>
              <td className="text-right font-bold text-blue-700">
                {(cumulative(normalMonthly, normalAge, lifeExpect)/1e8).toFixed(1)}억
              </td>
              <td className="text-center text-gray-300">기준</td>
            </tr>
            {breakevenData.map(s => {
              const normalCum = cumulative(normalMonthly, normalAge, lifeExpect)
              const adv = s.advantage
              return (
                <tr key={s.offset}>
                  <td>
                    <span className="font-semibold text-sm" style={{ color: s.color }}>
                      {s.label}
                    </span>
                  </td>
                  <td className="text-center">{s.startAge}세</td>
                  <td className="text-right">{Math.round(s.monthly/10000).toLocaleString()}만원</td>
                  <td className="text-center">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      s.offset > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {s.offset > 0 ? '+' : ''}{((s.monthly - normalMonthly) / normalMonthly * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="text-center">
                    {s.be ? (
                      <span className={`font-semibold ${
                        s.be <= lifeExpect
                          ? (s.offset > 0 ? 'text-green-600' : 'text-red-500')
                          : 'text-gray-400'
                      }`}>
                        {s.be}세
                        {s.be <= lifeExpect
                          ? (s.offset > 0 ? ' ✅' : ' ⚠️')
                          : ' (기대 수명 이후)'}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">해당 없음</span>
                    )}
                  </td>
                  <td className="text-right font-semibold">
                    {(s.cum_le/1e8).toFixed(1)}억
                  </td>
                  <td className={`text-right font-bold ${adv >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {adv >= 0 ? '+' : ''}{(adv/1e8).toFixed(1)}억
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 의사결정 가이드 */}
      <div className="card bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">📌 의사결정 가이드</h3>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div className="bg-red-50 rounded-lg p-3 border border-red-100">
            <p className="font-bold text-red-700 mb-1">🟡 조기 수령 고려 상황</p>
            <ul className="text-gray-600 space-y-1">
              <li>• 건강 문제로 기대 수명이 짧을 때</li>
              <li>• 은퇴 초기 현금이 부족할 때</li>
              <li>• 포트폴리오 인출을 줄이고 싶을 때</li>
              <li>• 손익분기점보다 일찍 사망 예상 시</li>
            </ul>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <p className="font-bold text-blue-700 mb-1">🔵 정상 수령이 무난한 경우</p>
            <ul className="text-gray-600 space-y-1">
              <li>• 건강 상태가 평균적일 때</li>
              <li>• 포트폴리오가 충분히 여유로울 때</li>
              <li>• 은퇴 초기 지출이 계획적일 때</li>
              <li>• 결정하기 어려울 때 기본값</li>
            </ul>
          </div>
          <div className="bg-green-50 rounded-lg p-3 border border-green-100">
            <p className="font-bold text-green-700 mb-1">🟢 연기 수령 고려 상황</p>
            <ul className="text-gray-600 space-y-1">
              <li>• 건강하고 장수 가족력이 있을 때</li>
              <li>• 포트폴리오로 연금 전까지 충분히 생활 가능</li>
              <li>• 물가 상승 리스크 헤지 원할 때</li>
              <li>• 손익분기점 이전 사망 위험 낮을 때</li>
            </ul>
          </div>
        </div>
        <div className="mt-3 bg-yellow-50 rounded-lg px-3 py-2 text-xs text-yellow-700 border border-yellow-100">
          ⚠️ 물가 연동: 국민연금은 매년 물가상승률 반영 인상됩니다. 위 수치는 명목 기준이며, 실질 구매력은 유사합니다.
          조기/연기 수령 비율(6%/7.2%)도 명목 기준 고정 조정률입니다.
        </div>
      </div>

    </div>
  )
}
