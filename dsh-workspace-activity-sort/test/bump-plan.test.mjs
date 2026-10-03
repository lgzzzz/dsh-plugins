/**
 * 纯规划测试：验证归属查找、上浮所需移动、待落位新会话的认领与放弃。
 *
 * 运行：`node test/bump-plan.test.mjs`。
 */
import assert from 'node:assert/strict'
import { frontMove, owningWorkspaceId, planActivityFronts, planPendingFronts } from '../src/bump.ts'
import { ws } from './helpers.mjs'

// 归属查找

{
  const workspaces = [ws('a', ['s-1', 's-2']), ws('b', ['s-3'])]
  assert.equal(owningWorkspaceId(workspaces, 's-3'), 'b', '认得出会话属于哪个工作区')
  assert.equal(owningWorkspaceId(workspaces, 's-1'), 'a', '多个会话各归各的工作区')
  assert.equal(owningWorkspaceId(workspaces, 's-ungrouped'), undefined, '不属于任何工作区时没有归属')
  assert.equal(owningWorkspaceId([], 's-1'), undefined, '注册表为空时没有归属')
  assert.equal(owningWorkspaceId([ws('a', [])], 's-1'), undefined, '工作区账下为空时没有归属')
}

// 上浮需要的那一次移动

{
  assert.deepEqual(frontMove(['a', 'b', 'c'], 'c'), { id: 'c', beforeId: 'a' }, '不在最前就移到当前第一名之前')
  assert.equal(frontMove(['a', 'b', 'c'], 'a'), undefined, '已经在最前就一次写盘都不做')
  assert.equal(frontMove(['a'], 'a'), undefined, '只有一个工作区时无从上浮')
  assert.equal(frontMove([], 'a'), undefined, '注册表为空时不做任何事')
  assert.equal(frontMove(['a', 'b'], 'zzz'), undefined, '不在注册表里的工作区不做任何事')
  assert.deepEqual(frontMove(['a', 'b'], 'b'), { id: 'b', beforeId: 'a' }, '第二个上浮到第一个之前')
}

// 活动事件 → 上浮请求

{
  const workspaces = [ws('a', ['s-a']), ws('b', ['s-b', 's-b2'])]
  assert.deepEqual(
    planActivityFronts(workspaces, ['s-b2', 's-a']),
    [
      { workspaceId: 'b', reason: 'activity' },
      { workspaceId: 'a', reason: 'activity' },
    ],
    '按到达顺序解析归属',
  )
  assert.deepEqual(
    planActivityFronts(workspaces, ['s-ungrouped', 's-a']),
    [{ workspaceId: 'a', reason: 'activity' }],
    '不属于任何工作区的会话（Ungrouped）被丢掉',
  )
  assert.deepEqual(planActivityFronts(workspaces, []), [], '没有活动就没有请求')
  assert.deepEqual(
    planActivityFronts(workspaces, ['s-a', 's-a']),
    [
      { workspaceId: 'a', reason: 'activity' },
      { workspaceId: 'a', reason: 'activity' },
    ],
    '同一工作区的连续活动各自成一次请求（重复的那些会被「已在最前」吃掉）',
  )
}

// 待落位新会话的认领与放弃

const TTL = 60_000

{
  const workspaces = [ws('a', ['s-old']), ws('b', ['s-new'])]
  const plan = planPendingFronts({
    workspaces,
    pending: [
      { sessionId: 's-new', since: 2_000 },
      { sessionId: 's-older-missing', since: 1_000 },
    ],
    now: 3_000,
    ttl: TTL,
  })
  assert.deepEqual(plan.fronts, [{ workspaceId: 'b', reason: 'new-session' }], '已经落位的新会话认领工作区')
  assert.deepEqual(plan.settled, ['s-new'], '认领到的会话从待落位表里删掉')
  assert.deepEqual(plan.expired, [], '还没到上限的会话继续等归属')
}

{
  const workspaces = [ws('a', ['s-early', 's-late'])]
  const plan = planPendingFronts({
    workspaces,
    pending: [
      { sessionId: 's-late', since: 500 },
      { sessionId: 's-early', since: 100 },
    ],
    now: 600,
    ttl: TTL,
  })
  assert.deepEqual(plan.settled, ['s-early', 's-late'], '按登记先后依次认领，与入参顺序无关')
}

{
  const workspaces = [ws('a', ['s-1', 's-2'])]
  const plan = planPendingFronts({
    workspaces,
    pending: [
      { sessionId: 's-2', since: 100 },
      { sessionId: 's-1', since: 100 },
    ],
    now: 100,
    ttl: TTL,
  })
  assert.deepEqual(plan.settled, ['s-1', 's-2'], '登记时刻相同时按会话 id 定序，结果与入参顺序无关')
}

{
  const workspaces = [ws('a', [])]
  assert.deepEqual(
    planPendingFronts({ workspaces, pending: [{ sessionId: 's-x', since: 0 }], now: TTL - 1, ttl: TTL }),
    { fronts: [], settled: [], expired: [] },
    '还没到上限：既不算落位也不算放弃',
  )
  assert.deepEqual(
    planPendingFronts({ workspaces, pending: [{ sessionId: 's-x', since: 0 }], now: TTL, ttl: TTL }).expired,
    ['s-x'],
    '到达上限即放弃（它可能压根不属于任何工作区）',
  )
  assert.deepEqual(
    planPendingFronts({ workspaces, pending: [{ sessionId: 's-x', since: 0 }], now: TTL + 1, ttl: TTL }).expired,
    ['s-x'],
    '超过上限同样放弃',
  )
}

{
  const workspaces = [ws('a', ['s-1', 's-2'])]
  const plan = planPendingFronts({
    workspaces,
    pending: [
      { sessionId: 's-1', since: 10 },
      { sessionId: 's-2', since: 20 },
    ],
    now: 30,
    ttl: TTL,
  })
  assert.deepEqual(
    plan.fronts,
    [
      { workspaceId: 'a', reason: 'new-session' },
      { workspaceId: 'a', reason: 'new-session' },
    ],
    '同一工作区的多个新会话各自成一次请求，最终都收敛到同一次写盘',
  )
  assert.deepEqual(plan.settled, ['s-1', 's-2'], '两个都已认领')
}

console.log('bump-plan checks passed')
