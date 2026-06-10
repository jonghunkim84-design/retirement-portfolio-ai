import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import api, { fmt, LEVEL_COLOR } from '../api/client.js'

const SUGGESTED = [
  '지금 리밸런싱해야 하나요?',
  '내 인출률이 안전한가요?',
  '비상 유동성이 부족한데 어떻게 할까요?',
  '내 포트폴리오 위험도가 적절한가요?',
]

// ── 컨텍스트 수치 카드 ────────────────────────────────────────────
function ContextCard({ label, value, badgeLabel, badgeClass }) {
  return (
    <div className="text-center py-2">
      <div className="text-[11px] text-gray-400 mb-1">{label}</div>
      <div className="text-base font-bold text-gray-800 leading-tight">{value}</div>
      {badgeLabel && (
        <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>
          {badgeLabel}
        </span>
      )}
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────
export default function AIAdvisor() {
  const { user }        = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const bottomRef = useRef(null)

  const { data } = useQuery({
    queryKey:  ['dashboard'],
    queryFn:   () => api.get('/dashboard').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const chatMut = useMutation({
    mutationFn: ({ message, history }) =>
      api.post('/ai/chat', { user_id: user?.id ?? '', message, history }).then(r => r.data),
    onSuccess: (res) => {
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply }])
    },
    onError: () => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '죄송합니다. AI 응답 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      }])
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatMut.isPending])

  const send = (text) => {
    const msg = (text ?? input).trim()
    if (!msg || chatMut.isPending) return
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setInput('')
    chatMut.mutate({ message: msg, history })
  }

  // ── 컨텍스트 수치 ──────────────────────────────────────────────
  const totalAssets    = data?.buckets?.total          ?? 0
  const withdrawalRate = data?.withdrawal_rate         ?? 0
  const liqMonths      = data?.liquidity?.months       ?? null
  const riskScore      = data?.risk?.total_score       ?? 0
  const riskLevel      = data?.risk?.level             ?? 'green'

  const wrStatus  = withdrawalRate > 5 ? 'red' : withdrawalRate > 4 ? 'yellow' : 'green'
  const liqStatus = liqMonths == null ? null : liqMonths < 6 ? 'red' : liqMonths < 12 ? 'yellow' : 'green'

  const liqBadge = liqStatus == null
    ? { label: '계산불가', cls: 'bg-gray-100 text-gray-500' }
    : liqStatus === 'red'
    ? { label: '위험',     cls: 'bg-red-100 text-red-700' }
    : liqStatus === 'yellow'
    ? { label: '주의',     cls: 'bg-yellow-100 text-yellow-700' }
    : { label: '안전',     cls: 'bg-green-100 text-green-700' }

  const wrLabel = withdrawalRate <= 4 ? '안전' : withdrawalRate <= 5 ? '주의' : '위험'

  return (
    <div className="space-y-4 max-w-3xl mx-auto">

      {/* ─── 헤더 ──────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">🤖 AI 포트폴리오 어드바이저</h1>
        <p className="text-sm text-gray-500 mt-0.5">현재 포트폴리오 데이터 기반 맞춤 조언</p>
      </div>

      {/* ─── 컨텍스트 요약 카드 ────────────────────────────────── */}
      <div className="card">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">
          AI가 참조하는 포트폴리오 현황
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100">
          <ContextCard
            label="총 자산"
            value={fmt.eok(totalAssets)}
          />
          <ContextCard
            label="연 인출률"
            value={`${withdrawalRate.toFixed(1)}%`}
            badgeLabel={wrLabel}
            badgeClass={`${LEVEL_COLOR[wrStatus]?.bg ?? ''} ${LEVEL_COLOR[wrStatus]?.text ?? ''}`}
          />
          <ContextCard
            label="비상 유동성"
            value={liqMonths != null ? `${liqMonths}개월` : '—'}
            badgeLabel={liqBadge.label}
            badgeClass={liqBadge.cls}
          />
          <ContextCard
            label="위험 점수"
            value={`${riskScore}점`}
            badgeLabel={LEVEL_COLOR[riskLevel]?.label ?? '—'}
            badgeClass={`${LEVEL_COLOR[riskLevel]?.bg ?? ''} ${LEVEL_COLOR[riskLevel]?.text ?? ''}`}
          />
        </div>
      </div>

      {/* ─── 추천 질문 버튼 ────────────────────────────────────── */}
      {messages.length === 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-2">추천 질문</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map(q => (
              <button key={q} onClick={() => send(q)}
                className="text-sm border border-blue-200 text-blue-600 bg-blue-50
                           hover:bg-blue-100 rounded-full px-4 py-1.5 transition-colors">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── 채팅 메시지 영역 ──────────────────────────────────── */}
      <div className="card min-h-[280px] max-h-[480px] overflow-y-auto flex flex-col gap-3 p-4">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 py-16">
            위 추천 질문을 클릭하거나 직접 입력해보세요.
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <span className="text-xl flex-shrink-0 mb-0.5">🤖</span>
            )}
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-gray-50 border border-gray-200 text-gray-800 rounded-bl-sm'
            }`}>
              {m.content}
            </div>
          </div>
        ))}

        {chatMut.isPending && (
          <div className="flex items-end gap-2 justify-start">
            <span className="text-xl flex-shrink-0 mb-0.5">🤖</span>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">분석 중</span>
                {[0, 1, 2].map(i => (
                  <span key={i}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ─── 입력창 ────────────────────────────────────────────── */}
      <div className="card p-3 flex gap-2 items-end">
        <textarea
          rows={1}
          placeholder="포트폴리오에 대해 무엇이든 질문하세요... (Enter 전송 · Shift+Enter 줄바꿈)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2
                     text-sm focus:outline-none focus:ring-2 focus:ring-blue-300
                     min-h-[42px] max-h-32"
        />
        <button
          onClick={() => send()}
          disabled={!input.trim() || chatMut.isPending}
          className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-40
                     text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors">
          전송
        </button>
      </div>

    </div>
  )
}
