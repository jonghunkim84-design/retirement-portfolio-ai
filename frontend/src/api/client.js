import axios from 'axios'
import { supabase } from '../lib/supabase.js'
import { installAuthInterceptors } from './authInterceptors.js'

const api = axios.create({
  baseURL: '/api',
  timeout: 60_000,
})

// ── 인증: 모든 API 호출에 로그인 토큰을 붙이고 401/403 을 처리한다 (백엔드가 토큰을 검증) ──
let leaving = false
async function backToLogin(reason) {
  try { await supabase.auth.signOut() } catch { /* 이미 만료된 세션이면 무시 */ }
  if (leaving || window.location.pathname === '/login') return
  leaving = true
  window.location.replace(`/login?reason=${reason}`)
}

installAuthInterceptors(api, {
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  refreshAccessToken: async () => {
    const { data, error } = await supabase.auth.refreshSession()
    return error ? null : data.session?.access_token ?? null
  },
  onUnauthorized: () => backToLogin('expired'),
  onForbidden: () => backToLogin('forbidden'),
})

export default api

export const fmt = {
  won:  (v) => (v == null ? '-' : Math.round(v).toLocaleString('ko-KR') + '원'),
  eok:  (v) => (v == null ? '-' : (v / 1e8).toFixed(2) + '억원'),
  pct:  (v) => (v == null ? '-' : v.toFixed(1) + '%'),
  date: (s) => (s ? s.slice(0, 10) : '-'),
  month:(s) => (s ? s.slice(0, 7) : '-'),
}

export const LEVEL_COLOR = {
  green:  { text: 'text-green-600',  bg: 'bg-green-100',  badge: 'badge-green',  hex: '#22c55e', label: '🟢 안전' },
  yellow: { text: 'text-yellow-600', bg: 'bg-yellow-100', badge: 'badge-yellow', hex: '#eab308', label: '🟡 주의' },
  red:    { text: 'text-red-600',    bg: 'bg-red-100',    badge: 'badge-red',    hex: '#ef4444', label: '🔴 위험' },
}

export const ASSET_TYPE_LABEL = {
  cash: '현금성', bond: '채권', tdf: 'TDF', fund: '펀드', equity: '주식형', income: '리츠/인컴'
}

export const ACCOUNT_TYPES = ['연금저축', '개인연금', '개인저축', 'IRP']
