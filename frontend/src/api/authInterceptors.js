// axios 인스턴스에 Supabase 로그인 토큰 첨부 + 401/403 처리를 설치한다.
// Supabase 에 직접 의존하지 않고 함수를 주입받아 단위 테스트할 수 있게 분리했다 (client.js 에서 연결).
//
//  - 요청: Authorization: Bearer <access_token>
//  - 401 : 세션 갱신을 1회 시도(동시 요청은 갱신 1번을 공유) → 성공하면 재요청, 실패/재차 401 이면 onUnauthorized
//  - 403 : 서버가 허용하지 않은 계정 → onForbidden
export function installAuthInterceptors(api, { getAccessToken, refreshAccessToken, onUnauthorized, onForbidden }) {
  let refreshing = null

  const refreshOnce = () => {
    if (!refreshing) {
      refreshing = Promise.resolve()
        .then(refreshAccessToken)
        .catch(() => null)
        .finally(() => { refreshing = null })
    }
    return refreshing
  }

  api.interceptors.request.use(async (config) => {
    if (config._authRetried) return config          // 재요청은 갱신된 토큰이 이미 붙어 있다
    const token = await getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error.response?.status
      const config = error.config

      if (status === 401) {
        if (config && !config._authRetried) {
          const token = await refreshOnce()
          if (token) {
            config._authRetried = true
            config.headers.Authorization = `Bearer ${token}`
            return api.request(config)
          }
        }
        await onUnauthorized()
      } else if (status === 403) {
        await onForbidden()
      }
      return Promise.reject(error)
    },
  )
}
