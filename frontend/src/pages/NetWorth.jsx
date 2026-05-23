import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid, Cell, ReferenceLine,
} from 'recharts'
import api, { fmt } from '../api/client.js'

// ── 색상 상수 ─────────────────────────────────────────────────────
const B1_COLOR = '#3b82f6'  // 현금성
const B2_COLOR = '#22c55e'  // 채권/TDF
const B3_COLOR = '#a855f7'  // 주식/인컴
const TOTAL_COLOR = '#1e3a5f'

// ── 날짜 포맷 헬퍼 ────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${y}.${m}.${day}`
}
function fmtMonth(d) {
  if (!d) return ''
  const [y, m] = d.split('-')
  return `${y.slice(2)}.${m}`
}
function fmtWon(v) {
  if (v == null) return '-'
  const abs = Math.abs(v)
  if (abs >= 1e8) return (v / 1e8).toFixed(1) + '억'
  return Math.round(v / 1e4).toLocaleString() + '만'
}

// ── 커스텀 툴팁 ───────────────────────────────────────────────────
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs min-w-[160px]">
      <p className="font-bold text-gray-700 mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-3 py-0.5" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-semibold">{fmtWon(p.value * 1e8)}원</span>
        </div>
      ))}
    </div>
  )
}

function BucketTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs min-w-[170px]">
      <p className="font-bold text-gray-700 mb-2">{label}</p>
      {[...payload].reverse().map((p, i) => (
        <div key={i} className="flex justify-between gap-3 py-0.5" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-semibold">{(p.value).toFixed(1)}억</span>
        </div>
      ))}
      <div className="border-t mt-1 pt-1 flex justify-between text-gray-600 font-bold">
        <span>합계</span>
        <span>{total.toFixed(1)}억</span>
      </div>
    </div>
  )
}

function AnnualTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs min-w-[160px]">
      <p className="font-bold text-gray-700 mb-2">{label}년</p>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-3 py-0.5" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-semibold">
            {p.dataKey === 'yoy_pct'
              ? (p.value != null ? `${p.value > 0 ? '+' : ''}${p.value}%` : '-')
              : `${(p.value).toFixed(1)}억`
            }
          </span>
        </div>
      ))}
    </div>
  )
}

