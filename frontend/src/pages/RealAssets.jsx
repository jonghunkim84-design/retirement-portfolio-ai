import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { fmt } from '../api/client.js'

// ── 상수 ─────────────────────────────────────────────────────────
const CATEGORY = {
  house:    { label: '주택',           badge: 'bg-blue-100 text-blue-700',     icon: '🏠' },
  building: { label: '건물·상가·토지', badge: 'bg-green-100 text-green-700',   icon: '🏢' },
  jeonse:   { label: '전세보증금',     badge: 'bg-yellow-100 text-yellow-700', icon: '🔑' },
  other:    { label: '기타 실물자산',  badge: 'bg-gray-100 text-gray-600',     icon: '📦' },
}

const EMPTY_FORM = {
  name: '', category: 'house', market_value: 0, official_price: '',
  loan_amount: 0, acquisition_price: '', acquisition_date: '', address: '', memo: '',
  is_active: true,
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

function Field({ label, children, required }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">
        {label}{required && <span className="text-red-400"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200'

// ── 입력 폼 ──────────────────────────────────────────────────────
function RealAssetForm({ initial, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const submit = e => {
    e.preventDefault()
    onSubmit({
      ...form,
      market_value:      Number(form.market_value) || 0,
      official_price:    form.official_price === '' ? null : Number(form.official_price),
      loan_amount:       Number(form.loan_amount) || 0,
      acquisition_price: form.acquisition_price === '' ? null : Number(form.acquisition_price),
      acquisition_date:  form.acquisition_date || null,
      address:           form.address || null,
      memo:              form.memo || null,
    })
  }

  return (
    <form onSubmit={submit} className="card border border-blue-100 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">
        {initial.id ? '✏️ 실물자산 수정' : '➕ 실물자산 등록'}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="명칭" required>
          <input value={form.name} onChange={e => set('name', e.target.value)}
                 placeholder="예: 잠실 아파트" required className={inputCls} />
        </Field>
        <Field label="분류" required>
          <select value={form.category} onChange={e => set('category', e.target.value)} className={inputCls}>
            {Object.entries(CATEGORY).map(([v, c]) => (
              <option key={v} value={v}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label={form.category === 'jeonse' ? '보증금 (원)' : '시세 (원)'} required>
          <input type="number" min="0" value={form.market_value}
                 onChange={e => set('market_value', e.target.value)} required className={inputCls} />
        </Field>
        <Field label="공시가격 (원)">
          <input type="number" min="0" value={form.official_price} placeholder="건보료·재산세 추정용"
                 onChange={e => set('official_price', e.target.value)} className={inputCls} />
        </Field>
        <Field label="담보대출 잔액 (원)">
          <input type="number" min="0" value={form.loan_amount}
                 onChange={e => set('loan_amount', e.target.value)} className={inputCls} />
        </Field>
        <Field label="취득가 (원)">
          <input type="number" min="0" value={form.acquisition_price}
                 onChange={e => set('acquisition_price', e.target.value)} className={inputCls} />
        </Field>
        <Field label="취득일">
          <input type="date" value={form.acquisition_date}
                 onChange={e => set('acquisition_date', e.target.value)} className={inputCls} />
        </Field>
        <Field label="소재지">
          <input value={form.address} onChange={e => set('address', e.target.value)}
                 placeholder="예: 서울 송파구" className={inputCls} />
        </Field>
      </div>
      <Field label="메모">
        <input value={form.memo} onChange={e => set('memo', e.target.value)} className={inputCls} />
      </Field>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
          취소
        </button>
        <button type="submit" disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </form>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────
export default function RealAssets() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)   // null | EMPTY_FORM | row
  const [error, setError] = useState(null)

  const { data: list, isLoading } = useQuery({
    queryKey: ['real-assets'],
    queryFn: () => api.get('/real-assets').then(r => r.data),
  })
  const { data: summary } = useQuery({
    queryKey: ['real-assets-summary'],
    queryFn: () => api.get('/real-assets/summary').then(r => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['real-assets'] })
    qc.invalidateQueries({ queryKey: ['real-assets-summary'] })
    qc.invalidateQueries({ queryKey: ['withdrawal-strategy'] })
  }
  const onError = e => setError(e.response?.data?.detail ?? '저장에 실패했습니다')

  const saveMut = useMutation({
    mutationFn: body => body.id
      ? api.put(`/real-assets/${body.id}`, { ...body, id: undefined })
      : api.post('/real-assets', body),
    onSuccess: () => { setEditing(null); setError(null); invalidate() },
    onError,
  })
  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/real-assets/${id}`),
    onSuccess: invalidate, onError,
  })
  const toggleMut = useMutation({
    mutationFn: id => api.patch(`/real-assets/${id}/toggle`),
    onSuccess: invalidate, onError,
  })

  const rows = list ?? []

  return (
    <div className="space-y-5">
      {/* ─── 헤더 ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">🏘 실물자산</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            부동산 등 비금융자산 — 리밸런싱·인출률 계산에는 포함되지 않고, 순자산과 건보료 추정에 반영됩니다
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(EMPTY_FORM)}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 flex-shrink-0">
            + 등록
          </button>
        )}
      </div>

      {/* ─── KPI ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="실물자산 시세 합계" value={fmt.eok(summary?.total_market_value)}
                 sub={`${summary?.count ?? 0}건 (활성)`} />
        <KpiCard label="담보대출 잔액" value={fmt.eok(summary?.total_loan)}
                 color={summary?.total_loan > 0 ? 'text-red-600' : 'text-gray-800'} />
        <KpiCard label="실물 순자산" value={fmt.eok(summary?.net_value)} color="text-blue-600"
                 sub="시세 − 대출" />
        <KpiCard label="총 순자산 (금융+실물)" value={fmt.eok(summary?.combined_net_worth)}
                 color="text-green-600"
                 sub={`금융자산 ${fmt.eok(summary?.financial_total)} 포함`} />
      </div>

      {/* ─── 건보료 연동 안내 ─────────────────────────────────── */}
      {summary?.count > 0 && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-700 leading-relaxed">
          🏥 건보료 재산 과세표준 추정:{' '}
          <span className="font-bold">{(summary.property_tax_base_manwon ?? 0).toLocaleString('ko-KR')}만원</span>
          {' '}(공시가 환산 − 대출 − 기본공제 1억) — {' '}
          <Link to="/withdrawal-strategy" className="underline font-medium">인출 전략</Link>과{' '}
          <Link to="/health-insurance" className="underline font-medium">건강보험료 시뮬레이터</Link>에서 활용하세요
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">
          ⚠️ {error}
        </div>
      )}

      {/* ─── 입력 폼 ──────────────────────────────────────────── */}
      {editing && (
        <RealAssetForm
          initial={editing}
          saving={saveMut.isPending}
          onSubmit={body => saveMut.mutate(editing.id ? { ...body, id: editing.id } : body)}
          onCancel={() => { setEditing(null); setError(null) }}
        />
      )}

      {/* ─── 목록 ─────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">📋 등록 목록</h2>
        {isLoading ? (
          <div className="text-sm text-gray-400 py-6 text-center">불러오는 중...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">
            등록된 실물자산이 없습니다 — 우측 상단 [+ 등록]으로 추가하세요
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-2 text-left font-medium">명칭</th>
                  <th className="py-2 pr-2 text-left font-medium">분류</th>
                  <th className="py-2 pr-2 text-right font-medium">시세</th>
                  <th className="py-2 pr-2 text-right font-medium hidden md:table-cell">공시가격</th>
                  <th className="py-2 pr-2 text-right font-medium">대출</th>
                  <th className="py-2 pr-2 text-right font-medium">순가치</th>
                  <th className="py-2 pr-2 text-right font-medium hidden lg:table-cell">취득가 대비</th>
                  <th className="py-2 text-center font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const cat = CATEGORY[r.category] ?? CATEGORY.other
                  const net = (r.market_value || 0) - (r.loan_amount || 0)
                  const gain = r.acquisition_price
                    ? (r.market_value || 0) - r.acquisition_price : null
                  return (
                    <tr key={r.id} className={`border-b border-gray-50 ${!r.is_active ? 'opacity-40' : ''}`}>
                      <td className="py-2 pr-2">
                        <span className="font-medium text-gray-700">{cat.icon} {r.name}</span>
                        {r.address && <span className="block text-[10px] text-gray-400">{r.address}</span>}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cat.badge}`}>
                          {cat.label}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-right font-medium text-gray-700">{fmt.won(r.market_value)}</td>
                      <td className="py-2 pr-2 text-right text-gray-500 hidden md:table-cell">
                        {r.official_price ? fmt.won(r.official_price) : '-'}
                      </td>
                      <td className="py-2 pr-2 text-right text-red-500">
                        {r.loan_amount > 0 ? fmt.won(r.loan_amount) : '-'}
                      </td>
                      <td className="py-2 pr-2 text-right font-bold text-blue-600">{fmt.won(net)}</td>
                      <td className={`py-2 pr-2 text-right hidden lg:table-cell ${
                        gain == null ? 'text-gray-300' : gain >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {gain == null ? '-' : `${gain >= 0 ? '+' : ''}${fmt.won(gain)}`}
                      </td>
                      <td className="py-2 text-center whitespace-nowrap">
                        <button onClick={() => setEditing({
                                  ...EMPTY_FORM, ...r,
                                  official_price: r.official_price ?? '',
                                  acquisition_price: r.acquisition_price ?? '',
                                  acquisition_date: r.acquisition_date ?? '',
                                  address: r.address ?? '', memo: r.memo ?? '',
                                })}
                                className="text-blue-500 hover:underline px-1">수정</button>
                        <button onClick={() => toggleMut.mutate(r.id)}
                                className="text-gray-400 hover:underline px-1">
                          {r.is_active ? '비활성' : '활성'}
                        </button>
                        <button onClick={() => window.confirm(`'${r.name}'을(를) 삭제할까요?`) && deleteMut.mutate(r.id)}
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

      {/* ─── 주의사항 ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500 leading-relaxed">
        ⚠️ <span className="font-medium text-gray-600">참고</span> ·
        실물자산은 유동성이 낮아 리밸런싱·4% 인출률·위험점수·비상자금 계산에서 제외됩니다.
        건보료 과세표준 추정은 공시가격 기준 환산율(주택 43~45% · 건물 100% · 전세 30%)을 적용한
        참고치이며, 실제 부과 기준과 다를 수 있습니다.
      </div>
    </div>
  )
}
