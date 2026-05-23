import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts'
import api, { fmt, LEVEL_COLOR } from '../api/client.js'

function RiskGauge({ score, level }) {
  const color = LEVEL_COLOR[level]?.hex || '#6b7280'
  const r = 70, cx = 90, cy = 85
  const angle = Math.PI * (1 - Math.max(0, Math.min(100, score)) / 100)
  const ex = cx + r * Math.cos(angle)
  const ey = cy - r * Math.sin(angle)
  return (
    <svg width="180" height="110" viewBox="0 0 180 110">
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}
        fill="none" stroke="#e5e7eb" strokeWidth="16" strokeLinecap="round"/>
      {score > 0 && (
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`}
          fill="none" stroke={color} strokeWidth="16" strokeLinecap="round"/>
      )}
      <text x={cx} y={cy-10} textAnchor="middle" fontSize="28" fontWeight="bold" fill={color}>{score}</text>
      <text x={cx} y={cy+12} textAnchor="middle" fontSize="13" fill="#9ca3af">/ 100점</text>
    </svg>
  )
}

export default function RiskScore() {
  const qc = useQueryClient()

  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ['risk-current'],
    queryFn: () => api.get('/risk/current').then(r => r.data),
  })

  const { data: history } = useQuery({
    queryKey: ['risk-history'],
    queryFn: () => api.get('/risk/history').then(r => r.data),
  })

  const calcMut = useMutation({
    mutationFn: () => api.post('/risk/calculate'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risk-current'] })
      qc.invalidateQueries({ queryKey: ['risk-history'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  if (loadingCurrent) return <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>

  const risk    = current?.risk   || {}
  const buckets = current?.buckets || {}
  const lc      = LEVEL_COLOR[risk.level] || LEVEL_COLOR.green

  const scoreItems = [
    { name: '현금 위험', score: risk.cash_score  || 0, weight: '40%', desc: `버킷1 ${buckets.months_covered}개월치` },
    { name: '순서 위험', score: risk.seq_score   || 0, weight: '40%', desc: `주식+인컴 ${((buckets.equity_ratio||0)+(buckets.income_ratio||0))*100|0}%` },
    { name: '집중 위험', score: risk.conc_score  || 0, weight: '20%', desc: `최대이탈 ${risk.max_deviation||0}%p` },
  ]

  const histChartData = (history || []).slice().reverse().map(h => ({
    date:   h.date?.slice(5),
    종합:   h.total_score,
    현금:   h.cash_score,
    순서:   h.seq_score,
    집중:   h.conc_score,
  }))

  const devRows = Object.entries(risk.deviations || {}).map(([k, v]) => ({
    key: k,
    label: { cash: '현금성', bond: '채권/TDF', equity: '주식형', income: '리츠/인컴' }[k] || k,
    diff: v,
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">⚠️ 위험 점수 분석</h1>
        <button className="btn-primary" onClick={() => calcMut.mutate()} disabled={calcMut.isPending}>
          {calcMut.isPending ? '계산 중...' : '🔄 점수 재계산 & 저장'}
        </button>
      </div>

      {calcMut.isSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2">
          ✅ 위험 점수 계산 및 저장 완료
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* 게이지 */}
        <div className="card col-span-1 flex flex-col items-center">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">종합 위험 게이지</h3>
          <RiskGauge score={risk.total_score || 0} level={risk.level || 'green'} />
          <div className={`mt-3 text-lg font-bold ${lc.text}`}>{lc.label}</div>
          <div className="mt-1 text-xs text-gray-400">
            {risk.level === 'green' ? '현재 포트폴리오를 유지하세요.' :
             risk.level === 'yellow' ? '1~2개월 내 점검을 권장합니다.' :
             '즉시 리밸런싱이 필요합니다.'}
          </div>
          <div className="mt-4 w-full">
            <div className="text-xs text-gray-500 mb-1">기준</div>
            {[['0~25점', '녹색 (안전)', '#22c55e'], ['26~55점', '황색 (주의)', '#eab308'], ['56~100점', '적색 (위험)', '#ef4444']].map(([range, label, color]) => (
              <div key={range} className="flex items-center gap-2 text-xs py-0.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-gray-500">{range}</span>
                <span className="text-gray-700 font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 항목별 점수 */}
        <div className="card col-span-1">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">항목별 위험 점수</h3>
          <div className="space-y-4">
            {scoreItems.map(({ name, score, weight, desc }) => {
              const color = score === 0 ? '#22c55e' : score <= 30 ? '#22c55e' : score <= 60 ? '#eab308' : '#ef4444'
              return (
                <div key={name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{name} <span className="text-gray-400">({weight})</span></span>
                    <span className="font-bold" style={{ color }}>{score}점</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-3 border-t">
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={scoreItems} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => v + '점'} />
                <Bar dataKey="score" radius={[4,4,0,0]}
                  fill="#3b82f6"
                  label={{ position: 'top', fontSize: 10 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 비중 이탈 */}
        <div className="card col-span-1">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">목표 대비 비중 이탈</h3>
          <div className="space-y-2">
            {devRows.map(({ label, diff }) => {
              const isOver = diff > 0
              const isAlert = Math.abs(diff) >= 10
              return (
                <div key={label} className={`flex items-center justify-between p-2 rounded-lg ${isAlert ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                  <span className="text-sm font-medium text-gray-700">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${isOver ? 'text-red-500' : 'text-blue-500'}`}>
                      {diff > 0 ? '+' : ''}{diff}%p
                    </span>
                    {isAlert && <span className="badge-yellow text-xs">⚠ 조정 필요</span>}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 text-xs text-gray-400">
            ±10%p 이상 이탈 시 리밸런싱 권장
          </div>
        </div>
      </div>

      {/* 이력 차트 */}
      {histChartData.length > 1 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">위험 점수 이력</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={histChartData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="종합" stroke="#1e3a5f" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="현금" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="순서" stroke="#f97316" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="집중" stroke="#eab308" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