// ── 스냅샷 입력 모달 ──────────────────────────────────────────────
function SnapshotModal({ onClose, onSave, today }) {
  const [form, setForm] = useState({
    snapshot_date: today,
    total_value:   '',
    b1_value:      '',
    b2_value:      '',
    b3_value:      '',
    note:          '',
  })
  const [showBuckets, setShowBuckets] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = () => {
    if (!form.snapshot_date) return setErr('날짜를 입력해 주세요')
    const total = parseFloat(form.total_value)
    if (isNaN(total) || total <= 0) return setErr('올바른 총자산 금액을 입력해 주세요')
    setErr('')
    onSave({
      snapshot_date: form.snapshot_date,
      total_value:   total,
      b1_value:      parseFloat(form.b1_value) || 0,
      b2_value:      parseFloat(form.b2_value) || 0,
      b3_value:      parseFloat(form.b3_value) || 0,
      note:          form.note,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800 text-base">📌 스냅샷 추가</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="space-y-4">
          {/* 날짜 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">날짜 *</label>
            <input type="date" max={today}
              value={form.snapshot_date}
              onChange={e => set('snapshot_date', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none" />
          </div>

          {/* 총자산 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">총자산 (원) *</label>
            <input type="number" min="0" step="1000000" placeholder="예: 900000000"
              value={form.total_value}
              onChange={e => set('total_value', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none" />
            {form.total_value && !isNaN(+form.total_value) && (
              <p className="text-[11px] text-blue-500 mt-0.5">
                ≈ {(+form.total_value / 1e8).toFixed(2)}억원
              </p>
            )}
          </div>

          {/* 버킷 상세 (선택) */}
          <div>
            <button type="button"
              onClick={() => setShowBuckets(v => !v)}
              className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
              {showBuckets ? '▲' : '▼'} 버킷별 상세 입력 (선택)
            </button>
            {showBuckets && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { key: 'b1_value', label: '현금성(B1)', color: 'text-blue-600' },
                  { key: 'b2_value', label: '채권/TDF(B2)', color: 'text-green-600' },
                  { key: 'b3_value', label: '주식/인컴(B3)', color: 'text-purple-600' },
                ].map(({ key, label, color }) => (
                  <div key={key}>
                    <label className={`block text-[11px] font-semibold ${color} mb-1`}>{label}</label>
                    <input type="number" min="0" step="1000000" placeholder="0"
                      value={form[key]}
                      onChange={e => set(key, e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-300 outline-none" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 메모 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">메모 (선택)</label>
            <input type="text" placeholder="예: 연말 정산, 부동산 매각 등"
              value={form.note}
              onChange={e => set('note', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none" />
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
            취소
          </button>
          <button onClick={handleSubmit}
            className="flex-1 bg-[#1e3a5f] text-white rounded-lg py-2 text-sm font-semibold hover:bg-[#16304f]">
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
const PERIODS = [
  { key: 'all', label: '전체' },
  { key: '1y',  label: '1년' },
  { key: '3y',  label: '3년' },
  { key: '5y',  label: '5년' },
]
const CHART_TABS = [
  { key: 'trend',  label: '순자산 추이' },
  { key: 'bucket', label: '버킷별 구성' },
  { key: 'annual', label: '연도별 성장' },
]

export default function NetWorth() {
  const qc = useQueryClient()
  const [period,   setPeriod]   = useState('all')
  const [chartTab, setChartTab] = useState('trend')
  const [showForm, setShowForm] = useState(false)
  const today = new Date().toISOString().slice(0, 10)

  const { data, isLoading } = useQuery({
    queryKey: ['networth'],
    queryFn: () => api.get('/networth/history').then(r => r.data),
    staleTime: 60_000,
  })

  const saveTodayMut = useMutation({
    mutationFn: () => api.post('/networth/today'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networth'] }),
  })

  const upsertMut = useMutation({
    mutationFn: (body) => api.post('/networth', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['networth'] }); setShowForm(false) },
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/networth/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networth'] }),
  })

  // ── 기간 필터 적용 ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const snaps = data?.snapshots ?? []
    if (period === 'all') return snaps
    const msPerYear = 365.25 * 24 * 3600 * 1000
    const years = period === '1y' ? 1 : period === '3y' ? 3 : 5
    const cutoff = new Date(Date.now() - years * msPerYear)
    return snaps.filter(s => new Date(s.date) >= cutoff)
  }, [data, period])

  // ── 차트 데이터 변환 ───────────────────────────────────────────
  const trendData = useMemo(() =>
    filtered.map(s => ({
      label: filtered.length > 60 ? fmtMonth(s.date) : fmtDate(s.date),
      total: +(s.total / 1e8).toFixed(2),
      _raw:  s.total,
    }))
  , [filtered])

  const bucketData = useMemo(() =>
    filtered.map(s => ({
      label: filtered.length > 60 ? fmtMonth(s.date) : fmtDate(s.date),
      현금성:    +(s.b1 / 1e8).toFixed(2),
      '채권/TDF': +(s.b2 / 1e8).toFixed(2),
      '주식/인컴':+(s.b3 / 1e8).toFixed(2),
    }))
  , [filtered])

  const annualData = useMemo(() =>
    (data?.annual_summary ?? []).map(a => ({
      year:    a.year,
      total:   +(a.total / 1e8).toFixed(2),
      yoy_pct: a.yoy_pct,
      yoy_change: a.yoy_change,
      positive: (a.yoy_change ?? 0) >= 0,
    }))
  , [data])

  const stats   = data?.stats ?? {}
  const snaps   = data?.snapshots ?? []
  const hasData = snaps.length > 0

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  )

  return (
    <div className="space-y-5">

      {/* ── 헤더 ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">📊 순자산 추이</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            스냅샷 {stats.count ?? 0}개 · 마지막 기록 {stats.latest_date ?? '-'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => saveTodayMut.mutate()}
            disabled={saveTodayMut.isPending}
            className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 shadow-sm">
            {saveTodayMut.isPending ? '저장 중...' : '💾 오늘 스냅샷'}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 bg-[#1e3a5f] text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-[#16304f] shadow-sm">
            + 스냅샷 추가
          </button>
        </div>
      </div>

      {/* ── KPI 카드 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 현재 순자산 */}
        <div className="card border-l-4 border-blue-500">
          <p className="text-xs text-gray-500 font-medium">현재 순자산</p>
          <p className="text-lg font-bold text-gray-800 mt-0.5">
            {hasData ? fmt.eok(stats.latest_total) : '-'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{stats.latest_date ?? '데이터 없음'}</p>
        </div>

        {/* 총 증감 */}
        <div className={`card border-l-4 ${
          (stats.total_change ?? 0) >= 0 ? 'border-green-500' : 'border-red-400'
        }`}>
          <p className="text-xs text-gray-500 font-medium">첫 기록 대비</p>
          <p className={`text-lg font-bold mt-0.5 ${
            (stats.total_change ?? 0) >= 0 ? 'text-green-600' : 'text-red-500'
          }`}>
            {stats.total_change != null
              ? `${stats.total_change >= 0 ? '+' : ''}${fmt.eok(stats.total_change)}`
              : '-'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {stats.total_pct != null
              ? `${stats.total_pct >= 0 ? '+' : ''}${stats.total_pct}%`
              : ''}
          </p>
        </div>

        {/* CAGR */}
        <div className="card border-l-4 border-purple-500">
          <p className="text-xs text-gray-500 font-medium">연평균 성장률 (CAGR)</p>
          <p className="text-lg font-bold text-purple-600 mt-0.5">
            {stats.cagr != null ? `${stats.cagr > 0 ? '+' : ''}${stats.cagr}%` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {stats.cagr != null ? '연복리 환산' : '기간 1년 이상 필요'}
          </p>
        </div>

        {/* 기록 기간 */}
        <div className="card border-l-4 border-gray-400">
          <p className="text-xs text-gray-500 font-medium">기록 기간</p>
          <p className="text-lg font-bold text-gray-700 mt-0.5">
            {stats.count ? `${stats.count}개 스냅샷` : '기록 없음'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {stats.first_date
              ? `${stats.first_date} ~ ${stats.latest_date}`
              : '데이터를 추가하세요'}
          </p>
        </div>
      </div>

      {/* ── 데이터 적을 때 안내 ───────────────────────────────────── */}
      {snaps.length < 5 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm">
          <p className="font-semibold text-blue-700 mb-1">💡 과거 데이터를 입력하면 성장 히스토리가 완성됩니다</p>
          <p className="text-blue-600 text-xs">
            연말 기준 총자산을 입력하는 것을 권장합니다.
            예: 2020년 말 ~ 2025년 말까지 각 연도의 포트폴리오 금액을 추가해 보세요.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-2 bg-blue-600 text-white text-xs rounded-lg px-3 py-1.5 hover:bg-blue-700">
            + 과거 데이터 추가하기
          </button>
        </div>
      )}

      {/* ── 차트 영역 ────────────────────────────────────────────── */}
      <div className="card">
        {/* 기간 필터 + 탭 */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          {/* 기간 */}
          <div className="flex gap-1.5">
            {PERIODS.map(p => (
              <button key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  period === p.key
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {/* 탭 */}
          <div className="flex gap-1.5">
            {CHART_TABS.map(t => (
              <button key={t.key}
                onClick={() => setChartTab(t.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  chartTab === t.key
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── 탭1: 순자산 추이 AreaChart ───────────────────────── */}
        {chartTab === 'trend' && (
          <>
            <p className="text-xs text-gray-400 mb-3">
              총 순자산 변화 추이 · 단위 억원
            </p>
            {trendData.length < 2 ? (
              <div className="flex flex-col items-center justify-center h-52 text-gray-400 text-sm">
                <span className="text-3xl mb-2">📭</span>
                <p>스냅샷 2개 이상이면 차트가 표시됩니다</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={trendData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                  <defs>
                    <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={TOTAL_COLOR} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={TOTAL_COLOR} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }}
                    interval={Math.max(0, Math.floor(trendData.length / 8) - 1)} />
                  <YAxis unit="억" tick={{ fontSize: 11 }} width={50}
                    tickFormatter={v => v.toFixed(0)} />
                  <Tooltip content={<TrendTooltip />} />
                  <Area
                    type="monotone" dataKey="total" name="순자산"
                    stroke={TOTAL_COLOR} fill="url(#netGrad)"
                    strokeWidth={2.5} dot={trendData.length < 20}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </>
        )}

        {/* ── 탭2: 버킷별 구성 Stacked AreaChart ───────────────── */}
        {chartTab === 'bucket' && (
          <>
            <p className="text-xs text-gray-400 mb-3">
              버킷별 자산 구성 변화 · 현금성(B1) / 채권·TDF(B2) / 주식·인컴(B3)
            </p>
            {bucketData.length < 2 ? (
              <div className="flex flex-col items-center justify-center h-52 text-gray-400 text-sm">
                <span className="text-3xl mb-2">📭</span>
                <p>스냅샷 2개 이상이면 차트가 표시됩니다</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={bucketData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                  <defs>
                    {[['b1G', B1_COLOR], ['b2G', B2_COLOR], ['b3G', B3_COLOR]].map(([id, c]) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={c} stopOpacity={0.5} />
                        <stop offset="95%" stopColor={c} stopOpacity={0.05} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }}
                    interval={Math.max(0, Math.floor(bucketData.length / 8) - 1)} />
                  <YAxis unit="억" tick={{ fontSize: 11 }} width={50} />
                  <Tooltip content={<BucketTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="현금성"     stackId="1" stroke={B1_COLOR} fill={`url(#b1G)`} strokeWidth={1.5} />
                  <Area type="monotone" dataKey="채권/TDF"   stackId="1" stroke={B2_COLOR} fill={`url(#b2G)`} strokeWidth={1.5} />
                  <Area type="monotone" dataKey="주식/인컴"  stackId="1" stroke={B3_COLOR} fill={`url(#b3G)`} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </>
        )}

        {/* ── 탭3: 연도별 성장 BarChart ────────────────────────── */}
        {chartTab === 'annual' && (
          <>
            <p className="text-xs text-gray-400 mb-3">
              연도별 연말 기준 순자산 · 우측 축: 전년 대비 성장률(%)
            </p>
            {annualData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-52 text-gray-400 text-sm">
                <span className="text-3xl mb-2">📭</span>
                <p>스냅샷을 추가하면 연도별 성장 차트가 표시됩니다</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={annualData} margin={{ top: 10, right: 45, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="l" unit="억" tick={{ fontSize: 11 }} width={50}
                    tickFormatter={v => v.toFixed(0)} />
                  <YAxis yAxisId="r" orientation="right" unit="%" tick={{ fontSize: 11 }} width={40} />
                  <Tooltip content={<AnnualTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine yAxisId="r" y={0} stroke="#9ca3af" strokeDasharray="4 2" />
                  <Bar yAxisId="l" dataKey="total" name="연말 순자산" maxBarSize={80}>
                    {annualData.map((entry, idx) => (
                      <Cell key={idx}
                        fill={entry.positive === false ? '#ef4444'
                              : entry.yoy_pct == null ? '#3b82f6'
                              : '#22c55e'} />
                    ))}
                  </Bar>
                  <Line yAxisId="r" type="monotone" dataKey="yoy_pct" name="성장률(%)"
                    stroke="#f97316" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            {/* 연도별 요약 */}
            {annualData.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {annualData.map(a => (
                  <div key={a.year} className="bg-gray-50 rounded-lg px-3 py-2 text-xs min-w-[120px]">
                    <p className="font-bold text-gray-700 mb-1">{a.year}년</p>
                    <p className="text-gray-600">{(a.total).toFixed(1)}억원</p>
                    {a.yoy_pct != null && (
                      <p className={`font-semibold ${a.yoy_pct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {a.yoy_pct >= 0 ? '+' : ''}{a.yoy_pct}%
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 스냅샷 이력 테이블 ────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">📋 스냅샷 이력</h3>
          <span className="text-xs text-gray-400">총 {snaps.length}개 · 최신순</span>
        </div>

        {snaps.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            스냅샷이 없습니다. 위의 버튼으로 데이터를 추가하세요.
          </div>
        ) : (
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="text-left py-2 px-3 font-semibold">날짜</th>
                <th className="text-right py-2 px-3 font-semibold">총자산</th>
                <th className="text-right py-2 px-3 font-semibold text-blue-600">현금성(B1)</th>
                <th className="text-right py-2 px-3 font-semibold text-green-600">채권/TDF(B2)</th>
                <th className="text-right py-2 px-3 font-semibold text-purple-600">주식/인컴(B3)</th>
                <th className="text-left py-2 px-3 font-semibold">메모</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {[...snaps].reverse().map((s, i) => {
                const prev = [...snaps].reverse()[i + 1]
                const diff = prev ? s.total - prev.total : null
                return (
                  <tr key={s.id}
                    className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-2 px-3 font-semibold text-gray-700">{s.date}</td>
                    <td className="py-2 px-3 text-right font-bold text-gray-800">
                      {fmt.eok(s.total)}
                      {diff != null && (
                        <span className={`ml-1.5 text-[10px] font-normal ${diff >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                          {diff >= 0 ? '▲' : '▼'}{fmt.eok(Math.abs(diff))}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-blue-600">
                      {s.b1 > 0 ? fmt.eok(s.b1) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-green-600">
                      {s.b2 > 0 ? fmt.eok(s.b2) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-purple-600">
                      {s.b3 > 0 ? fmt.eok(s.b3) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2 px-3 text-gray-400 max-w-[150px] truncate">{s.note || ''}</td>
                    <td className="py-2 px-3">
                      <button
                        onClick={() => {
                          if (window.confirm(`${s.date} 스냅샷을 삭제할까요?`)) {
                            deleteMut.mutate(s.id)
                          }
                        }}
                        className="text-red-400 hover:text-red-600 text-[11px]">
                        삭제
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 모달 ─────────────────────────────────────────────────── */}
      {showForm && (
        <SnapshotModal
          today={today}
          onClose={() => setShowForm(false)}
          onSave={(body) => upsertMut.mutate(body)}
        />
      )}
    </div>
  )
}
