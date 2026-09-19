import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client.js'
import { ratioToPctInput, pctInputToRatio, validateRatio, sumTargets } from '../../lib/pct.js'
import { Loading, Banner, errMsg } from './ui.jsx'

const CLASSES = [
  { key: 'cash',   label: '현금성',                 example: '예: 예금, MMF' },
  { key: 'bond',   label: '채권 (TDF·펀드 포함)',   example: '예: 단기채, 중기채, 장기채' },
  { key: 'equity', label: '주식',                   example: '예: 국내, 해외선진, 신흥' },
  { key: 'income', label: '리츠/인컴',              example: '예: 국내리츠, 해외리츠' },
]

let newKey = 0

export default function SubTargetsTab() {
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState({})   // { [id | 'new-N']: { sub_class, target, band } } — 손댄 행
  const [added, setAdded] = useState([])     // 아직 저장 안 된 새 행 [{ key, asset_class }]
  const [errors, setErrors] = useState({})

  const { data, isLoading } = useQuery({
    queryKey: ['wd-sub-targets'], queryFn: () => api.get('/sub-allocation-targets').then(r => r.data),
  })
  if (isLoading) return <Loading />

  const refresh = () => qc.invalidateQueries({ queryKey: ['wd-sub-targets'] })
  const baseOf = it => ({ sub_class: it.sub_class, target: ratioToPctInput(it.target_pct), band: ratioToPctInput(it.band_pct) })
  const valueOf = (key, base) => drafts[key] ?? base
  const setDraft = (key, base, field, v) => {
    setDrafts(d => ({ ...d, [key]: { ...(d[key] ?? base), [field]: v } }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }
  const clearDraft = key => setDrafts(d => { const n = { ...d }; delete n[key]; return n })

  async function saveRow(key, cls, id) {
    const v = valueOf(key, { sub_class: '', target: '', band: '' })
    const target = pctInputToRatio(v.target)
    const band = pctInputToRatio(v.band) ?? 0
    const err = !v.sub_class.trim() ? '하위 분류 이름을 입력하세요'
      : target === null ? '목표 비중을 입력하세요'
      : validateRatio(target, '목표 비중') || validateRatio(band, '허용 폭')
    if (err) { setErrors(e => ({ ...e, [key]: err })); return }
    const body = { asset_class: cls, sub_class: v.sub_class.trim(), target_pct: target, band_pct: band }
    try {
      if (id) await api.put(`/sub-allocation-targets/${id}`, body)
      else await api.post('/sub-allocation-targets', body)
      clearDraft(key)
      if (!id) setAdded(a => a.filter(x => x.key !== key))
      refresh()
    } catch (e) {
      setErrors(er => ({ ...er, [key]: errMsg(e) }))
    }
  }

  async function removeRow(key, id) {
    if (!id) { setAdded(a => a.filter(x => x.key !== key)); clearDraft(key); return }
    if (!confirm('이 항목을 삭제할까요?')) return
    try { await api.delete(`/sub-allocation-targets/${id}`); clearDraft(key); refresh() }
    catch (e) { setErrors(er => ({ ...er, [key]: errMsg(e) })) }
  }

  return (
    <div className="space-y-5">
      <Banner tone="blue">
        자산군 안에서의 비중을 % 로 입력합니다 (자산군별 합계 100%). 허용 폭은 목표에서 ±몇 %p 벗어나도 허용할지입니다.
        합계가 100% 가 아니어도 저장은 되지만 경고가 표시됩니다.
      </Banner>

      {CLASSES.map(c => {
        const saved = data.items.filter(i => i.asset_class === c.key)
        const fresh = added.filter(a => a.asset_class === c.key)
        // 저장 전 입력 중인 값까지 반영한 실시간 합계
        const ratios = [
          ...saved.map(it => pctInputToRatio(valueOf(it.id, baseOf(it)).target)),
          ...fresh.map(a => pctInputToRatio(valueOf(a.key, { target: '' }).target)),
        ].filter(r => r !== null && !Number.isNaN(r))
        const { sum, warning } = sumTargets(ratios)
        const hasRows = saved.length + fresh.length > 0

        return (
          <div key={c.key} className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">{c.label}</h3>
              <div className="flex items-center gap-3">
                {hasRows && (
                  <span className={`text-xs font-medium ${warning ? 'text-yellow-700' : 'text-green-700'}`}>
                    합계 {ratioToPctInput(sum)}%{warning ? ' ⚠️ 100%가 아닙니다' : ' ✓'}
                  </span>
                )}
                <button className="btn-secondary text-sm"
                  onClick={() => setAdded(a => [...a, { key: `new-${++newKey}`, asset_class: c.key }])}>+ 추가</button>
              </div>
            </div>
            <table>
              <thead><tr><th>하위 분류</th><th style={{ width: 130 }}>목표 비중(%)</th><th style={{ width: 130 }}>허용 폭(±%p)</th><th style={{ width: 150 }} /></tr></thead>
              <tbody>
                {[...saved.map(it => ({ key: it.id, id: it.id, base: baseOf(it) })),
                  ...fresh.map(a => ({ key: a.key, id: null, base: { sub_class: '', target: '', band: '' } }))].map(({ key, id, base }) => {
                  const v = valueOf(key, base)
                  const dirty = !id || JSON.stringify(v) !== JSON.stringify(base)
                  return (
                    <tr key={key}>
                      <td>
                        <input className="w-full" value={v.sub_class} placeholder={c.example}
                          onChange={e => setDraft(key, base, 'sub_class', e.target.value)} />
                        {errors[key] && <div className="text-[11px] text-red-600 mt-1">{errors[key]}</div>}
                      </td>
                      <td><input className="w-full" type="number" min={0} max={100} step="1" value={v.target}
                        onChange={e => setDraft(key, base, 'target', e.target.value)} /></td>
                      <td><input className="w-full" type="number" min={0} max={100} step="0.5" value={v.band}
                        onChange={e => setDraft(key, base, 'band', e.target.value)} /></td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-primary text-sm mr-2" disabled={!dirty} onClick={() => saveRow(key, c.key, id)}>저장</button>
                        <button className="btn-danger" onClick={() => removeRow(key, id)}>{id ? '삭제' : '취소'}</button>
                      </td>
                    </tr>
                  )
                })}
                {!hasRows && <tr><td colSpan={4} className="text-center text-gray-400 py-5">설정된 하위 분류가 없습니다. ({c.example})</td></tr>}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
