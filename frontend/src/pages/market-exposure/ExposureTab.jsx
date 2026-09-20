import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../../api/client.js'
import { describeExposure, rateRowText, BASIS_TEXT, wonSigned } from '../../lib/marketText.js'
import { Banner, Loading, errMsg } from '../withdrawal-settings/ui.jsx'
import { Badge, Section, Tag } from './parts.jsx'

export default function ExposureTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['exposure'], queryFn: () => api.get('/exposure').then(r => r.data), staleTime: 60_000,
  })
  if (isLoading) return <Loading />
  if (error) return <Banner tone="red">{errMsg(error)}</Banner>
  const d = describeExposure(data)
  const rateRows = [...data.rate.rows].filter(r => r.price_change_per_1pp !== 0).sort((a, b) => a.price_change_per_1pp - b.price_change_per_1pp)

  return (
    <div className="space-y-4">
      <Section title="한눈에 보기" note={`활성 투자자산 ${d.total} 기준 · 실물자산 제외`}>
        <ul className="space-y-2 text-sm text-gray-700">
          <li>📉 {d.lines.rate}<Tag kind="assumed" /></li>
          <li className="text-gray-500">💰 {d.lines.rateInterest}<Tag kind="assumed" /></li>
          <li>💱 {d.lines.fx}<Tag kind="observed" /></li>
        </ul>
        {d.assumedCount > 0 && <p className="text-xs text-yellow-700 mt-2">금리 노출 중 {d.assumedCount}건은 가정에 의존합니다 (잔존만기·민감도 대용).</p>}
      </Section>

      <Section title="지역별 주식 노출" note="주식성 금액 = 주식 + 리츠·인컴 + TDF·펀드의 주식 부분. 지역이 없으면 '지역 미상'으로 모읍니다.">
        {d.regions.length === 0 ? <p className="text-sm text-gray-500">주식성 자산이 없거나 아직 입력되지 않았습니다.</p> : (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>지역</th><th className="text-right">금액</th><th className="text-right">주식 노출 중</th><th className="text-right">전체 자산 중</th><th>비고</th></tr></thead>
              <tbody>
                {d.regions.map(r => (
                  <tr key={r.region}>
                    <td className="font-medium">{r.region}</td>
                    <td className="text-right tabular-nums">{r.amount}</td>
                    <td className="text-right tabular-nums">{r.shareOfEquity}</td>
                    <td className="text-right tabular-nums">{r.shareOfTotal}</td>
                    <td className="text-xs text-yellow-700">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="금리 1%p 상승 시 자산별 변화" note="선형 근사(−듀레이션 × 금리 변화 × 금액)입니다. 채권일수록, 듀레이션이 길수록 크게 움직입니다.">
        {rateRows.length === 0 ? <p className="text-sm text-gray-500">금리 노출을 계산할 자산이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>자산</th><th>구분</th><th>근거</th><th className="text-right normal-case">1%p 상승 시</th></tr></thead>
              <tbody>
                {rateRows.map(r => (
                  <tr key={r.asset_id}>
                    <td className="font-medium">{r.asset_name}</td>
                    <td className="text-xs text-gray-600">{rateRowText(r)}</td>
                    <td>{r.basis === 'input' ? <Badge>입력값</Badge> : <Badge tone="warn" title={BASIS_TEXT[r.basis]}>가정</Badge>}</td>
                    <td className="text-right tabular-nums">{wonSigned(r.price_change_per_1pp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="데이터 완성도" right={<Link to="/withdrawal-settings?tab=holdings" className="text-xs text-blue-600 hover:underline">보유상품 속성 입력 →</Link>}
        note="입력하지 않은 속성은 추정해서 채우지 않고 계산에서 제외합니다. 아래 비중은 전체 투자자산 대비입니다.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {d.completeness.map(c => (
            <div key={c.key} className="border border-gray-100 rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500">{c.label}</div>
              <div className="text-lg font-bold tabular-nums">{c.count}건 <span className="text-sm font-medium text-gray-500">({c.share})</span></div>
            </div>
          ))}
        </div>
        {d.excludedRows.length > 0 && (
          <ul className="text-sm text-gray-600 space-y-1">
            {d.excludedRows.map(x => <li key={x.id}><Badge>{x.area}</Badge> <b>{x.name}</b> ({x.value}) — {x.text}</li>)}
          </ul>
        )}
      </Section>

      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">계산 가정 보기</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">{data.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
      </details>
    </div>
  )
}
