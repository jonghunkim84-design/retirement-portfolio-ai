import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ── 2026년 기준 상수 ──────────────────────────────────────────────
const HI_CONST = {
  ratePerPoint:           208.4,
  longCareRate:           0.1295,
  minPremium:             20160,
  basicPropertyDeduction: 10000, // 만원 (= 1억원)
  dependentIncomeLimit:   2000,  // 만원
}

const PROPERTY_TYPES = [
  { value: 'house_under3', label: '주택 (공시가 3억 이하)' },
  { value: 'house_3to6',   label: '주택 (공시가 3억~6억)'  },
  { value: 'house_over6',  label: '주택 (공시가 6억 초과)' },
  { value: 'building',     label: '건물·상가·토지'          },
  { value: 'jeonse',       label: '전세 보증금'              },
  { value: 'wolse',        label: '월세'                    },
]

// ── 핵심 계산 함수 ────────────────────────────────────────────────
function calcTaxBase(type, value) {
  switch (type) {
    case 'house_under3': return (value.amount || 0) * 0.43
    case 'house_3to6':   return (value.amount || 0) * 0.44
    case 'house_over6':  return (value.amount || 0) * 0.45
    case 'building':     return (value.amount || 0)
    case 'jeonse':       return (value.amount || 0) * 0.30
    case 'wolse':        return ((value.deposit || 0) + (value.monthly || 0) / 0.025) * 0.30
    default:             return 0
  }
}

function calcTaxableIncome(np, pp, fi, ws) {
  return np * 0.5 + fi + ws
}

function calcDependentIncome(np, pp, fi, ws) {
  return np + pp + fi + ws
}

function getIncomeScore(annualIncome) {
  if (annualIncome <= 336)   return 0
  if (annualIncome <= 500)   return 17
  if (annualIncome <= 700)   return 51
  if (annualIncome <= 1000)  return 103
  if (annualIncome <= 1500)  return 184
  if (annualIncome <= 2000)  return 257
  if (annualIncome <= 2500)  return 325
  if (annualIncome <= 3000)  return 390
  if (annualIncome <= 4000)  return 498
  if (annualIncome <= 5000)  return 612
  if (annualIncome <= 7000)  return 810
  if (annualIncome <= 10000) return 1082
  if (annualIncome <= 15000) return 1486
  return 1956
}

function getPropertyScore(netTaxBase) {
  if (netTaxBase <= 0)      return 0
  if (netTaxBase <= 450)    return 22
  if (netTaxBase <= 900)    return 44
  if (netTaxBase <= 1350)   return 66
  if (netTaxBase <= 1900)   return 93
  if (netTaxBase <= 2700)   return 138
  if (netTaxBase <= 3500)   return 188
  if (netTaxBase <= 4900)   return 250
  if (netTaxBase <= 6500)   return 326
  if (netTaxBase <= 8500)   return 411
  if (netTaxBase <= 11000)  return 511
  if (netTaxBase <= 14000)  return 628
  if (netTaxBase <= 18000)  return 782
  if (netTaxBase <= 24000)  return 982
  if (netTaxBase <= 32000)  return 1249
  if (netTaxBase <= 44000)  return 1571
  if (netTaxBase <= 60000)  return 1952
  if (netTaxBase <= 80000)  return 2363
  return 2700
}

function calcPremium(incomeScore, propertyScore) {
  const totalScore = incomeScore + propertyScore
  const health     = Math.max(HI_CONST.minPremium, Math.round(totalScore * HI_CONST.ratePerPoint))
  const longCare   = Math.round(health * HI_CONST.longCareRate)
  return { totalScore, health, longCare, total: health + longCare, annual: (health + longCare) * 12 }
}

function won(v) {
  return Math.round(v).toLocaleString('ko-KR') + '원'
}

function todayLabel() {
  return new Date().toISOString().slice(0, 10) + ' 시뮬레이션'
}

