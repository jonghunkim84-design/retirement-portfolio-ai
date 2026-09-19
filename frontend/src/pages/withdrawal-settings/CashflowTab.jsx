import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client.js'
import { localToday, classifyItem, summarizeCashflow } from '../../lib/cashflow.js'
import { Modal, Field, Loading, errMsg, won } from './ui.jsx'

const TYPES = [
  { key: 'expense_essential',     label: '필수생활비' },
  { key: 'expense_discretionary', label: '선택생활비' },
  { key: 'income_regular',        label: '정기수입 (국민연금 등)' },
]

const STATUS_BADGE = {
  active:   <span className="badge-green">유효</span>,
  upcoming: <span className="badge-blue">예정</span>,
  ended:    <span className="badge-gray">종료</span>,
}

function ItemForm({ init, onSave, onCancel, saving, error }) {
  const [f, setF] = useState(init)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  return (
    <form className="space-y-3" onSubmit={e => {
      e.preventDefault()
      onSave({
        item_type: f.item_type, name: f.name.trim(), monthly_amount: Number(f.monthly_amount || 0),
        start_date: f.start_date || null, end_date: f.end_date || null, inflation_linked: f.inflation_linked,
      })
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="구분 *">
          <select className="w-full" value={f.item_type} onChange={e => set('item_type', e.target.value)}>
            {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="이름 *">
          <input className="w-full" required value={f.name} onChange={e => set('name', e.target.value)} placeholder="예: 관리비, 국민연금" />
        </Field>
        <Field label="월 금액 (원) *" className="col-span-2">
          <input className="w-full" type="number" min={0} required value={f.monthly_amount}
            onChange={e => set('monthly_amount', e.target.value)} />
        </Field>
        <Field label="시작일" hint="비우면 즉시 적용">
          <input className="w-full" type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label="종료일" hint="비우면 기간 제한 없음">
          <input className="w-full" type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="!p-0 !w-4 !h-4" checked={f.inflation_linked}
            onChange={e => set('inflation_linked', e.target.checked)} />
          물가 연동
        </label>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>취소</button>
      </div>
    </form>
  )
}

function Row({ label, monthly, annual, strong }) {
  return (
    <div className={`flex items-baseline justify-between py-1.5 ${strong ? 'border-t border-gray-200 mt-1 pt-2.5' : ''}`}>
      <span className={strong ? 'font-semibold text-gray-800' : 'text-gray-600'}>{label}</span>
      <span className="tabular-nums text-right">
        {monthly !== undefined && <span className="text-gray-400 text-xs mr-3">월 {won(monthly)}</span>}
        <span className={strong ? 'font-bold text-blue-700' : 'font-medium text-gray-800'}>연 {won(annual)}</span>
      </span>
    </div>
  )
}

export default function CashflowTab() {
  const qc = useQueryClient()
  const today = localToday()
  const [modal, setModal] = useState(null)   // { mode:'add'|'edit', data }
  const [formError, setFormError] = useState('')

  const { data: items, isLoading } = useQuery({
    queryKey: ['wd-cashflow'], queryFn: () => api.get('/cashflow-items').then(r => r.data),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['wd-cashflow'] })
  const save = useMutation({
    mutationFn: ({ id, body }) => (id ? api.put(`/cashflow-items/${id}`, body) : api.post('/cashflow-items', body)),
    onSuccess: () => { refresh(); setModal(null) },
    onError: e => setFormError(errMsg(e)),
  })
  const del = useMutation({
    mutationFn: id => api.delete(`/cashflow-items/${id}`), onSuccess: refresh,
  })

  if (isLoading) return <Loading />
  const s = summarizeCashflow(items, today)
  const openAdd = type => { setFormError(''); setModal({ mode: 'add', data: { item_type: type, name: '', monthly_amount: '', start_date: '', end_date: '', inflation_linked: false } }) }
  const openEdit = it => { setFormError(''); setModal({ mode: 'edit', data: { ...it, monthly_amount: String(it.monthly_amount), start_date: it.start_date || '', end_date: it.end_date || '' } }) }

  return (
    <div className="space-y-5">
      {TYPES.map(t => {
        const list = items.filter(i => i.item_type === t.key)
        return (
          <div key={t.key} className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">{t.label}</h3>
              <button className="btn-secondary text-sm" onClick={() => openAdd(t.key)}>+ 추가</button>
            </div>
            <table>
              <thead>
                <tr><th>이름</th><th className="text-right">월 금액</th><th>시작일</th><th>종료일</th><th>물가연동</th><th>상태</th><th /></tr>
              </thead>
              <tbody>
                {list.map(it => {
                  const st = classifyItem(it, today)
                  return (
                    <tr key={it.id} className={st === 'ended' ? 'text-gray-400' : ''}>
                      <td className="font-medium">{it.name}</td>
                      <td className="text-right tabular-nums">{won(it.monthly_amount)}</td>
                      <td>{it.start_date || '-'}</td>
                      <td>{it.end_date || '-'}</td>
                      <td>{it.inflation_linked ? '예' : '-'}</td>
                      <td>{STATUS_BADGE[st]}</td>
                      <td className="text-right whitespace-nowrap">
                        <button className="text-blue-600 text-sm mr-3" onClick={() => openEdit(it)}>수정</button>
                        <button className="btn-danger" onClick={() => { if (confirm(`'${it.name}' 항목을 삭제할까요?`)) del.mutate(it.id) }}>삭제</button>
                      </td>
                    </tr>
                  )
                })}
                {list.length === 0 && <tr><td colSpan={7} className="text-center text-gray-400 py-5">항목이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        )
      })}

      <div className="card">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">오늘({today}) 기준 유효 항목 합계</h3>
          <span className="text-xs text-gray-400">
            유효 {s.counts.active} · 예정 {s.counts.upcoming} · 종료 {s.counts.ended}
          </span>
        </div>
        <Row label="필수생활비" monthly={s.active.essentialMonthly} annual={s.active.essentialMonthly * 12} />
        <Row label="선택생활비" monthly={s.active.discretionaryMonthly} annual={s.active.discretionaryMonthly * 12} />
        <Row label="연간 지출 합계" monthly={s.active.expenseMonthly} annual={s.active.expenseAnnual} />
        <Row label="연간 정기수입 합계" monthly={s.active.incomeMonthly} annual={s.active.incomeAnnual} />
        <Row strong label="순인출 필요액 (연간 지출 − 연간 정기수입)" annual={s.active.netWithdrawalAnnual} />
        <p className="text-[11px] text-gray-400 mt-2">
          단순 합산입니다. 물가 연동·기간 변화·세금은 반영하지 않으며, 시작 전(예정)·종료된 항목은 합계에서 제외됩니다.
        </p>
      </div>

      {s.counts.upcoming > 0 && (
        <div className="card border-blue-100 bg-blue-50/40">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">
            <span className="badge-blue mr-2">예정</span>아직 개시되지 않은 항목 소계 <span className="font-normal text-blue-600">(위 합계에 포함되지 않음)</span>
          </h3>
          <Row label="예정 지출" monthly={s.upcoming.expenseMonthly} annual={s.upcoming.expenseAnnual} />
          <Row label="예정 정기수입" monthly={s.upcoming.incomeMonthly} annual={s.upcoming.incomeAnnual} />
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === 'add' ? '항목 추가' : '항목 수정'} onClose={() => setModal(null)}>
          <ItemForm init={modal.data} saving={save.isPending} error={formError}
            onCancel={() => setModal(null)}
            onSave={body => { setFormError(''); save.mutate({ id: modal.mode === 'edit' ? modal.data.id : null, body }) }} />
        </Modal>
      )}
    </div>
  )
}
