import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts'
import api, { fmt } from '../api/client.js'

const ASSET_TYPE_LABEL = {
  cash: '현금성', bond: '채권', tdf: 'TDF',
  fund: '펀드', equity: '주식형', income: '리츠/인컴',
}
const TYPE_BADGE = {
  cash: 'bg-blue-100 text-blue-700', bond: 'bg-green-100 text-green-700',
  tdf:  'bg-green-100 text-green-700', fund: 'bg-green-100 text-green-700',
  equity: 'bg-yellow-100 text-yellow-700', income: 'bg-yellow-100 text-yellow-700',
}

// 만원 단위 축약
const man = v => Math.round(v / 10000)

// ── 요약 카드 ─────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color = 'blue', icon }) {
  const border = {
    blue: 'border-blue-500', green: 'border-green-500',
    red: 'border-red-500', orange: 'border-orange-400',
  }[color]
  const numCol = {
    blue: 'text-blue-700', green: 'text-green-600',
    red: 'text-red-600', orange: 'text-orange-500',
  }[color]
  return (
    <div className={`card border-l-4 ${border}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium">{label}</p>
          <p className={`text-xl font-bold mt-1 ${numCol}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl opacity-50">{icon}</span>
      </div>
    </div>
  )
}

// ── 차트 툴팁 ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs min-w-[160px]">
      <div className="font-bold text-gray-700 mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-3 py-0.5" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="font-semibold">{Number(p.value).toLocaleString()}만</span>
        </div>
      ))}
    </div>
  )
}

