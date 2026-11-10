/** Lineage walking for per-turn billing identity: child → root, fail-safe. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunSessionResolver, type LineageSessionStore } from '../../src/turn-lineage.ts'

/** A session store over a plain child→parent map. */
function storeOf(parents: Record<string, string>): LineageSessionStore {
  return {
    get(id) {
      const parent = parents[id]
      return parent === undefined ? {} : { header: { parentSession: parent } }
    },
  }
}

test('a root session resolves to undefined (its own run key)', () => {
  const resolve = createRunSessionResolver(() => storeOf({}))
  assert.equal(resolve('root'), undefined)
})

test('a child and a grandchild resolve to the root', () => {
  const resolve = createRunSessionResolver(() => storeOf({ child: 'root', grandchild: 'child' }))
  assert.equal(resolve('child'), 'root')
  assert.equal(resolve('grandchild'), 'root')
})

test('a missing store or missing session stops at the session itself', () => {
  assert.equal(createRunSessionResolver(() => undefined)('child'), undefined)
  const resolve = createRunSessionResolver(() => ({ get: () => undefined }))
  assert.equal(resolve('child'), undefined)
})

test('a cycle stops without looping and keeps the last resolvable ancestor', () => {
  const resolve = createRunSessionResolver(() => storeOf({ a: 'b', b: 'a' }))
  // From `child` the walk reaches `a`, then `b`, then sees `a` again and stops.
  const cyclic = createRunSessionResolver(() => storeOf({ child: 'a', a: 'b', b: 'a' }))
  assert.equal(resolve('a'), 'b')
  assert.ok(['a', 'b'].includes(cyclic('child') ?? ''))
})

test('a self-parent is not a lineage', () => {
  const resolve = createRunSessionResolver(() => storeOf({ root: 'root' }))
  assert.equal(resolve('root'), undefined)
})

test('a throwing store never fails the request path', () => {
  const resolve = createRunSessionResolver(() => ({ get: () => { throw new Error('store gone') } }))
  assert.equal(resolve('child'), undefined)
})

test('the store is resolved per call, not captured', () => {
  let store: LineageSessionStore | undefined
  const resolve = createRunSessionResolver(() => store)
  assert.equal(resolve('child'), undefined)
  store = storeOf({ child: 'root' })
  assert.equal(resolve('child'), 'root')
})