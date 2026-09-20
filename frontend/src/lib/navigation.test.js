import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NAV_GROUPS } from '../navigation.js'

const items = NAV_GROUPS.flatMap(g => g.items)
const appSrc = readFileSync(new URL('../App.jsx', import.meta.url), 'utf-8')

test('메뉴 경로는 중복이 없고 모두 App 의 라우트로 존재한다', () => {
  const paths = items.map(i => i.path)
  assert.equal(new Set(paths).size, paths.length, '중복 경로')
  for (const p of paths) assert.ok(p === '/' || appSrc.includes(`path="${p}"`), `라우트 없음: ${p}`)
})

test('인출 판단 시스템 화면(지시서 01~04)은 "인출 판단" 그룹 한 곳에 모여 있다', () => {
  const g = NAV_GROUPS.find(x => x.id === 'withdrawal')
  assert.equal(g.label, '인출 판단')
  assert.deepEqual(g.items.map(i => i.path), ['/withdrawal-settings', '/market-exposure', '/quarterly-decision'])
  for (const p of g.items.map(i => i.path)) {
    const owners = NAV_GROUPS.filter(x => x.items.some(i => i.path === p)).map(x => x.id)
    assert.deepEqual(owners, ['withdrawal'], `${p} 는 다른 그룹에 남아 있으면 안 된다`)
  }
})

test('그룹 id 는 유일하고 모바일 라벨이 있다', () => {
  const ids = NAV_GROUPS.map(g => g.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const g of NAV_GROUPS) assert.ok(g.label && g.mobileLabel && g.icon, g.id)
})
