import { useSearchParams } from 'react-router-dom'
import SignalsTab from './market-exposure/SignalsTab.jsx'
import ImpactTab from './market-exposure/ImpactTab.jsx'
import ExposureTab from './market-exposure/ExposureTab.jsx'
import ScenarioTab from './market-exposure/ScenarioTab.jsx'

const TABS = [
  { key: 'signals',  label: '시장 신호',        Component: SignalsTab },
  { key: 'impact',   label: '최근 변화의 영향', Component: ImpactTab },
  { key: 'exposure', label: '내 노출도',        Component: ExposureTab },
  { key: 'scenario', label: '시나리오',         Component: ScenarioTab },
]

export default function MarketExposure() {
  // 탭은 ?tab= 쿼리로 유지한다. 알 수 없는 값은 첫 탭.
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'signals'
  const setTab = key => setParams({ tab: key }, { replace: true })
  const { Component } = TABS.find(t => t.key === tab)

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-4">
        <h1 className="text-xl font-bold">🌐 시장·노출</h1>
        <p className="text-blue-200 text-sm mt-1">시장이 변하면 내 자산과 생활비에 어떤 영향이 있는지 — 관측값과 가정에 따른 점검이며 예측이 아닙니다</p>
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
