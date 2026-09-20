import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api, { ASSET_TYPE_LABEL } from '../../api/client.js'
import { localToday } from '../../lib/cashflow.js'
import {
  ROLES, ROLE_LABEL, fieldEnabled, suggestedForm, formFromProfile,
  formsEqual, toPayload, bondWarning,
} from '../../lib/holdingProfile.js'
import { Loading, errMsg, won } from './ui.jsx'

const cellInput = 'w-full text-xs px-2 py-1'
const disabledCls = 'bg-gray-50 text-gray-300 cursor-not-allowed'
// 머리글 행은 위에, 자산 열은 왼쪽에 고정 (엑셀의 틀 고정). 겹치는 순서: 모서리 > 머리글 > 자산 열
const TH = 'sticky top-0 z-20 bg-gray-50'
const TH_CORNER = 'sticky left-0 top-0 z-30 bg-gray-50'
const TH_STYLE = { boxShadow: '0 1px 0 #e5e7eb' }
const MIN_BOX_HEIGHT = 320

export default function HoldingProfilesTab() {
  const qc = useQueryClient()
  const today = localToday()
  const [drafts, setDrafts] = useState({})        // { [assetId]: form } — 사용자가 손댄 행만
  const [errors, setErrors] = useState({})        // { [assetId]: 메시지 }
  const [saving, setSaving] = useState({})        // { [assetId]: true }
  const [batchMsg, setBatchMsg] = useState('')

  // 표 상자를 화면 아래 끝까지 채운다: 세로·가로 스크롤 막대가 항상 보이는 화면 안에 있고, 머리글은 고정된다.
  // 높이는 페이지 스크롤 0 기준의 상자 위치로 계산한다(스크롤할 때마다 바꾸면 페이지 높이가 따라 늘어난다).
  const boxRef = useRef(null)
  const [boxHeight, setBoxHeight] = useState(560)

  // 활성 자산 전체 + 속성 + 버킷(기본/실효/출처)을 서버가 한 번에 준다. 기본 버킷의 단일 출처는 서버(BUCKET_MAP).
  const { data: overview, isLoading } = useQuery({
    queryKey: ['wd-overview'], queryFn: () => api.get('/holding-profiles/overview').then(r => r.data),
  })

  const rows = useMemo(() => {
    if (!overview) return []
    return overview.items                                  // 서버가 금액 내림차순으로 정렬해 준다
      .map(({ asset, profile, default_bucket: defaultBucket }) => {
        const base = profile ? formFromProfile(profile) : suggestedForm(asset, today)
        const draft = drafts[asset.id]
        const form = draft ?? base
        const edited = !!draft && !formsEqual(draft, base)
        const status = edited ? 'edited' : profile ? 'saved' : 'suggested'
        return { asset, profile, form, status, defaultBucket }
      })
  }, [overview, drafts, today])

  useLayoutEffect(() => {
    const fit = () => {
      const el = boxRef.current
      if (!el) return
      const bottomGap = window.innerWidth < 768 ? 84 : 24          // 모바일은 하단 탭 바 위로
      const top = el.getBoundingClientRect().top + window.scrollY
      setBoxHeight(Math.max(MIN_BOX_HEIGHT, Math.floor(window.innerHeight - top - bottomGap)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [isLoading, batchMsg, rows.length])

  if (isLoading) return <Loading />

  const total = rows.length
  const done = rows.filter(r => r.profile).length
  const editedRows = rows.filter(r => r.status === 'edited')

  const setField = (asset, base, field, value) => {
    setDrafts(d => ({ ...d, [asset.id]: { ...(d[asset.id] ?? base), [field]: value } }))
    setErrors(e => ({ ...e, [asset.id]: undefined }))
  }

  async function saveRow({ asset, form }) {
    const { payload, error } = toPayload(form, asset, today)
    if (error) { setErrors(e => ({ ...e, [asset.id]: error })); return false }
    setSaving(s => ({ ...s, [asset.id]: true }))
    try {
      await api.put(`/holding-profiles/${asset.id}`, payload)
      setDrafts(d => { const n = { ...d }; delete n[asset.id]; return n })
      setErrors(e => ({ ...e, [asset.id]: undefined }))
      return true
    } catch (e) {
      setErrors(er => ({ ...er, [asset.id]: errMsg(e) }))
      return false
    } finally {
      setSaving(s => ({ ...s, [asset.id]: false }))
    }
  }

  async function saveOne(row) {
    setBatchMsg('')
    await saveRow(row)
    qc.invalidateQueries({ queryKey: ['wd-overview'] })
  }

  async function saveAllEdited() {
    setBatchMsg('')
    const results = await Promise.all(editedRows.map(saveRow))
    qc.invalidateQueries({ queryKey: ['wd-overview'] })
    const ok = results.filter(Boolean).length
    setBatchMsg(`${ok}개 저장${ok < results.length ? `, ${results.length - ok}개 실패 (행의 오류 문구 확인)` : ''}`)
  }

  const STATUS_BADGE = {
    saved:     <span className="badge-green">저장됨</span>,
    edited:    <span className="badge-blue">변경됨</span>,
    suggested: <span className="badge-gray">미저장(제안)</span>,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-800">
            전체 {total}개 중 <span className="text-blue-600">{done}개</span> 입력
            <span className="text-gray-400 font-normal ml-2">({total - done}개 미입력)</span>
          </div>
          <div className="mt-1.5 h-2 w-64 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {batchMsg && <span className="text-xs text-gray-500">{batchMsg}</span>}
          <button className="btn-primary text-sm" disabled={editedRows.length === 0} onClick={saveAllEdited}>
            변경 행 일괄 저장 ({editedRows.length})
          </button>
        </div>
      </div>

      <details className="text-sm bg-blue-50 border border-blue-200 text-blue-700 rounded-xl px-4 py-2">
        <summary className="cursor-pointer font-medium">입력 안내 (펼치기)</summary>
        <div className="mt-2 leading-relaxed">
          역할은 자산유형 기준 <b>제안값</b>이 미리 채워져 있으며, <b>저장 버튼을 눌러야 기록</b>됩니다.
          버킷은 비워 두면 자산유형 기준 기본값을 따르고, 선택한 경우에만 재지정으로 저장됩니다.
          수정듀레이션·금리 민감도 등은 <b>가정</b> / <b>관측</b>을 구분하고 기준일을 남겨 주세요.
          TDF·펀드는 <b>주식 비중</b>과 함께 <b>채권 부분의 수정듀레이션</b>을 입력해야 금리 노출이 계산됩니다.
          회색 칸은 해당 자산유형에서 사용하지 않는 항목입니다. 비율은 % 로 입력합니다.
          머리글과 자산 열은 고정되어 있고, 표 안에서 좌우·상하로 스크롤합니다.
        </div>
      </details>

      <div ref={boxRef} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto" style={{ height: boxHeight }}>   {/* .card 는 p-5 가 유틸리티보다 우선해 고정 머리글이 안쪽으로 밀리므로 쓰지 않는다 */}
        <table style={{ minWidth: 2100 }}>
          <thead>
            <tr>
              <th className={TH_CORNER} style={{ minWidth: 220, ...TH_STYLE }}>자산 / 상태</th>
              <th className={TH} style={{ minWidth: 110, ...TH_STYLE }}>평가금액</th>
              <th className={TH} style={{ minWidth: 100, ...TH_STYLE }}>역할</th>
              <th className={TH} style={{ minWidth: 150, ...TH_STYLE }}>버킷</th>
              <th className={TH} style={{ minWidth: 110, ...TH_STYLE }}>하위 분류</th>
              <th className={TH} style={{ minWidth: 70, ...TH_STYLE }}>통화</th>
              <th className={TH} style={{ minWidth: 60, ...TH_STYLE }}>환헤지</th>
              <th className={TH} style={{ minWidth: 90, ...TH_STYLE }}>지역</th>
              <th className={TH} style={{ minWidth: 90, ...TH_STYLE }}>업종</th>
              <th className={TH} style={{ minWidth: 90, ...TH_STYLE }}>듀레이션(년)</th>
              <th className={TH} style={{ minWidth: 90, ...TH_STYLE }}>금리유형</th>
              <th className={TH} style={{ minWidth: 80, ...TH_STYLE }}>신용등급</th>
              <th className={TH} style={{ minWidth: 100, ...TH_STYLE }}>부동산 유형</th>
              <th className={TH} style={{ minWidth: 110, ...TH_STYLE }}>금리 민감도</th>
              <th className={TH} style={{ minWidth: 90, ...TH_STYLE }}>주식 비중(%)</th>
              <th className={TH} style={{ minWidth: 90, ...TH_STYLE }}>총보수(%)</th>
              <th className={TH} style={{ minWidth: 90, ...TH_STYLE }}>값 구분</th>
              <th className={TH} style={{ minWidth: 130, ...TH_STYLE }}>기준일</th>
              <th className={TH} style={{ minWidth: 180, ...TH_STYLE }}>인출 제약 메모</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const { asset, profile, form, status } = row
              const base = profile ? formFromProfile(profile) : suggestedForm(asset, today)
              const on = f => fieldEnabled(asset.asset_type, f)
              const set = (f, v) => setField(asset, base, f, v)
              const warn = bondWarning(asset, form)
              const inp = (f, extra = {}) => (
                <input className={`${cellInput} ${on(f) ? '' : disabledCls}`} disabled={!on(f)}
                  value={on(f) ? form[f] : ''} onChange={e => set(f, e.target.value)} {...extra} />
              )
              const defBucket = row.defaultBucket                     // 서버가 준 기본 버킷
              const showAssumed = form.value_source === 'assumed'
                && ((on('bond_modified_duration') && form.bond_modified_duration !== '')
                  || (on('rate_sensitivity') && form.rate_sensitivity !== ''))
              return (
                <tr key={asset.id}>
                  <td className="sticky left-0 bg-white z-10">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {warn && (
                            <span title={warn.message} aria-label={warn.message} className="cursor-help">⚠️</span>
                          )}
                          <span className="font-medium text-gray-800 truncate" title={asset.asset_name}>{asset.asset_name}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 truncate">
                          {asset.account_name} · {ASSET_TYPE_LABEL[asset.asset_type] || asset.asset_type}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          {STATUS_BADGE[status]}
                          <button className="btn-secondary text-xs px-2 py-1"
                            disabled={status === 'saved' || saving[asset.id]}
                            onClick={() => saveOne(row)}>
                            {saving[asset.id] ? '저장 중' : '저장'}
                          </button>
                        </div>
                        {errors[asset.id] && <div className="text-[11px] text-red-600 mt-1">{errors[asset.id]}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="text-right tabular-nums text-gray-700">{won(asset.current_value)}</td>
                  <td>
                    <select className={cellInput} value={form.role} onChange={e => set('role', e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className={`${cellInput} ${form.bucket === '' ? 'text-gray-400' : ''}`}
                      value={form.bucket} onChange={e => set('bucket', e.target.value)}
                      title="비워 두면 자산유형 기준 기본 버킷을 따릅니다. 선택하면 재지정으로 저장됩니다.">
                      <option value="">{defBucket ? `기본: ${defBucket}버킷(자산유형 기준)` : '기본: 미지정(자산유형 기준 없음)'}</option>
                      <option value="1">1버킷</option>
                      <option value="2">2버킷</option>
                      <option value="3">3버킷</option>
                    </select>
                  </td>
                  <td>{inp('sub_class', { placeholder: '예: 단기채' })}</td>
                  <td>{inp('currency')}</td>
                  <td className="text-center">
                    <input type="checkbox" className="!p-0 !w-4 !h-4" disabled={!on('fx_hedged')}
                      checked={on('fx_hedged') && !!form.fx_hedged} onChange={e => set('fx_hedged', e.target.checked)} />
                  </td>
                  <td>{inp('region')}</td>
                  <td>{inp('sector')}</td>
                  <td>{inp('bond_modified_duration', { type: 'number', step: '0.1', min: 0,
                    title: asset.asset_type === 'tdf' || asset.asset_type === 'fund' ? 'TDF·펀드의 채권 부분 수정듀레이션(년)' : '수정듀레이션(년)' })}</td>
                  <td>
                    <select className={`${cellInput} ${on('bond_rate_type') ? '' : disabledCls}`} disabled={!on('bond_rate_type')}
                      value={on('bond_rate_type') ? form.bond_rate_type : ''} onChange={e => set('bond_rate_type', e.target.value)}>
                      <option value="">-</option>
                      <option value="fixed">고정</option>
                      <option value="floating">변동</option>
                    </select>
                  </td>
                  <td>{inp('credit_grade', { placeholder: 'AAA' })}</td>
                  <td>{inp('reit_property_type', { placeholder: '오피스' })}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {inp('rate_sensitivity', { type: 'number', step: '0.1' })}
                      {showAssumed && <span className="badge-yellow whitespace-nowrap">가정</span>}
                    </div>
                  </td>
                  <td>{inp('equity_share_pct', { type: 'number', step: '1', min: 0, max: 100, placeholder: '%' })}</td>
                  <td>{inp('expense_ratio', { type: 'number', step: '0.01', min: 0, max: 100, placeholder: '%' })}</td>
                  <td>
                    <select className={`${cellInput} ${on('value_source') ? '' : disabledCls}`} disabled={!on('value_source')}
                      value={on('value_source') ? form.value_source : 'assumed'} onChange={e => set('value_source', e.target.value)}>
                      <option value="assumed">가정</option>
                      <option value="observed">관측</option>
                    </select>
                  </td>
                  <td>{inp('as_of_date', { type: 'date' })}</td>
                  <td>{inp('liquidity_note', { placeholder: '중도해지 조건 등' })}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={19} className="text-center text-gray-400 py-8">활성 자산이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
