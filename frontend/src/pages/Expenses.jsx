import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
  PieChart, Pie, Cell,
} from 'recharts'
import api, { fmt } from '../api/client.js'

const CATEGORY_LABEL = {
  living:  '생활비',
  housing: '주거·관리',
  medical: '의료·건강',
  family:  '경조사·가족',
  leisure: '여행·여가',
  other:   '기타',
}
const CATEGORY_COLOR = {
  living:  '#3b82f6',
  housing: '#22c55e',
  medical: '#f59e0b',
  family:  '#a78bfa',
  leisure: '#f97316',
  other:   '#94a3b8',
}
const CATEGORIES = Object.keys(CATEGORY_LABEL)

const EMPTY_FORM = {
  expense_date: new Date().toISOString().slice(0, 10),
  amount:       '',
  category:     'other',
  memo:         '',
}

// ── 모달 ──────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── 입력 폼 ───────────────────────────────────────────────────────
function ExpenseForm({ init, onSave, onCancel, saving }) {
  const [form, setForm] = useState(init)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">날짜 *</label>
          <input type="date" value={form.expense_date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => set('expense_date', e.target.value)} required className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">카테고리</label>
          <select value={form.category} onChange={e => set('category', e.target.value)} className="w-full">
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">금액 (원) *</label>
          <input type="number" value={form.amount}
            onChange={e => set('amount', e.target.value)} required min={1}
            placeholder="예: 1870000" className="w-full" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">메모</label>
          <input value={form.memo} onChange={e => set('memo', e.target.value)}
            placeholder="예: 6월 카드값 합산" className="w-full" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>취소</button>
      </div>
    </form>
  )
}

// ── 이번 달 게이지 ────────────────────────────────────────────────
function MonthGauge({ actual, setting }) {
  if (!setting) return null
  const pct   = Math.min((actual / setting) * 100, 120)
  const color = actual <= setting * 0.9 ? '#22c55e' : actual <= setting ? '#f59e0b' : '#ef4444'
  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex justify-between text-xs text-gray-500">
        <span>이번 달 지출 / 생활비 기준</span>
        <span className="font-bold" style={{ color }}>
          {Math.round(actual / 10000).toLocaleString()}만 / {Math.round(setting / 10000).toLocaleString()}만
        </span>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

// ── 커스텀 도넛 레이블 ────────────────────────────────────────────
function DonutLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
      fontSize={11} fontWeight="600">
      {Math.round(percent * 100)}%
    </text>
  )
}

