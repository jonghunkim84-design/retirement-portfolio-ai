import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { fmt } from '../api/client.js'

// ── 상수 ─────────────────────────────────────────────────────────
const RELATIONSHIP = {
  spouse:         { label: '배우자',      deduction: '6억',    badge: 'bg-purple-100 text-purple-700' },
  adult_child:    { label: '성인 자녀',   deduction: '5,000만', badge: 'bg-blue-100 text-blue-700' },
  minor_child:    { label: '미성년 자녀', deduction: '2,000만', badge: 'bg-sky-100 text-sky-700' },
  grandchild:     { label: '손자녀',      deduction: '5,000만', badge: 'bg-amber-100 text-amber-700' },
  other_relative: { label: '기타 친족',   deduction: '1,000만', badge: 'bg-green-100 text-green-700' },
  other:          { label: '타인',        deduction: '없음',    badge: 'bg-gray-100 text-gray-600' },
}

const THIS_YEAR = new Date().getFullYear()

const EMPTY_FORM = {
  recipient_name: '', relationship: 'adult_child', gift_type: 'one_time',
  amount: 0, start_year: THIS_YEAR + 1, end_year: '', memo: '', is_active: true,
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

// ── 증여 계획 입력 폼 ────────────────────────────────────────────
function GiftForm({ initial, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const submit = e => {
    e.preventDefault()
    onSubmit({
      ...form,
      amount:     Number(form.amount) || 0,
      start_year: Number(form.start_year),
      end_year:   form.gift_type === 'recurring' ? Number(form.end_year) || null : null,
      memo:       form.memo || null,
    })
  }

  return (
    <form onSubmit={submit} className="card border border-blue-100 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">
        {initial.id ? '✏️ 증여 계획 수정' : '➕ 증여 계획 등록'}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="수증자" required>
          <input value={form.recipient_name} onChange={e => set('recipient_name', e.target.value)}
                 placeholder="예: 첫째" required className={inputCls} />
        </Field>
        <Field label="관계" required>
          <select value={form.relationship} onChange={e => set('relationship', e.target.value)} className={inputCls}>
            {Object.entries(RELATIONSHIP).map(([v, r]) => (
              <option key={v} value={v}>{r.label} (공제 {r.deduction})</option>
            ))}
          </select>
        </Field>
        <Field label="유형" required>
          <select value={form.gift_type} onChange={e => set('gift_type', e.target.value)} className={inputCls}>
            <option value="one_time">일회성</option>
            <option value="recurring">정기 (매년 반복)</option>
          </select>
        </Field>
        <Field label={form.gift_type === 'recurring' ? '연간 증여 금액 (원)' : '증여 금액 (원)'} required>
          <input type="number" min="1" value={form.amount}
                 onChange={e => set('amount', e.target.value)} required className={inputCls} />
        </Field>
        <Field label={form.gift_type === 'recurring' ? '시작 연도' : '증여 연도'} required>
          <input type="number" min={THIS_YEAR} max={THIS_YEAR + 40} value={form.start_year}
                 onChange={e => set('start_year', e.target.value)} required className={inputCls} />
        </Field>
        {form.gift_type === 'recurring' && (
          <Field label="종료 연도" required>
            <input type="number" min={form.start_year} max={THIS_YEAR + 40} value={form.end_year}
                   onChange={e => set('end_year', e.target.value)} required className={inputCls} />
          </Field>
        )}
      </div>
      <Field label="메모">
        <input value={form.memo ?? ''} onChange={e => set('memo', e.target.value)}
               placeholder="예: 주택 자금 지원" className={inputCls} />
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
export default function EstatePlan() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)

  // 상속 목표 설정 입력 (만원 단위 입력 → 원 저장)
  const [targetInput, setTargetInput] = useState('')
  const [hasSpouse, setHasSpouse] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['estate-summary'],
    queryFn: () => api.get('/estate/summary').then(r => r.data),
  })

  useEffect(() => {
    if (data && !configLoaded) {
      setTargetInput(data.config.target_amount ? String(Math.round(data.config.target_amount / 10000)) : '')
      setHasSpouse(data.config.has_spouse)
      setConfigLoaded(true)
    }
  }, [data, configLoaded])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['estate-summary'] })
    qc.invalidateQueries({ queryKey: ['estate-schedule'] })
  }
  const onError = e => setError(e.response?.data?.detail ?? '저장에 실패했습니다')

  const configMut = useMutation({
    mutationFn: body => api.put('/estate/config', body),
    onSuccess: () => { setError(null); invalidate() },
    onError,
  })
  const saveMut = useMutation({
    mutationFn: body => body.id
      ? api.put(`/estate/gifts/${body.id}`, { ...body, id: undefined })
      : api.post('/estate/gifts', body),
    onSuccess: () => { setEditing(null); setError(null); invalidate() },
    onError,
  })
  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/estate/gifts/${id}`),
    onSuccess: invalidate, onError,
  })
  const toggleMut = useMutation({
    mutationFn: id => api.patch(`/estate/gifts/${id}/toggle`),
    onSuccess: invalidate, onError,
  })

  const saveConfig = () => configMut.mutate({
    target_amount: (Number(targetInput) || 0) * 10000,
    has_spouse: hasSpouse,
  })

  const plans = data?.plans ?? []
  const comp = data?.comparison
  const savings = comp?.savings ?? 0

  return (
    <div className="space-y-5">
      {/* ─── 헤더 ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">🎁 상속·증여 계획</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            사전증여 계획과 상속세 개산 — 증여 유출과 상속 목표는{' '}
            <Link to="/pension-plan" className="text-blue-500 underline">연금 계획</Link> 시뮬레이션에 반영됩니다
          </p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(EMPTY_FORM)}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 flex-shrink-0">
            + 증여 계획
          </button>
        )}
      </div>

      {/* ─── KPI ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="현재 총자산 (금융+실물)" value={fmt.eok(data?.assets?.total)}
                 sub={`금융 ${fmt.eok(data?.assets?.financial)} · 실물 ${fmt.eok(data?.assets?.real_net)}`} />
        <KpiCard label="계획된 증여 총액" value={fmt.eok(data?.total_gifts)}
                 color="text-blue-600" sub={`증여세 합계 ${fmt.won(comp?.with_gift?.gift_tax)}`} />
        <KpiCard label="예상 상속세 (현재 기준)" value={fmt.won(data?.inheritance?.tax)}
                 color="text-red-600"
                 sub={`실효세율 ${data?.inheritance?.effective_rate_pct ?? 0}%`} />
        <KpiCard label="사전증여 절세 효과" value={savings > 0 ? fmt.won(savings) : '없음'}
                 color={savings > 0 ? 'text-green-600' : 'text-gray-500'}
                 sub="10년 이상 생존 가정" />
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-xs text-red-600">
          ⚠️ {error}
        </div>
      )}

      {/* ─── 상속 목표 설정 ───────────────────────────────────── */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">🎯 상속 목표 설정</h2>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="남길 상속 목표 금액 (만원)">
            <input type="number" min="0" value={targetInput}
                   onChange={e => setTargetInput(e.target.value)}
                   placeholder="예: 50000 (5억)" className={`${inputCls} w-44`} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-2 cursor-pointer">
            <input type="checkbox" checked={hasSpouse} onChange={e => setHasSpouse(e.target.checked)}
                   className="w-4 h-4" />
            배우자 있음 (상속공제 +5억)
          </label>
          <button onClick={saveConfig} disabled={configMut.isPending}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">
            {configMut.isPending ? '저장 중...' : configMut.isSuccess ? '✓ 저장됨' : '저장'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          목표 금액은 연금 계획의 포트폴리오 잔액 차트에 목표선으로 표시됩니다
        </p>
      </div>

      {/* ─── 입력 폼 ──────────────────────────────────────────── */}
      {editing && (
        <GiftForm
          initial={editing}
          saving={saveMut.isPending}
          onSubmit={body => saveMut.mutate(editing.id ? { ...body, id: editing.id } : body)}
          onCancel={() => { setEditing(null); setError(null) }}
        />
      )}

      {/* ─── 증여 계획 목록 ───────────────────────────────────── */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">📋 증여 계획 목록</h2>
        {isLoading ? (
          <div className="text-sm text-gray-400 py-6 text-center">불러오는 중...</div>
        ) : plans.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">
            등록된 증여 계획이 없습니다 — 우측 상단 [+ 증여 계획]으로 추가하세요
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-2 text-left font-medium">수증자</th>
                  <th className="py-2 pr-2 text-left font-medium">관계</th>
                  <th className="py-2 pr-2 text-center font-medium">유형</th>
                  <th className="py-2 pr-2 text-center font-medium">기간</th>
                  <th className="py-2 pr-2 text-right font-medium">금액</th>
                  <th className="py-2 pr-2 text-right font-medium">예상 증여세</th>
                  <th className="py-2 text-center font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => {
                  const rel = RELATIONSHIP[p.relationship] ?? RELATIONSHIP.other
                  const isRecurring = p.gift_type === 'recurring'
                  const years = isRecurring
                    ? Math.max(1, (p.end_year ?? p.start_year) - p.start_year + 1) : 1
                  return (
                    <tr key={p.id} className={`border-b border-gray-50 ${!p.is_active ? 'opacity-40' : ''}`}>
                      <td className="py-2 pr-2 font-medium text-gray-700">
                        {p.recipient_name}
                        {p.memo && <span className="block text-[10px] text-gray-400">{p.memo}</span>}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${rel.badge}`}>
                          {rel.label}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-center text-gray-500">
                        {isRecurring ? `정기 (${years}년)` : '일회성'}
                      </td>
                      <td className="py-2 pr-2 text-center text-gray-500">
                        {isRecurring ? `${p.start_year}~${p.end_year}` : p.start_year}
                      </td>
                      <td className="py-2 pr-2 text-right font-medium text-gray-700">
                        {fmt.won(p.amount)}{isRecurring && <span className="text-gray-400">/년</span>}
                        {isRecurring && (
                          <span className="block text-[10px] text-gray-400">총 {fmt.won(p.amount * years)}</span>
                        )}
                      </td>
                      <td className={`py-2 pr-2 text-right font-bold ${
                        p.estimated_tax > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {p.estimated_tax == null ? '-' : p.estimated_tax === 0 ? '면세' : fmt.won(p.estimated_tax)}
                      </td>
                      <td className="py-2 text-center whitespace-nowrap">
                        <button onClick={() => setEditing({ ...EMPTY_FORM, ...p, end_year: p.end_year ?? '' })}
                                className="text-blue-500 hover:underline px-1">수정</button>
                        <button onClick={() => toggleMut.mutate(p.id)}
                                className="text-gray-400 hover:underline px-1">
                          {p.is_active ? '비활성' : '활성'}
                        </button>
                        <button onClick={() => window.confirm(`'${p.recipient_name}' 계획을 삭제할까요?`) && deleteMut.mutate(p.id)}
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

      {/* ─── 상속세 개산 + 사전증여 비교 ──────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">🏛 상속세 개산 (현재 자산 기준)</h2>
          <div className="space-y-1.5 text-xs">
            {[
              ['상속재산 (금융+실물 순자산)', fmt.won(data?.inheritance?.estate_value)],
              ['일괄공제', `− ${fmt.won(data?.inheritance?.lump_deduction)}`],
              ...(data?.inheritance?.spouse_deduction > 0
                ? [['배우자 상속공제 (최소)', `− ${fmt.won(data.inheritance.spouse_deduction)}`]] : []),
              ['금융재산공제', `− ${fmt.won(data?.inheritance?.financial_deduction)}`],
              ['과세표준', fmt.won(data?.inheritance?.taxable)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-gray-500">
                <span>{k}</span><span className="font-medium text-gray-700">{v}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-gray-100 pt-2 mt-2">
              <span className="font-semibold text-gray-700">예상 상속세</span>
              <span className="font-bold text-red-600">{fmt.won(data?.inheritance?.tax)}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">⚖️ 사전증여 vs 전액 상속</h2>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-gray-500">
              <span>A. 증여 없이 전액 상속 시 상속세</span>
              <span className="font-medium text-gray-700">{fmt.won(comp?.no_gift?.total_cost)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>B. 계획 증여 실행 — 증여세</span>
              <span className="font-medium text-gray-700">{fmt.won(comp?.with_gift?.gift_tax)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>B. 잔여 재산 상속세</span>
              <span className="font-medium text-gray-700">{fmt.won(comp?.with_gift?.inheritance_tax)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>B. 합계</span>
              <span className="font-medium text-gray-700">{fmt.won(comp?.with_gift?.total_cost)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-2 mt-2">
              <span className="font-semibold text-gray-700">절세 효과 (A − B)</span>
              <span className={`font-bold ${savings > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                {fmt.won(savings)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 주의사항 ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500 leading-relaxed space-y-1">
        <p>⚠️ <span className="font-medium text-gray-600">주의사항</span></p>
        {(data?.warnings ?? []).map((w, i) => <p key={i}>· {w}</p>)}
        <p>· 본 계산은 참고용 개산이며, 실행 전 반드시 세무사와 상담하세요.</p>
      </div>
    </div>
  )
}
