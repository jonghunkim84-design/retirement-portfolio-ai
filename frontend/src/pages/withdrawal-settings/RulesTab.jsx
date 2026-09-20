import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client.js'
import { ratioToPctInput } from '../../lib/pct.js'
import { RULE_SPECS, ruleToForm, formToParameters, formsEqual, serverErrorsToFields } from '../../lib/ruleForm.js'
import { Loading, Banner } from './ui.jsx'

function RuleCard({ rule, threshold }) {
  const qc = useQueryClient()
  const code = rule.rule_code
  const original = ruleToForm(rule)
  const [form, setForm] = useState(original)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = !formsEqual(form, original)
  useEffect(() => { setForm(ruleToForm(rule)) }, [rule.updated_at])       // 저장 후 서버 값으로 다시 맞춘다 (저장 완료 표시는 유지)
  const specs = RULE_SPECS[code] || []

  const setValue = (key, v) => { setForm(f => ({ ...f, values: { ...f.values, [key]: v } })); setSaved(false) }

  async function save() {
    setSaved(false)
    const { parameters, errors: e } = formToParameters(code, form)
    if (e) { setErrors(e); return }
    setSaving(true)
    try {
      await api.put(`/ips-rules/${code}`, { parameters, enabled: form.enabled })
      setErrors({})
      setSaved(true)
      await qc.invalidateQueries({ queryKey: ['wd-rules'] })
    } catch (err) {
      const detail = err.response?.data?.detail
      setErrors(Object.keys(serverErrorsToFields(detail)).length ? serverErrorsToFields(detail) : { _form: err.message })
    } finally {
      setSaving(false)
    }
  }

  const visible = specs.filter(f => !f.onlyMode || f.onlyMode === form.mode)
  const thresholdZero = threshold === 0
  return (
    <div className={`card ${form.enabled ? '' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge-blue">{code}</span>
            <h3 className="text-sm font-semibold text-gray-800">{rule.name}</h3>
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{rule.description}</p>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap cursor-pointer">
          <input type="checkbox" className="!p-0 !w-4 !h-4" checked={form.enabled}
            onChange={e => { setForm(f => ({ ...f, enabled: e.target.checked })); setSaved(false) }} />
          {form.enabled ? '사용 중' : '꺼짐'}
        </label>
      </div>

      {code === 'R-03' && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className="!p-0" name="r03-mode" checked={form.mode === 'config'}
                onChange={() => { setForm(f => ({ ...f, mode: 'config' })); setSaved(false) }} />
              기존 설정값 사용
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className="!p-0" name="r03-mode" checked={form.mode === 'relative'}
                onChange={() => { setForm(f => ({ ...f, mode: 'relative' })); setSaved(false) }} />
              목표 대비 상대 폭
            </label>
          </div>
          {form.mode === 'config' ? (
            <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              리밸런싱 설정의 허용 폭 <b>{threshold === undefined ? '불러오는 중...' : threshold === null ? '미설정 (기본 10%)' : `${ratioToPctInput(threshold)}%`}</b>
              <span className="text-gray-400 text-xs ml-1">(읽기 전용)</span>
              <Link to="/settings" className="text-blue-600 text-xs ml-2 hover:underline">설정 화면에서 수정 →</Link>
              {thresholdZero && (
                <div className="mt-1.5 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-2 py-1.5">
                  ⚠️ 허용 폭이 <b>0%</b> 입니다. 0이면 모든 자산군이 허용 폭 초과로 판정되어 작은 이탈도 매도 후보가 됩니다 (판단 결과에 <code>threshold_zero</code> 경고가 표시됩니다).
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">자산군별 허용 폭 = max(목표 비중 × 상대 폭, 최소 절대 폭). 예: 상대 폭 20%, 최소 3%p 이면 목표 25% 자산군은 ±5%p, 목표 10% 자산군은 ±3%p.</p>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visible.map(f => (
            <div key={f.key}>
              <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
              <div className="flex items-center gap-1.5">
                <input type="number" step="any" className={`w-full ${errors[f.key] ? '!border-red-400' : ''}`}
                  value={form.values[f.key] ?? ''} onChange={e => setValue(f.key, e.target.value)} />
                <span className="text-sm text-gray-500 w-6">{f.unit}</span>
              </div>
              {errors[f.key] && <p className="text-[11px] text-red-600 mt-1">{errors[f.key]}</p>}
            </div>
          ))}
        </div>
      )}
      {code === 'R-07' && <p className="text-xs text-gray-400">조정할 값이 없는 규칙입니다. 사용 여부만 정할 수 있습니다.</p>}
      {code === 'R-02' && <p className="text-[11px] text-gray-400 mt-2">2버킷 목표는 점검 결과에 참고로 표시되며, 분기 판단의 보충 여부에는 쓰지 않습니다.</p>}

      {errors._form && <p className="text-sm text-red-600 mt-2">{errors._form}</p>}
      <div className="flex items-center gap-3 mt-3">
        <button className="btn-primary text-sm" disabled={!dirty || saving} onClick={save}>{saving ? '저장 중...' : '저장'}</button>
        {saved && !dirty && <span className="text-xs text-green-700">✓ 저장했습니다</span>}
        {dirty && <span className="text-xs text-gray-400">변경됨 — 저장해야 반영됩니다</span>}
      </div>
    </div>
  )
}

export default function RulesTab() {
  const { data: rules, isLoading } = useQuery({
    queryKey: ['wd-rules'], queryFn: () => api.get('/ips-rules').then(r => r.data),
  })
  const { data: config } = useQuery({
    queryKey: ['wd-config'], queryFn: () => api.get('/config').then(r => r.data),
  })
  if (isLoading) return <Loading />
  const threshold = config === undefined ? undefined : (config?.portfolio?.rebalance_threshold ?? null)   // undefined=불러오는 중, null=미설정

  return (
    <div className="space-y-4">
      <Banner tone="blue">
        <b>기본값은 예시입니다. 본인의 재정 상황에 맞게 조정하세요.</b>
        {' '}규칙은 분기 인출 판단에서 그대로 적용되며, 꺼 두면 해당 규칙은 적용하지 않고 판단 결과에 "미적용"으로 표시됩니다.
        비율은 %, 연수는 "년", 배수는 "배"로 입력합니다.
      </Banner>
      {(rules || []).map(r => (
        <RuleCard key={r.rule_code} rule={r} threshold={threshold} />
      ))}
    </div>
  )
}
