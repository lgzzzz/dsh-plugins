/**
 * 纯判定测试：最后一轮结局识别、恢复口径、候选筛选与续跑文案。
 *
 * 运行：`node test/decide.test.mjs`。
 */
import assert from 'node:assert/strict'
import {
  continuationText,
  inspectTurn,
  restartDecision,
  selectCandidates,
} from '../src/decide.ts'

const DAY = 86_400_000

/** 造一条最小事件。 */
const ev = (type, seq, data, time = 1_000 + seq) => ({
  type,
  seq,
  time,
  ...(data === undefined ? {} : { data }),
})

/** 造一条 `turn/end`。 */
const turnEnd = (seq, kind, cause, time) => ev(
  'turn/end',
  seq,
  { turn: 1, reason: { kind, ...(cause === undefined ? {} : { reason: { kind: cause } }) } },
  time,
)

const policy = { includeHookCancelled: true }
const noHookPolicy = { includeHookCancelled: false }

// inspectTurn：没有轮次

{
  assert.deepEqual(inspectTurn([]), { kind: 'none', at: 0 }, '空日志没有轮次')
  assert.deepEqual(
    inspectTurn([ev('user/message', 0, {})]),
    { kind: 'none', at: 0 },
    '只有消息、没有轮次时也是 none',
  )
}

// inspectTurn：各种结局

{
  const completed = inspectTurn([ev('turn/start', 0), turnEnd(1, 'completed', undefined, 5_000)])
  assert.deepEqual(completed, { kind: 'completed', at: 5_000 }, 'completed 带上结束时间')

  const interrupted = inspectTurn([ev('turn/start', 0), turnEnd(1, 'interrupted', undefined, 6_000)])
  assert.deepEqual(interrupted, { kind: 'interrupted', at: 6_000 }, 'interrupted 是崩溃配平后的终态')

  const disposed = inspectTurn([ev('turn/start', 0), turnEnd(1, 'aborted', 'disposed', 7_000)])
  assert.deepEqual(
    disposed,
    { kind: 'aborted', cancelCause: 'disposed', at: 7_000 },
    'aborted 带上取消原因',
  )

  const user = inspectTurn([ev('turn/start', 0), turnEnd(1, 'aborted', 'user')])
  assert.equal(user.cancelCause, 'user', '用户取消可辨认')

  const missingCause = inspectTurn([ev('turn/start', 0), turnEnd(1, 'aborted')])
  assert.equal(missingCause.kind, 'aborted', '缺原因的 aborted 仍是 aborted')
  assert.equal(missingCause.cancelCause, undefined, '缺原因时不编造 cancelCause')

  const error = inspectTurn([
    ev('turn/start', 0),
    ev('turn/end', 1, { turn: 1, reason: { kind: 'error', error: { message: 'x', code: 'RATE_LIMIT' } } }),
  ])
  assert.deepEqual(error, { kind: 'error', at: 1_001 }, 'error 不影响判定，只记录结局')

  for (const kind of ['max-tokens', 'blocked', 'forked']) {
    assert.equal(inspectTurn([ev('turn/start', 0), turnEnd(1, kind)]).kind, kind, `${kind} 可识别`)
  }

  assert.equal(
    inspectTurn([ev('turn/start', 0), turnEnd(1, 'refusal')]).kind,
    'unknown',
    '未来新增的合并原因落到 unknown',
  )
  assert.equal(
    inspectTurn([ev('turn/start', 0), ev('turn/end', 1, { turn: 1 })]).kind,
    'unknown',
    '缺 data.reason 时是 unknown',
  )
}

// inspectTurn：开放尾部与多轮

{
  const open = inspectTurn([ev('turn/start', 0, {}, 2_000)])
  assert.deepEqual(open, { kind: 'open', at: 2_000 }, '只有 turn/start 说明轮次没闭合')

  const lastWins = inspectTurn([
    ev('turn/start', 0),
    turnEnd(1, 'completed'),
    ev('turn/start', 2),
    turnEnd(3, 'interrupted', undefined, 9_000),
  ])
  assert.deepEqual(lastWins, { kind: 'interrupted', at: 9_000 }, '只看最后一轮')

  const openAfterClosed = inspectTurn([
    ev('turn/start', 0),
    turnEnd(1, 'completed'),
    ev('turn/start', 2, {}, 8_000),
  ])
  assert.deepEqual(openAfterClosed, { kind: 'open', at: 8_000 }, '已闭合一轮后又开了一轮，以开放轮为准')

  const outOfOrder = inspectTurn([
    turnEnd(3, 'interrupted'),
    ev('turn/start', 2),
    turnEnd(1, 'completed'),
  ])
  assert.equal(outOfOrder.kind, 'interrupted', '按 seq 而不是数组顺序取最后一轮')
}

// restartDecision：口径

