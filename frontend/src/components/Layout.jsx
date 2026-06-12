import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { NAV_GROUPS } from '../navigation'

// 현재 경로가 속한 그룹 id 반환
function activeGroupId(pathname) {
  for (const g of NAV_GROUPS) {
    if (g.items.some(item => pathname === item.path || pathname.startsWith(item.path + '/')))
      return g.id
  }
  return null
}

// 데스크탑 사이드바용: 홈·설정 제외한 토글 가능 그룹
const SIDEBAR_GROUPS = NAV_GROUPS.filter(g => g.id !== 'home' && g.id !== 'settings')

export default function Layout({ children }) {
  const location       = useLocation()
  const { user, signOut } = useAuth()

  const [openGroups, setOpenGroups] = useState(() => {
    try {
      const saved = localStorage.getItem('nav_open_groups')
      if (saved) return new Set(JSON.parse(saved))
    } catch {}
    // 기본 전체 펼침 (은퇴자 — 숨겨진 메뉴는 없는 메뉴다)
    return new Set(NAV_GROUPS.map(g => g.id))
  })

  // 현재 경로가 속한 그룹 자동 펼침
  useEffect(() => {
    const gid = activeGroupId(location.pathname)
    if (gid) {
      setOpenGroups(prev => {
        const next = new Set(prev)
        next.add(gid)
        return next
      })
    }
  }, [location.pathname])

  useEffect(() => {
    localStorage.setItem('nav_open_groups', JSON.stringify([...openGroups]))
  }, [openGroups])

  const toggle = (id) =>
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const currentGroup = activeGroupId(location.pathname)

  return (
    <div className="flex min-h-screen bg-gray-50">

      {/* ── 데스크탑 사이드바 ───────────────────────────────────── */}
      <aside className="hidden md:flex w-52 bg-[#1e3a5f] text-white flex-col fixed h-full z-10 overflow-y-auto">

        <div className="px-5 py-5 border-b border-white/10 flex-shrink-0">
          <div className="text-lg font-bold leading-tight">🏦 은퇴포트폴리오</div>
          <div className="text-[11px] text-blue-300 mt-0.5">AI 자산관리 시스템</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {/* 홈 — 단독 항목 */}
          <NavLink to="/" end
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
               ${isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`
            }>
            <span>🏠</span>대시보드
          </NavLink>

          {/* 토글 그룹: 자산 / 현금흐름 / 연금·세금 */}
          {SIDEBAR_GROUPS.map(group => {
            const isOpen    = openGroups.has(group.id)
            const hasActive = group.items.some(item => location.pathname === item.path)
            return (
              <div key={group.id}>
                <button onClick={() => toggle(group.id)}
                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg
                              text-[11px] font-bold uppercase tracking-widest transition-colors select-none
                              ${hasActive
                                ? 'text-white/80 bg-white/8'
                                : 'text-blue-300/60 hover:text-blue-200 hover:bg-white/5'}`}>
                  <div className="flex items-center gap-1.5">
                    {hasActive && !isOpen && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-300 flex-shrink-0" />
                    )}
                    <span>{group.icon}</span>
                    <span>{group.label}</span>
                  </div>
                  <span className="text-[10px] opacity-50 transition-transform duration-150"
                        style={{ display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                    ▸
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-0.5 ml-1 pl-2 border-l border-white/10 space-y-0.5 pb-1">
                    {group.items.map(({ path, icon, label }) => (
                      <NavLink key={path} to={path}
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
        </nav>

        {/* 설정 — 하단 고정 */}
        <div className="px-3 pb-4 flex-shrink-0 border-t border-white/10 pt-3 space-y-1">
          <NavLink to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
               ${isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`
            }>
            <span>⚙️</span>설정
          </NavLink>

          <div className="px-3 pt-2 border-t border-white/10 mt-1">
            <p className="text-[11px] text-blue-300/70 truncate mb-1.5" title={user?.email}>
              👤 {user?.email}
            </p>
            <button
              onClick={signOut}
              className="w-full text-left text-xs text-blue-300/60 hover:text-red-300 hover:bg-white/5
                         px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <span>🚪</span>로그아웃
            </button>
          </div>
        </div>
      </aside>

      {/* ── 모바일 상단 헤더 ─────────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-20
                         bg-[#1e3a5f] border-b border-white/10
                         flex items-center justify-between px-4 py-3">
        <span className="text-white font-bold text-sm">🏦 은퇴포트폴리오</span>
        <button
          onClick={signOut}
          className="text-blue-300/70 hover:text-red-300 text-xs flex items-center gap-1 transition-colors"
        >
          <span>🚪</span>로그아웃
        </button>
      </header>

      {/* ── 메인 콘텐츠 ─────────────────────────────────────────── */}
      <main className="w-full md:ml-52 flex-1 p-4 md:p-6 min-h-screen pt-16 md:pt-6 pb-28 md:pb-6">
        {children}
      </main>

      {/* ── 모바일 하단 탭 바 — 5탭(홈/자산/현금흐름/연금/더보기) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20
                      bg-[#1e3a5f] border-t border-white/10
                      flex items-center justify-around py-2 px-1">

        {/* 홈 */}
        <NavLink to="/" end
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors
             min-w-[44px] min-h-[44px] justify-center
             ${isActive ? 'text-white' : 'text-blue-300/70'}`
          }>
          {({ isActive }) => (
            <>
              <span className="text-xl leading-none">🏠</span>
              <span className={`text-[11px] font-medium leading-tight ${isActive ? 'text-white' : 'text-blue-300/70'}`}>홈</span>
              <span className={`w-1 h-1 rounded-full mt-0.5 transition-opacity ${isActive ? 'bg-white opacity-100' : 'opacity-0'}`} />
            </>
          )}
        </NavLink>

        {/* 그룹 탭: 자산 / 현금흐름 / 연금 — 그룹 첫 번째 페이지로 이동 */}
        {SIDEBAR_GROUPS.map(group => {
          const firstPath     = group.items[0].path
          const isGroupActive = currentGroup === group.id
          return (
            <NavLink key={group.id} to={firstPath}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors
                          min-w-[44px] min-h-[44px] justify-center
                          ${isGroupActive ? 'text-white' : 'text-blue-300/70'}`}
            >
              <span className="text-xl leading-none">{group.icon}</span>
              <span className={`text-[11px] font-medium leading-tight ${isGroupActive ? 'text-white' : 'text-blue-300/70'}`}>
                {group.mobileLabel}
              </span>
              <span className={`w-1 h-1 rounded-full mt-0.5 transition-opacity ${isGroupActive ? 'bg-white opacity-100' : 'opacity-0'}`} />
            </NavLink>
          )
        })}

        {/* 더보기 — 설정으로 이동 */}
        <NavLink to="/settings"
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors
             min-w-[44px] min-h-[44px] justify-center
             ${isActive ? 'text-white' : 'text-blue-300/70'}`
          }>
          {({ isActive }) => (
            <>
              <span className="text-xl leading-none">⋯</span>
              <span className={`text-[11px] font-medium leading-tight ${isActive ? 'text-white' : 'text-blue-300/70'}`}>더보기</span>
              <span className={`w-1 h-1 rounded-full mt-0.5 transition-opacity ${isActive ? 'bg-white opacity-100' : 'opacity-0'}`} />
            </>
          )}
        </NavLink>
      </nav>
    </div>
  )
}
