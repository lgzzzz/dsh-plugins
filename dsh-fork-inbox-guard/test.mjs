/**
 * dsh-fork-inbox-guard 行为冒烟测试。
 *
 * 直接用支持 Type Stripping 的运行时加载 index.ts（Node 22.18+ / 23.6+ / 24+，
 * 或 App 内置运行时）：
 *
 *   node test.mjs
 *   npm test
 *
 * 测试用**真实的** `@deepseek-ai/dsh-session` 构造 seeded 会话（验证
 * inheritedEventCount / 继承标记等前提），再用结构等价的 fake agent 驱动
 * 移除逻辑，覆盖：
 *   - 前缀折叠：insert 后又被 claim 的不算 pending；
 *   - 形状非法的 splice 被跳过且不抛错；
 *   - 只移除「继承前缀里仍 pending」的消息，子会话自己的排队消息保留；
 *   - 非 seeded 会话 / inheritedEventCount 为 0 时不动；
 *   - 重复调用幂等；
 *   - `agent/created` 监听：正常移除、异常被吞掉（不否决发布）。
 */
import assert from 'node:assert/strict'
import { Session } from '@deepseek-ai/dsh-session'
import guard, {
  name,
  apply,
  collectInheritedPendingIds,
  dropInheritedPending,
  inheritedPendingIdsOf,
} from './index.ts'

assert.equal(name, 'dsh-fork-inbox-guard')
assert.equal(typeof apply, 'function')
assert.equal(guard.name, name)
assert.equal(guard.apply, apply)

const BASE_TIME = 1_700_000_000_000
let nextSeq = 0

/** 构造一条最小事件信封（本测试只用非 surface 事件，无需 surfaceOp）。 */
function ev(type, data) {
  const at = nextSeq
  nextSeq += 1
  return { type, seq: at, time: BASE_TIME + at, data }
}

function turnStart() {
  return ev('turn/start', { turn: 1 })
}

