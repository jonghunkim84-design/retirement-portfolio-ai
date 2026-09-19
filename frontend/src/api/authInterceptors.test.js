import test from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { installAuthInterceptors } from './authInterceptors.js'

// 가짜 서버(adapter): respond(config, callIndex) → { status, data }
function makeApi(respond) {
  const calls = []
  const api = axios.create({
    baseURL: '/api',
    adapter: async (config) => {
      const auth = config.headers.Authorization ?? null
      calls.push({ url: config.url, auth })
      const { status, data } = respond({ url: config.url, auth }, calls.length)
      const response = { status, data, statusText: '', headers: {}, config }
      if (status >= 400) {
        throw new axios.AxiosError(`status ${status}`, 'ERR_BAD_REQUEST', config, null, response)
      }
      return response
    },
  })
  return { api, calls }
}

function makeDeps(over = {}) {
  const log = { refresh: 0, unauthorized: 0, forbidden: 0 }
  const deps = {
    getAccessToken: async () => 'old-token',
    refreshAccessToken: async () => { log.refresh++; return 'new-token' },
    onUnauthorized: async () => { log.unauthorized++ },
    onForbidden: async () => { log.forbidden++ },
    ...over,
  }
  return { deps, log }
}

const ok = { status: 200, data: { ok: true } }

test('요청에 Bearer 토큰을 붙인다', async () => {
  const { api, calls } = makeApi(() => ok)
  installAuthInterceptors(api, makeDeps().deps)
  await api.get('/assets')
  assert.equal(calls[0].auth, 'Bearer old-token')
})

test('세션이 없으면 Authorization 헤더를 붙이지 않는다', async () => {
  const { api, calls } = makeApi(() => ok)
  installAuthInterceptors(api, makeDeps({ getAccessToken: async () => null }).deps)
  await api.get('/assets')
  assert.equal(calls[0].auth, null)
})

test('401 → 세션 갱신 1회 → 새 토큰으로 재요청 성공', async () => {
  const { api, calls } = makeApi(({ auth }) => (auth === 'Bearer new-token' ? ok : { status: 401, data: {} }))
  const { deps, log } = makeDeps()
  installAuthInterceptors(api, deps)
  const res = await api.get('/assets')
  assert.deepEqual(res.data, { ok: true })
  assert.equal(log.refresh, 1)
  assert.equal(log.unauthorized, 0)
  assert.deepEqual(calls.map(c => c.auth), ['Bearer old-token', 'Bearer new-token'])
})

test('동시에 여러 요청이 401 이어도 세션 갱신은 1번만', async () => {
  const { api } = makeApi(({ auth }) => (auth === 'Bearer new-token' ? ok : { status: 401, data: {} }))
  const { deps, log } = makeDeps({
    refreshAccessToken: async () => { log.refresh++; await new Promise(r => setTimeout(r, 20)); return 'new-token' },
  })
  installAuthInterceptors(api, deps)
  const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
  assert.equal(results.length, 3)
  assert.equal(log.refresh, 1)
})

test('갱신 후에도 401 이면 로그인으로 보낸다 (무한 재시도 없음)', async () => {
  const { api, calls } = makeApi(() => ({ status: 401, data: {} }))
  const { deps, log } = makeDeps()
  installAuthInterceptors(api, deps)
  await assert.rejects(api.get('/assets'), e => e.response.status === 401)
  assert.equal(calls.length, 2)          // 원 요청 + 재요청 1번만
  assert.equal(log.refresh, 1)
  assert.equal(log.unauthorized, 1)
})

test('세션 갱신에 실패하면 재요청 없이 로그인으로 보낸다', async () => {
  const { api, calls } = makeApi(() => ({ status: 401, data: {} }))
  const { deps, log } = makeDeps({ refreshAccessToken: async () => { log.refresh++; return null } })
  installAuthInterceptors(api, deps)
  await assert.rejects(api.get('/assets'), e => e.response.status === 401)
  assert.equal(calls.length, 1)
  assert.equal(log.unauthorized, 1)
})

test('세션 갱신이 예외를 던져도 로그인으로 보낸다', async () => {
  const { api } = makeApi(() => ({ status: 401, data: {} }))
  const { deps, log } = makeDeps({ refreshAccessToken: async () => { throw new Error('network') } })
  installAuthInterceptors(api, deps)
  await assert.rejects(api.get('/assets'), e => e.response.status === 401)
  assert.equal(log.unauthorized, 1)
})

test('403 → 허용되지 않은 계정 처리, 세션 갱신은 시도하지 않는다', async () => {
  const { api, calls } = makeApi(() => ({ status: 403, data: {} }))
  const { deps, log } = makeDeps()
  installAuthInterceptors(api, deps)
  await assert.rejects(api.get('/assets'), e => e.response.status === 403)
  assert.equal(calls.length, 1)
  assert.equal(log.forbidden, 1)
  assert.equal(log.refresh, 0)
  assert.equal(log.unauthorized, 0)
})

test('그 밖의 오류(500, 422)는 인증 처리를 하지 않는다', async () => {
  for (const status of [400, 404, 422, 500]) {
    const { api } = makeApi(() => ({ status, data: {} }))
    const { deps, log } = makeDeps()
    installAuthInterceptors(api, deps)
    await assert.rejects(api.get('/x'), e => e.response.status === status)
    assert.deepEqual(log, { refresh: 0, unauthorized: 0, forbidden: 0 })
  }
})

test('POST 본문도 재요청에 유지된다', async () => {
  const seen = []
  const api = axios.create({
    baseURL: '/api',
    adapter: async (config) => {
      seen.push({ auth: config.headers.Authorization, data: config.data })
      const status = config.headers.Authorization === 'Bearer new-token' ? 200 : 401
      const response = { status, data: {}, statusText: '', headers: {}, config }
      if (status >= 400) throw new axios.AxiosError('x', 'ERR_BAD_REQUEST', config, null, response)
      return response
    },
  })
  installAuthInterceptors(api, makeDeps().deps)
  await api.post('/income', { amount: 1000 })
  assert.equal(seen.length, 2)
  assert.equal(seen[0].data, seen[1].data)
  assert.match(seen[1].data, /1000/)
})
