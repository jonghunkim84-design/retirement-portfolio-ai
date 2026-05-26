import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn }   = useAuth()
  const navigate     = useNavigate()
  const location     = useLocation()
  const from         = location.state?.from?.pathname || '/'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [showPw,   setShowPw]   = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: err } = await signIn(email, password)

    if (err) {
      setError(
        err.message.includes('Invalid login credentials')
          ? '이메일 또는 비밀번호가 올바르지 않습니다.'
          : err.message.includes('Email not confirmed')
          ? '이메일 인증이 필요합니다. 메일함을 확인해주세요.'
          : '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      )
    } else {
      navigate(from, { replace: true })
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a5f] to-[#0f2040] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🏦</div>
          <h1 className="text-2xl font-bold text-white tracking-tight">은퇴포트폴리오</h1>
          <p className="text-blue-300 text-sm mt-1">AI 자산관리 시스템</p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-[#1e3a5f] px-6 py-4">
            <h2 className="text-white font-semibold text-base">로그인</h2>
            <p className="text-blue-300 text-xs mt-0.5">계정으로 접속하세요</p>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
            {/* 이메일 */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="example@email.com"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent
                           bg-gray-50 placeholder-gray-400"
              />
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                비밀번호
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent
                             bg-gray-50 placeholder-gray-400 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm select-none"
                  tabIndex={-1}
                >
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {/* 에러 메시지 */}
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
                <span className="flex-shrink-0 mt-0.5">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1e3a5f] hover:bg-[#2d5089] text-white font-semibold
                         py-3 rounded-lg transition-colors duration-200
                         disabled:opacity-60 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  로그인 중...
                </>
              ) : '로그인'}
            </button>
          </form>

          <div className="px-6 pb-5 text-center">
            <p className="text-xs text-gray-400">
              계정이 없으신가요?{' '}
              <span className="text-[#1e3a5f] font-medium">관리자에게 문의하세요</span>
            </p>
          </div>
        </div>

        <p className="text-center text-blue-400/40 text-xs mt-6">
          v2.0 · Supabase + FastAPI + Vercel
        </p>
      </div>
    </div>
  )
}
