// 인출 설정 화면 공용 조각 (기존 Expenses.jsx 모달·폼 스타일과 동일한 Tailwind 클래스)

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export function Loading() {
  return <div className="flex items-center justify-center h-40 text-gray-400">불러오는 중...</div>
}

export function Banner({ tone = 'yellow', children }) {
  const cls = {
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    red:    'bg-red-50 border-red-200 text-red-700',
  }[tone]
  return <div className={`border rounded-xl px-4 py-2.5 text-sm ${cls}`}>{children}</div>
}

/** axios 오류 → 사용자에게 보여줄 문구 (FastAPI detail 이 문자열 또는 검증 오류 배열) */
export function errMsg(e) {
  const d = e?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map(x => (x.msg || '').replace(/^Value error, /, '')).filter(Boolean).join(' / ') || '입력값이 올바르지 않습니다'
  return e?.message || '저장에 실패했습니다'
}

export const won = v => (v == null ? '-' : Math.round(Number(v)).toLocaleString('ko-KR') + '원')
