/**
 * 排序规划的纯函数测试：比较规则（数字序、大小写、方向、置顶、稳定性）与
 * 「最小移动序列」的正确性（就地模拟注册表的 insertBefore 语义）。
 *
 * 运行：`node test/order-plan.test.mjs`。
 */
import assert from 'node:assert/strict'
import {
  SORT_ORDERS,
  planReorderSteps,
  planWorkspaceOrder,
  sameOrder,
} from '../src/order.ts'

/** 一份工作区投影。 */
function ws(id, title, path = `C:\\work\\${id}`, createdAt = '2026-01-01T00:00:00.000Z', updatedAt = createdAt) {
  return { id, title, path, createdAt, updatedAt }
}

/** 展开默认值之后的策略。 */
function policy(overrides = {}) {
  return { order: 'title-asc', pinned: [], caseSensitive: false, locale: 'en-US', ...overrides }
}

/** 按注册表 insertBefore 的语义就地执行移动序列。 */
function applySteps(current, steps) {
  const arr = [...current]
  for (const step of steps) {
    const without = arr.filter((value) => value !== step.id)
    const at = step.beforeId === undefined ? without.length : without.indexOf(step.beforeId)
    arr.length = 0
    arr.push(...without.slice(0, at), step.id, ...without.slice(at))
  }
  return arr
}

// ---- 比较规则 ----------------------------------------------------------------

assert.deepEqual(planWorkspaceOrder([], policy()), [], '空列表得到空顺序')

{
  const list = [ws('c', 'gamma'), ws('a', 'Alpha'), ws('b', 'beta')]
  assert.deepEqual(
    planWorkspaceOrder(list, policy()),
    ['a', 'b', 'c'],
    'title-asc 默认不区分大小写',
  )
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ order: 'title-desc' })),
    ['c', 'b', 'a'],
    'title-desc 逐位取反',
  )
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ caseSensitive: true })),
    ['a', 'b', 'c'],
    '区分大小写时 Alpha 仍排在 beta 前',
  )
}

{
  const list = [ws('a10', 'project10'), ws('a2', 'project2'), ws('a1', 'project1')]
  assert.deepEqual(
    planWorkspaceOrder(list, policy()),
    ['a1', 'a2', 'a10'],
    '数字序：project2 排在 project10 之前（非字典序）',
  )
}

{
  const list = [
    ws('x', 'same', 'C:\\work\\b'),
    ws('y', 'same', 'C:\\work\\a'),
    ws('z', 'same', 'C:\\work\\c'),
  ]
  assert.deepEqual(
    planWorkspaceOrder(list, policy()),
    ['y', 'x', 'z'],
    '标题同值：按路径再按 id 稳定收束',
  )
  assert.deepEqual(
    planWorkspaceOrder([...list].reverse(), policy()),
    ['y', 'x', 'z'],
    '同值稳定性与入参顺序无关（重排不会抖动）',
  )
}

{
  const list = [ws('p', 'zzz', 'C:\\work\\zzz'), ws('q', 'aaa', 'C:\\work\\aaa')]
  assert.deepEqual(planWorkspaceOrder(list, policy({ order: 'path-asc' })), ['q', 'p'], 'path-asc 读路径')
  assert.deepEqual(planWorkspaceOrder(list, policy({ order: 'path-desc' })), ['p', 'q'], 'path-desc 读路径')
}

{
  const list = [
    ws('old', 'b', 'C:\\work\\b', '2026-01-01T00:00:00.000Z'),
    ws('new', 'a', 'C:\\work\\a', '2026-06-01T00:00:00.000Z'),
  ]
  assert.deepEqual(planWorkspaceOrder(list, policy({ order: 'created-asc' })), ['old', 'new'], 'created-asc 按创建时刻')
  assert.deepEqual(planWorkspaceOrder(list, policy({ order: 'created-desc' })), ['new', 'old'], 'created-desc 按创建时刻')
}

