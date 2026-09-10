/**
 * dsh-fork-inbox-guard 行为测试。
 *
 * 两个层次：
 *
 * 1. **纯逻辑**：前缀折叠与求交的语义（含畸形 splice、resume、非 seeded）。
 * 2. **真实集成**：用安装版的 `@deepseek-ai/dsh-session` 构造一个 **seeded 子
 *    会话**（seed 就是上游 fork 切点产出的那段「带 insert、缺 claim」的前缀），
 *    再驱动本插件的移除路径，断言：
 *    - `agent/inbox/spliced`（canceled）能被真实 Session 接受并追加；
 *    - 折叠结果回到平衡（inherited pending 清空）；
 *    - 子会话自己在切点之后排队的消息不受影响；
 *    - 重复调用幂等；源会话日志零改动。
 *
 * 依赖本目录 `node_modules/@deepseek-ai` 指向全局 dsh 内置 scope 的 junction
 * （与仓库内其他插件一致）。
 *
 * 运行：node test.mjs（Node 22.18+ / 23.6+ / 24+，Type Stripping 直载 index.ts）
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import guard, {
  apply,
  collectInheritedPendingIds,
  dropInheritedPending,
  inheritedPendingIdsOf,
  name,
} from './index.ts'

const require = createRequire(import.meta.url)
const { Session } = require('@deepseek-ai/dsh-session')

// ---------------------------------------------------------------------------
// 断言脚手架
// ---------------------------------------------------------------------------

let failures = 0

/**
 * 运行一组断言，失败时记录并继续（便于一次跑出全部结论）。
 * @param {string} label - 断言组描述。
 * @param {() => void} body - 断言体。
 */
