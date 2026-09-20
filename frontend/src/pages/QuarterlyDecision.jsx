import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import api from '../api/client.js'
import { marketInputFromForm, won } from '../lib/decisionText.js'
import { Banner, errMsg } from './withdrawal-settings/ui.jsx'
import DecisionResult from './quarterly-decision/DecisionResult.jsx'
import DecisionLog from './quarterly-decision/DecisionLog.jsx'

export default function QuarterlyDecision() {
  const qc = useQueryClient()
  const [indexName, setIndexName] = useState('')
  const [drawdown, setDrawdown] = useState('')
  const [running, setRunning] = useState(false)
  const [inputError, setInputError] = useState('')
  const [runError, setRunError] = useState('')
  const [result, setResult] = useState(null)
  const [kind, setKind] = useState('base')                // 저장할 지급액: base | recommended
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)             // { tone, text }

  async function run() {
    setInputError(''); setRunError(''); setSaveMsg(null)
    const { marketInput, error } = marketInputFromForm(indexName, drawdown)
    if (error) { setInputError(error); return }
    setRunning(true)
    try {
      const res = await api.post('/decision-engine/run', marketInput ? { market_input: marketInput } : {})
      setResult(res.data)
      setKind('base')
    } catch (e) {
      setRunError(errMsg(e)); setResult(null)
    } finally {
      setRunning(false)
    }
  }

  async function save(overwrite = false) {
    setSaving(true); setSaveMsg(null)
    try {
      await api.post(`/decision-log${overwrite ? '?overwrite=true' : ''}`, { engine_output: result, selected_payment_kind: kind })
      setSaveMsg({ tone: 'blue', text: `${result.period} 판단 기록을 저장했습니다.` })
      await qc.invalidateQueries({ queryKey: ['decision-log'] })
    } catch (e) {
      const detail = e.response?.data?.detail
      if (e.response?.status === 409 && detail?.code === 'period_exists') {
        setSaving(false)
        if (window.confirm(`${detail.period} 기록이 이미 있습니다.\n덮어쓰면 이전 판단과 실행 여부·사유가 사라집니다. 덮어쓸까요?`)) await save(true)
        return
      }
      setSaveMsg({ tone: 'red', text: errMsg(e) })
    } finally {
      setSaving(false)
    }
  }

  const rec = result?.payment.recommended_quarterly

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4">
        <h1 className="text-xl font-bold">🗓 분기 인출 판단</h1>
        <p className="text-blue-200 text-sm mt-1">이번 분기 생활비를 어디서 지급하고, 1버킷을 보충해야 하는지 규칙에 따라 판단합니다</p>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">시장 국면 입력</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">기준지수 이름 (선택)</label>
            <input className="w-full" placeholder="예: KOSPI, S&P500" value={indexName} onChange={e => setIndexName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">고점 대비 하락률 (%)</label>
            <input className={`w-full ${inputError ? '!border-red-400' : ''}`} type="number" min={0} max={100} step="0.1"
              placeholder="예: 12.5" value={drawdown} onChange={e => setDrawdown(e.target.value)} />
          </div>
          <button className="btn-primary" disabled={running} onClick={run}>{running ? '판단 중...' : '판단 실행'}</button>
        </div>
        {inputError && <p className="text-xs text-red-600 mt-2">{inputError}</p>}
        <p className="text-xs text-gray-500 mt-3 leading-relaxed">
          <b>본인 주식·리츠 자산이 추종하는 지수 기준으로 입력하세요.</b> 하락률이 하락 국면 기준(R-04) 이상이면 3버킷(주식·리츠) 자산은 매도 대상에서 제외됩니다.
          입력하지 않으면 <b>정상 국면으로 간주</b>합니다. 판단은 저장되지 않으며, 아래에서 저장을 눌러야 기록됩니다.
        </p>
      </div>

      {runError && <Banner tone="red">{runError}</Banner>}

      {result && (
        <>
          <DecisionResult result={result} />
          <div className="card border-l-4 border-blue-400">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">판단 기록 저장</h3>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-gray-600">적용할 지급액</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" className="!p-0" name="pay-kind" checked={kind === 'base'} onChange={() => setKind('base')} />
                기본 {won(result.payment.base_quarterly)}
              </label>
              {rec != null && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" className="!p-0" name="pay-kind" checked={kind === 'recommended'} onChange={() => setKind('recommended')} />
                  가드레일 권고 {won(rec)}
                </label>
              )}
              <button className="btn-primary" disabled={saving} onClick={() => save(false)}>{saving ? '저장 중...' : '판단 기록 저장'}</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              저장하는 것은 판단과 선택한 지급액뿐입니다. 자산 잔액이나 인출 기록은 바뀌지 않으며, 실제 인출은 인출 관리에서 직접 기록하세요.
              같은 분기 기록이 있으면 덮어쓰기 확인이 나옵니다.
            </p>
            {saveMsg && <div className="mt-3"><Banner tone={saveMsg.tone}>{saveMsg.text}</Banner></div>}
          </div>
        </>
      )}

      <DecisionLog />
    </div>
  )
}
