import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { fmt, ASSET_TYPE_LABEL } from '../api/client.js'

const EMPTY = {
  account_name: '', asset_name: '', ticker: '', asset_type: 'cash',
  quantity: 0, unit_price: 0, current_value: 0,
  purchase_date: '', is_active: true, maturity_date: '',
  investment_amount: '',
}

const ASSET_TYPES = ['cash', 'bond', 'tdf', 'fund', 'equity', 'income']

// 만기일이 오늘~7일 이내이면 true
function isExpiringSoon(dateStr) {
  if (!dateStr) return false
  const diff = (new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 7
}
const TYPE_BADGE  = { cash:'badge-blue', bond:'badge-green', tdf:'badge-green',
                      fund:'badge-green', equity:'badge-yellow', income:'badge-yellow' }

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AssetForm({ init, onSave, onCancel, saving }) {
  const [form, setForm] = useState(init)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">계좌명 *</label>
          <input value={form.account_name} onChange={e => set('account_name', e.target.value)} required className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">자산명 *</label>
          <input value={form.asset_name} onChange={e => set('asset_name', e.target.value)} required className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">자산 유형 *</label>
          <select value={form.asset_type} onChange={e => set('asset_type', e.target.value)} className="w-full">
            {ASSET_TYPES.map(t => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">종목 코드 (있을 때만)</label>
          <input value={form.ticker} onChange={e => set('ticker', e.target.value)} placeholder="예: 379800" className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">수량</label>
          <input type="number" value={form.quantity} onChange={e => set('quantity', +e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">현재가 (원)</label>
          <input type="number" value={form.unit_price} onChange={e => set('unit_price', +e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">현재 평가액 (원) *</label>
          <input type="number" value={form.current_value} onChange={e => set('current_value', +e.target.value)} required className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">매입일 (시작일)</label>
          <input type="date" value={form.purchase_date || ''} onChange={e => set('purchase_date', e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">입금액 (원) — 매수 원금</label>
          <input type="number" value={form.investment_amount || ''} placeholder="예: 50000000"
            onChange={e => set('investment_amount', e.target.value ? +e.target.value : null)} className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">만기일 (예금/채권)</label>
          <input type="date" value={form.maturity_date || ''} onChange={e => set('maturity_date', e.target.value)} className="w-full" />
        </div>
        <div className="flex items-center gap-2 pt-4">
          <input type="checkbox" id="is_active" checked={form.is_active}
            onChange={e => set('is_active', e.target.checked)} className="w-4 h-4" />
          <label htmlFor="is_active" className="text-sm text-gray-600">활성 자산</label>
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>취소</button>
      </div>
    </form>
  )
}

export default function Assets() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState({ type: '', active: 'active', account: '' })
  const [modal,  setModal]  = useState(null)   // null | { mode: 'add'|'edit', data }
  const [saveErr, setSaveErr] = useState('')    // 저장 오류 메시지

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: () => api.get('/assets').then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: body => api.post('/assets', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); setModal(null); setSaveErr('') },
    onError:   (err) => setSaveErr(err.response?.data?.detail
                          ? JSON.stringify(err.response.data.detail)
                          : err.message || '저장 중 오류가 발생했습니다.'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/assets/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); setModal(null); setSaveErr('') },
    onError:   (err) => setSaveErr(err.response?.data?.detail
                          ? JSON.stringify(err.response.data.detail)
                          : err.message || '수정 중 오류가 발생했습니다.'),
  })
  const deleteMut = useMutation({
    mutationFn: id => api.delete(`/assets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  })
  const toggleMut = useMutation({
    mutationFn: id => api.patch(`/assets/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  })

  const filtered = assets.filter(a => {
    if (filter.type && a.asset_type !== filter.type) return false
    if (filter.active === 'active' && !a.is_active) return false
    if (filter.active === 'inactive' && a.is_active) return false
    if (filter.account && !a.account_name.includes(filter.account)) return false
    return true
  })

  const total = filtered.filter(a => a.is_active).reduce((s, a) => s + a.current_value, 0)

  // 빈 문자열 → null 변환 (백엔드 Pydantic 타입 오류 방지)
  const cleanForm = (form) => ({
    ...form,
    ticker:            form.ticker            || null,
    purchase_date:     form.purchase_date     || null,
    maturity_date:     form.maturity_date     || null,
    investment_amount: (form.investment_amount !== '' && form.investment_amount != null)
                         ? Number(form.investment_amount) : null,
    quantity:    Number(form.quantity)    || 0,
    unit_price:  Number(form.unit_price)  || 0,
    current_value: Number(form.current_value) || 0,
  })

  const handleSave = (form) => {
    setSaveErr('')
    const body = cleanForm(form)
    if (modal.mode === 'add') createMut.mutate(body)
    else updateMut.mutate({ id: modal.data.id, body })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">📋 자산 관리</h1>
        <button className="btn-primary" onClick={() => setModal({ mode: 'add', data: EMPTY })}>
          + 자산 추가
        </button>
      </div>

      {/* 필터 */}
      <div className="card flex gap-3 items-center flex-wrap">
        <select value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))} className="text-sm">
          <option value="">전체 유형</option>
          {ASSET_TYPES.map(t => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
        </select>
        <select value={filter.active} onChange={e => setFilter(f => ({ ...f, active: e.target.value }))} className="text-sm">
          <option value="">전체</option>
          <option value="active">활성만</option>
          <option value="inactive">비활성만</option>
        </select>
        <input value={filter.account} onChange={e => setFilter(f => ({ ...f, account: e.target.value }))}
          placeholder="계좌명 검색..." className="text-sm w-40" />
        <div className="ml-auto text-sm text-gray-500">
          {filtered.length}개 · 합계 <strong>{fmt.eok(total)}</strong>
        </div>
      </div>

      {/* 테이블 */}
      <div className="card p-0 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">불러오는 중...</div>
        ) : (
          <table>
            <thead><tr>
              <th>계좌</th><th>자산명</th><th>유형</th><th>티커</th>
              <th className="text-right">수량</th><th className="text-right">현재가</th>
              <th className="text-right">입금액</th>
              <th className="text-right">평가액</th>
              <th>매입일</th><th>만기일</th><th>상태</th><th>관리</th>
            </tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} className={!a.is_active ? 'opacity-40' : ''}>
                  <td className="font-medium text-gray-700">{a.account_name}</td>
                  <td>{a.asset_name}</td>
                  <td><span className={TYPE_BADGE[a.asset_type] || 'badge-gray'}>{ASSET_TYPE_LABEL[a.asset_type] || a.asset_type}</span></td>
                  <td className="font-mono text-xs text-gray-500">{a.ticker || '-'}</td>
                  <td className="text-right">{a.quantity > 0 ? a.quantity.toLocaleString() : '-'}</td>
                  <td className="text-right">{a.unit_price > 0 ? fmt.won(a.unit_price) : '-'}</td>
                  <td className="text-right text-blue-600">{a.investment_amount ? fmt.won(a.investment_amount) : <span className="text-gray-300">-</span>}</td>
                  <td className="text-right font-medium">{fmt.won(a.current_value)}</td>
                  <td className="text-xs text-gray-400">{fmt.date(a.purchase_date)}</td>
                  <td className={`text-xs font-medium ${
                    isExpiringSoon(a.maturity_date)
                      ? 'text-red-600 animate-pulse'
                      : 'text-gray-400'}`}>
                    {fmt.date(a.maturity_date)}
                    {isExpiringSoon(a.maturity_date) && <span className="ml-1">⚠️</span>}
                  </td>
                  <td>
                    <button onClick={() => toggleMut.mutate(a.id)}
                      className={`text-xs px-2 py-0.5 rounded-full border ${a.is_active ? 'border-green-300 text-green-600' : 'border-gray-300 text-gray-400'}`}>
                      {a.is_active ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1"
                        onClick={() => setModal({ mode: 'edit', data: a })}>수정</button>
                      <button className="text-red-400 hover:text-red-600 text-xs px-2 py-1"
                        onClick={() => { if (confirm(`"${a.asset_name}" 삭제할까요?`)) deleteMut.mutate(a.id) }}>삭제</button>
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
        <Modal title={modal.mode === 'add' ? '자산 추가' : '자산 수정'}
               onClose={() => { setModal(null); setSaveErr('') }}>
          {saveErr && (
            <div className="mb-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 flex items-start gap-2">
              <span className="flex-shrink-0">⚠️</span>
              <span>{saveErr}</span>
            </div>
          )}
          <AssetForm
            init={modal.data}
            onSave={handleSave}
            onCancel={() => { setModal(null); setSaveErr('') }}
            saving={createMut.isPending || updateMut.isPending}
          />
        </Modal>
      )}
    </div>
  )
}