function check(label, body) {
  try {
    body()
    console.log(`PASS  ${label}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${label}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 造一条 user message（id 唯一即可，守卫只按 id 匹配）。 */
function userMessage(id, text = `text-${id}`) {
  return {
    id,
    role: 'user',
    source: { kind: 'user', rpcId: `rpc-${id}` },
    content: [{ type: 'text', text }],
  }
}

/** 造一条 `agent/inbox/spliced` 事件。 */
function spliceEvent(seq, data) {
  return { type: 'agent/inbox/spliced', seq, time: seq + 1, data }
}

/** 造一条 assistant message 事件（seed 校验要求 model source 与 settlement 字段）。 */
function assistantEvent(seq, turn, step, id) {
  return {
    type: 'assistant/message',
    seq,
    time: seq + 1,
    data: {
      turn,
      step,
      stream: [],
      message: {
        id,
        role: 'assistant',
        source: { kind: 'model', provider: 'p', model: 'm' },
        content: [{ type: 'text', text: `assistant-${id}` }],
      },
    },
    surfaceOp: 'append',
  }
}

/** 造一条 user message 事件（surface 事件必须声明 surfaceOp）。 */
function userEvent(seq, id) {
  return { type: 'user/message', seq, time: seq + 1, data: userMessage(id), surfaceOp: 'append' }
}

/**
 * 源会话日志（Web 分叉的真实形态）：turn 1 运行中补发 U2（insert），turn 2 才认领它。
 *
 * 与上游真实写法一致：`agent.send(msg, 'next-turn', true)` 的 insert 落在
 * `turn/start` 与 `turn/end` 之间，`claim` 落在下一个 `turn/start` 之后。这正是
 * 「切点带走 insert、留下 claim」的成因。
 *
 * @returns 事件数组（seq 连续从 0 开始）。
 */
function parentLog() {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    userEvent(2, 'U1'),
    assistantEvent(3, 1, 1, 'A1'),
    // 运行中补发的 U2：只 insert，尚未 claim
    spliceEvent(4, { target: 'next-turn', start: 0, inserted: [userMessage('U2', '用户消息2')] }),
    { type: 'step/end', seq: 5, time: 6, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 6, time: 7, data: { turn: 1, reason: { kind: 'completed' } } },
    // turn 2 起跑后 claim U2
    { type: 'turn/start', seq: 7, time: 8, data: { turn: 2 } },
    spliceEvent(8, { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    userEvent(9, 'U2'),
  ]
}

/**
 * 源会话日志（子代理 fork 的真实形态）：turn 1 已完成，turn 2 正在运行且期间补发了
 * U3。
 *
 * 上游 `dsh-subagent-fork-in-process` 的 `completedTurnPrefix()` 切在**最后一个**
 * `turn/end`（此处 seq 6）且含它，于是 turn 2 里的 insert（seq 7）落在切点之外，
 * 子代理 seed 不含任何未配对的 splice。
 *
 * @returns 事件数组。
 */
function parentLogWithRunningTurn() {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    userEvent(2, 'U1'),
    assistantEvent(3, 1, 1, 'A1'),
    { type: 'step/end', seq: 4, time: 5, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
    // 在飞的 turn 2：运行中补发 U3（只 insert，尚未 claim）
    { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
    spliceEvent(7, { target: 'next-turn', start: 0, inserted: [userMessage('U3', '运行中补发')] }),
  ]
}

/**
 * 「自身平衡」的继承前缀：一个已完成 turn 内 insert 与 claim 成对出现。
 *
 * 上游 `completedTurnPrefix()` 切在 `turn/end` 含处时，任何轮内 splice 都已配对，
 * 因此本夹具描述的是「前缀平衡」这一类 seed 的形状（子代理 fork 即属此类）。
 *
 * @returns 事件数组。
 */
function balancedPrefixLog() {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    spliceEvent(1, { target: 'next-turn', start: 0, inserted: [userMessage('Q', '排队消息')] }),
    spliceEvent(2, { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    { type: 'step/start', seq: 3, time: 4, data: { turn: 1, step: 1 } },
    userEvent(4, 'Q'),
    assistantEvent(5, 1, 1, 'A1'),
    { type: 'step/end', seq: 6, time: 7, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 7, time: 8, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

/**
 * 复刻上游 fork 的切点数学（dsh-api-session-controller/lib/index.js 的 fork()）。
 *
 * @param events - 源会话事件。
 * @param atSeq - 分支锚点（助手消息事件的 seq）。
 * @returns 继承前缀长度 cut。
 */
function forkCut(events, atSeq) {
  const lastSeq = events.at(-1).seq
  const boundary =
    events.find(event => event.type === 'turn/end' && event.seq >= atSeq) ??
    (atSeq > lastSeq ? events.findLast(event => event.type === 'turn/end') : undefined)
  assert.ok(boundary, 'fork boundary exists')
  let cut = boundary.seq + 1
  while (cut < events.length && events[cut]?.type !== 'turn/start') cut += 1
  return cut
}

/** 用真实 Session 构造一个 seeded 子会话（seed = 源会话的继承前缀）。 */
function seededChild(parentEvents, cut, id) {
  const seed = parentEvents.slice(0, cut)
  const session = Session.create(
    id,
    seed,
    { version: 3, id, createdAt: 1, cwd: 'C:\\work', parentSession: 'session-parent', isSeeded: true },
    cut,
  )
  return { session, seed }
}

/**
 * 复刻上游 inbox 折叠（dsh-agent-loop/lib/index.js 的 inboxProjectionDefinition.apply），
 * 用于断言「子会话日志折叠出的 inbox」。
 */
function foldInbox(events) {
  const state = { 'next-turn': [], 'next-step': [] }
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue
    const splice = event.data
    const list = state[splice.target]
    state[splice.target] = list.toSpliced(splice.start, splice.removedCount ?? 0, ...splice.inserted)
  }
  return state
}

/**
 * 以真实 Session 为后端的 inbox 桩：读投影折叠结果，写则追加一条 canceled splice
 * （与上游 `ReactLoopInbox.remove` 的 `mutate(...)` 产出同形）。
 */
function inboxOver(session) {
  const state = () => foldInbox(session.snapshotEvents())
  return {
    get nextTurn() {
      return state()['next-turn']
    },
    get nextStep() {
      return state()['next-step']
    },
    remove(id) {
      const current = state()
      for (const target of ['next-step', 'next-turn']) {
        const index = current[target].findIndex(message => message.id === id)
        if (index < 0) continue
        session.append('agent/inbox/spliced', {
          target,
          start: index,
          removedCount: 1,
          inserted: [],
          outcome: 'canceled',
        })
        return true
      }
      return false
    },
  }
}

/** 组装一个被守卫的 agent 结构切片。 */
function guardedAgent(session) {
  return { session, inbox: inboxOver(session) }
}

// ---------------------------------------------------------------------------
// 0. 模块形状
// ---------------------------------------------------------------------------

check('模块导出形状', () => {
  assert.equal(name, 'dsh-fork-inbox-guard')
  assert.equal(typeof apply, 'function')
  assert.equal(guard.name, name)
  assert.equal(guard.apply, apply)
  assert.equal(typeof collectInheritedPendingIds, 'function')
  assert.equal(typeof inheritedPendingIdsOf, 'function')
  assert.equal(typeof dropInheritedPending, 'function')
})

// ---------------------------------------------------------------------------
// 1. 前缀折叠（纯逻辑）
// ---------------------------------------------------------------------------

check('折叠：只有 insert、没有配对的 claim → 仍 pending', () => {
  const ids = collectInheritedPendingIds([
    spliceEvent(0, { target: 'next-turn', start: 0, inserted: [userMessage('U2')] }),
  ])
  assert.deepEqual([...ids], ['U2'])
})

check('折叠：insert 后又被 claim → 不再是 pending', () => {
  const ids = collectInheritedPendingIds([
    spliceEvent(0, { target: 'next-turn', start: 0, inserted: [userMessage('U2')] }),
    spliceEvent(1, { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
  ])
  assert.equal(ids.size, 0)
})

check('折叠：next-step 与 next-turn 都识别，多个 splice 按序应用', () => {
  const ids = collectInheritedPendingIds([
    spliceEvent(0, { target: 'next-turn', start: 0, inserted: [userMessage('A'), userMessage('B')] }),
    spliceEvent(1, { target: 'next-step', start: 0, inserted: [userMessage('C')] }),
    spliceEvent(2, { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    spliceEvent(3, { target: 'next-step', start: 0, removedCount: 1, inserted: [] }),
  ])
  assert.deepEqual([...ids].sort(), ['B'])
})

check('折叠：越界 start / removedCount 按上游钳制规则处理', () => {
  const ids = collectInheritedPendingIds([
    spliceEvent(0, { target: 'next-turn', start: 5, inserted: [userMessage('X')] }),
    spliceEvent(1, { target: 'next-turn', start: -3, removedCount: 99, inserted: [userMessage('Y')] }),
  ])
  assert.deepEqual([...ids], ['Y'])
})

check('折叠：畸形 splice 被跳过且不影响后续合法 splice', () => {
  const ids = collectInheritedPendingIds([
    { type: 'agent/inbox/spliced', seq: 0, data: null },
    { type: 'agent/inbox/spliced', seq: 1, data: { target: 'bogus', start: 0, inserted: [] } },
    { type: 'agent/inbox/spliced', seq: 2, data: { target: 'next-turn', start: '0', inserted: [] } },
    { type: 'agent/inbox/spliced', seq: 3, data: { target: 'next-turn', start: 0 } },
    spliceEvent(4, { target: 'next-turn', start: 0, inserted: [{ id: '' }] }),
    spliceEvent(5, { target: 'next-turn', start: 0, inserted: [userMessage('OK')] }),
    { type: 'turn/start', seq: 6, data: { turn: 1 } },
  ])
  assert.deepEqual([...ids], ['OK'])
})

check('折叠：空输入 / 非数组输入 → 空集', () => {
  assert.equal(collectInheritedPendingIds([]).size, 0)
  assert.equal(collectInheritedPendingIds(undefined).size, 0)
})

// ---------------------------------------------------------------------------
// 2. 会话筛选（纯逻辑）
// ---------------------------------------------------------------------------

check('筛选：非 seeded 会话不动作', () => {
  const session = { id: 's', header: { isSeeded: false }, inheritedEventCount: 0, snapshotEvents: () => [] }
  assert.equal(inheritedPendingIdsOf(session).size, 0)
})

check('筛选：isSeeded 但 inheritedEventCount 非正 / 非安全整数 → 不动作', () => {
  const events = [spliceEvent(0, { target: 'next-turn', start: 0, inserted: [userMessage('U2')] })]
  for (const cut of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const session = {
      id: 's',
      header: { isSeeded: true },
      inheritedEventCount: cut,
      snapshotEvents: () => events,
    }
    assert.equal(inheritedPendingIdsOf(session).size, 0, `cut=${String(cut)}`)
  }
})

check('筛选：undefined / 缺字段会话不抛错', () => {
  assert.equal(inheritedPendingIdsOf(undefined).size, 0)
  assert.equal(inheritedPendingIdsOf(null).size, 0)
  assert.equal(inheritedPendingIdsOf({}).size, 0)
  assert.equal(
    inheritedPendingIdsOf({ id: 's', header: undefined, inheritedEventCount: 1, snapshotEvents: () => [] }).size,
    0,
  )
})

check('筛选：只折叠继承前缀，切点之后的事件不参与', () => {
  const events = [
    spliceEvent(0, { target: 'next-turn', start: 0, inserted: [userMessage('GHOST')] }),
    spliceEvent(1, { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    spliceEvent(2, { target: 'next-turn', start: 0, inserted: [userMessage('OWN')] }),
  ]
  const session = {
    id: 's',
    header: { isSeeded: true },
    inheritedEventCount: 2,
    snapshotEvents: () => events,
  }
  const ids = inheritedPendingIdsOf(session)
  assert.equal(ids.size, 0, 'OWN 属于切点之后，不属于继承 pending')
})

// ---------------------------------------------------------------------------
// 3. 真实 Session 集成：上游切点 → 幽灵 pending
// ---------------------------------------------------------------------------

const parent = parentLog()
const cut = forkCut(parent, 3)
const child = seededChild(parent, cut, 'session-child')
const childInboxBefore = foldInbox(child.session.snapshotEvents())

check('集成：切点切走 insert、留下 claim 之外（前缀不平衡）', () => {
  assert.equal(cut, 7, 'cut 前推到下一个 turn/start')
  const prefix = parent.slice(0, cut)
  assert.ok(
    prefix.some(event => event.type === 'agent/inbox/spliced' && (event.data.inserted ?? []).length > 0),
    '前缀含 insert',
  )
  assert.equal(
    prefix.filter(event => event.type === 'agent/inbox/spliced' && (event.data.removedCount ?? 0) > 0).length,
    0,
    '前缀不含 claim',
  )
})

check('集成：真实 seeded 子会话的 inbox 折叠出幽灵 pending', () => {
  assert.equal(child.session.header.isSeeded, true)
  assert.equal(child.session.inheritedEventCount, cut)
  assert.deepEqual(childInboxBefore['next-turn'].map(message => message.id), ['U2'])
  assert.deepEqual(childInboxBefore['next-step'], [])
})

check('集成：inheritedPendingIdsOf 在真实会话上命中幽灵 id', () => {
  const ids = inheritedPendingIdsOf(child.session)
  assert.deepEqual([...ids], ['U2'])
})

// ---------------------------------------------------------------------------
// 4. 移除路径（真实 Session 接受 canceled splice）
// ---------------------------------------------------------------------------

const agent = guardedAgent(child.session)
const logs = []
const removed = dropInheritedPending(agent, message => logs.push(message))

check('移除：幽灵消息被移除并留下一条 canceled splice', () => {
  assert.deepEqual(removed, ['U2'])
  const appended = child.session.snapshotEvents().at(-1)
  assert.equal(appended.type, 'agent/inbox/spliced')
  assert.equal(appended.data.target, 'next-turn')
  assert.equal(appended.data.start, 0)
  assert.equal(appended.data.removedCount, 1)
  assert.deepEqual(appended.data.inserted, [])
  assert.equal(appended.data.outcome, 'canceled')
})

check('移除：真实 Session 折叠回到平衡（继承 pending 清空）', () => {
  const after = foldInbox(child.session.snapshotEvents())
  assert.deepEqual(after['next-turn'], [])
  assert.deepEqual(after['next-step'], [])
})

check('移除：日志回调只在确实移除时调用一次，且不含消息正文', () => {
  assert.equal(logs.length, 1)
  assert.match(logs[0], /dropped 1 inherited pending message\(s\)/)
  assert.match(logs[0], /session-child/)
  assert.equal(logs[0].includes('用户消息2'), false, '日志不含正文')
})

check('移除：重复调用幂等（不再追加事件）', () => {
  const before = child.session.snapshotEvents().length
  const again = dropInheritedPending(agent, message => logs.push(message))
  assert.deepEqual(again, [])
  assert.equal(child.session.snapshotEvents().length, before)
  assert.equal(logs.length, 1)
})

check('移除：源会话日志零改动', () => {
  const source = parentLog()
  assert.equal(source.length, 10)
  assert.equal(source.at(-1).type, 'user/message')
  assert.equal(source.filter(event => event.type === 'agent/inbox/spliced').length, 2)
})

// ---------------------------------------------------------------------------
// 5. 保留子会话自己排队的消息（切点之后入队）
// ---------------------------------------------------------------------------

check('保留：切点之后子会话自己排队的消息不被移除', () => {
  const childB = seededChild(parent, cut, 'session-child-b').session
  // 子会话自己排队（发生在 inheritedEventCount 之后）
  childB.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 1,
    inserted: [userMessage('MINE')],
  })
  const before = foldInbox(childB.snapshotEvents())['next-turn'].map(message => message.id)
  assert.deepEqual(before, ['U2', 'MINE'])

  const removedIds = dropInheritedPending(guardedAgent(childB))
  assert.deepEqual(removedIds, ['U2'], '只移除继承来的那条')
  const after = foldInbox(childB.snapshotEvents())['next-turn'].map(message => message.id)
  assert.deepEqual(after, ['MINE'], '子会话自己的消息保留且原位')
})

check('保留：balanced 前缀（轮内 splice 成对）→ 一条都不移除、零追加', () => {
  const balancedLog = balancedPrefixLog()
  // 上游子代理切点：最后一个 turn/end 含处（completedTurnPrefix）
  const subagentCut = balancedLog.findLast(event => event.type === 'turn/end').seq + 1
  const balanced = seededChild(balancedLog, subagentCut, 'session-balanced').session
  assert.deepEqual(foldInbox(balanced.snapshotEvents())['next-turn'], [], '前缀自身平衡')
  const lengthBefore = balanced.snapshotEvents().length
  const removedIds = dropInheritedPending(guardedAgent(balanced))
  assert.deepEqual(removedIds, [])
  assert.equal(balanced.snapshotEvents().length, lengthBefore, '不追加任何事件')
})

check('保留：子代理切点把「运行中补发的 insert」排除在外 → 不继承幽灵', () => {
  const runningLog = parentLogWithRunningTurn()
  const subagentCut = runningLog.findLast(event => event.type === 'turn/end').seq + 1
  assert.equal(subagentCut, 6, '切到最后一个 turn/end（含）')
  const seed = runningLog.slice(0, subagentCut)
  assert.equal(
    seed.some(event => event.type === 'turn/start' && event.data.turn === 2),
    false,
    '在飞 turn 被排除',
  )
  assert.equal(
    seed.some(event => event.type === 'agent/inbox/spliced' && (event.data.inserted ?? []).length > 0),
    false,
    '在飞 insert 被排除',
  )
  const subagent = seededChild(runningLog, subagentCut, 'session-subagent-shape').session
  assert.deepEqual(foldInbox(subagent.snapshotEvents())['next-turn'], [])
  assert.deepEqual(dropInheritedPending(guardedAgent(subagent)), [])
})

check('保留：非 seeded 会话（普通新建）不动作', () => {
  const fresh = Session.create(
    'session-fresh',
    undefined,
    { version: 3, id: 'session-fresh', createdAt: 1, isSeeded: false },
  )
  fresh.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [userMessage('QUEUED')],
  })
  const removedIds = dropInheritedPending(guardedAgent(fresh))
  assert.deepEqual(removedIds, [])
  assert.deepEqual(foldInbox(fresh.snapshotEvents())['next-turn'].map(message => message.id), ['QUEUED'])
})

check('保留：resume 形态（种子之外仍有自己的排队消息）', () => {
  // 取一个「继承前缀里 insert 与 claim 成对」的会话，再在其后排队自己的消息
  const resumeSeed = parent.slice(0, 10)
  const resumed = Session.create(
    'session-resumed',
    resumeSeed,
    { version: 3, id: 'session-resumed', createdAt: 1, isSeeded: true },
    resumeSeed.length,
  )
  resumed.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [userMessage('RESUMED-MINE')],
  })
  const removedIds = dropInheritedPending(guardedAgent(resumed))
  assert.deepEqual(removedIds, [], '成对前缀不产生交集')
  assert.deepEqual(
    foldInbox(resumed.snapshotEvents())['next-turn'].map(message => message.id),
    ['RESUMED-MINE'],
  )
})

// ---------------------------------------------------------------------------
// 6. 插件入口：注册、子代理跳过、异常收敛
// ---------------------------------------------------------------------------

/**
 * 造一个最小插件上下文桩。
 * @param options.registry - ctx.get('agents') 的返回值；undefined 表示服务不可用。
 * @param options.loggerThrows - logger 是否抛错（验证异常收敛）。
 */
function stubContext(options = {}) {
  const { registry, loggerThrows = false } = options
  const listeners = new Map()
  const records = { info: [], warn: [] }
  const boom = () => {
    throw new Error('logger exploded')
  }
  return {
    records,
    listeners,
    ctx: {
      get(key) {
        if (key === 'agents') return registry
        return undefined
      },
      on(eventName, callback) {
        listeners.set(eventName, callback)
        return () => true
      },
      logger: loggerThrows
        ? { info: boom, warn: boom }
        : {
            info(message) {
              records.info.push(message)
            },
            warn(message) {
              records.warn.push(message)
            },
          },
    },
  }
}

/** 造一个注册表桩：list 返回 owners，isOwnedBy 按 id 判定。 */
function registryStub(owners, ownedIds) {
  return {
    list: () => owners,
    isOwnedBy: (id, owner) => ownedIds.has(`${String(id)}|${owners.indexOf(owner)}`),
  }
}

check('入口：注册 agent/created 监听', () => {
  const { ctx, listeners } = stubContext({ registry: registryStub([], new Set()) })
  guard.apply(ctx)
  assert.equal(typeof listeners.get('agent/created'), 'function')
})

check('入口：注册表不可用（ctx.get 返回 undefined）→ 保守不动作', () => {
  const { ctx, listeners, records } = stubContext({ registry: undefined })
  apply(ctx)
  const session = seededChild(parent, cut, 'session-noreg').session
  const before = session.snapshotEvents().length
  listeners.get('agent/created')({ agent: guardedAgent(session) })
  assert.equal(records.info.length, 0)
  assert.equal(records.warn.length, 0)
  assert.equal(session.snapshotEvents().length, before, '零改动')
  assert.deepEqual(
    foldInbox(session.snapshotEvents())['next-turn'].map(message => message.id),
    ['U2'],
    '幽灵仍在（保守跳过）',
  )
})

check('入口：顶层 fork 子会话被处理并记录一行 info', () => {
  const { ctx, listeners, records } = stubContext({ registry: registryStub([], new Set()) })
  guard.apply(ctx)
  const session = seededChild(parent, cut, 'session-top').session
  listeners.get('agent/created')({ agent: guardedAgent(session) })
  assert.equal(records.info.length, 1)
  assert.match(records.info[0], /session-top/)
  assert.deepEqual(foldInbox(session.snapshotEvents())['next-turn'], [])
})

check('入口：有 runtime owner 的子代理被显式跳过（零日志、零改动）', () => {
  const owner = { id: 'parent-agent' }
  const childAgent = { id: 'session-sub' }
  // isOwnedBy('session-sub', owner) === true
  const registry = registryStub([owner], new Set(['session-sub|0']))
  const { ctx, listeners, records } = stubContext({ registry })
  guard.apply(ctx)
  const session = seededChild(parent, cut, 'session-sub').session
  const before = session.snapshotEvents().length
  listeners.get('agent/created')({ agent: { session, inbox: inboxOver(session) } })
  assert.equal(records.info.length, 0)
  assert.equal(records.warn.length, 0)
  assert.equal(session.snapshotEvents().length, before, '子代理零改动')
  assert.deepEqual(foldInbox(session.snapshotEvents())['next-turn'].map(m => m.id), ['U2'], '幽灵仍在（未触碰）')
  void childAgent
})

check('入口：其他 owner 不匹配时不跳过（正常处理）', () => {
  const registry = registryStub([{ id: 'unrelated' }], new Set())
  const { ctx, listeners, records } = stubContext({ registry })
  guard.apply(ctx)
  const session = seededChild(parent, cut, 'session-other').session
  listeners.get('agent/created')({ agent: guardedAgent(session) })
  assert.equal(records.info.length, 1)
})

check('入口：移除过程抛错时降级为 warn，绝不外逸（不得否决发布）', () => {
  const { ctx, listeners, records } = stubContext({ registry: registryStub([], new Set()) })
  guard.apply(ctx)
  const broken = {
    session: {
      id: 'session-broken',
      header: { isSeeded: true },
      inheritedEventCount: 1,
      snapshotEvents() {
        throw new Error('snapshot exploded')
      },
    },
    inbox: { nextTurn: [], nextStep: [], remove: () => false },
  }
  assert.doesNotThrow(() => listeners.get('agent/created')({ agent: broken }))
  assert.equal(records.warn.length, 1, '降级为一行 warn')
  assert.match(records.warn[0], /dsh-fork-inbox-guard/)
})

check('入口：logger 自身抛错也被吞掉（不同步外逸）', () => {
  const { ctx, listeners } = stubContext({ registry: registryStub([], new Set()), loggerThrows: true })
  guard.apply(ctx)
  const session = seededChild(parent, cut, 'session-logger-boom').session
  assert.doesNotThrow(() => listeners.get('agent/created')({ agent: guardedAgent(session) }))
  assert.deepEqual(foldInbox(session.snapshotEvents())['next-turn'], [], '移除仍然完成')
})

check('入口：inbox 结构异常时不抛错', () => {
  const { ctx, listeners } = stubContext({ registry: registryStub([], new Set()) })
  guard.apply(ctx)
  const session = seededChild(parent, cut, 'session-bad-inbox').session
  for (const brokenInbox of [undefined, null, {}, { nextTurn: undefined, nextStep: null, remove: undefined }]) {
    assert.doesNotThrow(() =>
      listeners.get('agent/created')({ agent: { session, inbox: brokenInbox } }),
    )
  }
})

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
