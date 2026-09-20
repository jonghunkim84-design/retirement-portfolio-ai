import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client.js'
import { TONE_BADGE } from '../../lib/withdrawalCheck.js'
import { CONCLUSION_LABEL, CONCLUSION_TONE, EXECUTED_LABEL, describeSummary, selectedPaymentText } from '../../lib/decisionText.js'
import { errMsg } from '../withdrawal-settings/ui.jsx'

function LogRow({ row }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)          // '다르게 실행함' 사유 입력 중
  const [reason, setReason] = useState(row.deviation_reason || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const eo = row.engine_output || {}
  const type = eo.conclusion?.type

  async function patch(body) {
    setBusy(true); setError('')
    try {
      await api.patch(`/decision-log/${row.id}`, body)
      setEditing(false)
      await qc.invalidateQueries({ queryKey: ['decision-log'] })
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const executedBadge = row.executed === true ? 'badge-green' : row.executed === false ? 'badge-yellow' : 'badge-gray'
  return (
    <tr>
      <td className="font-medium whitespace-nowrap">{row.period}</td>
      <td>
        <span className={TONE_BADGE[CONCLUSION_TONE[type]] ?? 'badge-gray'}>{CONCLUSION_LABEL[type] ?? '-'}</span>
        <div className="text-xs text-gray-500 mt-1 max-w-md">{eo.conclusion ? describeSummary(eo) : ''}</div>
      </td>
      <td className="whitespace-nowrap tabular-nums">{selectedPaymentText(eo)}</td>
      <td style={{ minWidth: 260 }}>
        <span className={executedBadge}>{EXECUTED_LABEL(row.executed)}</span>
        {row.executed === false && row.deviation_reason && !editing && (
          <div className="text-xs text-gray-600 mt-1">사유: {row.deviation_reason}</div>
        )}
        {editing ? (
          <div className="mt-2 space-y-1.5">
            <input className="w-full text-sm" placeholder="다르게 실행한 사유 (필수)" value={reason}
              onChange={e => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-primary text-xs px-3 py-1" disabled={busy || !reason.trim()}
                onClick={() => patch({ executed: false, deviation_reason: reason })}>저장</button>
              <button className="btn-secondary text-xs px-3 py-1" onClick={() => { setEditing(false); setReason(row.deviation_reason || '') }}>취소</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button className="btn-secondary text-xs px-2.5 py-1" disabled={busy || row.executed === true} onClick={() => patch({ executed: true })}>실행함</button>
            <button className="btn-secondary text-xs px-2.5 py-1" disabled={busy} onClick={() => setEditing(true)}>
              {row.executed === false ? '사유 수정' : '다르게 실행함'}
            </button>
            {row.executed !== null && row.executed !== undefined && (
              <button className="text-xs text-gray-400 hover:text-gray-600 px-1" disabled={busy} onClick={() => patch({ executed: null })}>미확인으로</button>
            )}
          </div>
        )}
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </td>
    </tr>
  )
}

/** 판단 기록 목록 — 분기별 결론·적용 지급액·실행 여부. '다르게 실행함'은 사유가 있어야 저장된다. */
export default function DecisionLog() {
  const { data: rows, isLoading, error } = useQuery({
    queryKey: ['decision-log'], queryFn: () => api.get('/decision-log').then(r => r.data),
  })
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">판단 기록</h3>
      {isLoading ? <div className="text-sm text-gray-400">불러오는 중...</div>
        : error ? <div className="text-sm text-red-600">기록을 불러오지 못했습니다.</div>
        : (rows || []).length === 0 ? <div className="text-sm text-gray-400 py-4 text-center">저장된 판단 기록이 없습니다. 위에서 판단을 실행하고 저장해 보세요.</div>
        : (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>분기</th><th>결론</th><th>적용 지급액</th><th>실행 여부</th></tr></thead>
              <tbody>{rows.map(r => <LogRow key={`${r.id}-${r.updated_at}`} row={r} />)}</tbody>
            </table>
          </div>
        )}
    </div>
  )
}
