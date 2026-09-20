import { useQuery } from '@tanstack/react-query'
import api from '../../api/client.js'
import { describeSignals } from '../../lib/marketText.js'
import { Banner, Loading, errMsg } from '../withdrawal-settings/ui.jsx'
import { Badge, Disclaimer, Section, Tag } from './parts.jsx'

const KIND_ICON = { rate: '📉', equity: '📈', fx: '💱' }

export default function ImpactTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['exposure-signals'], queryFn: () => api.get('/exposure/signals').then(r => r.data), staleTime: 60_000,
  })
  if (isLoading) return <Loading />
  if (error) return <Banner tone="red">{errMsg(error)}</Banner>
  const d = describeSignals(data)

  return (
    <div className="space-y-4">
      <Disclaimer>{d.disclaimer}</Disclaimer>

      {d.cards.length === 0 ? (
        <Banner tone="yellow">영향을 계산할 노출이 없습니다. 인출 설정의 보유상품 속성(지역·듀레이션 등)을 입력하세요.</Banner>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {d.cards.map(c => (
            <div key={c.key} className="card">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-gray-800">{KIND_ICON[c.kind]} {c.title}{c.isProxy && <Badge tone="info" title="실제 지수 대신 ETF 등을 쓰는 대용 지표">대용</Badge>}</div>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3"><span className="text-gray-500">① 관측된 변화<Tag kind="observed" /></span><b className="tabular-nums text-right">{c.observed}</b></div>
                <div className="flex justify-between gap-3"><span className="text-gray-500">② 내 노출<Tag kind={c.kind === 'rate' ? 'assumed' : 'observed'} /></span><span className="tabular-nums text-right">{c.exposure}</span></div>
                <div className="flex justify-between gap-3 pt-1.5 border-t border-gray-100"><span className="text-gray-700 font-medium">③ 추정 영향<Tag kind="assumed" /></span><b className="tabular-nums text-right text-base">{c.impact}</b></div>
              </div>
              {c.reason && <p className="text-xs text-yellow-700 mt-2">{c.reason}</p>}
            </div>
          ))}
        </div>
      )}

      <Section title="합계와 생활비 연수 영향">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <span className="text-gray-600">추정 영향 합계 <b className="text-lg tabular-nums text-gray-900">{d.total}</b><Tag kind="assumed" /></span>
          {d.yearsRow && <span className="text-gray-600">{d.yearsRow}</span>}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">주식·환율·금리 영향을 단순 합산한 참고값이며 교차 효과는 반영하지 않습니다.</p>
      </Section>

      {d.excluded.length > 0 && (
        <Section title={`계산에서 제외된 자산 (${d.excluded.length}건)`}>
          <ul className="text-sm text-gray-600 space-y-1">
            {d.excluded.map(x => <li key={x.id}><b>{x.name}</b> ({x.value}) — {x.text}</li>)}
          </ul>
        </Section>
      )}
    </div>
  )
}
