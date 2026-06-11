import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client.js'

const STATUS = {
  safe:    { border: 'border-green-500',  bar: 'bg-green-400',  badge: 'bg-green-100 text-green-700',   label: '안전', text: 'text-green-600' },
  warning: { border: 'border-yellow-400', bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700', label: '주의', text: 'text-yellow-600' },
  danger:  { border: 'border-red-500',    bar: 'bg-red-400',    badge: 'bg-red-100 text-red-700',       label: '위험', text: 'text-red-600' },
}

const TAX_KO = {
  pension_savings:    '개인연금(연금저축)',
  retirement_pension: '퇴직연금(IRP)',
  isa:                'ISA',
  regular:            '일반',
}

const ESTIMATE_TOOLTIP =
  '수령액 변경, 연금수령한도(평가액 기준 연차별 한도), 인출 실적에 따라 달라질 수 있습니다'

function won(v) {
  if (v == null) return '-'
  const abs = Math.round(Math.abs(v))
  return (v < 0 ? '-' : '') + abs.toLocaleString('ko-KR') + '원'
}

// 만 원 병기: "1,250,000원 (125만 원)"
function wonMan(v) {
  if (v == null) return '-'
  return `${won(v)} (${Math.round(v / 10_000).toLocaleString('ko-KR')}만 원)`
}

function fmtYM(s) {
  if (!s) return '-'
  const [y, m] = s.slice(0, 7).split('-')
  return `${y}년 ${parseInt(m)}월`
}


// ════════════════════════════════════════════════════════════════════════════
// 블록 0: 연금 계획 입력 패널 (퇴직연금 / 개인연금 두 카드)
// ════════════════════════════════════════════════════════════════════════════

function Field({ label, tooltip, children }) {
  return (
    <div>
      <label className="text-[11px] text-gray-500 block mb-1">
        {label}
        {tooltip && (
          <span title={tooltip}
                className="ml-1 inline-block text-blue-400 cursor-help select-none">ⓘ</span>
        )}
      </label>
      {children}
    </div>
  )
}

const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300'

function RpPlanCard({ track, onSave, isSaving }) {
  const plan = track.plan
  const [editing, setEditing] = useState(!track.active)
  const [form, setForm] = useState({
    severance_principal:    plan.principal ?? '',
    pension_start_date:     plan.start_date ?? '',
    monthly_pension_amount: plan.monthly_amount ?? '',
  })
  useEffect(() => {
    setEditing(!track.active)
    setForm({
      severance_principal:    plan.principal ?? '',
      pension_start_date:     plan.start_date ?? '',
      monthly_pension_amount: plan.monthly_amount ?? '',
    })
  }, [track.active, plan.start_date, plan.principal, plan.monthly_amount])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const valid = form.severance_principal && form.pension_start_date && form.monthly_pension_amount

  return (
    <div className="card border-l-4 border-blue-400">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">🏦 퇴직연금(IRP)</h3>
        {track.active && (
          <button className="text-xs text-blue-500 underline" onClick={() => setEditing(p => !p)}>
            {editing ? '취소' : '수정'}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="text-xs text-gray-600 space-y-1.5">
          <div className="flex justify-between"><span className="text-gray-400">퇴직금 원금</span><strong>{wonMan(plan.principal)}</strong></div>
          <div className="flex justify-between"><span className="text-gray-400">연금 개시일</span><strong>{plan.start_date}</strong></div>
          <div className="flex justify-between"><span className="text-gray-400">월 수령액</span><strong>{wonMan(plan.monthly_amount)}</strong></div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-gray-400">퇴직금 원금(이연퇴직소득)은 한도와 무관하게 수령되며, 소진 후 운용수익부터 과세 단계입니다.</p>
          <Field label="IRP 이체 퇴직금 원금 (원)">
            <input type="number" placeholder="200000000" value={form.severance_principal}
              onChange={e => set('severance_principal', e.target.value)} className={inputCls} />
          </Field>
          <Field label="연금 수령 개시일">
            <input type="date" value={form.pension_start_date}
              onChange={e => set('pension_start_date', e.target.value)} className={inputCls} />
          </Field>
          <Field label="계획 월 수령액 (원)">
            <input type="number" placeholder="1000000" value={form.monthly_pension_amount}
              onChange={e => set('monthly_pension_amount', e.target.value)} className={inputCls} />
          </Field>
          <button className="btn-primary w-full text-sm" disabled={!valid || isSaving}
            onClick={() => onSave({
              severance_principal:    Number(form.severance_principal) || null,
              pension_start_date:     form.pension_start_date || null,
              monthly_pension_amount: Number(form.monthly_pension_amount) || null,
            }, () => setEditing(false))}>
            {isSaving ? '저장 중...' : '저장'}
          </button>
          {!track.active && (
            <p className="text-[10px] text-gray-400">위 3개 값을 모두 입력하면 퇴직연금 트랙이 활성화됩니다.</p>
          )}
        </div>
      )}
    </div>
  )
}

const DEDUCTED_TOOLTIP =
  '이 금액은 운용수익과 동일하게 과세되며, 과세 시작 시점에는 영향을 주지 않습니다'

function PpPlanCard({ track, onSave, isSaving }) {
  const plan = track.plan
  const [editing, setEditing] = useState(!track.active)
  const [form, setForm] = useState({
    pp_non_deducted_principal: plan.non_deducted_principal ?? '',
    pp_deducted_principal:     plan.deducted_principal ?? '',
    pp_start_date:             plan.start_date ?? '',
    pp_monthly_amount:         plan.monthly_amount ?? '',
  })
  useEffect(() => {
    setEditing(!track.active)
    setForm({
      pp_non_deducted_principal: plan.non_deducted_principal ?? '',
      pp_deducted_principal:     plan.deducted_principal ?? '',
      pp_start_date:             plan.start_date ?? '',
      pp_monthly_amount:         plan.monthly_amount ?? '',
    })
  }, [track.active, plan.start_date, plan.non_deducted_principal, plan.deducted_principal, plan.monthly_amount])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const valid = form.pp_start_date && form.pp_monthly_amount

  return (
    <div className="card border-l-4 border-purple-400">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">💜 개인연금(연금저축)</h3>
        {track.active && (
          <button className="text-xs text-blue-500 underline" onClick={() => setEditing(p => !p)}>
            {editing ? '취소' : '수정'}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="text-xs text-gray-600 space-y-1.5">
          <div className="flex justify-between"><span className="text-gray-400">세액공제 받지 않은 원금</span><strong>{wonMan(plan.non_deducted_principal ?? 0)}</strong></div>
          <div className="flex justify-between">
            <span className="text-gray-400">세액공제 받은 원금 <span title={DEDUCTED_TOOLTIP} className="text-blue-400 cursor-help">ⓘ</span></span>
            <strong>{plan.deducted_principal != null ? wonMan(plan.deducted_principal) : '- (참고값)'}</strong>
          </div>
          <div className="flex justify-between"><span className="text-gray-400">연금 개시일</span><strong>{plan.start_date}</strong></div>
          <div className="flex justify-between"><span className="text-gray-400">월 수령액</span><strong>{wonMan(plan.monthly_amount)}</strong></div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-gray-400">세액공제 받지 않은 납입 원금이 먼저 비과세로 인출되고, 소진 후 과세 단계가 시작됩니다.</p>
          <Field label="세액공제 받지 않은 납입 원금 (원)">
            <input type="number" placeholder="36000000" value={form.pp_non_deducted_principal}
              onChange={e => set('pp_non_deducted_principal', e.target.value)} className={inputCls} />
          </Field>
          <Field label="세액공제 받은 납입 원금 (원) — 참고값" tooltip={DEDUCTED_TOOLTIP}>
            <input type="number" placeholder="50000000" value={form.pp_deducted_principal}
              onChange={e => set('pp_deducted_principal', e.target.value)} className={inputCls} />
          </Field>
          <Field label="연금 수령 개시일">
            <input type="date" value={form.pp_start_date}
              onChange={e => set('pp_start_date', e.target.value)} className={inputCls} />
          </Field>
          <Field label="계획 월 수령액 (원)">
            <input type="number" placeholder="600000" value={form.pp_monthly_amount}
              onChange={e => set('pp_monthly_amount', e.target.value)} className={inputCls} />
          </Field>
          <button className="btn-primary w-full text-sm" disabled={!valid || isSaving}
            onClick={() => onSave({
              pp_non_deducted_principal: form.pp_non_deducted_principal === '' ? null : Number(form.pp_non_deducted_principal),
              pp_deducted_principal:     form.pp_deducted_principal === '' ? null : Number(form.pp_deducted_principal),
              pp_start_date:             form.pp_start_date || null,
              pp_monthly_amount:         Number(form.pp_monthly_amount) || null,
            }, () => setEditing(false))}>
            {isSaving ? '저장 중...' : '저장'}
          </button>
          {!track.active && (
            <p className="text-[10px] text-gray-400">
              개시일과 월 수령액을 입력하면 개인연금 트랙이 활성화됩니다.
              개인연금을 쓰지 않으면 비워두세요 — 퇴직연금 단독으로 동작합니다.
            </p>
          )}
        </div>
      )}
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// 블록 1: 듀얼 타임라인
// ════════════════════════════════════════════════════════════════════════════

const MS_PER_MONTH = 30.44 * 24 * 3600 * 1000

function DualTimeline({ tracks }) {
  const rp = tracks.retirement_pension
  const pp = tracks.pension_savings
  const active = [rp, pp].filter(t => t.active && t.plan.start_date)

  if (active.length === 0) return null

  // 시간 축: 최초 개시일 ~ 최후 과세 전환 + 36개월 (전환 미상이면 개시 + 120개월)
  const starts = active.map(t => new Date(t.plan.start_date).getTime())
  const taxStarts = active.filter(t => t.tax_start_date).map(t => new Date(t.tax_start_date).getTime())
  const axisStart = Math.min(...starts, Date.now())
  const axisEnd = taxStarts.length
    ? Math.max(...taxStarts) + 36 * MS_PER_MONTH
    : Math.max(...starts) + 120 * MS_PER_MONTH
  const pos = t => Math.max(0, Math.min(100, ((t - axisStart) / (axisEnd - axisStart)) * 100))

  const nowPct = pos(Date.now())
  // 동시 과세 구간: 두 트랙 모두 과세 전환 후
  const dualFrom = (active.length === 2 && taxStarts.length === 2) ? Math.max(...taxStarts) : null

  const Row = ({ track, label, freeLabel, color }) => {
    const start = new Date(track.plan.start_date).getTime()
    const taxStart = track.tax_start_date ? new Date(track.tax_start_date).getTime() : null
    const startPct = pos(start)
    const taxPct = taxStart != null ? pos(taxStart) : null
    const isEstimate = track.depletion?.is_estimate

    return (
      <div className="mb-5 last:mb-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-gray-600">{label}</span>
          {taxStart != null && (
            <span className="text-[10px] text-gray-400">
              ▼ 과세 전환 {isEstimate ? '예상 ' : ''}{fmtYM(track.tax_start_date)}
              {isEstimate && <span title={ESTIMATE_TOOLTIP} className="ml-0.5 text-blue-400 cursor-help">ⓘ</span>}
            </span>
          )}
        </div>
        <div className="relative h-5 bg-gray-100 rounded">
          {taxPct != null ? (
            <>
              <div className={`absolute top-0 bottom-0 ${color} rounded-l`}
                   style={{ left: `${startPct}%`, width: `${Math.max(0, taxPct - startPct)}%` }} />
              <div className="absolute top-0 bottom-0 bg-orange-300 rounded-r"
                   style={{ left: `${taxPct}%`, width: `${100 - taxPct}%` }} />
              <div className="absolute -top-1 bottom-0 w-0.5 bg-orange-600 z-10"
                   style={{ left: `${taxPct}%` }} />
            </>
          ) : (
            <div className={`absolute top-0 bottom-0 ${color} rounded`}
                 style={{ left: `${startPct}%`, width: `${100 - startPct}%` }}
                 title="과세 전환 시점 추정 불가 (월 수령액 확인 필요)" />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
          <span>개시 {fmtYM(track.plan.start_date)} · {freeLabel}</span>
          {taxPct != null && <span className="text-orange-500">과세 구간 (한도 대상)</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">📊 과세 전환 듀얼 타임라인</h2>
        <span title={ESTIMATE_TOOLTIP}
              className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full cursor-default">예상 ⓘ</span>
      </div>

      {/* 모바일: 가로 스크롤 */}
      <div className="overflow-x-auto">
        <div className="relative min-w-[520px] pt-5 pb-1">
          {/* 동시 과세 구간 하이라이트 */}
          {dualFrom != null && (
            <div className="absolute top-0 bottom-0 bg-red-50 border-l-2 border-red-300 rounded-r z-0"
                 style={{ left: `${pos(dualFrom)}%`, right: 0 }}>
              <span className="absolute top-0 left-1 text-[9px] text-red-500 font-medium whitespace-nowrap">
                동시 과세 구간
              </span>
            </div>
          )}
          {/* 현재 날짜 세로선 */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-blue-600 z-20" style={{ left: `${nowPct}%` }}>
            <span className="absolute -top-0.5 left-1 text-[9px] text-blue-600 font-medium whitespace-nowrap">오늘</span>
          </div>

          <div className="relative z-10">
            {rp.active && rp.plan.start_date && (
              <Row track={rp} label="퇴직연금(IRP)" freeLabel="원금 구간 (한도 무관)" color="bg-blue-300" />
            )}
            {pp.active && pp.plan.start_date && (
              <Row track={pp} label="개인연금(연금저축)" freeLabel="비과세 원금 구간 (한도 무관)" color="bg-purple-300" />
            )}
          </div>
        </div>
      </div>

      {dualFrom != null && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
          🔴 <strong>동시 과세 구간 ({fmtYM(new Date(dualFrom).toISOString())}~)</strong> — 두 연금 합산
          연 1,500만 원 관리 필요. 이 기간에는 두 계좌 인출이 모두 한도에 합산됩니다.
        </div>
      )}
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// 블록 2: 구간별 권장 월 수령액 가이드
// ════════════════════════════════════════════════════════════════════════════

const PHASE_META = {
  tax_free: { icon: '🟢', title: '비과세 구간',  border: 'border-green-300',  desc: '모든 계좌가 비과세 풀(원금) 인출 중' },
  single:   { icon: '🟡', title: '단독 과세 구간', border: 'border-yellow-300', desc: '한 계좌만 과세 단계' },
  dual:     { icon: '🔴', title: '동시 과세 구간', border: 'border-red-300',    desc: '두 계좌 모두 과세 단계' },
}

function PhaseGuideBlock({ phases, overWarning, taxRate, monthlyCap }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">🧭 구간별 권장 월 수령액</h2>
      <p className="text-[11px] text-gray-400 mb-4">
        과세 전환 시점을 기준으로 시간 축을 3개 구간으로 나눠 권장 상한을 제시합니다 (예상 ⓘ)
      </p>

      {phases.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">
          연금 계획(개시일·월 수령액)을 입력하면 구간별 가이드가 표시됩니다.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {phases.map((p, i) => {
            const meta = PHASE_META[p.phase]
            return (
              <div key={i} className={`border ${meta.border} rounded-lg p-3 flex flex-col`}>
                <p className="text-xs font-semibold text-gray-700">{meta.icon} {meta.title}</p>
                <p className="text-[10px] text-gray-400 mb-2">
                  {fmtYM(p.from)} ~ {p.to ? fmtYM(p.to) : '이후'}
                </p>
                <p className="text-[10px] text-gray-500 mb-2">{meta.desc}
                  {p.taxable_accounts.length > 0 && (
                    <span> — {p.taxable_accounts.map(a => TAX_KO[a]).join(' + ')}</span>
                  )}
                </p>
                <div className="mt-auto pt-2 border-t border-gray-100">
                  {p.phase === 'tax_free' ? (
                    <p className="text-sm font-bold text-green-600">제한 없음 <span className="font-normal text-[10px] text-gray-400">(한도 무관)</span></p>
                  ) : p.phase === 'dual' ? (
                    <>
                      <p className="text-[10px] text-gray-400">두 연금 합계</p>
                      <p className="text-lg font-bold text-red-600">월 125만 원 이내 권장</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-gray-400">과세 계좌 기준</p>
                      <p className="text-sm font-bold text-yellow-600">월 {won(Math.round(p.monthly_cap))} 이내 권장</p>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 초과 예상 경고 */}
      {overWarning?.will_exceed && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2.5">
          🚨 <strong>현재 계획(합계 월 {wonMan(overWarning.planned_monthly_total)})대로면{' '}
          {overWarning.first_over_year}년부터 연 1,500만 원을 초과합니다</strong>
          {' '}— 초과 시 해당 연도 과세 대상 수령액 <strong>전액</strong>이 16.5% 분리과세 또는 종합과세 선택 대상이 됩니다.
        </div>
      )}
      {overWarning && !overWarning.will_exceed && overWarning.planned_monthly_total > 0 && (
        <div className="mt-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg px-3 py-2">
          ✅ 현재 계획(합계 월 {wonMan(overWarning.planned_monthly_total)}) 기준, 연 1,500만 원 한도 이내로 유지됩니다.
        </div>
      )}

      {/* 현재 세율 */}
      <div className="mt-3 border-t pt-3 text-xs text-gray-500">
        {taxRate.rate_pct != null ? (
          <>현재 나이({taxRate.age}세) 기준 한도 내 세율:{' '}
            <strong className="text-gray-700">{taxRate.rate_pct}% ({taxRate.bracket})</strong></>
        ) : taxRate.bracket}
      </div>
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// 블록 3: 당해 연도 한도 게이지 + 인출 기록
// ════════════════════════════════════════════════════════════════════════════

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
          <p className="text-[11px] text-gray-400 mb-0.5">올해 한도 대상 수령액</p>
          <p className={`text-lg font-bold ${S.text}`}>{won(limitYtd.ytd_amount)}</p>
        </div>
        <div className="text-center">
          <p className="text-[11px] text-gray-400 mb-0.5">연간 한도</p>
          <p className="text-lg font-bold text-gray-700">1,500만 원</p>
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
          <span>1,500만 원</span>
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
          🚨 <strong>한도 초과 — 올해 과세 대상 수령액 전액이 16.5% 분리과세 또는 종합과세 선택 대상이 됩니다.</strong>
          세무사 상담을 권장합니다.
        </div>
      ) : limitYtd.remaining > 0 ? (
        <div className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg px-3 py-2 mb-3">
          ✅ 연말까지 저율(3.3~5.5%)로 더 수령 가능: <strong>{wonMan(limitYtd.remaining)}</strong>
        </div>
      ) : null}

      {/* 계좌별 기여 내역 */}
      <div className="text-xs text-gray-500 flex gap-4 mb-3">
        <span>퇴직연금(IRP): <strong className="text-gray-700">{won(limitYtd.retirement_pension_ytd)}</strong></span>
        <span>개인연금(연금저축): <strong className="text-gray-700">{won(limitYtd.pension_savings_ytd)}</strong></span>
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


// ════════════════════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════════════════════

export default function PensionTax() {
  const qc = useQueryClient()

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
    onSuccess:  invalidate,
  })

  const addMut = useMutation({
    mutationFn: body => api.post('/withdrawals', body),
    onSuccess:  invalidate,
  })

  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/withdrawals/${id}`),
    onSuccess:  invalidate,
  })

  if (isLoading || !data) {
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

  const handlePlanSave = (body, onDone) => {
    planMut.mutate(body, { onSuccess: onDone })
  }

  return (
    <div className="space-y-5">

      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">🏖 연금 세금 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          퇴직연금·개인연금 과세 전환 예측 · 구간별 월 수령액 가이드 · 연간 1,500만 원 한도 관리
        </p>
      </div>

      {/* 블록 0: 연금 계획 두 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <RpPlanCard track={data.tracks.retirement_pension} onSave={handlePlanSave} isSaving={planMut.isPending} />
        <PpPlanCard track={data.tracks.pension_savings}    onSave={handlePlanSave} isSaving={planMut.isPending} />
      </div>

      {/* 블록 1: 듀얼 타임라인 */}
      {data.has_any_plan && <DualTimeline tracks={data.tracks} />}

      {/* 블록 2: 구간별 가이드 */}
      <PhaseGuideBlock
        phases={data.phases}
        overWarning={data.over_warning}
        taxRate={data.tax_rate}
        monthlyCap={data.monthly_cap}
      />

      {/* 블록 3: 한도 게이지 + 인출 기록 */}
      <LimitGaugeBlock
        limitYtd={data.limit_ytd}
        withdrawalsYtd={data.withdrawals_ytd}
        accounts={pensionAccounts}
        onAdd={handleAdd}
        onDelete={id => deleteMut.mutate(id)}
        isAdding={addMut.isPending}
      />

      {/* 면책 문구 */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500 leading-relaxed">
        ⚠️ <span className="font-medium text-gray-600">주의사항</span> · 본 화면은 참고용 추정이며 세무 자문이 아닙니다.
        실제 세액은 금융기관 원천징수 내역 및 세무 전문가 상담으로 확인하세요.
        (세법 기준: 2024년 개정 연 1,500만 원)
      </div>

    </div>
  )
}
