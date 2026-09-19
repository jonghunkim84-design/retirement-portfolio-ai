import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../api/client.js'
import {
  NULL_TEXT, fmtYears, fmtRate, fmtMan, cardModel, CARD_BASIS, TONE_BADGE, TONE_TEXT,
} from '../lib/withdrawalCheck.js'

// 값이 null 이면 "-" 와 사유 툴팁 (0 으로 보이지 않게)
function Val({ text, reason, className = '' }) {
  const isNull = text === NULL_TEXT
  return (
    <span className={className} title={isNull && reason ? reason : undefined}
      style={isNull && reason ? { cursor: 'help', textDecoration: 'underline dotted' } : undefined}>
      {text}
    </span>
  )
}

/** 대시보드 "인출 점검" 카드 — 서버의 GET /withdrawal-check 결과를 요약해서 보여 준다 (계산은 서버). */
export default function WithdrawalCheckCard() {
  const nav = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['withdrawal-check'],
    queryFn: () => api.get('/withdrawal-check').then(r => r.data),
    staleTime: 60 * 1000,
  })

  const go = tab => nav(`/withdrawal-settings?tab=${tab}`)

  if (isLoading) {
    return <div className="card border-l-4 border-blue-400 text-sm text-gray-400">🧮 인출 점검 불러오는 중...</div>
  }
  if (error || !data) {
    return (
      <div className="card border-l-4 border-gray-300 text-sm text-gray-500">
        🧮 인출 점검을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </div>
    )
  }

  const m = cardModel(data)
  return (
    <div className="card border-l-4 border-blue-400 cursor-pointer hover:shadow-md transition-shadow"
      role="button" tabIndex={0} onClick={() => go('check')}
      onKeyDown={e => { if (e.key === 'Enter') go('check') }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">🧮 인출 점검</h3>
        <span className="text-[11px] text-blue-500">점검 결과 자세히 →</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 순인출 필요액 */}
        <div>
          <div className="text-xs text-gray-500 mb-1">순인출 필요액 (지출 − 정기수입)</div>
          <div className="text-xl font-bold text-gray-800">
            <Val text={m.netAnnual > 0 ? fmtMan(m.netAnnual) : NULL_TEXT} reason={m.netReason} />
            <span className="text-xs font-normal text-gray-400 ml-1">/ 년</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            월 <Val text={m.netAnnual > 0 ? fmtMan(m.netMonthly) : NULL_TEXT} reason={m.netReason} />
          </div>
        </div>

        {/* 버킷 커버 연수 */}
        <div>
          <div className="text-xs text-gray-500 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            버킷 커버 연수
            <span className={TONE_BADGE[m.r01.tone]} title={m.r01Reason || 'R-01 (1버킷 최소·목표 연수) 판정'}>
              R-01 {m.r01.label}
            </span>
          </div>
          <div className="flex gap-4">
            <div>
              <div className={`text-xl font-bold ${TONE_TEXT[m.r01.tone]}`}>
                <Val text={fmtYears(m.b1Years)} reason={m.yearsReason} />
              </div>
              <div className="text-[11px] text-gray-400">1버킷</div>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-800">
                <Val text={fmtYears(m.b12Years)} reason={m.yearsReason} />
              </div>
              <div className="text-[11px] text-gray-400">1+2버킷</div>
            </div>
          </div>
          <div className="text-[11px] text-gray-400 mt-1" title={CARD_BASIS.bucketHelp}
            style={{ cursor: 'help' }}>
            ({CARD_BASIS.bucket})
          </div>
        </div>

        {/* 인출률 */}
        <div>
          <div className="text-xs text-gray-500 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            인출률 <span className="text-gray-400" title={CARD_BASIS.rateHelp} style={{ cursor: 'help' }}>({CARD_BASIS.rate})</span>
            <span className={TONE_BADGE[m.guardrail.tone]} title={m.guardrailReason || '가드레일 (R-05·R-06) 판정'}>
              {m.guardrail.label}
            </span>
          </div>
          <div className="text-xl font-bold text-gray-800">
            <Val text={fmtRate(m.initialRate)} reason={m.initialReason} />
            <span className="text-gray-400 mx-1.5">→</span>
            <Val text={fmtRate(m.currentRate)} reason={m.currentReason} />
          </div>
          <div className="text-[11px] text-gray-400">초기 → 현재</div>
        </div>
      </div>

      {m.notices.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
          {m.notices.map(n => (
            <button key={n.code} onClick={() => go(n.tab)}
              className={`text-[11px] px-2 py-1 rounded-full border ${
                n.code === 'default_bucket'
                  ? 'bg-gray-50 border-gray-200 text-gray-600'
                  : 'bg-yellow-50 border-yellow-200 text-yellow-800'} hover:opacity-80`}>
              {n.text} →
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 text-[11px] text-gray-400">
        기준일 {m.asOf} · 수익률·물가 미반영 단순 계산
      </div>
    </div>
  )
}
