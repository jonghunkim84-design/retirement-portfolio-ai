// 시장·노출 화면 공용 조각
import { TONE_BADGE } from '../../lib/withdrawalCheck.js'

/** 수치의 성격 표시: 관측(시장에서 실제로 관측) / 가정(입력·대용·충격 가정) */
export function Tag({ kind }) {
  return kind === 'assumed'
    ? <span className="badge-yellow ml-1.5" title="사용자 입력값·대용값·충격 크기 등 가정에 의존하는 수치">가정</span>
    : <span className="badge-gray ml-1.5" title="시장 지표·보유 금액처럼 실제로 관측된 값">관측</span>
}

export function Badge({ tone = 'neutral', children, title }) {
  return <span className={TONE_BADGE[tone] ?? 'badge-gray'} title={title}>{children}</span>
}

export function Section({ title, right, children, note }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {right}
      </div>
      {children}
      {note && <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">{note}</p>}
    </div>
  )
}

export function Disclaimer({ children }) {
  return <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{children}</p>
}
