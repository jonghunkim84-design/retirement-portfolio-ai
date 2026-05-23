import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'

// ── 내비게이션 구조 ───────────────────────────────────────────────
const GROUPS = [
  {
    key:   'assets',
    label: '자산',
    items: [
      { to: '/assets',   icon: '📋', label: '자산 관리' },
      { to: '/returns',  icon: '📈', label: '수익률 분석' },
      { to: '/networth', icon: '💹', label: '순자산 추이' },
    ],
  },
  {
    key:   'risk',
    label: '리스크',
    items: [
      { to: '/risk',           icon: '⚠️', label: '위험 점수' },
      { to: '/rebalance',      icon: '⚖️', label: '리밸런싱' },
      { to: '/maturity-guide', icon: '🔄', label: '재배분 가이드' },
    ],
  },
  {
    key:   'cashflow',
    label: '인출·현금',
    items: [
      { to: '/withdrawal', icon: '💸', label: '인출 관리' },
      { to: '/cashflow',   icon: '📅', label: '현금흐름' },
      { to: '/income',     icon: '💰', label: '수입 추적' },
    ],
  },
  {
    key:   'pension',
    label: '연금',
    items: [
      { to: '/pension-plan',     icon: '📊', label: '연금 계획' },
      { to: '/pension-optimize', icon: '🏛',  label: '연금 최적화' },
    ],
  },
]

// 모바일 하단 탭 바 (5개 핵심 메뉴)
const MOBILE_TABS = [
  { to: '/',            icon: '🏠', label: '홈' },
  { to: '/assets',      icon: '📋', label: '자산' },
  { to: '/withdrawal',  icon: '💸', label: '인출' },
  { to: '/pension-plan',icon: '📊', label: '연금' },
  { to: '/settings',    icon: '⚙️', label: '설정' },
]

function activeGroupKeys(pathname) {
  const set = new Set()
  GROUPS.forEach(g => {
    if (g.items.some(item => pathname === item.to || pathname.startsWith(item.to + '/')))
      set.add(g.key)
  })
  return set
}

export default function Layout({ children }) {
  const location = useLocation()

  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const saved = localStorage.getItem('nav_open_groups')
      if (saved) return new Set(JSON.parse(saved))
    } catch {}
    return activeGroupKeys(location.pathname)
  })

  useEffect(() => {
    const active = activeGroupKeys(location.pathname)
    if (active.size > 0) {
      setOpenGroups(prev => {
        const next = new Set(prev)
        active.forEach(k => next.add(k))
        return next
      })
    }
  }, [location.pathname])

  useEffect(() => {
    localStorage.setItem('nav_open_groups', JSON.stringify([...openGroups]))
  }, [openGroups])

  const toggle = (key) =>
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <div className="flex min-h-screen bg-gray-50">

      {/* ── 데스크탑 사이드바 (md 이상에서만 표시) ──────────────── */}
      <aside className="hidden md:flex w-52 bg-[#1e3a5f] text-white flex-col fixed h-full z-10 overflow-y-auto">

        <div className="px-5 py-5 border-b border-white/10 flex-shrink-0">
          <div className="text-lg font-bold leading-tight">🏦 은퇴포트폴리오</div>
          <div className="text-[11px] text-blue-300 mt-0.5">AI 자산관리 시스템</div>
        </div>

        <nav className="flex-1 px-3 py-4">
          <NavLink to="/" end
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-3
               ${isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`
            }>
            <span>🏠</span>대시보드
          </NavLink>

          <div className="space-y-1">
            {GROUPS.map(group => {
              const isOpen    = openGroups.has(group.key)
              const hasActive = group.items.some(item => location.pathname === item.to)
              return (
                <div key={group.key}>
                  <button onClick={() => toggle(group.key)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg
                                text-[11px] font-bold uppercase tracking-widest transition-colors select-none
                                ${hasActive
                                  ? 'text-white/80 bg-white/8'
                                  : 'text-blue-300/60 hover:text-blue-200 hover:bg-white/5'}`}>
                    <div className="flex items-center gap-1.5">
                      {hasActive && !isOpen && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-300 flex-shrink-0" />
                      )}
                      <span>{group.label}</span>
                    </div>
                    <span className="text-[10px] opacity-50 transition-transform duration-150"
                          style={{ display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                      ▸
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-0.5 ml-1 pl-2 border-l border-white/10 space-y-0.5 pb-1">
                      {group.items.map(({ to, icon, label }) => (
                        <NavLink key={to} to={to}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                             ${isActive
                               ? 'bg-white/15 text-white font-medium'
                               : 'text-blue-100/80 hover:bg-white/10 hover:text-white'}`
                          }>
                          <span className="text-sm flex-shrink-0">{icon}</span>
                          <span>{label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>

        <div className="px-3 pb-4 flex-shrink-0 border-t border-white/10 pt-3">
          <NavLink to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
               ${isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`
            }>
            <span>⚙️</span>설정
          </NavLink>
          <p className="text-[10px] text-blue-400/60 px-3 mt-2">v2.0 · Supabase + FastAPI</p>
        </div>
      </aside>

      {/* ── 메인 콘텐츠 ─────────────────────────────────────────── */}
      {/* 모바일: 전체 너비, 하단 탭바 공간 확보 (pb-20) */}
      {/* 데스크탑: 사이드바 너비만큼 밀기 (md:ml-52) */}
      <main className="w-full md:ml-52 flex-1 p-4 md:p-6 min-h-screen pb-24 md:pb-6">
        {children}
      </main>

      {/* ── 모바일 하단 탭 바 (md 미만에서만 표시) ──────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20
                      bg-[#1e3a5f] border-t border-white/10
                      flex items-center justify-around
                      py-2 px-1">
        {MOBILE_TABS.map(({ to, icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors min-w-0
               ${isActive ? 'text-white' : 'text-blue-300/70'}`
            }>
            {({ isActive }) => (
              <>
                <span className="text-xl leading-none">{icon}</span>
                <span className={`text-[10px] font-medium leading-tight
                                  ${isActive ? 'text-white' : 'text-blue-300/70'}`}>
                  {label}
                </span>
                {/* 활성 인디케이터 점 */}
                <span className={`w-1 h-1 rounded-full mt-0.5 transition-opacity
                                  ${isActive ? 'bg-white opacity-100' : 'opacity-0'}`} />
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
