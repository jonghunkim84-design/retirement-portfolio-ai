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

  // 바텀시트: group id | 'more' | null
  const [bottomSheet, setBottomSheet] = useState(null)

  // 경로 이동 시 바텀시트 닫기
  useEffect(() => { setBottomSheet(null) }, [location.pathname])

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

      {/* ── AI 어드바이저 플로팅 버튼 ────────────────────────────── */}
      {/* 모바일: 탭바(≈64px) + 여유 → bottom-20(80px) / 데스크탑: bottom-6 */}
      <NavLink to="/ai-advisor"
        className={({ isActive }) =>
          `fixed right-4 bottom-20 md:bottom-6 z-30
           w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl
           transition-transform hover:scale-110 active:scale-95
           ${isActive ? 'bg-blue-400' : 'bg-[#2563eb] hover:bg-blue-500'}`
        }>
        <span title="AI에게 묻기">💬</span>
      </NavLink>

      {/* ── 모바일 하단 탭 바 — 5탭(홈/자산/현금흐름/연금/더보기) ── */}
      {/* pt-2 고정, pb는 홈바 safe area와 8px 중 큰 값 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-20
                      bg-[#1e3a5f] border-t border-white/10
                      flex items-center overflow-hidden pt-2"
           style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>

        {/* 홈 */}
        <NavLink to="/" end
          className={({ isActive }) =>
            `flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1 rounded-lg transition-colors
             min-h-[44px] justify-center
             ${isActive ? 'text-white' : 'text-blue-300/70'}`
          }>
          {({ isActive }) => (
            <>
              <span className="text-xl leading-none">🏠</span>
              <span className={`text-[11px] font-medium leading-tight whitespace-nowrap ${isActive ? 'text-white' : 'text-blue-300/70'}`}>홈</span>
              <span className={`w-1 h-1 rounded-full mt-0.5 transition-opacity ${isActive ? 'bg-white opacity-100' : 'opacity-0'}`} />
            </>
          )}
        </NavLink>

        {/* 그룹 탭: 자산 / 현금흐름 / 연금 — 터치 시 바텀시트 팝업 */}
        {SIDEBAR_GROUPS.map(group => {
          const isGroupActive = currentGroup === group.id
          const isSheetOpen   = bottomSheet === group.id
          return (
            <button key={group.id}
              onClick={() => setBottomSheet(isSheetOpen ? null : group.id)}
              className={`flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1 rounded-lg transition-colors
                          min-h-[44px] justify-center
                          ${isGroupActive || isSheetOpen ? 'text-white' : 'text-blue-300/70'}`}
            >
              <span className="text-xl leading-none">{group.icon}</span>
              <span className={`text-[11px] font-medium leading-tight whitespace-nowrap ${isGroupActive || isSheetOpen ? 'text-white' : 'text-blue-300/70'}`}>
                {group.mobileLabel}
              </span>
              <span className={`w-1 h-1 rounded-full mt-0.5 transition-opacity ${isGroupActive ? 'bg-white opacity-100' : 'opacity-0'}`} />
            </button>
          )
        })}

        {/* 더보기 — 설정 등 */}
        <button
          onClick={() => setBottomSheet(bottomSheet === 'more' ? null : 'more')}
          className={`flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1 rounded-lg transition-colors
                      min-h-[44px] justify-center
                      ${bottomSheet === 'more' || currentGroup === 'settings' ? 'text-white' : 'text-blue-300/70'}`}
        >
          <span className="text-xl leading-none">⋯</span>
          <span className={`text-[11px] font-medium leading-tight whitespace-nowrap ${bottomSheet === 'more' || currentGroup === 'settings' ? 'text-white' : 'text-blue-300/70'}`}>
            더보기
          </span>
          <span className={`w-1 h-1 rounded-full mt-0.5 transition-opacity ${currentGroup === 'settings' ? 'bg-white opacity-100' : 'opacity-0'}`} />
        </button>
      </nav>

      {/* ── 모바일 바텀시트 ──────────────────────────────────────── */}
      {bottomSheet && (
        <>
          {/* 반투명 오버레이 */}
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setBottomSheet(null)}
          />
          {/* 시트 본체 */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50
                          bg-[#1e3a5f] rounded-t-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
              <span className="text-white font-semibold text-sm">
                {bottomSheet === 'more'
                  ? '더보기'
                  : NAV_GROUPS.find(g => g.id === bottomSheet)?.label}
              </span>
              <button
                onClick={() => setBottomSheet(null)}
                className="text-blue-300/70 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center"
              >
                ×
              </button>
            </div>
            <div className="px-4 py-3 space-y-1">
              {bottomSheet === 'more' ? (
                <NavLink to="/settings"
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors
                     ${isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10'}`
                  }>
                  <span className="text-xl">⚙️</span>설정
                </NavLink>
              ) : (
                NAV_GROUPS.find(g => g.id === bottomSheet)?.items.map(({ path, icon, label }) => (
                  <NavLink key={path} to={path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors
                       ${isActive ? 'bg-white/15 text-white' : 'text-blue-100 hover:bg-white/10'}`
                    }>
                    <span className="text-xl">{icon}</span>{label}
                  </NavLink>
                ))
              )}
            </div>
            {/* 탭바 + safe area 높이만큼 여백 */}
            <div style={{ height: 'calc(64px + env(safe-area-inset-bottom))' }} />
          </div>
        </>
      )}
    </div>
  )
}
