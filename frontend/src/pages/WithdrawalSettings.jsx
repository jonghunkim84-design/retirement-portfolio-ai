import { useState } from 'react'
import HoldingProfilesTab from './withdrawal-settings/HoldingProfilesTab.jsx'
import CashflowTab from './withdrawal-settings/CashflowTab.jsx'
import BaselineTab from './withdrawal-settings/BaselineTab.jsx'
import SubTargetsTab from './withdrawal-settings/SubTargetsTab.jsx'

const TABS = [
  { key: 'holdings', label: '보유상품 속성',   Component: HoldingProfilesTab },
  { key: 'cashflow', label: '생활비·정기수입', Component: CashflowTab },
  { key: 'baseline', label: '인출 기준점',     Component: BaselineTab },
  { key: 'targets',  label: '자산군 내부 목표', Component: SubTargetsTab },
]

export default function WithdrawalSettings() {
  const [tab, setTab] = useState('holdings')
  const { Component } = TABS.find(t => t.key === tab)

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4">
        <h1 className="text-xl font-bold">🧭 인출 설정</h1>
        <p className="text-blue-200 text-sm mt-1">
          보유상품 속성 · 생활비 · 인출 기준점 · 자산군 내부 목표 — 인출 판단의 입력 데이터
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto overflow-y-hidden">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors
              ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <Component />
    </div>
  )
}
