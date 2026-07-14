import { useState, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import api, { fmt } from '../api/client.js'

// ── 표시 상수 ─────────────────────────────────────────────────────
const SCENARIO_COLOR = {
  recommended:   'border-blue-500',
  pension_first: 'border-orange-400',
  no_pension:    'border-gray-300',
}
const BURDEN_COLORS = { 인출세: '#3b82f6', 금융소득세: '#f59e0b', 건보료: '#ef4444' }

const POOL_BADGE = {
  0:    'bg-green-100 text-green-700',
  low:  'bg-blue-100 text-blue-700',
  mid:  'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
}
function rateBadge(pct) {
  if (pct == null)  return POOL_BADGE.high
  if (pct === 0)    return POOL_BADGE[0]
  if (pct <= 5.5)   return POOL_BADGE.low
  if (pct <= 9.9)   return POOL_BADGE.mid
  return POOL_BADGE.high
}

function KpiCard({ label, value, sub, color = 'text-gray-800' }) {
  return (
    <div className="card">
      <p className="text-[11px] text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function NumberInput({ label, unit, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number" min="0" value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <span className="text-xs text-gray-400 flex-shrink-0">{unit}</span>
      </div>
    </label>
  )
}

export default function WithdrawalStrategy() {
  // 입력 (빈 값 = 서버 기본값 사용)
  const [needInput,     setNeedInput]     = useState('')
  const [propertyInput, setPropertyInput] = useState('')
  const [earnedInput,   setEarnedInput]   = useState('')
  const [applied, setApplied] = useState({})

  // 600ms 디바운스 후 재계산
  useEffect(() => {
    const t = setTimeout(() => {
      const p = {}
      if (needInput !== '')     p.annual_need       = Number(needInput) * 10000
      if (propertyInput !== '') p.property_tax_base = Number(propertyInput)
      if (earnedInput !== '')   p.earned_income     = Number(earnedInput) * 10000
      setApplied(p)
    }, 600)
    return () => clearTimeout(t)
  }, [needInput, propertyInput, earnedInput])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['withdrawal-strategy', applied],
    queryFn: () => api.get('/withdrawal-strategy/summary', { params: applied }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const rec       = data?.recommendation
  const scenarios = data?.scenarios ?? []
  const best      = scenarios.find(s => s.is_best)
  const worst     = scenarios.reduce((a, b) => (!a || b.total_burden > a.total_burden ? b : a), null)
  const recAmounts = Object.fromEntries((rec?.rows ?? []).map(r => [r.id, r]))

  const chartData = scenarios.map(s => ({
    name:       s.label.replace(/ \(.*\)/, ''),
    인출세:     s.withdrawal_tax,
    금융소득세: s.financial_income_tax,
    건보료:     s.health_premium_annual,
  }))

  return (
    <div className="space-y-5">
      {/* ─── 헤더 ─────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">🪜 인출 전략</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          세금 + 건강보험료를 합산해 가장 부담이 적은 계좌 인출 순서를 계산합니다
        </p>
      </div>

      {/* ─── 입력 ─────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">🎛 시뮬레이션 조건</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumberInput
            label="연간 필요 인출액" unit="만원"
            value={needInput} onChange={setNeedInput}
            placeholder={data ? String(Math.round(data.inputs.annual_need / 10000)) : '자동'}
          />
          <NumberInput
            label="재산 과세표준 (공제 후)" unit="만원"
            value={propertyInput} onChange={setPropertyInput} placeholder="0"
          />
          <NumberInput
            label="연간 근로·사업소득" unit="만원"
            value={earnedInput} onChange={setEarnedInput} placeholder="0"
          />
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          필요 인출액 기본값 = 연 생활비 − 국민연금 수령액 ·
          재산 과세표준은 건강보험료 시뮬레이터의 값을 참고해 입력하세요
          {isFetching && <span className="ml-2 text-blue-400">재계산 중...</span>}
        </p>
      </div>

      {isLoading ? (
        <div className="card text-center text-sm text-gray-400 py-10">불러오는 중...</div>
      ) : data && (
        <>
          {/* ─── KPI ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="연간 필요 인출액" value={fmt.won(data.inputs.annual_need)}
                     sub={`국민연금 연 ${fmt.won(data.inputs.national_pension_annual)} 반영`} />
            <KpiCard label="권장 전략 인출세" value={fmt.won(rec?.total_tax)}
                     color="text-blue-600"
                     sub={data.inputs.age_rate_pct != null ? `연금소득세율 ${data.inputs.age_rate_pct}%` : undefined} />
            <KpiCard label="최악 시나리오 대비 절감"
                     value={best && worst ? fmt.won(worst.total_burden - best.total_burden) : '-'}
                     color="text-green-600" sub="연간 총 부담 기준" />
            <KpiCard label="1,500만원 한도 잔여" value={fmt.won(data.limit.remaining)}
                     sub={`올해 사용 ${fmt.won(data.limit.ytd_used)}`} />
          </div>

          {/* ─── 경고 ─────────────────────────────────────────── */}
          {data.warnings.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 space-y-1">
              {data.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-700">⚠️ {w}</p>
              ))}
            </div>
          )}

          {/* ─── 인출 순서 사다리 ─────────────────────────────── */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">🪜 한계 비용 사다리 — 권장 인출 순서</h2>
            <p className="text-[11px] text-gray-400 mb-3">
              위에서 아래 순서로 인출하면 같은 금액을 빼도 당해 연도 부담이 가장 적습니다
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="py-2 pr-2 text-left font-medium">순서</th>
                    <th className="py-2 pr-2 text-left font-medium">인출 재원</th>
                    <th className="py-2 pr-2 text-center font-medium">세율</th>
                    <th className="py-2 pr-2 text-right font-medium">가용 금액</th>
                    <th className="py-2 pr-2 text-right font-medium">권장 인출</th>
                    <th className="py-2 text-left font-medium hidden md:table-cell">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pools.map((p, i) => {
                    const used = recAmounts[p.id]
                    return (
                      <tr key={p.id}
                          className={`border-b border-gray-50 ${p.available <= 0 ? 'opacity-40' : ''}`}>
                        <td className="py-2 pr-2 text-gray-400">{i + 1}</td>
                        <td className="py-2 pr-2 font-medium text-gray-700">{p.label}</td>
                        <td className="py-2 pr-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full font-bold ${rateBadge(p.rate_pct)}`}>
                            {p.rate_pct == null ? '—' : `${p.rate_pct}%`}
                          </span>
                        </td>
                        <td className="py-2 pr-2 text-right text-gray-600">{fmt.won(p.available)}</td>
                        <td className={`py-2 pr-2 text-right font-bold ${used ? 'text-blue-600' : 'text-gray-300'}`}>
                          {used ? fmt.won(used.amount) : '-'}
                        </td>
                        <td className="py-2 text-gray-400 hidden md:table-cell">{p.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rec?.unfunded > 0 && (
              <p className="mt-2 text-[11px] text-red-500">
                ⚠️ 가용 자산 부족: {fmt.won(rec.unfunded)} 미충당
              </p>
            )}
          </div>

          {/* ─── 시나리오 비교 ────────────────────────────────── */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">📊 시나리오 비교 — 연간 총 부담</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `${Math.round(v / 10000).toLocaleString()}만`}
                         tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => fmt.won(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {Object.entries(BURDEN_COLORS).map(([k, c]) => (
                    <Bar key={k} dataKey={k} stackId="burden" fill={c} radius={[0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {scenarios.map(s => (
                <div key={s.id} className={`rounded-xl border-l-4 border border-gray-100 p-3 ${SCENARIO_COLOR[s.id]}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-gray-700">{s.label}</h3>
                    {s.is_best && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">최적</span>
                    )}
                  </div>
                  <p className="text-lg font-bold text-gray-800 mb-1">{fmt.won(s.total_burden)}</p>
                  {!s.is_best && (
                    <p className="text-[11px] text-red-500 mb-1">+{fmt.won(s.delta_vs_best)} 더 부담</p>
                  )}
                  <div className="space-y-0.5 text-[11px] text-gray-500">
                    <div className="flex justify-between"><span>인출세</span><span>{fmt.won(s.withdrawal_tax)}</span></div>
                    <div className="flex justify-between"><span>금융소득세</span><span>{fmt.won(s.financial_income_tax)}</span></div>
                    <div className="flex justify-between"><span>건보료 (연)</span><span>{fmt.won(s.health_premium_annual)}</span></div>
                  </div>
                  {s.comprehensive_tax_risk && (
                    <p className="mt-1.5 text-[10px] text-orange-500">
                      ⚠️ 예상 금융소득 {fmt.won(s.projected_financial_income)} — 종합과세(2,000만원 초과) 위험
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ─── 주의사항 ─────────────────────────────────────── */}
          <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500 leading-relaxed">
            ⚠️ <span className="font-medium text-gray-600">주의사항</span> ·
            본 계산은 당해 연도 기준 단순화 모델입니다 (지역가입자 가정 · 사적연금 건보료 미부과 ·
            ISA 만기 요건 충족 가정 · 금융소득은 최근 12개월 실적 기반 추정).
            연금 수령 요건(만 55세·가입 10년·수령한도)과 개인별 공제는 반영되지 않을 수 있으니
            실행 전 세무사와 상담하세요.
          </div>
        </>
      )}
    </div>
  )
}