{
  assert.deepEqual(
    restartDecision({ kind: 'interrupted', at: 0 }, noHookPolicy),
    { trigger: 'interrupted', label: 'interrupted' },
    '崩溃 / 被杀要恢复',
  )
  for (const cause of ['disposed', 'parent']) {
    assert.deepEqual(
      restartDecision({ kind: 'aborted', cancelCause: cause, at: 0 }, noHookPolicy),
      { trigger: cause, label: `aborted:${cause}` },
      `${cause} 不是用户终止，要恢复`,
    )
  }
  assert.deepEqual(
    restartDecision({ kind: 'aborted', cancelCause: 'hook', at: 0 }, policy),
    { trigger: 'hook', label: 'aborted:hook' },
    'hook 取消默认算被打断',
  )
  assert.equal(
    restartDecision({ kind: 'aborted', cancelCause: 'hook', at: 0 }, noHookPolicy),
    undefined,
    '关掉后不恢复 hook 取消',
  )
  for (const cause of ['user', 'legacy', undefined]) {
    assert.equal(
      restartDecision({ kind: 'aborted', ...(cause === undefined ? {} : { cancelCause: cause }), at: 0 }, policy),
      undefined,
      `${String(cause)} 取消不恢复`,
    )
  }
  assert.deepEqual(
    restartDecision({ kind: 'open', at: 0 }, noHookPolicy),
    { trigger: 'interrupted', label: 'interrupted' },
    '未闭合的轮次按崩溃处理',
  )
  for (const kind of ['completed', 'error', 'max-tokens', 'blocked', 'forked', 'unknown', 'none']) {
    assert.equal(restartDecision({ kind, at: 0 }, policy), undefined, `${kind} 不恢复`)
  }
}

// selectCandidates：过滤、排序与上限

{
  const candidate = (sessionId, overrides = {}) => ({
    sessionId,
    updatedAt: 10 * DAY - 1_000,
    running: false,
    blank: false,
    cwd: '/work',
    ...overrides,
  })
  const options = {
    now: 10 * DAY,
    windowDays: 7,
    archived: new Set(),
    live: new Set(),
    scanLimit: 100,
  }
  const kept = selectCandidates([candidate('a')], options)
  assert.deepEqual(kept.map((item) => item.sessionId), ['a'], '普通会话保留')

  const filtered = selectCandidates([
    candidate('ok'),
    candidate('blank', { blank: true }),
    candidate('subagent', { origin: 'subagent' }),
    candidate('no-cwd', { cwd: undefined }),
    candidate('running', { running: true }),
    candidate('old', { updatedAt: 10 * DAY - 8 * DAY }),
    candidate('archived-later'),
  ], {
    ...options,
    archived: new Set(['archived-later']),
    live: new Set(['live-elsewhere']),
  })
  assert.deepEqual(filtered.map((item) => item.sessionId), ['ok'], '六类不该碰的会话都被过滤')

  const live = selectCandidates([candidate('live-elsewhere')], { ...options, live: new Set(['live-elsewhere']) })
  assert.deepEqual(live, [], '已有 live Agent 的会话被过滤')

  const boundary = selectCandidates([candidate('edge', { updatedAt: 10 * DAY - 7 * DAY })], options)
  assert.deepEqual(boundary.map((item) => item.sessionId), ['edge'], '时间窗边界包含在内')

  const unlimited = selectCandidates([candidate('ancient', { updatedAt: 0 })], { ...options, windowDays: 0 })
  assert.deepEqual(unlimited.map((item) => item.sessionId), ['ancient'], 'windowDays=0 表示不限时间')

  const ordered = selectCandidates([
    candidate('oldest', { updatedAt: 10 * DAY - 3 }),
    candidate('newest', { updatedAt: 10 * DAY - 1 }),
    candidate('middle', { updatedAt: 10 * DAY - 2 }),
  ], options)
  assert.deepEqual(
    ordered.map((item) => item.sessionId),
    ['newest', 'middle', 'oldest'],
    '按最近活动倒序',
  )

  const tied = selectCandidates([
    candidate('b', { updatedAt: 10 * DAY - 5 }),
    candidate('a', { updatedAt: 10 * DAY - 5 }),
  ], options)
  assert.deepEqual(tied.map((item) => item.sessionId), ['a', 'b'], '同一时间戳按 id 稳定排序')

  const limited = selectCandidates([
    candidate('a', { updatedAt: 10 * DAY - 1 }),
    candidate('b', { updatedAt: 10 * DAY - 2 }),
    candidate('c', { updatedAt: 10 * DAY - 3 }),
  ], { ...options, scanLimit: 2 })
  assert.deepEqual(limited.map((item) => item.sessionId), ['a', 'b'], '先排序再截断，保留最新的')

  assert.deepEqual(selectCandidates([candidate('a')], { ...options, scanLimit: 0 }), [], 'scanLimit=0 不读任何日志')
}

// 续跑文案

{
  const decision = { trigger: 'interrupted', label: 'aborted:disposed' }
  assert.equal(
    continuationText('（{reason}）继续，另一处 {reason} 也替换。', decision),
    '（aborted:disposed）继续，另一处 aborted:disposed 也替换。',
    '所有 {reason} 占位都替换',
  )
  assert.equal(continuationText('没有占位', decision), '没有占位', '没有占位时原样返回')
}

console.log('decide.test.mjs: 全部通过')
