import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell, LabelList } from 'recharts'
import api, { fmt } from '../api/client.js'

export default function Rebalance() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rebalance'],
    queryFn: () => api.get('/rebalance').then(r => r.data),
  })

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  if (error)    return <div className="text-red-500 p-4">오류: {error.message}</div>

  const { comparisons = [], adjustments = [], needs_rebalance, total, threshold_pct } = data

  const barData = comparisons.map(c => ({
    name: c.label,
    목표: c.target_pct,
    현재: c.current_pct,
    이탈: c.diff_pct,
  }))

  const devData = comparisons.map(c => ({
    name:   c.label,
    value:  +c.diff_pct.toFixed(1),
    exceed: Math.abs(c.diff_pct) >= threshold_pct,
  }))

  const devMax = Math.max(...devData.map(d => Math.abs(d.value)), threshold_pct + 5)

  const checklist = [
    '현재 시장 상황 확인 (급락·급등 시 1~2주 대기 고려)',
    '연금저축·IRP 계좌 로그인 및 잔고 확인',
    '연금계좌 내 리밸런싱 먼저 실행 (세금 없음)',
    '일반계좌 매도 전 양도소득세 예상액 확인',
    '매도 실행 → 2영업일 후 결제 확인',
    '매수 실행 (지정가 또는 시장가)',
    '자산 관리 페이지에서 평가액 업데이트',
    '위험 점수 페이지에서 재계산 확인',
  ]

  return (
    <div className="space-y-5 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">⚖️ 리밸런싱 분석</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">기준: ±{threshold_pct}%p 초과 시 조정</span>
          <button className="btn-secondary text-sm" onClick={() => refetch()}>🔄 새로고침</button>
        </div>
      </div>

      {/* 필요 여부 배너 */}
      <div className={`rounded-xl px-5 py-3 text-sm font-medium ${needs_rebalance ? 'bg-yellow-50 border border-yellow-200 text-yellow-800' : 'bg-green-50 border border-green-200 text-green-800'}`}>
        {needs_rebalance
          ? `⚠️ 리밸런싱이 필요합니다. 총 자산 ${fmt.eok(total)} 기준 ${adjustments.length}개 자산군 조정이 필요합니다.`
          : `✅ 모든 자산군이 목표 비중 범위(±${threshold_pct}%p) 안에 있습니다.`}
      </div>

      {/* 차트 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Chart 1: 목표 vs 현재 */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">목표 vs 현재 비중</h3>
          <p className="text-xs text-gray-400 mb-3">자산군별 목표 비중과 현재 비중 비교</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={barData} barGap={3} barCategoryGap="32%"
              margin={{ top: 18, right: 10, bottom: 5, left: -10 }}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
              <YAxis unit="%" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={(v, name) => [v.toFixed(1) + '%', name]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              <Bar dataKey="목표" fill="#1e3a5f" radius={[4,4,0,0]}>
                <LabelList dataKey="목표" position="top"
                  formatter={v => v.toFixed(0) + '%'}
                  style={{ fontSize: 10, fill: '#1e3a5f', fontWeight: 600 }} />
              </Bar>
              <Bar dataKey="현재" fill="#60a5fa" radius={[4,4,0,0]}>
                <LabelList dataKey="현재" position="top"
                  formatter={v => v.toFixed(0) + '%'}
                  style={{ fontSize: 10, fill: '#2563eb', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 2: 이탈 현황 — 가로 발산형 */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">이탈 현황</h3>
          <div className="flex gap-3 text-xs mb-3">
            <span className="flex items-center gap-1 text-blue-600 font-medium">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500"/>
              ◀ 매수 필요 (목표보다 부족)
            </span>
            <span className="flex items-center gap-1 text-red-500 font-medium">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400"/>
              매도 필요 ▶ (목표보다 초과)
            </span>
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart layout="vertical" data={devData}
              margin={{ top: 5, right: 60, bottom: 5, left: 58 }}>
              <XAxis type="number" unit="%p" domain={[-devMax, devMax]}
                axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis type="category" dataKey="name" axisLine={false} tickLine={false}
                tick={{ fontSize: 12, fill: '#374151' }} width={58} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={(v) => [(v > 0 ? '+' : '') + v + '%p', '이탈']} />
              <ReferenceLine x={0} stroke="#9ca3af" strokeWidth={1.5} />
              <ReferenceLine x={ threshold_pct} stroke="#f59e0b" strokeDasharray="5 3"
                label={{ value: `+${threshold_pct}%`, position: 'top', fontSize: 9, fill: '#d97706' }} />
              <ReferenceLine x={-threshold_pct} stroke="#f59e0b" strokeDasharray="5 3"
                label={{ value: `-${threshold_pct}%`, position: 'top', fontSize: 9, fill: '#d97706' }} />
              <Bar dataKey="value" maxBarSize={22} radius={3}>
                {devData.map((entry, i) => (
                  <Cell key={i}
                    fill={entry.exceed
                      ? (entry.value > 0 ? '#ef4444' : '#3b82f6')
                      : (entry.value > 0 ? '#fca5a5' : '#93c5fd')} />
                ))}
                <LabelList dataKey="value"
                  content={({ x, y, width, height, value }) => {
                    const isPos = value >= 0
                    const lx = isPos ? x + width + 5 : x - 5
                    const anchor = isPos ? 'start' : 'end'
                    const col = Math.abs(value) >= threshold_pct
                      ? (value > 0 ? '#dc2626' : '#2563eb') : '#6b7280'
                    return (
                      <text x={lx} y={y + height / 2 + 1}
                        fontSize={11} fill={col} fontWeight={Math.abs(value) >= threshold_pct ? 700 : 400}
                        textAnchor={anchor} dominantBaseline="middle">
                        {value > 0 ? '+' : ''}{value}%p
                      </text>
                    )
                  }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* 조정 필요 자산군 */}
      {adjustments.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">조정 필요 자산군 — 실행 계획</h3>
          <div className="space-y-4">
            {adjustments.map(adj => (
              <div key={adj.key} className={`border rounded-lg p-4 ${adj.action === '매수' ? 'border-blue-200 bg-blue-50/50' : 'border-red-200 bg-red-50/50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-base ${adj.action === '매수' ? 'text-blue-700' : 'text-red-600'}`}>
                      [{adj.label}] {adj.action}
                    </span>
                    <span className="text-sm font-medium text-gray-600">{fmt.won(adj.amount)}</span>
                  </div>
                  <span className={`badge-${adj.action === '매수' ? 'blue' : 'red'}`}>{adj.action}</span>
                </div>
                <div className="overflow-x-auto mt-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                <table className="text-xs min-w-[340px]">
                  <thead><tr className="text-gray-500">
                    <th className={`sticky left-0 z-10 text-left py-1 ${adj.action === '매수' ? 'bg-blue-50' : 'bg-red-50'}`}>자산명</th>
                    <th className="text-left py-1">계좌</th>
                    <th className="text-right py-1">현재 평가액</th>
                    <th className="text-right py-1">{adj.action} 금액</th>
                    <th className="py-1">계좌 유형</th>
                  </tr></thead>
                  <tbody>
                    {adj.items.map(item => (
                      <tr key={item.id} className="border-t border-white/60">
                        <td className={`sticky left-0 z-10 py-1 ${adj.action === '매수' ? 'bg-blue-50' : 'bg-red-50'}`}>{item.asset_name}</td>
                        <td className="py-1">{item.account_name}</td>
                        <td className="text-right py-1">{fmt.won(item.current_value)}</td>
                        <td className="text-right py-1 font-medium">{fmt.won(item.trade_amount)}</td>
                        <td className="py-1 text-center">
                          {item.is_pension
                            ? <span className="badge-green">연금계좌</span>
                            : <span className="badge-gray">일반계좌</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 세금 효율 순서 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">💡 세금 효율적 리밸런싱 순서</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {[
            { step: '1단계', title: '연금저축·IRP 계좌 먼저', desc: '과세 이연으로 세금 없이 자유롭게 매도/매수 가능', icon: '🏆', color: 'green' },
            { step: '2단계', title: '신규 자금으로 매수', desc: '부족한 자산군을 신규 자금으로 직접 매수', icon: '💰', color: 'blue' },
            { step: '3단계', title: '일반계좌 (마지막)', desc: '양도소득세 확인 후 진행 — 세금 비용 고려', icon: '⚠️', color: 'yellow' },
          ].map(({ step, title, desc, icon, color }) => (
            <div key={step} className={`border rounded-lg p-3 ${color === 'green' ? 'border-green-200 bg-green-50' : color === 'blue' ? 'border-blue-200 bg-blue-50' : 'border-yellow-200 bg-yellow-50'}`}>
              <div className="text-xs font-bold text-gray-500 mb-1">{step}</div>
              <div className="font-medium text-gray-800 mb-1">{icon} {title}</div>
              <div className="text-xs text-gray-500">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 체크리스트 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">✅ 실행 체크리스트</h3>
        <div className="space-y-2">
          {checklist.map((item, i) => (
            <label key={i} className="flex items-start gap-2 cursor-pointer group">
              <input type="checkbox" className="mt-0.5 w-4 h-4 flex-shrink-0" />
              <span className="text-sm text-gray-700 group-has-[input:checked]:line-through group-has-[input:checked]:text-gray-400">
                {i + 1}. {item}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
