/**
 * 上级链纯逻辑：找父会话的三条依据、优先级、逐级向上、成环与上限。
 *
 * 运行：`node test/lineage.test.mjs`（或 pnpm test 跑全部）。
 */
import { ancestorRows, MAX_ANCESTORS, parentOf } from '../src/lineage.ts'
import { check, finish } from './helpers.mjs'

/** 造一行会话列表。 */
function summary(id, overrides = {}) {
  return {
    id,
    displayTitle: `标题-${id}`,
    running: false,
    origin: 'root',
    ...overrides,
  }
}

/** 造一条 `subagentCatalog` 投影，只保留判定要用的 id 字段。 */
function catalogProjection(ids) {
  return { state: 'ready', error: null, values: { subagentCatalog: ids.map(id => ({ id })) } }
}

console.log('--- ① 根会话没有上级 ---')
const rootInput = {
  sessionId: 'root',
  address: null,
  summaries: { root: summary('root') },
  projections: {},
}
check('parentOf 根会话', parentOf('root', null, rootInput.summaries, rootInput.projections), undefined)
check('ancestorRows 根会话', ancestorRows(rootInput), [])

console.log('--- ② 三条依据：地址 > 目录投影 > 列表行 ---')
const summaries2 = {
  child: summary('child', { origin: 'subagent', parentId: 'from-list' }),
}
check(
  '地址优先',
  parentOf('child', { parentSessionId: 'from-address', childSessionId: 'child', mode: 'continuable' }, summaries2, {}),
  'from-address',
)
check(
  '地址不属于本会话时忽略，退到列表行',
  parentOf('child', { parentSessionId: 'from-address', childSessionId: 'other', mode: 'continuable' }, summaries2, {}),
  'from-list',
)
check(
  '目录投影先于列表行',
  parentOf('child', null, summaries2, { 'from-catalog': catalogProjection(['child']) }),
  'from-catalog',
)
check(
  '只有列表行 originsubagent 才认 parentId',
  parentOf('solo', null, { solo: summary('solo', { parentId: 'ignored' }) }, {}),
  undefined,
)
check('三条都没有', parentOf('unknown', null, {}, {}), undefined)

console.log('--- ③ 逐级向上：从上到下，带标题与运行状态 ---')
const chain = {
  sessionId: 'grandchild',
  address: { parentSessionId: 'child', childSessionId: 'grandchild', mode: 'continuable' },
  summaries: {
    root: summary('root', { displayTitle: '主会话', running: true }),
    child: summary('child', { displayTitle: '一级子智能体', origin: 'subagent', parentId: 'root' }),
    grandchild: summary('grandchild', { displayTitle: '二级子智能体', origin: 'subagent', parentId: 'child' }),
  },
  projections: {},
}
const rows = ancestorRows(chain)
check('一级一行、二级两行', rows.length, 2)
check('链首是主智能体', [rows[0].sessionId, rows[0].root, rows[0].running, rows[0].title], ['root', true, true, '主会话'])
check('末行是直接上级', [rows[1].sessionId, rows[1].root, rows[1].running, rows[1].title], ['child', false, false, '一级子智能体'])

console.log('--- ④ 列表缺行：标题退回 id，状态按空闲 ---')
const orphan = ancestorRows({
  sessionId: 'child',
  address: null,
  summaries: { child: summary('child', { origin: 'subagent', parentId: 'missing' }) },
  projections: {},
})
check('缺行仍列出', orphan.map(row => row.sessionId), ['missing'])
check('标题退回 id', orphan[0].title, 'missing')
check('缺行按空闲', orphan[0].running, false)

console.log('--- ⑤ 成环与上限 ---')
const cycle = ancestorRows({
  sessionId: 'a',
  address: null,
  summaries: {
    a: summary('a', { origin: 'subagent', parentId: 'b' }),
    b: summary('b', { origin: 'subagent', parentId: 'a' }),
  },
  projections: {},
})
check('成环只走一圈', cycle.map(row => row.sessionId), ['b'])

const deepSummaries = {}
let deepId = 'leaf'
for (let level = 0; level < MAX_ANCESTORS + 4; level += 1) {
  const parent = `p${level}`
  deepSummaries[deepId] = summary(deepId, { origin: 'subagent', parentId: parent })
  deepId = parent
}
const deep = ancestorRows({ sessionId: 'leaf', address: null, summaries: deepSummaries, projections: {} })
check(`深度上限 ${MAX_ANCESTORS}`, deep.length, MAX_ANCESTORS)

finish()
