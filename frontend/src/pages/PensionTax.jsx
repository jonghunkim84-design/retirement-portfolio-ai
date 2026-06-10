import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { fmt } from '../api/client.js'

const LIMIT = 15_000_000

const STATUS = {
  safe:    { border: 'border-green-500',  bar: 'bg-green-400',  badge: 'bg-green-100 text-green-700',   label: '안전', text: 'text-green-600' },
  warning: { border: 'border-yellow-400', bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700', label: '주의', text: 'text-yellow-600' },
  danger:  { border: 'border-red-500',    bar: 'bg-red-400',    badge: 'bg-red-100 text-red-700',       label: '위험', text: 'text-red-600' },
}

const TAX_KO = {
  pension_savings:    '연금저축',
  retirement_pension: '퇴직연금(IRP)',
  isa:                'ISA',
  regular:            '일반',
}

function won(v) {
  if (v == null) return '-'
  const abs = Math.round(Math.abs(v))
  return (v < 0 ? '-' : '') + abs.toLocaleString('ko-KR') + '원'
}

function fmtYM(s) {
  if (!s) return '-'
  const [y, m] = s.slice(0, 7).split('-')
  return `${y}년 ${parseInt(m)}월`
}

function timelinePct(startStr, endStr) {
  if (!startStr || !endStr) return 0
  const start = new Date(startStr).getTime()
  const end   = new Date(endStr).getTime()
  const now   = Date.now()
  if (end <= start) return 100
  if (now <= start) return 0
  return Math.max(0, Math.min(99, (now - start) / (end - start) * 100))
}


// ── 연금 계획 설정 카드 ──────────────────────────────────────────────────────
function PlanSetupCard({ existing, onSave, isSaving }) {
  const init = {
    severance_principal:         existing?.severance_principal ?? '',
    pension_start_date:          existing?.pension_start_date  ?? '',
    monthly_pension_amount:      existing?.monthly_pension_amount ?? '',
    other_private_pension_annual: existing?.other_private_pension_annual ?? 0,
  }
  const [form, setForm] = useState(init)
  useEffect(() => { setForm(init) }, [existing?.pension_start_date])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const valid = form.severance_principal && form.pension_start_date && form.monthly_pension_amount

  return (
    <div className="card border-l-4 border-blue-400">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">📋 연금 계획 입력</h2>
      <p className="text-xs text-gray-400 mb-4">퇴직금 원금 소진 예측 및 월 수령액 가이드를 이용하려면 아래 정보를 입력하세요.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">IRP 이체 퇴직금 원금 (원)</label>
          <input type="number" placeholder="200000000" value={form.severance_principal}
            onChange={e => set('severance_principal', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">연금 수령 개시일</label>
          <input type="date" value={form.pension_start_date}
            onChange={e => set('pension_start_date', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">계획 월 수령액 (원)</label>
          <input type="number" placeholder="1000000" value={form.monthly_pension_amount}
            onChange={e => set('monthly_pension_amount', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">IRP 외 다른 사적연금 연간 수령액 (원)</label>
          <input type="number" placeholder="0" value={form.other_private_pension_annual}
            onChange={e => set('other_private_pension_annual', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <p className="text-[10px] text-gray-400 mt-0.5">연금저축 등 IRP 외 사적연금 수령액 합계</p>
        </div>
      </div>
      <button className="mt-4 btn-primary w-full" disabled={!valid || isSaving}
        onClick={() => onSave({
          severance_principal:         Number(form.severance_principal) || null,
          pension_start_date:          form.pension_start_date || null,
          monthly_pension_amount:      Number(form.monthly_pension_amount) || null,
          other_private_pension_annual: Number(form.other_private_pension_annual) || 0,
        })}>
        {isSaving ? '저장 중...' : '저장'}
      </button>
    </div>
  )
}


// ── 블록 1: 퇴직금 원금 소진 타임라인 ────────────────────────────────────────
function TimelineBlock({ depletion, plan }) {
  const pct    = timelinePct(plan.pension_start_date, depletion.depletion_date)
  const remain = depletion.remaining_principal

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">📊 퇴직금 원금 소진 타임라인</h2>
        {depletion.is_estimate && (
          <span title={depletion.assumption}
                className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full cursor-default">
            예상 ⓘ
          </span>
        )}
      </div>

      {depletion.is_depleted ? (
        <div className="bg-orange-50 border border-orange-200 text-orange-700 text-sm rounded-lg px-4 py-3">
          ⚠️ 퇴직금 원금이 소진되었습니다. 현재 <strong>운용수익 수령 단계</strong>입니다.
        </div>
      ) : (
        <>
          {/* 금액 요약 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: '이체 원금',   val: plan.severance_principal,       color: 'text-gray-700' },
              { label: '인출 누계',   val: depletion.withdrawn_principal,  color: 'text-gray-700' },
              { label: '잔여 원금',   val: remain,                          color: 'text-blue-700' },
              {
                label: '잔여 기간',
                val: depletion.months_remaining != null ? null : null,
                extra: depletion.months_remaining != null
                  ? `약 ${depletion.months_remaining}개월`
                  : '-',
                color: 'text-gray-700',
              },
            ].map(({ label, val, extra, color }) => (
              <div key={label} className="text-center bg-gray-50 rounded-lg p-3">
                <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
                <p className={`text-sm font-bold ${color}`}>{extra ?? won(val)}</p>
              </div>
            ))}
          </div>

          {/* 진행 바 */}
          <div className="mb-3">
            <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full transition-all duration-500"
                   style={{ width: `${pct}%` }} />
              {/* 현재 위치 마커 */}
              <div className="absolute top-0 bottom-0 w-0.5 bg-blue-700 z-10"
                   style={{ left: `${pct}%` }} />
            </div>
            <div className="flex justify-between mt-1.5 text-[11px] text-gray-400">
              <span>개시<br />{fmtYM(plan.pension_start_date)}</span>
              <span className="text-blue-600 font-medium text-center">
                ▲ 현재({pct.toFixed(0)}%)
              </span>
              <span className="text-right">
                {depletion.is_estimate ? '예상 소진' : '소진'}<br />
                {fmtYM(depletion.depletion_date)}
              </span>
            </div>
          </div>

          {/* 예상 안내 */}
          <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-800 mb-3">
            💡 현재 월 <strong>{won(plan.monthly_pension_amount)}</strong> 수령 기준,{' '}
            <strong>{fmtYM(depletion.depletion_date)}경</strong> 원금 소진 예상.
            {depletion.is_estimate && (
              <span className="text-gray-500">
                {' '}수령액 변경, 연금수령한도 제한, 추가 납입금 인출 순서에 따라 달라질 수 있습니다.
              </span>
            )}
          </div>

          {/* 원금 구간 안내 */}
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700">
            ✅ <strong>이 기간의 수령액은 연 1,500만원 한도와 무관합니다</strong> — 이연퇴직소득(퇴직금 원금)은
            퇴직소득세의 70%~60% 분리과세 적용. 한도 제한 없이 수령 가능합니다.
          </div>
        </>
      )}
    </div>
  )
}


// ── 블록 2: 운용수익 단계 월 수령액 가이드 ───────────────────────────────────
function MonthlyGuideBlock({ monthlyGuide, taxRate, onSaveOther }) {
  const [editing, setEditing]   = useState(false)
  const [otherVal, setOtherVal] = useState(monthlyGuide.other_annual)

  useEffect(() => { setOtherVal(monthlyGuide.other_annual) }, [monthlyGuide.other_annual])

  const S = monthlyGuide.over_other_pension ? STATUS.danger : STATUS.safe

  return (
    <div className={`card border-l-4 ${S.border}`}>
      <h2 className="text-sm font-semibold text-gray-700 mb-4">🏖 운용수익 단계 월 수령액 가이드</h2>

      {/* 큰 숫자 */}
      <div className="text-center py-4 mb-3">
        <p className="text-xs text-gray-400 mb-1">원금 소진 후 권장 월 수령액 상한</p>
        {monthlyGuide.over_other_pension ? (
          <p className="text-2xl font-bold text-red-600">한도 초과</p>
        ) : (
          <p className="text-3xl font-bold text-blue-700">
            월 {won(Math.round(monthlyGuide.monthly_limit))}
          </p>
        )}
      </div>

      {/* 계산 내역 */}
      <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 mb-3">
        (연 1,500만원 − 다른 사적연금 연{' '}
        <strong className="text-gray-700">{won(monthlyGuide.other_annual)}</strong>) ÷ 12
      </div>

      {/* 다른 사적연금 인라인 수정 */}
      <div className="flex items-center justify-between border-t pt-3 mb-3">
        <div>
          <p className="text-xs font-medium text-gray-600">IRP 외 다른 사적연금 연간 수령액</p>
          <p className="text-[10px] text-gray-400">연금저축 등 합산</p>
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <input type="number" value={otherVal} onChange={e => setOtherVal(Number(e.target.value))}
              className="w-32 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <button className="text-xs text-blue-600 font-medium"
              onClick={() => { onSaveOther(otherVal); setEditing(false) }}>저장</button>
            <button className="text-xs text-gray-400"
              onClick={() => { setOtherVal(monthlyGuide.other_annual); setEditing(false) }}>취소</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">{won(monthlyGuide.other_annual)}</span>
            <button className="text-xs text-blue-500 underline"
              onClick={() => setEditing(true)}>수정</button>
          </div>
        )}
      </div>

      {monthlyGuide.over_other_pension && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">
          ⚠️ 다른 사적연금만으로 이미 연 1,500만원 한도를 초과합니다. IRP 수령 시 전액 16.5% 분리과세 또는 종합과세 선택 대상이 됩니다.
        </div>
      )}

      {/* 현재 세율 */}
      {taxRate.rate_pct != null && (
        <div className="border-t pt-3 text-xs text-gray-500">
          현재 나이({taxRate.age}세) 기준 적용 세율:{' '}
          <strong className="text-gray-700">{taxRate.rate_pct}% ({taxRate.bracket})</strong> — 한도 내 수령 시 적용
        </div>
      )}
      {taxRate.rate_pct == null && (
        <div className="border-t pt-3 text-xs text-gray-400">{taxRate.bracket}</div>
      )}
    </div>
  )
}


// ── 블록 3: 당해 연도 한도 게이지 + 인출 기록 ────────────────────────────────
function LimitGaugeBlock({ limitYtd, withdrawalsYtd, accounts, onAdd, onDelete, isAdding }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    withdrawal_date: '', account_name: '', tax_account_type: '', amount: '', memo: '',
  })

  const S    = STATUS[limitYtd.status] ?? STATUS.safe
  const barW = Math.min(limitYtd.pct, 100)

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleAccountSelect = (name) => {
    const acct = accounts.find(a => a.account_name === name)
    setF('account_name', name)
    if (acct) setF('tax_account_type', acct.tax_account_type)
  }

  const resetForm = () => setForm({ withdrawal_date: '', account_name: '', tax_account_type: '', amount: '', memo: '' })

  return (
    <div className={`card border-l-4 ${S.border}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">📊 {limitYtd.year}년 연간 한도 게이지</h2>
        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${S.badge}`}>{S.label}</span>
      </div>

      {/* 금액 요약 3열 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <p className="text-[11px] text-gray-400 mb-0.5">올해 수령액</p>
          <p className={`text-lg font-bold ${S.text}`}>{won(limitYtd.ytd_amount)}</p>
        </div>
        <div className="text-center">
          <p className="text-[11px] text-gray-400 mb-0.5">연간 한도</p>
          <p className="text-lg font-bold text-gray-700">1,500만원</p>
        </div>
        <div className="text-center">
          <p className="text-[11px] text-gray-400 mb-0.5">잔여 여유분</p>
          <p className={`text-lg font-bold ${limitYtd.remaining >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
            {limitYtd.remaining >= 0 ? won(limitYtd.remaining) : `-${won(Math.abs(limitYtd.remaining))}`}
          </p>
        </div>
      </div>

      {/* 진행 바 */}
      <div className="mb-3">
        <div className="flex justify-between text-[11px] text-gray-400 mb-1">
          <span>0원</span>
          <span className="font-medium">{limitYtd.pct.toFixed(1)}% 소진</span>
          <span>1,500만원</span>
        </div>
        <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${S.bar} transition-all duration-500`}
               style={{ width: `${barW}%` }} />
          <div className="absolute top-0 bottom-0 w-0.5 bg-gray-400 opacity-50 z-10"
               style={{ left: '80%' }} />
        </div>
        <div className="flex justify-end text-[10px] text-gray-400 mt-0.5">
          <span>⚠ 80%</span>
        </div>
      </div>

      {/* 상태 메시지 */}
      {limitYtd.is_over_limit ? (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">
          🚨 <strong>한도 초과 — 올해 사적연금 수령액 전액이 16.5% 분리과세 또는 종합과세 선택 대상이 됩니다.</strong>
          세무사 상담을 권장합니다.
        </div>
      ) : limitYtd.remaining > 0 ? (
        <div className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg px-3 py-2 mb-3">
          ✅ 연말까지 저율(3.3~5.5%)로 더 수령 가능한 금액: <strong>{won(limitYtd.remaining)}</strong>
        </div>
      ) : null}

      {/* 내역 분류 */}
      <div className="text-xs text-gray-500 flex gap-4 mb-3">
        <span>연금저축: <strong className="text-gray-700">{won(limitYtd.pension_savings_ytd)}</strong></span>
        <span>IRP 운용수익: <strong className="text-gray-700">{won(limitYtd.retirement_pension_ytd)}</strong></span>
      </div>

      {/* 인출 기록 */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-gray-600">
            올해 인출 기록 ({withdrawalsYtd.length}건)
          </p>
          <button className="text-xs text-blue-600 font-medium hover:underline"
            onClick={() => { setShowForm(p => !p); resetForm() }}>
            {showForm ? '취소' : '+ 인출 추가'}
          </button>
        </div>

        {/* 인출 추가 폼 */}
        {showForm && (
          <div className="bg-gray-50 rounded-lg p-3 mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">날짜</label>
                <input type="date" value={form.withdrawal_date}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={e => setF('withdrawal_date', e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">계좌</label>
                <select value={form.account_name} onChange={e => handleAccountSelect(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5">
                  <option value="">계좌 선택</option>
                  {accounts.map(a => (
                    <option key={a.account_name} value={a.account_name}>
                      {a.account_name} ({TAX_KO[a.tax_account_type] ?? a.tax_account_type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">금액 (원)</label>
                <input type="number" placeholder="1250000" value={form.amount}
                  onChange={e => setF('amount', e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">메모</label>
                <input value={form.memo} onChange={e => setF('memo', e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5" />
              </div>
            </div>
            <button className="btn-primary w-full text-sm"
              disabled={!form.withdrawal_date || !form.account_name || !form.amount || isAdding}
              onClick={() => onAdd(form, () => { setShowForm(false); resetForm() })}>
              {isAdding ? '저장 중...' : '기록 추가'}
            </button>
          </div>
        )}

        {/* 기록 리스트 */}
        {withdrawalsYtd.length === 0 ? (
          <p className="text-xs text-gray-400 py-3 text-center">올해 인출 기록이 없습니다</p>
        ) : (
          <div className="space-y-0.5">
            {withdrawalsYtd.map(r => (
              <div key={r.id}
                className="flex items-center justify-between text-xs py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-400 flex-shrink-0">{r.withdrawal_date}</span>
                  <span className="text-gray-600 truncate">{r.account_name}</span>
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    r.tax_account_type === 'pension_savings'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}>
                    {TAX_KO[r.tax_account_type] ?? r.tax_account_type}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-medium text-gray-700">{won(r.amount)}</span>
                  <button className="text-red-400 hover:text-red-600 text-sm leading-none"
                    onClick={() => onDelete(r.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function PensionTax() {
  const qc = useQueryClient()
  const [showPlanForm, setShowPlanForm] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['pension-tax-summary'],
    queryFn:  () => api.get('/pension-tax/summary').then(r => r.data),
  })

  const { data: assetsData } = useQuery({
    queryKey: ['assets'],
    queryFn:  () => api.get('/assets').then(r => r.data),
  })

  // pension_savings / retirement_pension 계좌 중복 제거
  const pensionAccounts = (() => {
    const seen = new Set()
    return (assetsData || [])
      .filter(a => ['pension_savings', 'retirement_pension'].includes(a.tax_account_type) && a.is_active)
      .filter(a => { if (seen.has(a.account_name)) return false; seen.add(a.account_name); return true })
      .map(a => ({ account_name: a.account_name, tax_account_type: a.tax_account_type }))
  })()

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pension-tax-summary'] })

  const planMut = useMutation({
    mutationFn: body => api.put('/pension-tax/plan', body),
    onSuccess:  () => { invalidate(); setShowPlanForm(false) },
  })

  const addMut = useMutation({
    mutationFn: body => api.post('/withdrawals', body),
    onSuccess:  invalidate,
  })

  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/withdrawals/${id}`),
    onSuccess:  invalidate,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
    )
  }

  const handleAdd = (form, onDone) => {
    addMut.mutate({
      withdrawal_date:  form.withdrawal_date,
      account_name:     form.account_name,
      tax_account_type: form.tax_account_type,
      amount:           Number(form.amount),
      memo:             form.memo,
    }, { onSuccess: onDone })
  }

  return (
    <div className="space-y-5">

      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">🏖 연금 세금 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            퇴직금 원금 소진 예측 · 운용수익 단계 월 수령액 가이드 · 연간 한도 관리
          </p>
        </div>
        {data?.has_plan && (
          <button className="text-xs text-blue-600 underline flex-shrink-0 mt-1"
            onClick={() => setShowPlanForm(p => !p)}>
            {showPlanForm ? '취소' : '계획 수정'}
          </button>
        )}
      </div>

      {/* 연금 계획 설정 폼 */}
      {(!data?.has_plan || showPlanForm) && (
        <PlanSetupCard
          existing={data?.plan}
          onSave={body => planMut.mutate(body)}
          isSaving={planMut.isPending}
        />
      )}

      {/* 설정 완료 요약 배너 */}
      {data?.has_plan && !showPlanForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-xs text-blue-700">
          퇴직금 원금 <strong>{won(data.plan.severance_principal)}</strong> ·
          개시일 <strong>{data.plan.pension_start_date}</strong> ·
          월 <strong>{won(data.plan.monthly_pension_amount)}</strong> 수령 계획
        </div>
      )}

      {/* 블록 1: 타임라인 */}
      {data?.has_plan && data?.depletion && (
        <TimelineBlock depletion={data.depletion} plan={data.plan} />
      )}

      {/* 블록 2: 월 수령액 가이드 */}
      {data && (
        <MonthlyGuideBlock
          monthlyGuide={data.monthly_guide}
          taxRate={data.tax_rate}
          onSaveOther={val => planMut.mutate({ other_private_pension_annual: val })}
        />
      )}

      {/* 블록 3: 한도 게이지 */}
      {data && (
        <LimitGaugeBlock
          limitYtd={data.limit_ytd}
          withdrawalsYtd={data.withdrawals_ytd}
          accounts={pensionAccounts}
          onAdd={handleAdd}
          onDelete={id => deleteMut.mutate(id)}
          isAdding={addMut.isPending}
        />
      )}

      {/* 면책 문구 */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500 leading-relaxed">
        ⚠️ <span className="font-medium text-gray-600">주의사항</span> · 본 화면은 참고용 추정이며 세무 자문이 아닙니다.
        실제 세액은 금융기관 원천징수 내역 및 세무 전문가 상담으로 확인하세요.
        (세법 기준: 2024년 개정 연 1,500만원)
      </div>

    </div>
  )
}