// ── 메인 ─────────────────────────────────────────────────────────
export default function Expenses() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(null)  // null | { mode: 'add'|'edit', data }

  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['expense-list'],
    queryFn: () => api.get('/expenses').then(r => r.data),
  })
  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['expense-summary'],
    queryFn: () => api.get('/expenses/summary').then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: body => api.post('/expenses', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-list'] })
      qc.invalidateQueries({ queryKey: ['expense-summary'] })
      qc.invalidateQueries({ queryKey: ['income-summary'] })
      setModal(null)
    },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/expenses/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-list'] })
      qc.invalidateQueries({ queryKey: ['expense-summary'] })
      qc.invalidateQueries({ queryKey: ['income-summary'] })
      setModal(null)
    },
  })
  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-list'] })
      qc.invalidateQueries({ queryKey: ['expense-summary'] })
      qc.invalidateQueries({ queryKey: ['income-summary'] })
    },
  })

  const handleSave = form => {
    const body = { ...form, amount: Number(form.amount) }
    if (modal.mode === 'add') createMut.mutate(body)
    else updateMut.mutate({ id: modal.data.id, body })
  }

  // ⚠️ useMemo는 early return 이전에 선언 (Rules of Hooks)
  const logsByMonth = useMemo(() => {
    const map = new Map()
    for (const r of logs) {
      const ym = r.expense_date.slice(0, 7)
      if (!map.has(ym)) map.set(ym, [])
      map.get(ym).push(r)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [logs])

  if (logsLoading || sumLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  )

  const s = summary || {}
  const monthlyList   = s.monthly_list   || []
  const catBreakdown  = s.category_breakdown || []
  const setting       = s.monthly_expense_setting || 0
  const avg12         = s.monthly_avg_12 || 0
  const thisMonth     = s.this_month_total || 0
  const diffPct       = s.diff_pct || 0
  const insufficient  = s.insufficient_data !== false && (s.months_with_data || 0) < 3

  // 월별 차트 (만원 단위)
  const chartData = monthlyList.map(m => ({
    name: `${m.month.slice(5)}월`,
    지출: Math.round(m.total / 10000),
  }))

  // 도넛 차트 데이터
  const donutData = catBreakdown.map(c => ({
    name:  c.label,
    value: c.amount,
    pct:   c.pct,
    color: CATEGORY_COLOR[c.category] || '#94a3b8',
  }))

  return (
    <div className="space-y-5">

      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4">
        <h1 className="text-xl font-bold">🧾 지출 기록</h1>
        <p className="text-blue-200 text-sm mt-1">
          실지출 추적 · 시뮬레이션 가정 검증 · 카테고리별 패턴
        </p>
      </div>

      {/* 데이터 부족 안내 */}
      {insufficient && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 text-sm text-blue-700 flex items-center gap-2">
          <span>📊</span>
          <span>
            아직 데이터가 쌓이는 중입니다 ({s.months_with_data || 0}개월차).
            3개월 이상 쌓이면 실측 자급률과 시뮬레이션 비교가 활성화됩니다.
          </span>
        </div>
      )}

      {/* 입력 폼 + 이번 달 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 빠른 입력 */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">지출 추가</h3>
            <button className="btn-primary text-xs py-1 px-3"
              onClick={() => setModal({ mode: 'add', data: EMPTY_FORM })}>
              + 지출 추가
            </button>
          </div>
          <p className="text-xs text-gray-400">
            날짜와 금액만 입력하면 됩니다. 카드값·현금 합산 한 건으로 한 달치를 기록해도 충분합니다.
          </p>
        </div>

        {/* 이번 달 요약 */}
        <div className="card border-l-4 border-rose-400">
          <p className="text-xs text-gray-500 font-medium mb-1">
            {s.this_month_ym ? `${s.this_month_ym.replace('-', '년 ')}월` : '이번 달'} 지출
          </p>
          <p className="text-2xl font-bold text-rose-600">
            {Math.round(thisMonth / 10000).toLocaleString()}만원
          </p>
          <MonthGauge actual={thisMonth} setting={setting} />
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card border-l-4 border-gray-400">
          <p className="text-xs text-gray-500 font-medium">설정 월 생활비</p>
          <p className="text-xl font-bold text-gray-700 mt-1">
            {Math.round(setting / 10000).toLocaleString()}만원
          </p>
        </div>
        <div className="card border-l-4 border-rose-400">
          <p className="text-xs text-gray-500 font-medium">실지출 12개월 평균</p>
          {insufficient ? (
            <p className="text-sm text-gray-400 mt-2">3개월 이상 쌓이면 표시됩니다</p>
          ) : (
            <>
              <p className="text-xl font-bold text-rose-600 mt-1">
                {Math.round(avg12 / 10000).toLocaleString()}만원
              </p>
              <p className={`text-xs mt-0.5 font-medium ${diffPct > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                설정 대비 {diffPct > 0 ? '+' : ''}{diffPct}%
              </p>
            </>
          )}
        </div>
        <div className="card border-l-4 border-blue-400">
          <p className="text-xs text-gray-500 font-medium">누적 기록</p>
          <p className="text-xl font-bold text-blue-600 mt-1">{logs.length}건</p>
          <p className="text-xs text-gray-400 mt-0.5">{s.months_with_data || 0}개월 데이터</p>
        </div>
      </div>

      {/* 차트 영역 */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* 월별 추이 */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">월별 지출 추이 (만원)</h3>
            <p className="text-xs text-gray-400 mb-3">최근 24개월 · 점선 = 설정 생활비</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} unit="만" width={50} />
                <Tooltip formatter={v => `${(v || 0).toLocaleString()}만원`} />
                <ReferenceLine
                  y={Math.round(setting / 10000)}
                  stroke="#6b7280" strokeDasharray="6 3"
                  label={{ value: '생활비 기준', position: 'insideTopRight', fontSize: 10, fill: '#6b7280' }}
                />
                <Bar dataKey="지출" fill="#f43f5e" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 카테고리 도넛 */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">카테고리 비중</h3>
            <p className="text-xs text-gray-400 mb-3">최근 12개월 기준</p>
            {donutData.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                데이터가 없습니다
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={200}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={85}
                      dataKey="value"
                      labelLine={false}
                      label={DonutLabel}
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [`${Math.round(v / 10000).toLocaleString()}만원`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {donutData.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-gray-700">{d.name}</span>
                      </div>
                      <span className="font-semibold text-gray-600">{d.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 기록 리스트 */}
      <div className="card p-0 overflow-auto">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">지출 기록 ({logs.length}건)</h3>
          <button className="btn-primary text-xs py-1 px-3"
            onClick={() => setModal({ mode: 'add', data: EMPTY_FORM })}>
            + 지출 추가
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <div className="text-4xl mb-3">🧾</div>
            <p className="font-medium">아직 지출 기록이 없습니다</p>
            <p className="text-sm mt-1">
              날짜와 금액만 입력하면 됩니다. 월말 카드값 합산 한 건도 충분합니다.
            </p>
          </div>
        ) : (
          <>
            {logsByMonth.map(([ym, items]) => {
              const monthTotal = items.reduce((s, r) => s + Number(r.amount), 0)
              const [y, m] = ym.split('-')
              return (
                <div key={ym}>
                  <div className="px-5 py-2 bg-gray-50 border-y border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">
                      {y}년 {parseInt(m)}월
                    </span>
                    <span className="text-xs font-bold text-rose-600">
                      합계 {Math.round(monthTotal / 10000).toLocaleString()}만원
                    </span>
                  </div>
                  <table>
                    <tbody>
                      {items.map(r => (
                        <tr key={r.id}>
                          <td className="text-xs text-gray-500">{r.expense_date}</td>
                          <td>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: (CATEGORY_COLOR[r.category] || '#94a3b8') + '20',
                                color: CATEGORY_COLOR[r.category] || '#94a3b8',
                              }}>
                              {CATEGORY_LABEL[r.category] || '기타'}
                            </span>
                          </td>
                          <td className="text-right font-semibold text-rose-700">
                            {fmt.won(r.amount)}
                          </td>
                          <td className="text-xs text-gray-400">{r.memo || '-'}</td>
                          <td>
                            <div className="flex gap-1">
                              <button className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1"
                                onClick={() => setModal({ mode: 'edit', data: r })}>수정</button>
                              <button className="text-red-400 hover:text-red-600 text-xs px-2 py-1"
                                onClick={() => { if (confirm('이 지출 기록을 삭제할까요?')) deleteMut.mutate(r.id) }}>
                                삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* 모달 */}
      {modal && (
        <Modal
          title={modal.mode === 'add' ? '지출 추가' : '지출 수정'}
          onClose={() => setModal(null)}>
          <ExpenseForm
            init={modal.data}
            onSave={handleSave}
            onCancel={() => setModal(null)}
            saving={createMut.isPending || updateMut.isPending}
          />
        </Modal>
      )}
    </div>
  )
}