// ── 공통 UI ──────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
        <span>{icon}</span>{title}
      </h2>
      {subtitle && <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function TipBox({ type = 'info', children }) {
  const s = {
    info:    'bg-blue-50  border-blue-200  text-blue-700',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    success: 'bg-green-50 border-green-200 text-green-700',
    danger:  'bg-red-50   border-red-200   text-red-700',
  }
  return (
    <div className={`rounded-lg border p-3 text-[12px] leading-relaxed ${s[type] ?? s.info}`}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, sub, color = 'gray' }) {
  const c = { red: 'text-red-600', yellow: 'text-yellow-600', green: 'text-green-600', gray: 'text-gray-800', blue: 'text-blue-600' }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${c[color] ?? c.gray}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── 소득 슬라이더 행 ──────────────────────────────────────────────
function SliderRow({ label, badge, badgeClass, value, onChange, min, max, step }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-gray-700">{label}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>{badge}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number" value={value} min={min} max={max} step={step}
            onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
            className="w-20 text-right text-sm font-bold text-gray-800 border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          <span className="text-[12px] text-gray-500">만원</span>
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-blue-600 h-2"
      />
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>0</span>
        <span>{max.toLocaleString('ko-KR')}만원/년</span>
      </div>
    </div>
  )
}

// ── 재산 항목 행 ──────────────────────────────────────────────────
function PropertyRow({ item, onTypeChange, onValueChange, onRemove }) {
  const isWolse    = item.type === 'wolse'
  const isBuilding = item.type === 'building'
  const taxBase    = Math.round(calcTaxBase(item.type, item.value))

  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <select value={item.type} onChange={e => onTypeChange(e.target.value)}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
          {PROPERTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={onRemove}
          className="text-gray-400 hover:text-red-500 text-xl leading-none px-1 shrink-0">×</button>
      </div>

      {isWolse ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-gray-500 block mb-0.5">보증금 (만원)</label>
            <input type="number" value={item.value.deposit || ''} min={0}
              onChange={e => onValueChange('deposit', e.target.value)} placeholder="0"
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 block mb-0.5">월세 (만원/월)</label>
            <input type="number" value={item.value.monthly || ''} min={0}
              onChange={e => onValueChange('monthly', e.target.value)} placeholder="0"
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
        </div>
      ) : (
        <div>
          <label className="text-[11px] text-gray-500 block mb-0.5">
            {isBuilding ? '과세표준' : '공시가격'} (만원)
          </label>
          <input type="number" value={item.value.amount || ''} min={0}
            onChange={e => onValueChange('amount', e.target.value)} placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </div>
      )}

      <div className="text-[11px] text-gray-400">
        과세표준: <span className="font-medium text-gray-600">{taxBase.toLocaleString('ko-KR')}만원</span>
      </div>
    </div>
  )
}