{
  const list = [
    ws('a', 'Alpha', 'C:\\work\\a', '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
    ws('b', 'beta', 'C:\\work\\b', '2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
    ws('c', 'gamma', 'C:\\work\\c', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ]
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ order: 'updated-desc' })),
    ['b', 'a', 'c'],
    'updated-desc：最近改动的排最前（与标题序不同）',
  )
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ order: 'updated-asc' })),
    ['c', 'a', 'b'],
    'updated-asc：最久没动的排最前',
  )
  assert.deepEqual(
    planWorkspaceOrder([...list].reverse(), policy({ order: 'updated-desc' })),
    ['b', 'a', 'c'],
    'updated-desc 与入参顺序无关',
  )
}

{
  const list = [
    ws('x', 'same', 'C:\\work\\b'),
    ws('y', 'same', 'C:\\work\\a'),
  ]
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ order: 'updated-desc' })),
    ['y', 'x'],
    'updatedAt 同值：兜底仍按路径升序（方向只反转主键）',
  )
}

{
  const list = [ws('c', 'gamma'), ws('a', 'Alpha'), ws('b', 'beta')]
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ pinned: ['gamma', 'alpha'] })),
    ['c', 'a', 'b'],
    '置顶按数组顺序在最前，其余仍按依据排序',
  )
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ pinned: ['C:\\work\\b'] })),
    ['b', 'a', 'c'],
    '置顶可按绝对路径匹配（工作区 b 的路径就是 C:\\work\\b）',
  )
  assert.deepEqual(
    planWorkspaceOrder(list, policy({ pinned: ['gamma'], order: 'title-desc' })),
    ['c', 'b', 'a'],
    '置顶段不受排序方向影响',
  )
}

for (const order of SORT_ORDERS) {
  const list = [ws('b', 'beta'), ws('a', 'Alpha'), ws('c', 'gamma')]
  const once = planWorkspaceOrder(list, policy({ order }))
  const twice = planWorkspaceOrder([...list].reverse(), policy({ order }))
  assert.deepEqual(once, twice, `${order}：与入参顺序无关`)
  assert.equal(new Set(once).size, 3, `${order}：不丢条目`)
}

// ---- 最小移动序列 ------------------------------------------------------------

assert.deepEqual(planReorderSteps([], []), [], '空顺序无需移动')
assert.deepEqual(planReorderSteps(['a', 'b', 'c'], ['a', 'b', 'c']), [], '已就位时一次也不移动')
assert.deepEqual(
  planReorderSteps(['c', 'b', 'a'], ['a', 'b', 'c']),
  [{ id: 'a', beforeId: 'c' }, { id: 'b', beforeId: 'c' }],
  '逆序只要两步：a、b 先后移到 c 之前',
)

for (const current of [
  ['a', 'b', 'c'],
  ['c', 'b', 'a'],
  ['b', 'c', 'a'],
  ['a', 'c', 'b'],
]) {
  const desired = ['a', 'b', 'c']
  const steps = planReorderSteps(current, desired)
  assert.ok(steps.length <= desired.length - 1, `${current.join('')}: 移动次数不超过 n-1`)
  assert.deepEqual(applySteps(current, steps), desired, `${current.join('')}: 按注册表语义执行后到位`)
}

{
  const steps = planReorderSteps([1, 2, 3], [3, 2, 1])
  assert.deepEqual(steps, [{ id: 3, beforeId: 1 }, { id: 2, beforeId: 1 }], 'id 类型无关（数字同样可用）')
}

// ---- 顺序比较 ----------------------------------------------------------------

assert.equal(sameOrder([], []), true, '两个空顺序相同')
assert.equal(sameOrder(['a'], ['a']), true, '同序相同')
assert.equal(sameOrder(['a', 'b'], ['b', 'a']), false, '异序不同')
assert.equal(sameOrder(['a'], ['a', 'b']), false, '长度不同即不同')

console.log('order-plan checks passed')
