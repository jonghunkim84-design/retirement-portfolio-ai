import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../../api/client.js'
import { describeSeriesCard, groupSeries, describeRefresh, fmtLevel } from '../../lib/marketText.js'
import { Banner, Loading, errMsg } from '../withdrawal-settings/ui.jsx'
import { Badge, Section, Tag } from './parts.jsx'

const RANGES = [{ days: 90, label: '3개월' }, { days: 365, label: '1년' }, { days: 1095, label: '3년' }]

function SeriesCard({ card, selected, onSelect }) {
  return (
    <button onClick={onSelect}
      className={`card text-left w-full transition-shadow hover:shadow-md ${selected ? 'ring-2 ring-blue-400' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-gray-700">{card.name}</div>
        <div className="flex flex-wrap gap-1 justify-end">
          {card.badges.map(b => <Badge key={b.key} tone={b.tone} title={b.help}>{b.label}</Badge>)}
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{card.value}</div>
      <div className="grid grid-cols-2 gap-x-3 text-xs text-gray-600 mt-2">
        <div>1개월 <b className="tabular-nums" title={card.change1mReason || undefined}>{card.change1m}</b></div>
        <div>3개월 <b className="tabular-nums">{card.change3m}</b></div>
        {card.drawdown != null && (
          <div className="col-span-2">고점 대비 하락 <b className="tabular-nums" title={card.drawdownReason || undefined}>{card.drawdown}</b>{card.drawdownNote && <span className="text-yellow-700 ml-1.5">({card.drawdownNote})</span>}</div>
        )}
        {card.yoy != null && <div className="col-span-2">전년 동월 대비 <b className="tabular-nums">{card.yoy}</b></div>}
      </div>
      <div className="text-[11px] text-gray-400 mt-2">
        기준일 {card.date}{card.source && ` · ${card.source}`}<Tag kind="observed" />
      </div>
      {card.reason && <div className="text-[11px] text-yellow-700 mt-1">{card.reason}</div>}
    </button>
  )
}

function HistoryPanel({ code, name }) {
  const [days, setDays] = useState(365)
  const { data, isLoading, error } = useQuery({
    queryKey: ['market-history', code, days],
    queryFn: () => api.get(`/market/series/${code}/history`, { params: { days } }).then(r => r.data),
  })
  const points = data?.points ?? []
  const flagged = points.filter(p => p.flag)
  return (
    <Section title={`${name} 이력`}
      right={
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 text-xs rounded-md border ${days === r.days ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-600 border-gray-200'}`}>{r.label}</button>
          ))}
        </div>
      }
      note={flagged.length ? `이상치 의심 관측 ${flagged.length}건이 있습니다 (${flagged.slice(0, 3).map(p => p.date).join(', ')}${flagged.length > 3 ? ' …' : ''}). 최신값·변화율에는 포함되고 고점 계산에서는 제외됩니다.` : undefined}>
      {isLoading ? <Loading /> : error ? <Banner tone="red">{errMsg(error)}</Banner> : points.length === 0 ? (
        <p className="text-sm text-gray-500">이 기간의 관측값이 없습니다.</p>
      ) : (
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={56} tickFormatter={fmtLevel} />
              <Tooltip formatter={v => fmtLevel(v)} labelStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={1.8} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  )
}

export default function SignalsTab() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['market-series'], queryFn: () => api.get('/market/series').then(r => r.data), staleTime: 60_000,
  })
  const refresh = useMutation({
    mutationFn: () => api.post('/market/refresh', null, { timeout: 120_000 }).then(r => r.data),
    onSuccess: () => {
      for (const k of ['market-series', 'market-history', 'market-regime', 'exposure-signals']) qc.invalidateQueries({ queryKey: [k] })
    },
  })

  if (isLoading) return <Loading />
  if (error) return <Banner tone="red">{errMsg(error)}</Banner>
  const cards = data.series.map(describeSeriesCard)
  const groups = groupSeries(data.series)
  const byCode = Object.fromEntries(cards.map(c => [c.code, c]))
  const result = refresh.data ? describeRefresh(refresh.data) : null
  const sel = selected ? byCode[selected] : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">기준일 {data.as_of} · 매일 자동 수집됩니다. 카드를 누르면 이력 차트가 열립니다.</p>
        <button className="btn-primary text-sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? '수집 중... (최대 1분)' : '🔄 데이터 갱신'}
        </button>
      </div>

      {refresh.isError && <Banner tone="red">{errMsg(refresh.error)}</Banner>}
      {result && (
        <div className="space-y-2">
          <Banner tone={result.tone}>{result.headline}</Banner>
          {result.rows.some(r => r.status.tone !== 'ok') && (
            <ul className="text-xs text-gray-600 space-y-0.5 pl-2">
              {result.rows.filter(r => r.status.tone !== 'ok').map(r => (
                <li key={r.code}><b>{r.code}</b> {r.status.label} — {r.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {groups.map(g => (
        <div key={g.category}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{g.label}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.items.map(s => (
              <SeriesCard key={s.code} card={byCode[s.code]} selected={selected === s.code}
                onSelect={() => setSelected(selected === s.code ? null : s.code)} />
            ))}
          </div>
        </div>
      ))}

      {sel && <HistoryPanel code={sel.code} name={sel.name} />}
    </div>
  )
}
