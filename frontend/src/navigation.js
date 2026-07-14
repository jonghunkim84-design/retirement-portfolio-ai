export const NAV_GROUPS = [
  {
    id: 'home',
    label: '홈',
    mobileLabel: '홈',
    icon: '🏠',
    items: [{ path: '/', label: '대시보드', icon: '🏠' }],
  },
  {
    id: 'assets',
    label: '자산',
    mobileLabel: '자산',
    icon: '📊',
    items: [
      { path: '/assets',        label: '자산 관리',    icon: '📋' },
      { path: '/real-assets',   label: '실물자산',     icon: '🏘' },
      { path: '/returns',       label: '수익률 분석',  icon: '📈' },
      { path: '/rebalance',     label: '리밸런싱',     icon: '⚖️' },
      { path: '/maturity-guide', label: '만기 재배분', icon: '🔄' },
    ],
  },
  {
    id: 'cashflow',
    label: '현금흐름',
    mobileLabel: '현금흐름',
    icon: '💰',
    items: [
      { path: '/income',     label: '수입 관리',   icon: '💰' },
      { path: '/expenses',   label: '지출 기록',   icon: '🧾' },
      { path: '/withdrawal', label: '인출 관리',   icon: '💸' },
      { path: '/cashflow',   label: '현금흐름',    icon: '📅' },
      { path: '/networth',   label: '순자산 추이', icon: '💹' },
    ],
  },
  {
    id: 'pension',
    label: '연금·세금',
    mobileLabel: '연금',
    icon: '🏛',
    items: [
      { path: '/pension-plan',     label: '연금 계획',   icon: '📊' },
      { path: '/pension-optimize', label: '연금 최적화', icon: '🏛' },
      { path: '/pension-tax',      label: '연금 세금',   icon: '🏖' },
      { path: '/withdrawal-strategy', label: '인출 전략', icon: '🪜' },
      { path: '/tax',              label: '세금 최적화', icon: '🧾' },
      { path: '/health-insurance', label: '건강보험료',  icon: '🏥' },
      { path: '/risk',             label: '위험 점수',   icon: '⚠️' },
    ],
  },
  {
    id: 'settings',
    label: '설정',
    mobileLabel: '설정',
    icon: '⚙️',
    items: [{ path: '/settings', label: '설정', icon: '⚙️' }],
  },
]

export const AI_ADVISOR = { path: '/ai-advisor', label: 'AI 어드바이저', icon: '💬' }