function turnEnd() {
  return ev('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

/** 构造一条 `agent/inbox/spliced`；`ids` 为空且 removedCount 缺省即无操作，故显式给出。 */
function splice(target, start, removedCount, ids) {
  return ev('agent/inbox/spliced', {
    target,
    start,
    ...(removedCount > 0 ? { removedCount } : {}),
    inserted: ids.map(id => ({ id, role: 'user', content: [{ type: 'text', text: id }] })),
  })
}

let sessionCounter = 0

/**
 * 用真实 Session 构造一个 seeded（或普通）会话。
 * seed 的 seq 在这里归一化为 0..n-1（Session 要求 seed 从 0 连续）。
 */
function makeSession(rawSeed, isSeeded = true) {
  const seed = rawSeed.map((event, index) => ({ ...event, seq: index }))
  const id = `session-test-${++sessionCounter}`
  const header = {
    version: 3,
    id,
    createdAt: BASE_TIME,
    isSeeded,
    ...(isSeeded ? { parentSession: 'session-source' } : {}),
  }
  return Session.create(id, seed, header, isSeeded ? seed.length : 0)
}

/** 记录移除动作的 fake inbox，语义与上游 ReactLoopInbox 的 remove 一致。 */
function fakeAgent(session, { nextTurn = [], nextStep = [] } = {}) {
  const inbox = {
    nextTurn: nextTurn.slice(),
    nextStep: nextStep.slice(),
    remove(id) {
      for (const target of ['nextTurn', 'nextStep']) {
        const list = inbox[target]
        const index = list.findIndex(message => message.id === id)
        if (index >= 0) {
          list.splice(index, 1)
          return true
        }
      }
      return false
    },
  }
  return { session, inbox }
}

function idsOf(list) {
  return list.map(message => message.id)
}

// ---------------------------------------------------------------------------
// 前提：真实 Session 的 seed / inheritedEventCount / 继承标记语义
// ---------------------------------------------------------------------------
const seeded = makeSession([turnStart(), turnEnd(), splice('next-turn', 0, 0, ['m1'])])
assert.equal(seeded.header.isSeeded, true, 'header.isSeeded 保留')
assert.equal(seeded.header.parentSession, 'session-source', 'parentSession 保留')
assert.equal(seeded.inheritedEventCount, 3, 'inheritedEventCount = seed 长度')
assert.equal(seeded.seq, 4, '构造时追加一条继承标记')
const marker = seeded.snapshotEvents().at(-1)
assert.equal(marker.type, 'session/end-seed', '继承标记事件类型')
assert.deepEqual(marker.data, { inherited: true }, '继承标记带 inherited: true')
assert.deepEqual([...inheritedPendingIdsOf(seeded)], ['m1'], '前缀尾部 insert 视为 pending')

// ---------------------------------------------------------------------------
// 前缀折叠
// ---------------------------------------------------------------------------
// insert 后在**前缀内**又被 claim（remove）：切点上并不 pending。
const claimed = makeSession([
  turnStart(),
  turnEnd(),
  splice('next-turn', 0, 0, ['m1']),
  splice('next-turn', 0, 1, []),
])
assert.equal(claimed.inheritedEventCount, 4)
assert.deepEqual([...inheritedPendingIdsOf(claimed)], [], '前缀内已 claim 的 insert 不算 pending')

// next-step 的 pending 同样要被识别。
const stepPending = makeSession([turnStart(), turnEnd(), splice('next-step', 0, 0, ['s1'])])
assert.deepEqual([...inheritedPendingIdsOf(stepPending)], ['s1'], 'next-step pending 被识别')

// 两条 insert、只移除其中一条 → 只剩另一条。
const partial = makeSession([
  turnStart(),
  turnEnd(),
  splice('next-turn', 0, 0, ['m1', 'm2']),
  splice('next-turn', 0, 1, []),
])
assert.deepEqual([...inheritedPendingIdsOf(partial)], ['m2'], '部分移除后只保留剩余 pending')

// 形状非法的 splice 必须被跳过，且不影响后续合法 splice 的折叠。
const malformed = makeSession([
  turnStart(),
  turnEnd(),
  ev('agent/inbox/spliced', null),
  ev('agent/inbox/spliced', { target: 'bogus', start: 0, inserted: [] }),
  ev('agent/inbox/spliced', { target: 'next-turn' }),
  ev('agent/inbox/spliced', { target: 'next-turn', start: 'x', inserted: [] }),
  ev('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 'y', inserted: [] }),
  ev('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [{ noId: true }] }),
  splice('next-turn', 0, 0, ['m9']),
])
assert.deepEqual([...inheritedPendingIdsOf(malformed)], ['m9'], '非法 splice 被跳过，后续合法 splice 仍折叠')

// 越界 start / removedCount 按上游同样的钳制规则处理，不抛错。
const clamped = makeSession([
  turnStart(),
  turnEnd(),
  splice('next-turn', 99, 0, ['m1']),
  splice('next-turn', 0, 99, []),
])
assert.deepEqual([...inheritedPendingIdsOf(clamped)], [], '越界 splice 被钳制后得到空队列')

// 纯函数直接调用：非数组 / 空前缀 / 混入非 inbox 事件。
assert.deepEqual([...collectInheritedPendingIds(undefined)], [], '非数组前缀返回空集')
assert.deepEqual([...collectInheritedPendingIds([])], [], '空前缀返回空集')
assert.deepEqual(
  [...collectInheritedPendingIds([splice('next-turn', 0, 0, ['x']), { type: 'turn/end', seq: 1, data: {} }])],
  ['x'],
  '忽略非 inbox 事件',
)

// 普通（非 seeded）会话：前缀视为空，不动作。
const plain = makeSession([turnStart(), turnEnd(), splice('next-turn', 0, 0, ['m1'])], false)
assert.equal(plain.header.isSeeded, false)
assert.equal(plain.inheritedEventCount, 0)
assert.deepEqual([...inheritedPendingIdsOf(plain)], [], '非 seeded 会话不动作')

// ---------------------------------------------------------------------------
// 移除：只动继承的 pending
// ---------------------------------------------------------------------------
const turnSession = makeSession([turnStart(), turnEnd(), splice('next-turn', 0, 0, ['inherited-turn'])])
const turnAgent = fakeAgent(turnSession, {
  nextTurn: [{ id: 'inherited-turn' }, { id: 'own-turn' }],
  nextStep: [{ id: 'own-step' }],
})
const reports = []
const removed = dropInheritedPending(turnAgent, message => reports.push(message))
assert.deepEqual(removed, ['inherited-turn'], '只移除 next-turn 中继承的那条')
assert.deepEqual(idsOf(turnAgent.inbox.nextTurn), ['own-turn'], '子会话自己排队的 next-turn 保留')
assert.deepEqual(idsOf(turnAgent.inbox.nextStep), ['own-step'], '无关的 next-step 不动')
assert.equal(reports.length, 1, 'report 恰调用一次')
assert.match(reports[0], /dropped 1 inherited pending message/, 'report 描述移除数量')
assert.match(reports[0], new RegExp(turnSession.id), 'report 带会话 id')

assert.deepEqual(dropInheritedPending(turnAgent, message => reports.push(message)), [], '重复调用幂等')
assert.equal(reports.length, 1, '幂等时不再 report')

// next-step 继承项也会被移除。
const stepSession = makeSession([turnStart(), turnEnd(), splice('next-step', 0, 0, ['inherited-step'])])
const stepAgent = fakeAgent(stepSession, {
  nextTurn: [{ id: 'own-turn' }],
  nextStep: [{ id: 'inherited-step' }, { id: 'own-step' }],
})
assert.deepEqual(dropInheritedPending(stepAgent), ['inherited-step'], 'next-step 继承项被移除')
assert.deepEqual(idsOf(stepAgent.inbox.nextTurn), ['own-turn'], 'next-turn 自身项保留')
assert.deepEqual(idsOf(stepAgent.inbox.nextStep), ['own-step'], 'next-step 自身项保留')

// 没有继承 pending 时不动。
const cleanAgent = fakeAgent(makeSession([turnStart(), turnEnd()]), {
  nextTurn: [{ id: 'own-1' }],
  nextStep: [{ id: 'own-2' }],
})
assert.deepEqual(dropInheritedPending(cleanAgent), [], '无继承 pending 时不动作')
assert.deepEqual(idsOf(cleanAgent.inbox.nextTurn), ['own-1'])
assert.deepEqual(idsOf(cleanAgent.inbox.nextStep), ['own-2'])

// 结构异常不抛错。
assert.deepEqual(dropInheritedPending(undefined), [], 'undefined agent 不抛错')
assert.deepEqual(dropInheritedPending({}), [], '缺字段的 agent 不抛错')
assert.deepEqual(dropInheritedPending({ session: {}, inbox: {} }), [], '缺 header 的 session 不抛错')

// ---------------------------------------------------------------------------
// agent/created 监听
// ---------------------------------------------------------------------------
const listeners = new Map()
const logs = { info: [], warn: [] }
const ctx = {
  on(eventName, callback) {
    listeners.set(eventName, callback)
    return () => true
  },
  logger: {
    info(message) {
      logs.info.push(message)
    },
    warn(message) {
      logs.warn.push(message)
    },
  },
}
guard.apply(ctx)
const handler = listeners.get('agent/created')
assert.ok(handler, 'agent/created 监听已注册')
assert.equal(listeners.size, 1, '只注册一个事件')

const liveAgent = fakeAgent(
  makeSession([turnStart(), turnEnd(), splice('next-turn', 0, 0, ['inherited-turn'])]),
  { nextTurn: [{ id: 'inherited-turn' }, { id: 'own-turn' }] },
)
handler({ agent: liveAgent })
assert.deepEqual(idsOf(liveAgent.inbox.nextTurn), ['own-turn'], '监听路径移除继承项')
assert.equal(logs.info.length, 1, '监听路径记录一次 info')
assert.equal(logs.warn.length, 0, '监听路径无 warn')

handler({ agent: liveAgent })
assert.equal(logs.info.length, 1, '再次触发不再移除、不再记录')

// 同步 listener 抛错会否决 Agent 发布：必须被吞掉并降级为 warn。
handler({ agent: { get session() { throw new Error('boom') } } })
assert.equal(logs.warn.length, 1, '异常降级为 warn')
assert.match(logs.warn[0], /boom/, 'warn 带上原始错误')

// logger 自身抛错也不能逃逸。
const brokenCtx = {
  on(eventName, callback) {
    brokenCtx.listener = callback
    return () => true
  },
  logger: {
    info() {
      throw new Error('logger down')
    },
    warn() {
      throw new Error('logger down')
    },
  },
}
guard.apply(brokenCtx)
assert.doesNotThrow(() => {
  brokenCtx.listener({
    agent: fakeAgent(
      makeSession([turnStart(), turnEnd(), splice('next-turn', 0, 0, ['inherited-turn'])]),
      { nextTurn: [{ id: 'inherited-turn' }] },
    ),
  })
}, 'logger 抛错不影响监听')

console.log('dsh-fork-inbox-guard: all assertions passed')
