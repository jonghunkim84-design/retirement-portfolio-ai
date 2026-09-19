import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client.js'
import { Field, Loading, Banner, errMsg } from './ui.jsx'

const EMPTY = { withdrawal_start_date: '', initial_portfolio_value: '', initial_annual_withdrawal: '' }

export default function BaselineTab() {
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY)
  const [msg, setMsg] = useState(null)   // { tone, text }

  const { data, isLoading } = useQuery({
    queryKey: ['wd-baseline'],
    queryFn: () => api.get('/withdrawal-baseline').then(r => r.data),   // 미설정이면 null
  })

  useEffect(() => {
    if (isLoading) return
    setForm(data ? {
      withdrawal_start_date: data.withdrawal_start_date,
      initial_portfolio_value: String(data.initial_portfolio_value),
      initial_annual_withdrawal: String(data.initial_annual_withdrawal),
    } : EMPTY)
  }, [data, isLoading])

  const refresh = () => qc.invalidateQueries({ queryKey: ['wd-baseline'] })
  const save = useMutation({
    mutationFn: body => api.put('/withdrawal-baseline', body),
    onSuccess: () => { refresh(); setMsg({ tone: 'blue', text: '저장했습니다.' }) },
    onError: e => setMsg({ tone: 'red', text: errMsg(e) }),
  })
  const del = useMutation({
    mutationFn: () => api.delete('/withdrawal-baseline'),
    onSuccess: () => { refresh(); setMsg({ tone: 'blue', text: '인출 기준점을 삭제했습니다.' }) },
    onError: e => setMsg({ tone: 'red', text: errMsg(e) }),
  })

  if (isLoading) return <Loading />
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="card max-w-xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">인출 기준점</h3>
        <p className="text-xs text-gray-400 mt-1">
          인출을 시작한 시점의 값입니다. 이후 단계에서 초기 인출률의 기준으로 사용하며, 여기서는 저장만 합니다. (사용자당 1건)
        </p>
      </div>
      <form className="space-y-3" onSubmit={e => {
        e.preventDefault(); setMsg(null)
        save.mutate({
          withdrawal_start_date: form.withdrawal_start_date,
          initial_portfolio_value: Number(form.initial_portfolio_value),
          initial_annual_withdrawal: Number(form.initial_annual_withdrawal),
        })
      }}>
        <Field label="인출 시작일 *">
          <input className="w-full" type="date" required value={form.withdrawal_start_date}
            onChange={e => set('withdrawal_start_date', e.target.value)} />
        </Field>
        <Field label="인출 시작 시점 투자자산 (원) *">
          <input className="w-full" type="number" min={0} required value={form.initial_portfolio_value}
            onChange={e => set('initial_portfolio_value', e.target.value)} />
        </Field>
        <Field label="인출 시작 시점 연간 인출액 (원) *">
          <input className="w-full" type="number" min={0} required value={form.initial_annual_withdrawal}
            onChange={e => set('initial_annual_withdrawal', e.target.value)} />
        </Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            {save.isPending ? '저장 중...' : data ? '수정 저장' : '저장'}
          </button>
          {data && (
            <button type="button" className="btn-danger" disabled={del.isPending}
              onClick={() => { if (confirm('인출 기준점을 삭제할까요?')) del.mutate() }}>삭제</button>
          )}
        </div>
      </form>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
    </div>
  )
}
