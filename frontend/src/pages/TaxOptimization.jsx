import { useQuery } from '@tanstack/react-query'
import api from '../api/client.js'

const THRESHOLD = 20_000_000

// 상태별 스타일 매핑
const STATUS = {
  safe:    { border: 'border-green-500',  bar: 'bg-green-400',  badge: 'bg-green-100 text-green-700',   label: '안전',  text: 'text-green-600' },
  warning: { border: 'border-yellow-400', bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700', label: '주의',  text: 'text-yellow-600' },
  danger:  { border: 'border-red-500',    bar: 'bg-red-400',    badge: 'bg-red-100 text-red-700',       label: '위험',  text: 'text-red-600' },
}

// ── 절세 전략 정적 데이터 ──────────────────────────────────────────
const STRATEGIES = [
  {
    icon:  '🏦',
    title: 'ISA 계좌 활용',
    rows: [
      { label: '납입 한도',   value: '연 2,000만원 (5년 최대 1억)' },
      { label: '비과세 한도', value: '일반형 200만원 / 서민형 400만원' },
    ],
    tip: '배당·이자 수익을 ISA 계좌 안으로 이전하면 2,000만원 한도 소진 속도를 늦출 수 있습니다.',
  },
  {
    icon:  '📊',
    title: '연금저축 / IRP 세액공제',
    rows: [
      { label: '세액공제 한도', value: '연 900만원 (연금저축 600 + IRP 300)' },
      { label: '공제율',        value: '16.5% (종합소득 4,500만원 이하 기준)' },
    ],
    tip: 'IRP 추가 납입으로 최대 148만원 세액공제가 가능합니다.',
  },
  {
    icon:  '📅',
    title: '분리과세 관리',
    rows: [
      { label: '2,000만원 이하', value: '15.4% 원천징수로 종결' },
      { label: '2,000만원 초과', value: '종합소득 합산 (최고 세율 49.5%)' },
    ],
    tip: '연말 배당 수령 시기를 조정하면 한도를 해를 넘겨 분산할 수 있습니다.',
  },
]

function won(v) {
  return Math.round(v).toLocaleString('ko-KR') + '원'
}

export default function TaxOptimization() {
  const { data, isLoading } = useQuery({
    queryKey: ['tax-summary'],
    queryFn:  () => api.get('/tax/summary').then(r => r.data),
  })

  const today = new Date()
  const year  = today.getFullYear()

  const ytd       = data?.financial_income_ytd ?? 0
  const remaining = data?.remaining            ?? THRESHOLD
  const pct       = data?.utilization_pct      ?? 0
  const status    = data?.status               ?? 'safe'
  const S         = STATUS[status] ?? STATUS.safe
  const barW      = Math.min(pct, 100)

  return (
    <div className="space-y-5">

      {/* ─── 헤더 ──────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">🧾 세금 최적화</h1>
        <p className="text-sm text-gray-500 mt-0.5">{year}년 금융소득 종합과세 모니터 및 절세 전략</p>
      </div>

      {/* ─── A: 금융소득 종합과세 모니터 ──────────────────────── */}
      <div className={`card border-l-4 ${S.border}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">💰 금융소득 종합과세 모니터</h2>
          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${S.badge}`}>
            {S.label}
          </span>
        </div>

        {isLoading ? (
          <div className="text-sm text-gray-400 py-4 text-center">불러오는 중...</div>
        ) : (
          <>
            {/* 금액 요약 */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <p className="text-[11px] text-gray-400 mb-0.5">올해 금융소득</p>
                <p className={`text-lg font-bold ${S.text}`}>{won(ytd)}</p>
              </div>
              <div className="text-center">
                <p className="text-[11px] text-gray-400 mb-0.5">종합과세 기준</p>
                <p className="text-lg font-bold text-gray-700">{won(THRESHOLD)}</p>
              </div>
              <div className="text-center">
                <p className="text-[11px] text-gray-400 mb-0.5">잔여 한도</p>
                <p className={`text-lg font-bold ${remaining >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {remaining >= 0 ? won(remaining) : `-${won(Math.abs(remaining))}`}
                </p>
              </div>
            </div>

            {/* 프로그레스바 */}
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>0원</span>
                <span className="font-medium">{pct.toFixed(1)}% 소진</span>
                <span>2,000만원</span>
              </div>
              <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${S.bar} transition-all duration-500`}
                     style={{ width: `${barW}%` }} />
                {/* 60% · 80% 경고선 */}
                {[60, 80].map(mark => (
                  <div key={mark}
                    className="absolute top-0 bottom-0 w-0.5 bg-gray-400 opacity-50 z-10"
                    style={{ left: `${mark}%` }} />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-gray-400 mt-0.5 px-0.5">
                <span />
                <span>⚠ 60%</span>
                <span>🔴 80%</span>
                <span />
              </div>
            </div>

            {/* 상태 설명 */}
            <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${S.badge}`}>
              {status === 'safe'    && '현재 금융소득이 기준의 60% 미만입니다. 여유 한도를 확인하며 관리하세요.'}
              {status === 'warning' && '금융소득이 기준의 60%를 초과했습니다. ISA·연금 계좌 활용을 검토하세요.'}
              {status === 'danger'  && '금융소득이 기준의 80%를 초과했습니다. 연내 배당 수령 조정이 필요합니다.'}
            </div>
          </>
        )}
      </div>

      {/* ─── B: 절세 전략 카드 3개 ────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">📌 절세 전략</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STRATEGIES.map(s => (
            <div key={s.title} className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{s.icon}</span>
                <h3 className="text-sm font-semibold text-gray-700">{s.title}</h3>
              </div>

              <div className="space-y-2 mb-3">
                {s.rows.map(r => (
                  <div key={r.label} className="flex justify-between items-start gap-2 text-xs">
                    <span className="text-gray-400 flex-shrink-0">{r.label}</span>
                    <span className="font-medium text-gray-700 text-right">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-2.5">
                <p className="text-[11px] text-blue-600 leading-relaxed">
                  💡 {s.tip}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── C: 주의사항 ────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500 leading-relaxed">
        ⚠️ <span className="font-medium text-gray-600">주의사항</span> · 본 안내는 일반적인 참고용 정보입니다.
        정확한 세금 계획은 세무사와 상담하세요.
        개인 소득 구성, 공제 항목, 가족 상황에 따라 세부 적용이 달라질 수 있습니다.
      </div>

    </div>
  )
}
