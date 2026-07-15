import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import api, { fmt } from '../api/client.js'

// ── 상수 ─────────────────────────────────────────────────────────
const TAX_TYPE = {
  pension_savings:    { label: '연금저축',      badge: 'bg-blue-100 text-blue-700' },
  retirement_pension: { label: '퇴직연금(IRP)', badge: 'bg-green-100 text-green-700' },
  isa:                { label: 'ISA',           badge: 'bg-yellow-100 text-yellow-700' },
  regular:            { label: '일반',          badge: 'bg-gray-100 text-gray-600' },
}

const EMPTY_FORM = {
  withdrawal_date: new Date().toISOString().slice(0, 10),
  amount: '', account_name: '', tax_account_type: 'regular', memo: '',
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200'

function KpiCard({ label, value, sub, color = 'text-gray-800' }) {
  return (
    <div className="card">
      <p className="text-[11px] text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function Withdrawal() {
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const year = new Date().getFullYear()

  const { data: summary } = useQuery({
    queryKey: ['withdrawals-summary'],
    queryFn: () => api.get('/withdrawals/summary').then(r => r.data),
  })
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['withdrawals', year],
    queryFn: () => api.get('/withdrawals', { params: { year } }).then(r => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['withdrawals'] })
    qc.invalidateQueries({ queryKey: ['withdrawals-summary'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['pension-tax'] })
  }

  const saveMut = useMutation({
    mutationFn: body => api.post('/withdrawals', body),
    onSuccess: () => { setForm(f => ({ ...EMPTY_FORM, withdrawal_date: f.withdrawal_date })); setError(null); invalidate() },
    onError: e => setError(e.response?.data?.detail ?? '저장에 실패했습니다'),
  })
  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/withdrawals/${id}`),
    onSuccess: invalidate,
  })

  const submit = e => {
    e.preventDefault()
    saveMut.mutate({
      withdrawal_date: form.withdrawal_date,
      amount: Number(form.amount) || 0,
      account_name: form.account_name || '기타',
      tax_account_type: form.tax_account_type,
      memo: form.memo || null,
    })
  }

  const chartData = (summary?.monthly ?? []).map(m => ({
    name: m.month.slice(2),                        // YY-MM
    인출액: Math.round(m.total / 10000),           // 만원
  }))

  const rate = summary?.withdrawal_rate_pct
  const rateColor = rate == null ? 'text-gray-400'
    : rate <= 4 ? 'text-green-600' : rate <= 5 ? 'text-yellow-600' : 'text-red-600'

  return (
    <div className="space-y-5">
      {/* ─── 헤더 ─────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">💸 인출 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          계좌별 인출 기록 — 연금소득세 한도·현금흐름·수익률 계산에 공용으로 사용됩니다.
          어느 계좌에서 뺄지는 <Link to="/withdrawal-strategy" className="text-blue-500 underline">인출 전략</Link>을 참고하세요
        </p>
      </div>

      {/* ─── KPI ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="이달 인출 합계" value={fmt.won(summary?.current_month_total)}
                 sub={`참고: 생활비 − 국민연금 = ${fmt.won(summary?.recommended)}`} />
        <KpiCard label="올해 누적 인출" value={fmt.won(summary?.ytd_total)} />
        <KpiCard label="실적 인출률 (최근 12개월)"
                 value={rate == null ? '기록 없음' : `${rate}%`}
                 color={rateColor}
                 sub={rate == null ? '인출 기록을 입력하면 계산됩니다' : rate <= 4 ? '✅ 4% 기준 이하' : '⚠️ 4% 기준 초과'} />
        <KpiCard label="비상자금" value={`${summary?.emergency_months ?? 0}개월`}
                 sub="현금성 자산 ÷ 월 생활비"
                 color={(summary?.emergency_months ?? 0) >= 6 ? 'text-green-600' : 'text-red-600'} />
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">⚠️ {error}</div>
      )}

      {/* ─── 입력 폼 ──────────────────────────────────────────── */}
      <form onSubmit={submit} className="card space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">✏️ 인출 기록 추가</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="block">
            <span className="text-xs text-gray-500">날짜</span>
            <input type="date" value={form.withdrawal_date} required
                   onChange={e => set('withdrawal_date', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">금액 (원)</span>
            <input type="number" min="1" value={form.amount} required
                   onChange={e => set('amount', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">계좌명</span>
            <input value={form.account_name} placeholder="예: 미래에셋 IRP"
                   onChange={e => set('account_name', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">세제 분류</span>
            <select value={form.tax_account_type}
                    onChange={e => set('tax_account_type', e.target.value)} className={`${inputCls} mt-1`}>
              {Object.entries(TAX_TYPE).map(([v, t]) => (
                <option key={v} value={v}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">메모</span>
            <input value={form.memo} placeholder="예: 생활비"
                   onChange={e => set('memo', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
        </div>
        <div className="flex justify-between items-center">
          <p className="text-[11px] text-gray-400">
            연금저축·IRP 인출은 연 1,500만원 한도 모니터(연금 세금)에 자동 반영됩니다
          </p>
          <button type="submit" disabled={saveMut.isPending}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">
            {saveMut.isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>

      {/* ─── 월별 인출 차트 ───────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">📊 월별 인출 추이</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${v.toLocaleString()}만`} tick={{ fontSize: 10 }} width={70} />
                <Tooltip formatter={v => `${v.toLocaleString()}만원`} />
                <Bar dataKey="인출액" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── 올해 기록 목록 ───────────────────────────────────── */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">📋 {year}년 인출 기록</h2>
        {isLoading ? (
          <div className="text-sm text-gray-400 py-6 text-center">불러오는 중...</div>
        ) : records.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">올해 인출 기록이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-2 text-left font-medium">날짜</th>
                  <th className="py-2 pr-2 text-left font-medium">계좌</th>
                  <th className="py-2 pr-2 text-center font-medium">세제 분류</th>
                  <th className="py-2 pr-2 text-right font-medium">금액</th>
                  <th className="py-2 pr-2 text-left font-medium hidden md:table-cell">메모</th>
                  <th className="py-2 text-center font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const t = TAX_TYPE[r.tax_account_type] ?? TAX_TYPE.regular
                  return (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="py-2 pr-2 font-medium text-gray-700">{fmt.date(r.withdrawal_date)}</td>
                      <td className="py-2 pr-2 text-gray-600">{r.account_name}</td>
                      <td className="py-2 pr-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t.badge}`}>{t.label}</span>
                      </td>
                      <td className="py-2 pr-2 text-right font-bold text-gray-800">{fmt.won(r.amount)}</td>
                      <td className="py-2 pr-2 text-gray-400 hidden md:table-cell">{r.memo || '-'}</td>
                      <td className="py-2 text-center">
                        <button onClick={() => window.confirm('이 기록을 삭제할까요?') && deleteMut.mutate(r.id)}
                                className="text-red-400 hover:underline px-1">삭제</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