// ── 월 카드 ──────────────────────────────────────────────────────
function MonthCard({ m, isSelected, onClick }) {
  const netPos  = m.net_cashflow >= 0
  const hasMat  = m.maturity_count > 0
  const isPast  = m.is_past

  let borderCls = 'border-gray-200'
  if (isSelected)    borderCls = 'border-blue-500 ring-2 ring-blue-300'
  else if (isPast)   borderCls = 'border-gray-100'
  else if (hasMat)   borderCls = netPos ? 'border-green-400' : 'border-orange-400'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 ${borderCls} p-3 transition-all
        ${isPast ? 'opacity-50 bg-gray-50' : 'bg-white hover:shadow-md'}
        ${m.is_current ? 'bg-blue-50/60' : ''}`}
    >
      {/* 월 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <span className={`font-bold text-sm ${m.is_current ? 'text-blue-700' : 'text-gray-800'}`}>
          {m.month_num}월
          {m.is_current && <span className="ml-1 text-[10px] bg-blue-600 text-white px-1 py-0.5 rounded">이번달</span>}
        </span>
        <span className="text-[10px] text-gray-400">{m.year}</span>
      </div>

      {/* 만기 자산 */}
      {hasMat && (
        <div className="flex items-center gap-1 mb-1">
          <span className="text-green-500 text-xs">💰</span>
          <span className="text-xs font-semibold text-green-700">
            만기 {man(m.maturity_total).toLocaleString()}만
          </span>
          <span className="text-[10px] text-green-500">({m.maturity_count}건)</span>
        </div>
      )}

      {/* 연금 수입 */}
      {m.pension_income > 0 && (
        <div className="flex items-center gap-1 mb-1">
          <span className="text-blue-400 text-xs">🏛</span>
          <span className="text-xs text-blue-600">
            연금 {man(m.pension_income).toLocaleString()}만
          </span>
        </div>
      )}

      {/* 인출 */}
      <div className="flex items-center gap-1 mb-1">
        <span className="text-orange-400 text-xs">📤</span>
        <span className="text-xs text-gray-600">
          인출 {man(m.display_withdrawal).toLocaleString()}만
        </span>
        {m.has_actual && (
          <span className="text-[9px] bg-orange-100 text-orange-600 px-1 rounded">실적</span>
        )}
      </div>

      {/* 순 현금흐름 */}
      <div className={`mt-2 pt-1.5 border-t border-gray-100 text-xs font-bold
        ${netPos ? 'text-green-600' : 'text-red-500'}`}>
        {netPos ? '+' : ''}{man(m.net_cashflow).toLocaleString()}만
      </div>
    </button>
  )
}

// ── 메인 ─────────────────────────────────────────────────────────
export default function CashFlow() {
  const [selectedMonth, setSelectedMonth] = useState(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['cashflow'],
    queryFn: () => api.get('/cashflow/monthly').then(r => r.data),
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  )
  if (error) return <div className="text-red-500 p-4">오류: {error.message}</div>

  const { months, summary, pension_income, monthly_expense, recommended_withdrawal } = data

  // TODO: 사적연금 인출 기록(withdrawals 테이블, 연금 세금 화면) 연동은 스코프 제외.
  // 현재 '인출'은 포트폴리오 인출 계획(withdrawal_log) 기준이라 단순 합산 시 이중 계산 위험 —
  // 연동하려면 재원 구분(사적연금 수령 vs 포트폴리오 인출) 별도 설계 필요.

  // 차트: 현재+향후 13개월
  const chartMonths = months.filter(m => m.is_current || m.is_future).slice(0, 13)
  const chartData = chartMonths.map(m => ({
    label:    `${m.month_num}월`,
    만기_회수: man(m.maturity_total),
    연금_수입: man(m.pension_income),
    인출:     man(m.display_withdrawal),
    순흐름:   man(m.net_cashflow),
  }))

  // 선택한 달 데이터
  const selectedData = months.find(m => m.month === selectedMonth)

  // 요약 수치
  const net12 = summary.net_12m
  const netColor = net12 >= 0 ? 'green' : 'red'

  return (
    <div className="space-y-5">

      {/* 헤더 */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4">
        <h1 className="text-xl font-bold">📅 월별 현금흐름 캘린더</h1>
        <p className="text-blue-200 text-sm mt-1">
          만기 회수 · 인출 · 연금 수입 — 향후 12개월 흐름
        </p>
      </div>

      {/* 요약 KPI */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          icon="💰" label="향후 12개월 만기 예정"
          value={fmt.eok(summary.total_maturity_12m)}
          sub={`${summary.months_with_maturity}개월에 걸쳐 회수`}
          color="green"
        />
        <SummaryCard
          icon="📤" label="향후 12개월 총 인출"
          value={fmt.eok(summary.total_withdrawal_12m)}
          sub={`월 평균 ${man(summary.total_withdrawal_12m / 12).toLocaleString()}만원`}
          color="orange"
        />
        <SummaryCard
          icon="🏛" label="향후 12개월 연금 수입"
          value={fmt.eok(summary.total_pension_12m)}
          sub={pension_income > 0 ? `월 ${man(pension_income).toLocaleString()}만원` : '아직 수령 전'}
          color="blue"
        />
        <SummaryCard
          icon={net12 >= 0 ? '📈' : '📉'} label="향후 12개월 순 현금흐름"
          value={`${net12 >= 0 ? '+' : ''}${fmt.eok(net12)}`}
          sub={net12 >= 0 ? '만기 회수 > 인출' : '인출이 만기 회수 초과'}
          color={netColor}
        />
      </div>

      {/* 막대 차트 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">월별 현금흐름 현황 (만원)</h3>
        <p className="text-xs text-gray-400 mb-4">
          현재 월 포함 향후 13개월 · 만기 회수액과 인출액 비교
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v.toLocaleString()} unit="만" width={65} />
            <Tooltip content={<ChartTooltip />} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#9ca3af" />
            <Bar dataKey="만기_회수" stackId="in" fill="#22c55e" radius={[0,0,0,0]} />
            <Bar dataKey="연금_수입" stackId="in" fill="#3b82f6" radius={[3,3,0,0]} />
            <Bar dataKey="인출"      fill="#f97316" radius={[3,3,0,0]} />
            <Line type="monotone" dataKey="순흐름" stroke="#1e3a5f"
              strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500 border-t pt-2">
          <span>🟢 만기 회수 = 만기 도래 자산 평가액 회수</span>
          <span>🔵 연금 수입 = 국민연금 월 수령액</span>
          <span>🟠 인출 = 생활비 인출 (실적/계획)</span>
          <span>━ 순흐름 = 수입 – 인출</span>
        </div>
      </div>

      {/* 월별 카드 그리드 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">월별 상세 (과거 3개월 + 향후 12개월)</h3>
          {selectedMonth && (
            <button onClick={() => setSelectedMonth(null)}
              className="text-xs text-gray-400 hover:text-gray-600">
              ✕ 선택 해제
            </button>
          )}
        </div>

        <div className="grid grid-cols-4 gap-3">
          {months.map(m => (
            <MonthCard
              key={m.month}
              m={m}
              isSelected={selectedMonth === m.month}
              onClick={() => setSelectedMonth(prev => prev === m.month ? null : m.month)}
            />
          ))}
        </div>
      </div>

      {/* 선택 월 상세 패널 */}
      {selectedData && (
        <div className="card border-2 border-blue-300 bg-blue-50/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-blue-800">
              📋 {selectedData.month_label} 상세
            </h3>
            <span className={`text-sm font-bold ${selectedData.net_cashflow >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              순흐름 {selectedData.net_cashflow >= 0 ? '+' : ''}{man(selectedData.net_cashflow).toLocaleString()}만원
            </span>
          </div>

          {/* 인출 / 연금 요약 */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-xs text-gray-500 mb-1">만기 회수 예정</div>
              <div className="text-lg font-bold text-green-600">
                {man(selectedData.maturity_total).toLocaleString()}만원
              </div>
              <div className="text-xs text-gray-400">{selectedData.maturity_count}건</div>
            </div>
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-xs text-gray-500 mb-1">
                인출 ({selectedData.has_actual ? '실적' : '계획'})
              </div>
              <div className="text-lg font-bold text-orange-500">
                {man(selectedData.display_withdrawal).toLocaleString()}만원
              </div>
              {selectedData.has_actual && selectedData.planned_withdrawal !== selectedData.actual_withdrawal && (
                <div className="text-xs text-gray-400">
                  계획 {man(selectedData.planned_withdrawal).toLocaleString()}만
                </div>
              )}
            </div>
            <div className="bg-white rounded-lg p-3 text-center shadow-sm">
              <div className="text-xs text-gray-500 mb-1">연금 수입</div>
              <div className={`text-lg font-bold ${selectedData.pension_income > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                {selectedData.pension_income > 0
                  ? `${man(selectedData.pension_income).toLocaleString()}만원`
                  : '수령 전'}
              </div>
            </div>
          </div>

          {/* 만기 자산 목록 */}
          {selectedData.maturing_assets.length > 0 ? (
            <>
              <h4 className="text-xs font-semibold text-gray-600 mb-2">
                💰 만기 도래 자산 ({selectedData.maturing_assets.length}건)
              </h4>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                    <th className="pb-1.5">자산명</th>
                    <th className="pb-1.5">계좌</th>
                    <th className="pb-1.5">유형</th>
                    <th className="pb-1.5 text-right">만기일</th>
                    <th className="pb-1.5 text-right">평가액</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedData.maturing_assets.map(a => (
                    <tr key={a.id} className="border-b border-gray-100 text-sm">
                      <td className="py-2 font-medium text-gray-800">{a.asset_name}</td>
                      <td className="py-2 text-gray-500 text-xs">{a.account_name}</td>
                      <td className="py-2">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium
                          ${TYPE_BADGE[a.asset_type] || 'bg-gray-100 text-gray-600'}`}>
                          {ASSET_TYPE_LABEL[a.asset_type] || a.asset_type}
                        </span>
                      </td>
                      <td className="py-2 text-right text-xs text-gray-500">{a.maturity_date}</td>
                      <td className="py-2 text-right font-semibold text-green-700">
                        {fmt.won(a.current_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-sm font-bold text-green-700 border-t-2 border-green-200">
                    <td colSpan={4} className="pt-2">합계</td>
                    <td className="pt-2 text-right">{fmt.won(selectedData.maturity_total)}</td>
                  </tr>
                </tfoot>
              </table>
              <div className="mt-3 bg-green-50 rounded-lg px-3 py-2 text-xs text-green-700">
                💡 만기 후 재투자 계획을 미리 세워두세요. 자산 관리 탭에서 해당 자산을 수정하거나 새 자산을 추가할 수 있습니다.
              </div>
            </>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm">
              이 달에 만기 도래하는 자산이 없습니다.
            </div>
          )}
        </div>
      )}

      {/* 범례 설명 */}
      <div className="card bg-gray-50">
        <h4 className="text-xs font-semibold text-gray-600 mb-2">📌 카드 색상 안내</h4>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-gray-500">
          <div><span className="inline-block w-3 h-3 rounded border-2 border-green-400 mr-1.5"/>녹색 테두리: 만기 자산 있고 순 현금흐름 플러스</div>
          <div><span className="inline-block w-3 h-3 rounded border-2 border-orange-400 mr-1.5"/>주황 테두리: 만기 자산 있지만 순 현금흐름 마이너스</div>
          <div><span className="inline-block w-3 h-3 rounded border-2 border-blue-500 mr-1.5"/>파란 테두리: 현재 선택된 달</div>
          <div><span className="inline-block w-3 h-3 rounded bg-blue-50 border border-blue-200 mr-1.5"/>파란 배경: 이번 달</div>
        </div>
      </div>

    </div>
  )
}