// ── 절세 시나리오 카드 ────────────────────────────────────────────
function ScenarioCard({ title, monthlySaving, currentTotal, note }) {
  const pct       = currentTotal > 0 ? Math.round(monthlySaving / currentTotal * 100) : 0
  const effective = monthlySaving > 0

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="font-semibold text-[13px] text-gray-800 mb-2">{title}</div>
      {note ? (
        <p className="text-[12px] text-gray-400">{note}</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-gray-500">월 절감액</span>
            <span className={`text-base font-bold ${effective ? 'text-green-600' : 'text-gray-400'}`}>
              {effective ? `- ${won(monthlySaving)}` : '절감 없음'}
            </span>
          </div>
          {effective && (
            <div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-400 rounded-full transition-all"
                  style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5 text-right">{pct}% 절감 · 연 {won(monthlySaving * 12)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────
export default function HealthInsurance() {
  const navigate  = useNavigate()
  const { user }  = useAuth()
  const nextId    = useRef(1)

  // 소득 입력 (만원/년)
  const [np, setNp] = useState(0)
  const [pp, setPp] = useState(0)
  const [fi, setFi] = useState(0)
  const [ws, setWs] = useState(0)

  // 재산 입력
  const [propertyItems, setPropertyItems] = useState([])
  const [mortgageLoan,  setMortgageLoan]  = useState(0)

  // 저장·불러오기 UI 상태
  const [saveModal,    setSaveModal]    = useState(false)
  const [saveLabel,    setSaveLabel]    = useState('')
  const [saving,       setSaving]       = useState(false)
  const [loadModal,    setLoadModal]    = useState(false)
  const [simList,      setSimList]      = useState([])
  const [loadingList,  setLoadingList]  = useState(false)
  const [saveMsg,      setSaveMsg]      = useState(null)  // { ok: bool, text: string }

  // ── 파생 계산 ─────────────────────────────────────────────────
  const taxableIncome   = useMemo(() => calcTaxableIncome(np, pp, fi, ws),   [np, pp, fi, ws])
  const dependentIncome = useMemo(() => calcDependentIncome(np, pp, fi, ws), [np, pp, fi, ws])

  const totalTaxBase = useMemo(
    () => propertyItems.reduce((sum, item) => sum + calcTaxBase(item.type, item.value), 0),
    [propertyItems]
  )
  const netTaxBase = useMemo(
    () => Math.max(0, totalTaxBase - HI_CONST.basicPropertyDeduction - mortgageLoan),
    [totalTaxBase, mortgageLoan]
  )

  const incomeScore     = useMemo(() => getIncomeScore(taxableIncome),          [taxableIncome])
  const propertyScore   = useMemo(() => getPropertyScore(netTaxBase),           [netTaxBase])
  const premium         = useMemo(() => calcPremium(incomeScore, propertyScore), [incomeScore, propertyScore])
  const canBeDependent  = dependentIncome <= HI_CONST.dependentIncomeLimit

  const totalAnnualIncome = (np + pp + fi + ws) * 10000
  const premiumRate       = totalAnnualIncome > 0 ? (premium.annual / totalAnnualIncome * 100).toFixed(1) : null
  const rateColor         = premiumRate == null ? 'gray' : Number(premiumRate) > 10 ? 'red' : Number(premiumRate) > 5 ? 'yellow' : 'green'

  // ── 절세 시나리오 ────────────────────────────────────────────
  const sc1Premium = useMemo(() => {
    const fi2 = Math.max(0, fi - 2000)
    return calcPremium(getIncomeScore(calcTaxableIncome(np, pp, fi2, ws)), propertyScore)
  }, [np, pp, fi, ws, propertyScore])

  const sc2Premium = useMemo(() => {
    const np2 = Math.max(0, np - 500)
    return calcPremium(getIncomeScore(calcTaxableIncome(np2, pp, fi, ws)), propertyScore)
  }, [np, pp, fi, ws, propertyScore])

  // ── 재산 핸들러 ──────────────────────────────────────────────
  const addProperty = () => setPropertyItems(prev => [
    ...prev,
    { id: nextId.current++, type: 'house_under3', value: { amount: 0, deposit: 0, monthly: 0 } },
  ])

  const updatePropertyType = (id, type) =>
    setPropertyItems(prev => prev.map(item =>
      item.id === id ? { ...item, type, value: { amount: 0, deposit: 0, monthly: 0 } } : item
    ))

  const updatePropertyValue = (id, field, val) =>
    setPropertyItems(prev => prev.map(item =>
      item.id === id ? { ...item, value: { ...item.value, [field]: Number(val) || 0 } } : item
    ))

  const removeProperty = id =>
    setPropertyItems(prev => prev.filter(item => item.id !== id))

  // ── 알림 ─────────────────────────────────────────────────────
  function showMsg(ok, text) {
    setSaveMsg({ ok, text })
    setTimeout(() => setSaveMsg(null), 3000)
  }

  // ── 저장 ─────────────────────────────────────────────────────
  function openSaveModal() {
    setSaveLabel(todayLabel())
    setSaveModal(true)
  }

  async function handleSave() {
    if (!saveLabel.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('health_insurance_simulations')
      .insert({
        user_id: user.id,
        label:   saveLabel.trim(),
        inputs: {
          np, pp, fi, ws,
          property_items: propertyItems,
          mortgage_loan:  mortgageLoan,
          year: 2026,
        },
        health_premium:        premium.health,
        long_care_premium:     premium.longCare,
        total_monthly:         premium.total,
        total_annual:          premium.annual,
        income_score:          incomeScore,
        property_score:        propertyScore,
        total_score:           premium.totalScore,
        is_dependent_eligible: canBeDependent,
      })
    setSaving(false)
    setSaveModal(false)
    showMsg(!error, error ? '저장에 실패했습니다. 다시 시도해주세요.' : '저장되었습니다.')
  }

  // ── 불러오기 ─────────────────────────────────────────────────
  async function handleLoadOpen() {
    setLoadModal(true)
    setLoadingList(true)
    const { data } = await supabase
      .from('health_insurance_simulations')
      .select('id, label, created_at, total_monthly, total_annual, is_dependent_eligible, inputs')
      .order('created_at', { ascending: false })
      .limit(20)
    setSimList(data ?? [])
    setLoadingList(false)
  }

  function handleLoad(row) {
    const { np: n, pp: p, fi: f, ws: w, property_items, mortgage_loan } = row.inputs
    setNp(n ?? 0)
    setPp(p ?? 0)
    setFi(f ?? 0)
    setWs(w ?? 0)
    setPropertyItems((property_items ?? []).map(item => ({ ...item, id: nextId.current++ })))
    setMortgageLoan(mortgage_loan ?? 0)
    setLoadModal(false)
    showMsg(true, `"${row.label}" 불러왔습니다.`)
  }

  async function handleDelete(id) {
    if (!window.confirm('이 시뮬레이션을 삭제할까요?')) return
    await supabase.from('health_insurance_simulations').delete().eq('id', id)
    setSimList(prev => prev.filter(r => r.id !== id))
  }

  // ── 렌더링 ───────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

      {/* 알림 배너 */}
      {saveMsg && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          saveMsg.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {saveMsg.text}
        </div>
      )}

      {/* 저장 라벨 입력 모달 */}
      {saveModal && (
        <Modal title="시뮬레이션 저장" onClose={() => setSaveModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">저장 이름</label>
              <input
                value={saveLabel}
                onChange={e => setSaveLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-[12px] text-gray-500 space-y-0.5">
              <div>월 납부액: <span className="font-bold text-gray-700">{won(premium.total)}</span></div>
              <div>연간 납부액: <span className="font-bold text-gray-700">{won(premium.annual)}</span></div>
              <div>피부양자 가능: <span className={`font-bold ${canBeDependent ? 'text-green-600' : 'text-red-600'}`}>{canBeDependent ? '✓ 가능' : '✗ 불가'}</span></div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave} disabled={saving || !saveLabel.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-semibold transition-colors">
                {saving ? '저장 중...' : '저장'}
              </button>
              <button onClick={() => setSaveModal(false)}
                className="px-4 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 저장 목록 모달 */}
      {loadModal && (
        <Modal title="저장된 시뮬레이션" onClose={() => setLoadModal(false)}>
          {loadingList ? (
            <p className="text-center text-sm text-gray-400 py-6">불러오는 중...</p>
          ) : simList.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">저장된 시뮬레이션이 없습니다.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {simList.map(row => (
                <div key={row.id} className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{row.label}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {row.created_at.slice(0, 10)} · 월 {won(row.total_monthly)} ·{' '}
                        <span className={row.is_dependent_eligible ? 'text-green-600' : 'text-red-500'}>
                          피부양자 {row.is_dependent_eligible ? '가능' : '불가'}
                        </span>
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => handleLoad(row)}
                        className="text-[12px] bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg transition-colors">
                        불러오기
                      </button>
                      <button onClick={() => handleDelete(row.id)}
                        className="text-[12px] text-red-400 hover:text-red-600 px-1.5 py-1 transition-colors">
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* 페이지 제목 */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">건강보험료 시뮬레이터</h1>
        <p className="text-[12px] text-gray-500 mt-1">
          은퇴 후 지역가입자 전환 시 예상 건강보험료를 계산합니다 (2026년 기준)
        </p>
      </div>

      {/* ── 섹션 1: 소득 입력 ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <SectionHeader icon="💰" title="소득 입력" subtitle="연간 금액 기준으로 입력하세요 (단위: 만원/년)" />
        <div className="space-y-5">
          <SliderRow
            label="국민연금" badge="50% 반영" badgeClass="bg-green-100 text-green-700"
            value={np} onChange={setNp} min={0} max={3000} step={50}
          />
          <SliderRow
            label="개인연금·IRP 인출" badge="건보료 미부과" badgeClass="bg-gray-100 text-gray-600"
            value={pp} onChange={setPp} min={0} max={3000} step={50}
          />
          <SliderRow
            label="이자·배당 소득" badge="100% 반영" badgeClass="bg-red-100 text-red-600"
            value={fi} onChange={setFi} min={0} max={5000} step={100}
          />
          <SliderRow
            label="근로·사업 소득" badge="100% 반영" badgeClass="bg-red-100 text-red-600"
            value={ws} onChange={setWs} min={0} max={5000} step={100}
          />
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-2 text-[12px]">
          <div className="flex justify-between">
            <span className="text-gray-500">건보료 부과 소득</span>
            <span className="font-bold text-gray-800">{taxableIncome.toLocaleString('ko-KR')}만원</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">소득 점수</span>
            <span className="font-bold text-gray-800">{incomeScore}점</span>
          </div>
        </div>
      </div>

      {/* ── 섹션 2: 재산 입력 ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <SectionHeader icon="🏠" title="재산 입력" subtitle="재산 항목을 추가하세요 (최대 5개)" />

        {/* v1.1: 공동명의 안내 */}
        <p className="text-sm text-gray-500 mb-3">
          부부 공동명의 재산은 지분 구분 없이 전체 금액을 입력하세요.
          건강보험료는 세대 단위로 부과됩니다.
        </p>

        <div className="space-y-3">
          {propertyItems.map(item => (
            <PropertyRow
              key={item.id} item={item}
              onTypeChange={v       => updatePropertyType(item.id, v)}
              onValueChange={(f, v) => updatePropertyValue(item.id, f, v)}
              onRemove={() => removeProperty(item.id)}
            />
          ))}
          {propertyItems.length === 0 && (
            <p className="text-center text-[12px] text-gray-400 py-3">
              재산이 없으면 소득 점수만 적용됩니다
            </p>
          )}
          {propertyItems.length < 5 && (
            <button onClick={addProperty}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg py-2.5 text-[13px] text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
              + 재산 항목 추가
            </button>
          )}
        </div>

        <p className="mt-2 text-[11px] text-gray-400">
          ※ 2주택 이상은 국민건강보험공단(nhis.or.kr)에 직접 문의하세요.
        </p>

        {/* 주택담보대출 공제 */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <label className="text-[12px] text-gray-600 block mb-1">
            주택담보대출 잔액 (만원) <span className="text-gray-400">— 선택</span>
          </label>
          <input
            type="number" value={mortgageLoan || ''} min={0} placeholder="0"
            onChange={e => setMortgageLoan(Number(e.target.value) || 0)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            실거주 목적 주택 구입·임차 대출에 한함. 국민건강보험공단에 대출 사실을 통보한 경우에만 적용됩니다.
          </p>
        </div>

        {/* 재산 과세표준 요약 */}
        {propertyItems.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5 text-[12px]">
            <div className="flex justify-between text-gray-600">
              <span>과세표준 합계</span>
              <span>{Math.round(totalTaxBase).toLocaleString('ko-KR')}만원</span>
            </div>
            <div className="flex justify-between text-red-500">
              <span>기본공제</span>
              <span>- {HI_CONST.basicPropertyDeduction.toLocaleString('ko-KR')}만원</span>
            </div>
            {mortgageLoan > 0 && (
              <div className="flex justify-between text-red-500">
                <span>주택담보대출 공제</span>
                <span>- {mortgageLoan.toLocaleString('ko-KR')}만원</span>
              </div>
            )}
            <div className="flex justify-between font-bold pt-1.5 border-t border-gray-100 text-gray-800">
              <span>부과 기준 재산</span>
              <span>{Math.round(netTaxBase).toLocaleString('ko-KR')}만원 ({propertyScore}점)</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 섹션 3: 예상 보험료 ───────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <SectionHeader icon="🏥" title="예상 보험료" />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <KpiCard label="월 건강보험료"    value={won(premium.health)}   color="red" />
          <KpiCard label="월 장기요양보험료" value={won(premium.longCare)} color="yellow" />
          <KpiCard label="월 총 납부액"     value={won(premium.total)}    color="red" />
          <KpiCard label="연간 총 납부액"   value={won(premium.annual)} />
          <KpiCard
            label="실소득 대비 보험료율"
            value={premiumRate !== null ? `${premiumRate}%` : '-'}
            color={rateColor}
          />
          <KpiCard
            label="부과점수 합계"
            value={`${premium.totalScore}점`}
            sub={`소득 ${incomeScore} + 재산 ${propertyScore}`}
          />
        </div>

        {/* 계산 근거 */}
        <div className="bg-gray-50 rounded-lg p-3 text-[11px] text-gray-500 space-y-0.5">
          <div>소득 부과 기준: {taxableIncome.toLocaleString('ko-KR')}만원 → {incomeScore}점</div>
          <div>재산 부과 기준: {Math.round(netTaxBase).toLocaleString('ko-KR')}만원 → {propertyScore}점</div>
          <div>
            합계 {premium.totalScore}점 × 208.4원 = {won(premium.totalScore * HI_CONST.ratePerPoint)}
            {premium.totalScore * HI_CONST.ratePerPoint < HI_CONST.minPremium && ' (최저보험료 적용)'}
          </div>
        </div>

        {/* 상황별 팁 */}
        {(fi >= 2000 || pp > 0 || np > 0 || netTaxBase > 20000) && (
          <div className="mt-4 space-y-2">
            {fi >= 2000 && (
              <TipBox type="warning">
                💡 이자·배당 소득이 2,000만원 이상입니다. ISA 계좌로 전환하면 건보료 소득 점수를 낮출 수 있습니다.
              </TipBox>
            )}
            {pp > 0 && (
              <TipBox type="success">
                ✅ 개인연금·IRP 인출액({pp.toLocaleString('ko-KR')}만원)은 건강보험료 부과 대상이 아닙니다.
              </TipBox>
            )}
            {np > 0 && (
              <TipBox type="info">
                ℹ️ 국민연금은 수령액의 50%만 건강보험료에 반영됩니다.
              </TipBox>
            )}
            {netTaxBase > 20000 && (
              <TipBox type="warning">
                ℹ️ 재산 과세표준이 2억원을 초과합니다. 주택담보대출 공제를 공단에 신청하면 보험료를 낮출 수 있습니다.
              </TipBox>
            )}
          </div>
        )}

        {/* v1.1: 저장 바 */}
        <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100">
          <button
            onClick={openSaveModal}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
            💾 이 결과 저장하기
          </button>
          <button
            onClick={handleLoadOpen}
            className="flex-1 flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl py-2.5 text-sm font-semibold transition-colors">
            📂 저장 목록 불러오기
          </button>
        </div>
      </div>

      {/* ── 섹션 4: 피부양자 판정 ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <SectionHeader
          icon="👨‍👩‍👧" title="피부양자 등록 가능 여부"
          subtitle="직장가입자(자녀·배우자)의 피부양자로 등록 가능한지 확인합니다"
        />

        <TipBox type="info">
          피부양자 판정 시 개인연금·IRP도 전액 합산됩니다. 건강보험료 부과 기준과 다릅니다.
        </TipBox>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <KpiCard label="판정 소득 합계" value={`${dependentIncome.toLocaleString('ko-KR')}만원`} />
          <KpiCard label="소득 한도"      value={`${HI_CONST.dependentIncomeLimit.toLocaleString('ko-KR')}만원`} />
          <KpiCard
            label="피부양자 가능"
            value={canBeDependent ? '✓ 가능' : '✗ 불가'}
            color={canBeDependent ? 'green' : 'red'}
          />
        </div>

        <div className="mt-3">
          {canBeDependent ? (
            <TipBox type="success">
              ✅ 피부양자 등록이 가능합니다. 직장가입자의 피부양자로 등록하면 월{' '}
              <strong>{won(premium.total)}</strong> (연 {won(premium.annual)})을 절감할 수 있습니다.
            </TipBox>
          ) : (
            <TipBox type="danger">
              ✗ 소득 합계({dependentIncome.toLocaleString('ko-KR')}만원)가 한도(2,000만원)를 초과합니다.
              {pp > 0 && ` 개인연금·IRP(${pp.toLocaleString('ko-KR')}만원)도 판정 소득에 포함됩니다.`}
              {` 초과액: ${(dependentIncome - HI_CONST.dependentIncomeLimit).toLocaleString('ko-KR')}만원.`}
            </TipBox>
          )}
        </div>
      </div>

      {/* ── 섹션 5: 절세 시나리오 비교 ───────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <SectionHeader
          icon="💡" title="절세 시나리오 비교"
          subtitle="건보료를 줄이기 위한 전략별 월 절감 효과"
        />

        <div className="space-y-3">
          <ScenarioCard
            title="① ISA 전환 — 이자·배당 2,000만원 분리"
            monthlySaving={premium.total - sc1Premium.total}
            currentTotal={premium.total}
            note={fi < 2000 ? '이자·배당 소득이 2,000만원 미만이어서 추가 절감 여지가 없습니다.' : null}
          />
          <ScenarioCard
            title="② 국민연금 수령액 500만원 감소"
            monthlySaving={premium.total - sc2Premium.total}
            currentTotal={premium.total}
            note={np === 0 ? '국민연금 수령액을 입력하면 절감 효과를 확인할 수 있습니다.' : null}
          />
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="font-semibold text-[13px] text-gray-800 mb-2">
              ③ 개인연금·IRP 인출 증가
            </div>
            <TipBox type="success">
              개인연금·IRP 인출은 건강보험료 부과 대상이 아닙니다. 근로·사업 소득이나 이자·배당 소득
              대신 개인연금 인출을 늘려도 건보료 변동이 없으며, 세후 실수령액을 높일 수 있습니다.
            </TipBox>
          </div>
        </div>

        <button
          onClick={() => navigate('/ai-advisor')}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors">
          💬 AI 어드바이저에게 절세 전략 물어보기
        </button>
      </div>

      {/* 면책 문구 */}
      <p className="text-[11px] text-gray-400 text-center pb-2 leading-relaxed">
        2026년 기준 추정치입니다. 부과점수당 208.4원, 장기요양보험료율 12.95% 적용.<br />
        실제 고지액과 차이가 있을 수 있으며, 정확한 금액은 국민건강보험공단(nhis.or.kr)에서 확인하세요.
      </p>
    </div>
  )
}
