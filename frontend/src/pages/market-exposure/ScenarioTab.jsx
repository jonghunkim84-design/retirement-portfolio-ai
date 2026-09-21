import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client.js'
import {
  KIND_LABEL, scenarioBodyFromForm, scenarioErrorText, describeShock, describeCoverage, describeR01,
  describeScenarioChange, describeScenarioReasons, describeScenarioExcluded,
} from '../../lib/marketText.js'
import { Banner, Loading } from '../withdrawal-settings/ui.jsx'
import { Badge, Disclaimer, Section, Tag } from './parts.jsx'

const EMPTY_FORM = { kind: 'rate', delta: '1', equityMode: 'uniform', pct: '20', byRegion: {}, defaultPct: '', currency: 'USD' }

function Result({ r }) {
  const cov = describeCoverage(r)
  const r01 = describeR01(r.r01)
  const ch = describeScenarioChange(r)
  const reasons = describeScenarioReasons(r)
  const excluded = describeScenarioExcluded(r)
  const h = cov.headline
  return (
    <div className="space-y-4">
      <div className={`border rounded-xl px-5 py-4 ${r01.changed ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
        <div className="text-xs text-gray-500 mb-1">{r.label ?? describeShock(r)} · 기준일 {r.as_of}<Tag kind="assumed" /></div>
        <div className="text-sm text-gray-700">{h.label} 커버 연수</div>
        <div className="text-3xl font-bold tabular-nums text-gray-900 mt-0.5">
          {h.before} <span className="text-gray-400">→</span> {h.after}
        </div>
        {h.note && <p className="text-xs text-yellow-800 mt-2">{h.note}</p>}
        <p className="text-sm mt-2 text-gray-700">{r01.text}</p>
        {r.kind === 'inflation' && ch.needChange && <p className="text-sm mt-1 text-gray-700">{ch.needChange}</p>}
      </div>

      <Section title="자산 금액 변화">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm mb-3">
          <span>전체 <b className="text-lg tabular-nums">{ch.total}</b> <span className="text-gray-500">({ch.share})</span></span>
          {ch.byBucket.map(b => <span key={b.bucket} className="text-gray-600">{b.bucket}버킷 <b className="tabular-nums">{b.amount}</b></span>)}
        </div>
        {ch.byAsset.length > 0 ? (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>자산</th><th className="text-right">충격 전</th><th className="text-right">변화</th><th className="text-right">충격 후</th></tr></thead>
              <tbody>
                {ch.byAsset.map(a => (
                  <tr key={a.id}><td className="font-medium">{a.name}</td><td className="text-right tabular-nums">{a.before}</td>
                    <td className="text-right tabular-nums">{a.change}</td><td className="text-right tabular-nums">{a.after}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-gray-500">금액이 변하는 자산이 없습니다{r.kind === 'inflation' ? ' (물가 충격은 자산 가격이 아니라 생활비에 반영됩니다)' : ''}.</p>}
        {ch.noteInterest && <p className="text-xs text-gray-500 mt-2">{ch.noteInterest}</p>}
        {reasons.map(t => <p key={t} className="text-xs text-yellow-700 mt-2">{t}</p>)}
      </Section>

      <Section title="버킷별 커버 연수" note="연수 = 버킷 금액 ÷ 연 필요액. '수입 차감 전'은 정기수입을 빼기 전 필수생활비 총액, '수입 차감 후'는 02 점검과 같은 순인출 필요액 기준입니다. 수익률 0%·물가 미반영 계산을 충격 반영 입력으로 다시 계산한 결과입니다.">
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>버킷</th><th className="text-right">금액 (전 → 후)</th><th className="text-right">필수생활비 (수입 차감 전)</th><th className="text-right">필수생활비 (수입 차감 후)</th><th className="text-right">전체 생활비 (수입 차감 후)</th></tr></thead>
            <tbody>
              {cov.buckets.map(b => (
                <tr key={b.bucket}>
                  <td className="font-medium">{b.bucket}버킷</td>
                  <td className="text-right tabular-nums text-xs">{b.valueBefore} → {b.valueAfter}</td>
                  <td className="text-right tabular-nums font-medium">{b.grossBefore} → {b.grossAfter}</td>
                  <td className="text-right tabular-nums text-gray-500">{b.essentialBefore} → {b.essentialAfter}</td>
                  <td className="text-right tabular-nums text-gray-500">{b.totalBefore} → {b.totalAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {excluded.length > 0 && (
        <Section title={`계산에서 제외된 자산 (${excluded.length}건)`}>
          <ul className="text-sm text-gray-600 space-y-1">{excluded.map(x => <li key={x.id}><b>{x.name}</b> ({x.value}) — {x.text}</li>)}</ul>
        </Section>
      )}

      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">가정 목록 보기</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">{r.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
      </details>
    </div>
  )
}

export default function ScenarioTab() {
  const { data: presets, isLoading } = useQuery({ queryKey: ['scenario-presets'], queryFn: () => api.get('/exposure/scenario/presets').then(r => r.data) })
  const { data: exposure } = useQuery({ queryKey: ['exposure'], queryFn: () => api.get('/exposure').then(r => r.data), staleTime: 60_000 })
  const [form, setForm] = useState(EMPTY_FORM)
  const [running, setRunning] = useState(null)      // 실행 중인 프리셋 id 또는 'custom'
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const regions = (exposure?.equity.by_region ?? []).map(g => g.region).filter(Boolean)

  async function run(key, body) {
    setError(''); setRunning(key)
    try {
      setResult((await api.post('/exposure/scenario', body)).data)
    } catch (e) {
      setResult(null); setError(scenarioErrorText(e.response?.data?.detail) || e.message)
    } finally { setRunning(null) }
  }
  function runCustom() {
    const { body, error: err } = scenarioBodyFromForm(form)
    if (err) { setError(err); return }
    run('custom', body)
  }

  if (isLoading) return <Loading />
  return (
    <div className="space-y-4">
      <Disclaimer>예측이 아니라 가정에 따른 점검입니다. 한 번에 하나의 충격만 적용하며, 결과는 저장되지 않습니다.</Disclaimer>

      <Section title="프리셋">
        <div className="flex flex-wrap gap-2">
          {(presets ?? []).map(p => (
            <button key={p.id} className="btn-secondary text-sm" disabled={running !== null} onClick={() => run(p.id, { preset_id: p.id })}>
              {running === p.id ? '계산 중...' : p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="직접 입력">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">충격 종류</label>
            <select className="w-full" value={form.kind} onChange={e => set({ kind: e.target.value })}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {(form.kind === 'rate' || form.kind === 'inflation') && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">{form.kind === 'rate' ? '금리 변화 (%p, 예: 1 또는 -1)' : '물가 상승 (%p, 1년)'}</label>
              <input className="w-full" type="number" step="0.1" value={form.delta} onChange={e => set({ delta: e.target.value })} />
            </div>
          )}
          {form.kind === 'equity' && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">적용 방식</label>
                <select className="w-full" value={form.equityMode} onChange={e => set({ equityMode: e.target.value })}>
                  <option value="uniform">모든 지역 같은 하락률</option>
                  <option value="by_region">지역별 하락률</option>
                </select>
              </div>
              {form.equityMode === 'uniform' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">주가 하락률 (%)</label>
                  <input className="w-full" type="number" min={0} max={100} step="1" value={form.pct} onChange={e => set({ pct: e.target.value })} />
                </div>
              )}
            </>
          )}
          {form.kind === 'fx' && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">통화</label>
                <input className="w-full" value={form.currency} onChange={e => set({ currency: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">원화 환율 변화 (%, 예: -10 = 원화 강세)</label>
                <input className="w-full" type="number" step="1" value={form.pct} onChange={e => set({ pct: e.target.value })} />
              </div>
            </>
          )}
          <button className="btn-primary" disabled={running !== null} onClick={runCustom}>{running === 'custom' ? '계산 중...' : '시나리오 실행'}</button>
        </div>

        {form.kind === 'equity' && form.equityMode === 'by_region' && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {regions.length === 0 && <p className="col-span-full text-sm text-gray-500">지역이 입력된 주식성 자산이 없습니다. 인출 설정에서 지역을 입력하세요.</p>}
            {regions.map(rg => (
              <div key={rg}>
                <label className="text-xs text-gray-500 block mb-1">{rg} 하락률 (%)</label>
                <input className="w-full" type="number" min={0} max={100} step="1" value={form.byRegion[rg] ?? ''}
                  onChange={e => set({ byRegion: { ...form.byRegion, [rg]: e.target.value } })} />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-500 block mb-1">나머지 지역 (%)</label>
              <input className="w-full" type="number" min={0} max={100} step="1" placeholder="0" value={form.defaultPct} onChange={e => set({ defaultPct: e.target.value })} />
            </div>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">
          원/달러 환율 변화는 환헤지하지 않은 해당 통화 자산에만 적용하고 그 자산의 주가 변화는 0으로 둡니다(단일 충격). 물가 충격은 물가 연동으로 표시한 생활비 항목만 늘립니다.
        </p>
      </Section>

      {error && <Banner tone="red">{error}</Banner>}
      {result && <Result r={result} />}
    </div>
  )
}
