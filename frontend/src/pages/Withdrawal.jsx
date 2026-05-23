import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { fmt } from '../api/client.js'

// ── 인출률 계산기 ─────────────────────────────────────────────────
function SliderRow({ label, value, min, max, step, display, onChange }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-gray-600 w-40 flex-shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        className="flex-1 h-1.5 accent-blue-600 cursor-pointer" />
      <span className="text-sm font-semibold text-gray-700 w-20 text-right">{display}</span>
    </div>
  )
}

const W_TABS = ['① 기본 인출률', '② 하락 반영 인출률', '③ 실질 인출률']

function WithdrawalCalc({ initAssets, initAnnualW, initInflation }) {
  const [assets,    setAssets]    = useState(initAssets    ?? 10)
  const [annualW,   setAnnualW]   = useState(initAnnualW   ?? 3000)
  const [decline,   setDecline]   = useState(0)
  const [inflation, setInflation] = useState(initInflation ?? 2.5)
  const [tab,       setTab]       = useState(0)

  useEffect(() => { if (initAssets   != null) setAssets(initAssets)       }, [initAssets])
  useEffect(() => { if (initAnnualW  != null) setAnnualW(initAnnualW)     }, [initAnnualW])
  useEffect(() => { if (initInflation!= null) setInflation(initInflation)  }, [initInflation])

  const totalMan      = assets * 10000
  const adjustedTotal = totalMan * (1 - decline / 100)
  const adjustedW     = annualW  * (1 + inflation / 100)
  const rates = [
    annualW / totalMan * 100,
    annualW / adjustedTotal * 100,
    adjustedW / totalMan * 100,
  ]
  const rate          = rates[tab]
  const durationYears = totalMan > 0 ? Math.floor(totalMan / annualW) : 0
  const safeAmount    = Math.round(totalMan * 0.04)
  const rateColor     = rate < 4 ? 'text-green-600' : rate < 6 ? 'text-yellow-600' : 'text-red-600'

  const formulas = [
    { text: `기본 인출률 = 연간 인출액 ÷ 총 자산`,
      calc: `= ${annualW.toLocaleString()}만 ÷ ${totalMan.toLocaleString()}만 = ${rate.toFixed(2)}%`,
      sub:  '주가 하락·물가 미반영' },
    { text: `하락 반영 인출률 = 연간 인출액 ÷ (총 자산 × (1 − 하락률))`,
      calc: `= ${annualW.toLocaleString()}만 ÷ ${Math.round(adjustedTotal).toLocaleString()}만 = ${rate.toFixed(2)}%`,
      sub:  `주식 ${decline}% 하락 시 실효 인출률` },
    { text: `실질 인출률 = 연간 인출액 × (1 + 물가상승률) ÷ 총 자산`,
      calc: `= ${Math.round(adjustedW).toLocaleString()}만 ÷ ${totalMan.toLocaleString()}만 = ${rate.toFixed(2)}%`,
      sub:  `물가 ${inflation.toFixed(1)}% 반영 — 실질 구매력 기준` },
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-3 py-1">
        <SliderRow label="총 자산 (억 원)"    value={assets}    min={1}   max={50}    step={0.5} display={`${assets}억`}                 onChange={setAssets} />
        <SliderRow label="연간 인출액 (만 원)" value={annualW}   min={500} max={20000} step={500} display={`${annualW.toLocaleString()}만`} onChange={setAnnualW} />
        <SliderRow label="주식 하락률 (%)"    value={decline}   min={0}   max={50}    step={1}   display={`${decline}%`}                  onChange={setDecline} />
        <SliderRow label="물가상승률 (%)"     value={inflation} min={0}   max={10}    step={0.1} display={`${inflation.toFixed(1)}%`}     onChange={setInflation} />
      </div>

      {/* 탭 */}
      <div className="flex gap-2 flex-wrap">
        {W_TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
              ${tab === i
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
        <div className="text-gray-600">{formulas[tab].text}</div>
        <div className="font-semibold text-gray-800 mt-0.5">{formulas[tab].calc}</div>
        <div className="text-xs text-gray-400 mt-1">{formulas[tab].sub}</div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <div className="text-xs text-gray-500 mb-1">계산된 인출률</div>
          <div className={`text-2xl font-bold ${rateColor}`}>{rate.toFixed(2)}%</div>
          <div className="text-xs text-gray-400 mt-1">{formulas[tab].sub}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <div className="text-xs text-gray-500 mb-1">자산 지속 기간</div>
          <div className="text-2xl font-bold text-gray-800">{durationYears}년</div>
          <div className="text-xs text-gray-400 mt-1">수익률 0% 가정</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
          <div className="text-xs text-gray-500 mb-1">4% 기준 안전 인출액</div>
          <div className="text-2xl font-bold text-blue-600">{safeAmount.toLocaleString()}만</div>
          <div className="text-xs text-gray-400 mt-1">연간 기준</div>
        </div>
      </div>

      <div className={`text-xs rounded-lg px-3 py-2 ${
        rate < 4 ? 'bg-green-50 text-green-700' :
        rate < 6 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-600'}`}>
        {rate < 4
          ? `✅ 현재 인출률 ${rate.toFixed(2)}%는 4% 안전 기준 이하입니다.`
          : rate < 6
          ? `⚠️ 현재 인출률 ${rate.toFixed(2)}%는 4% 안전 기준을 초과합니다. 지출 조정을 권장합니다.`
          : `🔴 현재 인출률 ${rate.toFixed(2)}%는 6% 이상으로 장기 지속이 어려울 수 있습니다.`}
      </div>
    </div>
  )
}

export default function Withdrawal() {
  const qc = useQueryClient()
  const today = new Date()
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [amount, setAmount] = useState('')
  const [note, setNote]   = useState('')

  const { data: current } = useQuery({
    queryKey: ['withdrawal-current'],
    queryFn: () => api.get('/withdrawal/current-month').then(r => r.data),
  })

  const { data: dash } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['withdrawal-history'],
    queryFn: () => api.get('/withdrawal').then(r => r.data),
  })

  const saveMut = useMutation({
    mutationFn: body => api.post('/withdrawal', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['withdrawal-current'] })
      qc.invalidateQueries({ queryKey: ['withdrawal-history'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    saveMut.mutate({ year, month, actual_amount: Math.abs(+amount), note })
  }

  // 입력창 초기값을 현재 월 권장액으로
  const defaultAmount = current?.actual_amount ?? current?.recommended ?? ''

  const netFromPortfolio = current ? current.recommended : 0
  const statusColor = current?.actual_amount != null ? 'text-green-600' : 'text-orange-400'
  const statusText  = current?.actual_amount != null
    ? `입력 완료 (${fmt.won(current.actual_amount)})`
    : '미입력'

  // 계산기 초기값 (대시보드 데이터 기반)
  const initAssets    = dash ? Math.round(dash.buckets?.total / 1e8 * 10) / 10 : null
  const initAnnualW   = current ? Math.round(current.recommended * 12 / 10000) : null
  const initInflation = dash ? Math.round((dash.config?.inflation?.assumed_rate ?? 0.025) * 1000) / 10 : null

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-gray-800">💸 인출 관리</h1>

      <div className="grid grid-cols-3 gap-4">
        {/* 이번 달 현황 */}
        <div className="card col-span-1">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">이번 달 현황</h3>
          {current && (
            <div className="space-y-2 text-sm">
              {[
                ['월 생활비',          fmt.won(current.monthly_expense)],
                ['국민연금 수령액',    fmt.won(current.pension_income) + (current.pension_income > 0 ? ' (수령 중)' : ' (개시 전)')],
                ['포트폴리오 권장 인출', fmt.won(current.recommended)],
                ['실제 입력 상태',     null],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-1.5 border-b border-gray-50">
                  <span className="text-gray-500">{label}</span>
                  {value ? (
                    <span className="font-medium text-gray-800">{value}</span>
                  ) : (
                    <span className={`font-semibold ${statusColor}`}>{statusText}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 입력 폼 */}
        <div className="card col-span-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">✏️ 실제 인출액 입력</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">연도</label>
                <input type="number" value={year} onChange={e => setYear(+e.target.value)}
                  className="w-full" min={2020} max={2050} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">월</label>
                <select value={month} onChange={e => setMonth(+e.target.value)} className="w-full">
                  {Array.from({length: 12}, (_, i) => i+1).map(m => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">
                실제 인출액 (원)
                {current?.recommended && (
                  <button type="button" className="ml-2 text-blue-500 underline"
                    onClick={() => setAmount(String(current.recommended))}>
                    권장액({fmt.won(current.recommended)}) 입력
                  </button>
                )}
              </label>
              <input type="number" value={amount || (current?.actual_amount ?? '')}
                onChange={e => setAmount(e.target.value)}
                placeholder={`권장액: ${fmt.won(netFromPortfolio)}`}
                className="w-full" />
              {amount && current?.recommended && (
                <p className="text-xs mt-1 text-gray-400">
                  권장액 대비 {(Math.abs(+amount) - current.recommended) >= 0 ? '+' : ''}
                  {fmt.won(Math.abs(+amount) - current.recommended)}
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">메모 (선택)</label>
              <input value={note} onChange={e => setNote(e.target.value)}
                placeholder="예: 의료비 추가 지출" className="w-full" />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={saveMut.isPending || !amount}>
              {saveMut.isPending ? '저장 중...' : '💾 저장'}
            </button>

            {saveMut.isSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
                ✅ 저장 완료!
              </div>
            )}
            {saveMut.isError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-3 py-2">
                ❌ 저장 실패: {saveMut.error?.response?.data?.detail || '다시 시도해주세요.'}
              </div>
            )}
          </form>
        </div>
      </div>

      {/* 인출률 계산기 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">💡 인출률 계산기</h3>
        <WithdrawalCalc
          initAssets={initAssets}
          initAnnualW={initAnnualW}
          initInflation={initInflation}
        />
      </div>

      {/* 인출 이력 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">📊 인출 이력 — 권장 vs 실제</h3>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">인출 이력이 없습니다.</p>
        ) : (
          <table>
            <thead><tr>
              <th>날짜</th>
              <th className="text-right">권장 인출액</th>
              <th className="text-right">실제 인출액</th>
              <th className="text-right">차이</th>
              <th>가드레일</th>
              <th>메모</th>
            </tr></thead>
            <tbody>
              {history.map(w => {
                const diff = w.actual_amount != null ? Math.abs(w.actual_amount) - w.amount : null
                return (
                  <tr key={w.id}>
                    <td className="font-medium">{fmt.month(w.date)}</td>
                    <td className="text-right">{fmt.won(w.amount)}</td>
                    <td className={`text-right font-medium ${w.actual_amount != null ? 'text-green-600' : 'text-orange-400'}`}>
                      {w.actual_amount != null ? fmt.won(w.actual_amount) : '미입력'}
                    </td>
                    <td className={`text-right text-xs ${diff == null ? '' : diff > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                      {diff != null ? `${diff > 0 ? '+' : ''}${fmt.won(diff)}` : '-'}
                    </td>
                    <td>{w.guardrail_applied
                      ? <span className="badge-red">🔴 하향 적용</span>
                      : <span className="badge-gray">정상</span>}
                    </td>
                    <td className="text-xs text-gray-400">{w.note || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
