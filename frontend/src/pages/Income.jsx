import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import api, { fmt } from '../api/client.js'

const INCOME_TYPE_LABEL = { interest: '이자', dividend: '배당', earned: '근로소득', other: '기타' }
const INCOME_TYPE_COLOR = { interest: '#3b82f6', dividend: '#22c55e', earned: '#f97316', other: '#a78bfa' }
const ASSET_TYPE_LABEL  = {
  cash: '현금성', bond: '채권', tdf: 'TDF',
  fund: '펀드', equity: '주식형', income: '리츠/인컴',
}
const ASSET_TYPES = ['cash', 'bond', 'tdf', 'fund', 'equity', 'income']

const EMPTY_FORM = {
  income_date: new Date().toISOString().slice(0, 10),
  asset_name: '', account_name: '', asset_type: 'bond',
  income_type: 'interest', amount: '', note: '',
}

// ── 모달 ────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── 입력 폼 ──────────────────────────────────────────────────────
function IncomeForm({ init, onSave, onCancel, saving, assets }) {
  const [form, setForm] = useState(init)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // 자산 선택 시 account_name, asset_type 자동 채우기
  const handleAssetSelect = (assetName) => {
    const found = assets.find(a => a.asset_name === assetName)
    set('asset_name', assetName)
    if (found) {
      if (found.account_name) set('account_name', found.account_name)
      if (found.asset_type)   set('asset_type',   found.asset_type)
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">수령일 *</label>
          <input type="date" value={form.income_date}
            onChange={e => set('income_date', e.target.value)} required className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">수입 유형 *</label>
          <select value={form.income_type} onChange={e => set('income_type', e.target.value)} className="w-full">
            {Object.entries(INCOME_TYPE_LABEL).map(([v, l]) =>
              <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">자산명 *</label>
          <input
            list="asset-list" value={form.asset_name}
            onChange={e => handleAssetSelect(e.target.value)}
            required placeholder="자산명 입력 또는 선택" className="w-full" />
          <datalist id="asset-list">
            {assets.map(a => <option key={a.id} value={a.asset_name} />)}
          </datalist>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">계좌명</label>
          <input value={form.account_name}
            onChange={e => set('account_name', e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">자산 유형</label>
          <select value={form.asset_type} onChange={e => set('asset_type', e.target.value)} className="w-full">
            {ASSET_TYPES.map(t => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">수령 금액 (원) *</label>
          <input type="number" value={form.amount}
            onChange={e => set('amount', e.target.value)} required min={1}
            placeholder="예: 250000" className="w-full" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">메모</label>
          <input value={form.note} onChange={e => set('note', e.target.value)}
            placeholder="예: 3개월 이자" className="w-full" />
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

// ── 요약 카드 ─────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color = 'blue', icon }) {
  const border = { blue:'border-blue-500', green:'border-green-500', purple:'border-purple-500', orange:'border-orange-400' }[color]
  const numCol  = { blue:'text-blue-700',  green:'text-green-600',  purple:'text-purple-600',  orange:'text-orange-500'  }[color]
  return (
    <div className={`card border-l-4 ${border}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium">{label}</p>
          <p className={`text-xl font-bold mt-1 ${numCol}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl opacity-50">{icon}</span>
      </div>
    </div>
  )
}

// ── 세금 비교 모달 (원천징수 15.4% vs 종합소득세) ───────────────────
function TaxCompareModal({ onClose }) {
  const [dependents, setDependents] = useState(1)
  const [cardAmount, setCardAmount] = useState('')
  const [result, setResult] = useState(null)

  const compareMut = useMutation({
    mutationFn: () => api.get('/income/tax-compare', {
      params: { dependents, card_amount: Number(cardAmount) || 0 },
    }).then(r => r.data),
    onSuccess: data => setResult(data),
  })

  return (
    <Modal title="🧾 세금 비교 — 원천징수 vs 종합소득세" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">인적공제 대상 인원(본인 포함)</label>
            <input type="number" min={1} value={dependents}
              onChange={e => setDependents(Math.max(1, Number(e.target.value)))} className="w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">연간 카드 사용액 (원)</label>
            <input type="number" min={0} value={cardAmount}
              onChange={e => setCardAmount(e.target.value)} placeholder="예: 15000000" className="w-full" />
          </div>
        </div>
        <button className="btn-primary w-full" onClick={() => compareMut.mutate()} disabled={compareMut.isPending}>
          {compareMut.isPending ? '계산 중...' : '비교하기'}
        </button>

        {result && (
          <div className="space-y-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {result.year}년 수입 합계 <span className="font-semibold text-gray-700">{fmt.won(result.total_income)}</span> 기준
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-lg p-3 border ${result.better_option === 'withholding' ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
                <p className="text-xs text-gray-500 font-medium">원천징수 ({result.withholding.rate_pct}%)</p>
                <p className="text-lg font-bold text-blue-700 mt-1">{fmt.won(result.withholding.tax)}</p>
                <p className="text-[11px] text-gray-400 mt-1">세후 실수령 {fmt.won(result.withholding.net_income)}</p>
                {result.better_option === 'withholding' && <p className="text-[11px] text-green-600 font-semibold mt-1">✓ 더 유리</p>}
              </div>
              <div className={`rounded-lg p-3 border ${result.better_option === 'comprehensive' ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
                <p className="text-xs text-gray-500 font-medium">종합소득세 신고 (세율 {result.comprehensive.bracket_rate_pct}%)</p>
                <p className="text-lg font-bold text-purple-700 mt-1">{fmt.won(result.comprehensive.tax)}</p>
                <p className="text-[11px] text-gray-400 mt-1">세후 실수령 {fmt.won(result.comprehensive.net_income)}</p>
                {result.better_option === 'comprehensive' && <p className="text-[11px] text-green-600 font-semibold mt-1">✓ 더 유리</p>}
              </div>
            </div>

            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between"><span>인적공제</span><span>{fmt.won(result.comprehensive.personal_deduction)}</span></div>
              <div className="flex justify-between"><span>카드공제</span><span>{fmt.won(result.comprehensive.card_deduction)}</span></div>
              <div className="flex justify-between"><span>과세표준</span><span>{fmt.won(result.comprehensive.taxable_base)}</span></div>
              <div className="flex justify-between"><span>산출세액(종소세)</span><span>{fmt.won(result.comprehensive.income_tax)}</span></div>
              <div className="flex justify-between"><span>지방소득세</span><span>{fmt.won(result.comprehensive.local_tax)}</span></div>
            </div>

            <p className="text-sm font-semibold text-center text-gray-700">
              {result.better_option === 'withholding' ? '원천징수' : '종합소득세 신고'}가{' '}
              <span className="text-green-600">{fmt.won(result.diff)}</span> 더 유리합니다
            </p>

            <p className="text-[11px] text-gray-400 leading-relaxed">{result.disclaimer}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── 자급률 게이지 ─────────────────────────────────────────────────
function SelfSufGauge({ ratio }) {
  const pct   = Math.min(ratio, 100)
  const color = ratio >= 50 ? '#22c55e' : ratio >= 20 ? '#f59e0b' : '#ef4444'
  const label = ratio >= 100 ? '완전 자립' : ratio >= 50 ? '양호' : ratio >= 20 ? '성장 중' : '초기 단계'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-gray-500">
        <span>패시브 인컴 자급률</span>
        <span className="font-bold" style={{ color }}>{ratio.toFixed(1)}% · {label}</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
      </div>
    </div>
  )
}

// ── 메인 ─────────────────────────────────────────────────────────
export default function Income() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(null)  // null | { mode: 'add'|'edit', data }
  const [taxCompareOpen, setTaxCompareOpen] = useState(false)

  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['income-list'],
    queryFn: () => api.get('/income').then(r => r.data),
  })
  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['income-summary'],
    queryFn: () => api.get('/income/summary').then(r => r.data),
  })
  const { data: assets = [] } = useQuery({
    queryKey: ['assets'],
    queryFn: () => api.get('/assets').then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: body => api.post('/income', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['income-list'] }); qc.invalidateQueries({ queryKey: ['income-summary'] }); setModal(null) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/income/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['income-list'] }); qc.invalidateQueries({ queryKey: ['income-summary'] }); setModal(null) },
  })
  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/income/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['income-list'] }); qc.invalidateQueries({ queryKey: ['income-summary'] }) },
  })

  const handleSave = form => {
    const body = { ...form, amount: Number(form.amount) }
    if (modal.mode === 'add') createMut.mutate(body)
    else updateMut.mutate({ id: modal.data.id, body })
  }

  if (logsLoading || sumLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  )

  const s = summary || {}
  const monthlyList  = s.monthly_list  || []
  const byAsset      = s.by_asset      || []
  const typeTotals   = s.type_totals   || {}
  const currentYear  = s.current_year  || new Date().getFullYear()

  // 월별 차트 데이터 (이름을 "MM월" 형식으로)
  const chartData = monthlyList.map(m => ({
    name:     `${m.month.slice(5)}월`,
    이자:     Math.round((m.interest || 0) / 10000),
    배당:     Math.round((m.dividend || 0) / 10000),
    근로소득: Math.round((m.earned   || 0) / 10000),
    기타:     Math.round((m.other    || 0) / 10000),
  }))

  // 자산별 차트 (상위 8개)
  const assetChart = byAsset.slice(0, 8).map(a => ({
    name:  a.asset_name.length > 10 ? a.asset_name.slice(0, 10) + '…' : a.asset_name,
    금액:  Math.round(a.total / 10000),
    full:  a.asset_name,
  }))

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">💰 배당·이자 수입 추적</h1>
          <p className="text-blue-200 text-sm mt-1">
            패시브 인컴 기록 · 생활비 자급률 · 자산별 수입 현황
          </p>
        </div>
        <button
          className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg border border-white/30 whitespace-nowrap"
          onClick={() => setTaxCompareOpen(true)}>
          🧾 세금 비교
        </button>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard icon="📅" label={`${currentYear}년 수입 합계`}
          value={fmt.eok(s.total_this_year || 0)}
          sub={`이자 ${fmt.won(typeTotals.interest||0)} · 배당 ${fmt.won(typeTotals.dividend||0)}${typeTotals.earned > 0 ? ` · 근로 ${fmt.won(typeTotals.earned)}` : ''}`}
          color="blue" />
        <SummaryCard icon="📆" label="월 평균 패시브 인컴"
          value={`${Math.round((s.monthly_avg||0)/10000).toLocaleString()}만원`}
          sub={`월 생활비 ${Math.round((s.monthly_expense||0)/10000).toLocaleString()}만원 기준`}
          color="green" />
        <SummaryCard icon="🏦" label="누적 총 수입"
          value={fmt.eok(s.total_all || 0)}
          sub="전체 기간 합계"
          color="purple" />
        <div className="card border-l-4 border-orange-400">
          <p className="text-xs text-gray-500 font-medium mb-2">생활비 자급률</p>
          <div className="flex items-end gap-3 mb-1">
            <p className="text-xl font-bold text-orange-500">
              {(s.self_sufficiency || 0).toFixed(1)}%
            </p>
            {s.actual_self_suf != null && (
              <div className="text-xs text-gray-500 mb-0.5">
                <span className="text-gray-400">설정 기준</span>
                <span className="ml-2 font-semibold text-teal-600">
                  실측 {s.actual_self_suf.toFixed(1)}%
                </span>
                <span className="text-gray-400 ml-1">
                  ({Math.round((s.expense_monthly_avg||0)/10000).toLocaleString()}만원 기준·{s.expense_months_count}개월)
                </span>
              </div>
            )}
          </div>
          <SelfSufGauge ratio={s.self_sufficiency || 0} />
        </div>
      </div>

      {/* 차트 2개 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 월별 수입 */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">{currentYear}년 월별 수입 (만원)</h3>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              수입 기록을 추가하면 차트가 표시됩니다
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="만" width={50} />
                <Tooltip formatter={v => `${v.toLocaleString()}만원`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="이자" stackId="a" fill="#3b82f6" radius={[0,0,0,0]} />
                <Bar dataKey="배당" stackId="a" fill="#22c55e" radius={[0,0,0,0]} />
                <Bar dataKey="근로소득" stackId="a" fill="#f97316" radius={[0,0,0,0]} />
                <Bar dataKey="기타" stackId="a" fill="#a78bfa" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 자산별 수입 (전체) */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">자산별 누적 수입 상위 8 (만원)</h3>
          {assetChart.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              수입 기록을 추가하면 차트가 표시됩니다
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={assetChart} layout="vertical"
                margin={{ top: 5, right: 60, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="만" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip formatter={(v, _, p) => [`${v.toLocaleString()}만원`, p.payload.full]} />
                <Bar dataKey="금액" radius={[0,3,3,0]} barSize={14}>
                  {assetChart.map((_, i) => (
                    <Cell key={i} fill={['#3b82f6','#22c55e','#f59e0b','#a78bfa','#ef4444','#06b6d4','#f97316','#84cc16'][i % 8]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 자산별 수입 요약 테이블 */}
      {byAsset.length > 0 && (
        <div className="card p-0 overflow-auto">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">자산별 수입 내역</h3>
          </div>
          <table>
            <thead><tr>
              <th>자산명</th><th>계좌</th><th>유형</th>
              <th className="text-right">이자</th>
              <th className="text-right">배당</th>
              <th className="text-right">근로소득</th>
              <th className="text-right">기타</th>
              <th className="text-right">합계</th>
              <th className="text-right">건수</th>
            </tr></thead>
            <tbody>
              {byAsset.map((a, i) => (
                <tr key={i}>
                  <td className="font-medium">{a.asset_name}</td>
                  <td className="text-xs text-gray-500">{a.account_name || '-'}</td>
                  <td>
                    <span className="badge-gray text-xs">
                      {ASSET_TYPE_LABEL[a.asset_type] || a.asset_type || '-'}
                    </span>
                  </td>
                  <td className="text-right text-blue-600">{a.interest > 0 ? fmt.won(a.interest) : '-'}</td>
                  <td className="text-right text-green-600">{a.dividend > 0 ? fmt.won(a.dividend) : '-'}</td>
                  <td className="text-right text-orange-500">{a.earned > 0 ? fmt.won(a.earned) : '-'}</td>
                  <td className="text-right text-purple-600">{a.other > 0 ? fmt.won(a.other) : '-'}</td>
                  <td className="text-right font-semibold">{fmt.won(a.total)}</td>
                  <td className="text-right text-gray-400 text-xs">{a.count}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 수입 기록 목록 */}
      <div className="card p-0 overflow-auto">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">수입 기록 ({logs.length}건)</h3>
          <button className="btn-primary text-xs py-1 px-3"
            onClick={() => setModal({ mode: 'add', data: EMPTY_FORM })}>
            + 수입 추가
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <div className="text-4xl mb-3">💰</div>
            <p className="font-medium">아직 수입 기록이 없습니다</p>
            <p className="text-sm mt-1">이자·배당 수령 시 "+ 수입 추가" 버튼으로 기록하세요</p>
          </div>
        ) : (
          <table>
            <thead><tr>
              <th>수령일</th><th>자산명</th><th>계좌</th>
              <th>자산유형</th><th>수입유형</th>
              <th className="text-right">금액</th>
              <th>메모</th><th>관리</th>
            </tr></thead>
            <tbody>
              {logs.map(r => (
                <tr key={r.id}>
                  <td className="text-xs text-gray-500">{r.income_date}</td>
                  <td className="font-medium">{r.asset_name}</td>
                  <td className="text-xs text-gray-500">{r.account_name || '-'}</td>
                  <td>
                    <span className="badge-gray text-xs">
                      {ASSET_TYPE_LABEL[r.asset_type] || r.asset_type || '-'}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: INCOME_TYPE_COLOR[r.income_type] + '20',
                        color: INCOME_TYPE_COLOR[r.income_type],
                      }}>
                      {INCOME_TYPE_LABEL[r.income_type] || r.income_type}
                    </span>
                  </td>
                  <td className="text-right font-semibold text-green-700">{fmt.won(r.amount)}</td>
                  <td className="text-xs text-gray-400">{r.note || '-'}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1"
                        onClick={() => setModal({ mode: 'edit', data: r })}>수정</button>
                      <button className="text-red-400 hover:text-red-600 text-xs px-2 py-1"
                        onClick={() => { if (confirm(`"${r.asset_name}" 수입 기록을 삭제할까요?`)) deleteMut.mutate(r.id) }}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 모달 */}
      {modal && (
        <Modal
          title={modal.mode === 'add' ? '수입 추가' : '수입 수정'}
          onClose={() => setModal(null)}>
          <IncomeForm
            init={modal.data}
            assets={assets}
            onSave={handleSave}
            onCancel={() => setModal(null)}
            saving={createMut.isPending || updateMut.isPending}
          />
        </Modal>
      )}

      {taxCompareOpen && (
        <TaxCompareModal onClose={() => setTaxCompareOpen(false)} />
      )}
    </div>
  )
}
