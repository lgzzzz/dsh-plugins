/**
 * 诊断脚本(非插件产物):纯 Node,无浏览器、无构建依赖。直接以 Node Type Stripping 载入 src/*.ts,覆盖:
 *   A. 0.1.7 契约迁移:stopCurrentSessionTree 的子代理枚举(origin='subagent' 行 × 投影名的并集、
 *      **fork(parentId 有值但 origin 缺席)不得递归取消**、one-shot 跳过、
 *      两源去重、缺失来源的降级、无运行会话 / 锚点不可读的 no-op);
 *   B. 侧栏顺序复刻:sessionVisible 的 archivedFilter 三分支、reconcileOrder(存档序 / 置顶前置 / 归档沉底 /
 *      fork 紧随其源 / **缺摘要成员剔除**)、sectionMembers 分区、pinCurrentBlank,
 *      以及 sidebarOrderedSessionIds 端到端(workspace / flat × default|show|only × updated|manual);
 *   C. 近期对话浮窗:归档会话恒不列出(recentSessionsView 不跟随侧栏 archivedFilter)、
 *      打开归档行仍被拒(与上游 guardedOpen 同款门闸)。
 * 上游方法一律写成读 this 的类方法形态:插件若摘引用调用会抛错,本脚本能测出该类缺陷。
 * 用法:node test-order.mjs
 */
import { stopCurrentSessionTree } from './src/actions.ts'
import {
  normalizeArchivedFilter,
  pinCurrentBlank,
  recencyOrder,
  reconcileOrder,
  sectionMembers,
  sessionRowVisible,
  sessionVisible,
} from './src/session-order.ts'
import { sidebarOrderedSessionIds } from './src/sidebar-order.ts'
import { openRecentSession, recentSessionsView } from './src/recent-sessions.ts'

let failures = 0
/** 断言并按仓库脚本惯例记账。 */
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

// ---- A. stopCurrentSessionTree:0.1.7 子代理枚举 -------------------------------

/** 会话树桩:rows = byId 行(parentId 表达父子、origin='subagent' 才是子代理)、
 *  projections = 投影面补充、running/oneShot = 会话态。 */
function tree({ current = 's1', rows = {}, projections = {}, running = [], oneShot = [] } = {}) {
  const cancelled = []
  const runningSet = new Set(running)
  const oneShotSet = new Set(oneShot)
  const ids = Object.values(rows).filter((r) => r.parentId === undefined).map((r) => r.id)
  class Session {
    constructor(id) {
      this.id = id
    }
    getSnapshot() {
      return {
        running: runningSet.has(this.id),
        subagent: { address: { mode: oneShotSet.has(this.id) ? 'one-shot' : 'continuation' } },
      }
    }
    cancel() {
      cancelled.push(this.id)
    }
  }
  const services = {
    uiSession: { current: { getSnapshot: () => (current === undefined ? undefined : { key: current }) } },
    sessions: {
      list: { getSnapshot: () => ({ ids, byId: rows, projectionsBySession: projections }) },
      binding: (id) => (runningSet.has(id) || oneShotSet.has(id) ? { session: new Session(id) } : undefined),
    },
  }
  return { services, cancelled }
}

console.log('--- A① 子树枚举:origin=subagent 行(含隔代) ---')
{
  const { services, cancelled } = tree({
    rows: {
      s1: { id: 's1' },
      s2: { id: 's2', parentId: 's1', origin: 'subagent' },
      s3: { id: 's3', parentId: 's2', origin: 'subagent' },
    },
    running: ['s1', 's2', 's3'],
  })
  check('Esc → 取消 s1/s2/s3(递归直系)', stopCurrentSessionTree(services), true)
  check('取消集合', cancelled, ['s1', 's2', 's3'])
}

console.log('--- A② one-shot 子代理跳过,但其子树仍被访问 ---')
{
  const { services, cancelled } = tree({
    rows: {
      s1: { id: 's1' },
      s2: { id: 's2', parentId: 's1', origin: 'subagent' },
      s3: { id: 's3', parentId: 's2', origin: 'subagent' },
    },
    running: ['s1', 's2', 's3'],
    oneShot: ['s2'],
  })
  check('有运行会话 → true', stopCurrentSessionTree(services), true)
  check('one-shot s2 不取消,隔代 s3 仍取消', cancelled, ['s1', 's3'])
}

console.log('--- A③ 投影面补充 + 两源并集去重 ---')
{
  const { services, cancelled } = tree({
    rows: { s1: { id: 's1' }, s2: { id: 's2', parentId: 's1', origin: 'subagent' } },
    projections: {
      s1: { values: { subagentCatalog: [{ id: 's2', mode: 'continuation' }, { id: 's4', mode: 'continuation' }] } },
      s2: { values: { subagentCatalog: [{ id: 's5', mode: 'continuation' }] } },
    },
    running: ['s1', 's2', 's4', 's5'],
  })
  check('有运行会话 → true', stopCurrentSessionTree(services), true)
  // 深度优先:s1 → s2 → (s2 的子)s5 → 回到 s1 的下一子 s4;每个 id 恰好取消一次
  check('并集:s2 只取消一次,s4/s5 由投影贡献', cancelled, ['s1', 's2', 's5', 's4'])
}

console.log('--- A④ fork 不算子代理:parentId 有值但 origin 缺席 → 不递归取消 ---')
{
  // fork 与子代理共用 parentSession 字段(dsh-session/lib/index.js:1770-1772 只写 parentSession、不写 origin);
  // 上游 runningDescendants(dsh-subagent/lib/index.js:2435-2443)要求 origin === 'subagent' 才递归。
  const { services, cancelled } = tree({
    rows: {
      s1: { id: 's1' },
      fork: { id: 'fork', parentId: 's1' },
    },
    running: ['s1', 'fork'],
  })
  check('有运行会话 → true', stopCurrentSessionTree(services), true)
  check('只取消 s1,fork 不动', cancelled, ['s1'])
}
{
  // 隔代同样不穿透:root → sub(子代理) → fork(sub 的 fork);fork 的运行态不得被 sub 的取消带出
  const { services, cancelled } = tree({
    rows: {
      s1: { id: 's1' },
      sub: { id: 'sub', parentId: 's1', origin: 'subagent' },
      fork: { id: 'fork', parentId: 'sub' },
    },
    running: ['s1', 'sub', 'fork'],
  })
  check('隔代:取消 s1/sub', stopCurrentSessionTree(services) && cancelled, ['s1', 'sub'])
}
{
  // 反向对照:同一个 parentId 上带 origin 的行**必须**被取消,证明过滤不是把整条路径关掉
  const { services, cancelled } = tree({
    rows: {
      s1: { id: 's1' },
      sub: { id: 'sub', parentId: 's1', origin: 'subagent' },
      fork: { id: 'fork', parentId: 's1' },
    },
    running: ['s1', 'sub', 'fork'],
  })
  check('对照:同父下子代理取消、fork 不取消', stopCurrentSessionTree(services) && cancelled, ['s1', 'sub'])
}
{
  // 投影面是子代理名册,不受 origin 过滤影响(目录项即子代理)
  const { services, cancelled } = tree({
    rows: { s1: { id: 's1' } },
    projections: { s1: { values: { subagentCatalog: [{ id: 'c1', mode: 'continuation' }] } } },
    running: ['s1', 'c1'],
  })
  check('投影目录项仍被递归取消', stopCurrentSessionTree(services) && cancelled, ['s1', 'c1'])
}

console.log('--- A⑤ 降级 / no-op ---')
{
  const { services, cancelled } = tree({ rows: { s1: { id: 's1' } }, running: [] })
  check('无运行会话 → false 且不取消', stopCurrentSessionTree(services), false)
  check('无取消记录', cancelled, [])
}
{
  const { services } = tree({ current: '', rows: { s1: { id: 's1' } }, running: ['s1'] })
  check('锚点不可读 → false', stopCurrentSessionTree(services), false)
}
{
  const services = {
    uiSession: { current: { getSnapshot: () => ({ key: 's1' }) } },
    sessions: {
      list: { getSnapshot: () => ({ ids: [], byId: {}, projectionsBySession: {} }) },
      binding: () => undefined,
    },
  }
  check('两源皆空 → 只处理当前会话且无取消', stopCurrentSessionTree(services), false)
}
{
  check('sessions 服务缺席 → false', stopCurrentSessionTree({}), false)
}

// ---- B. 可见性原语 ----------------------------------------------------------

console.log('--- B① sessionRowVisible:archivedFilter 三分支 + blank / 子代理 ---')
{
  const archived = new Set(['arch'])
  check('归档行 default → 不可见', sessionRowVisible({ id: 'arch' }, 'cur', archived, 'default'), false)
  check('归档行 show → 可见', sessionRowVisible({ id: 'arch' }, 'cur', archived, 'show'), true)
  check('归档行 only → 可见', sessionRowVisible({ id: 'arch' }, 'cur', archived, 'only'), true)
  check('非归档行 only → 不可见', sessionRowVisible({ id: 'x' }, 'cur', archived, 'only'), false)
  check('非归档行 default → 可见', sessionRowVisible({ id: 'x' }, 'cur', archived, 'default'), true)
  check('子代理恒不可见', sessionRowVisible({ id: 'sub', origin: 'subagent' }, 'cur', archived, 'show'), false)
  check('非当前空白恒不可见', sessionRowVisible({ id: 'b', blank: true }, 'cur', archived, 'show'), false)
  check('当前空白 default 可见', sessionRowVisible({ id: 'cur', blank: true }, 'cur', archived, 'default'), true)
  check('keepBlank=false 剔除当前空白', sessionVisible({ id: 'cur', blank: true }, 'cur', archived, 'default', false), false)
  check('normalizeArchivedFilter 归一', [
    normalizeArchivedFilter('show'),
    normalizeArchivedFilter('only'),
    normalizeArchivedFilter('junk'),
    normalizeArchivedFilter(undefined),
  ], ['show', 'only', 'default', 'default'])
}

// ---- B② reconcileOrder ------------------------------------------------------

console.log('--- B② reconcileOrder:存档序 / 置顶 / 归档沉底 / fork 紧随其源 ---')
{
  const byId = { x: { id: 'x', updatedAt: 3 }, y: { id: 'y', updatedAt: 2 }, z: { id: 'z', updatedAt: 1 } }
  check('存档序保留 + 置顶前置 + 其余按最近更新',
    reconcileOrder(['x', 'y', 'z'], ['z'], byId, { pinnedSessionIds: ['y'] }), ['y', 'z', 'x'])
  check('归档的置顶行不前前置,且沉底',
    reconcileOrder(['x', 'y', 'z'], ['z'], byId, { pinnedSessionIds: ['y'], archivedSessionIds: ['y'] }), ['z', 'x', 'y'])
  check('rowState 缺席 → 纯最近更新', reconcileOrder(['z', 'x', 'y'], undefined, byId), ['x', 'y', 'z'])
  check('存档里已含的置顶不重复前置',
    reconcileOrder(['x', 'y'], ['y'], byId, { pinnedSessionIds: ['y'] }), ['y', 'x'])
}
{
  const byId = {
    q: { id: 'q', updatedAt: 3 },
    p: { id: 'p', updatedAt: 2 },
    f: { id: 'f', updatedAt: 1, parentId: 'p' },
  }
  check('新增 fork 紧随其源之前', reconcileOrder(['q', 'p', 'f'], undefined, byId), ['q', 'f', 'p'])
}

// ---- B④ 缺摘要成员剔除(上游 orderByRecency 语义) ---------------------------

console.log('--- B④ 缺摘要成员不参与定序(上游 orderByRecency 丢弃;否则 placeFork 误判) ---')
{
  const byId = { a: { id: 'a', updatedAt: 3 }, b: { id: 'b', updatedAt: 1 } }
  check('recencyOrder 剔除缺摘要 id', recencyOrder(['a', 'ghost', 'b'], byId), ['a', 'b'])
  check('recencyOrder 全缺摘要 → 空', recencyOrder(['ghost'], byId), [])
  check('reconcileOrder rest 剔除缺摘要 id', reconcileOrder(['a', 'ghost', 'b'], undefined, byId), ['a', 'b'])
  check('存档序里的缺摘要成员仍保留相对位置(与上游一致)',
    reconcileOrder(['a', 'ghost'], ['ghost'], byId), ['ghost', 'a'])
}
{
  // 上游对照反例(verifier §1.3):P 是 workspace 成员但快照缺摘要,且 X 是 P 的 fork。
  // 若保留 P,result.includes('P') 为真 → placeFork(X) 成功 → X 被搬到 B 之后(与上游可见偏离)。
  const noSummaryParent = {
    A: { id: 'A', updatedAt: 100 },
    X: { id: 'X', updatedAt: 50, parentId: 'P' },
    B: { id: 'B', updatedAt: 10 },
  }
  check('P 无摘要 → 不重定位 fork X(对齐上游 ["A","X","B"])',
    reconcileOrder(['A', 'X', 'B', 'P'], undefined, noSummaryParent), ['A', 'X', 'B'])
  const withSummaryParent = {
    A: { id: 'A', updatedAt: 100 },
    X: { id: 'X', updatedAt: 50, parentId: 'P' },
    B: { id: 'B', updatedAt: 10 },
    P: { id: 'P', updatedAt: 5 },
  }
  check('P 有摘要 → 照常重定位 fork X(对齐上游 ["A","B","X","P"])',
    reconcileOrder(['A', 'X', 'B', 'P'], undefined, withSummaryParent), ['A', 'B', 'X', 'P'])
}

// ---- B③ sectionMembers / pinCurrentBlank ------------------------------------

console.log('--- B③ sectionMembers 分区 + pinCurrentBlank ---')
{
  const blank = { id: 'b0', blank: true }
  const pinned = { id: 'p1' }
  const normal = { id: 'n1' }
  const archivedPinned = { id: 'p2' }
  check('blank → 置顶 → 其余',
    sectionMembers([normal, pinned, archivedPinned, blank], new Set(['p1', 'p2']), new Set(['p2'])).map((m) => m.id),
    ['b0', 'p1', 'n1', 'p2'])
  check('pinCurrentBlank 顶前', pinCurrentBlank(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
  check('pinCurrentBlank 缺席时复制', pinCurrentBlank(['a'], undefined), ['a'])
}

// ---- C. sidebarOrderedSessionIds 端到端 -------------------------------------

console.log('--- C① 侧栏顺序:workspace 模式 × 归档筛选 ---')

const T = 1_000_000
const byId = {
  a: { id: 'a', updatedAt: T - 100 },
  b: { id: 'b', updatedAt: T - 200 },
  c: { id: 'c', updatedAt: T - 300 },
  arch: { id: 'arch', updatedAt: T - 400 },
  stray: { id: 'stray', updatedAt: T - 500 },
}
const list = { ids: ['a', 'b', 'c', 'arch', 'stray'], byId }

/** 空的视图 store 座(带 store handle 的注册项)。 */
class SlotSeat {
  constructor(view) {
    this.view = view
  }
  entries(key) {
    return key === 'sidebar.workspaces' ? [{ store: { spec: { persist: 'dsh.workspace.view.v5' } } }] : []
  }
  resolveStore(handle, scope) {
    if (scope !== undefined) throw new Error('root 作用域不应传 binding')
    return { getSnapshot: () => this.view }
  }
}
class Workspaces {
  constructor(pinned = ['c'], archived = ['arch']) {
    this.pinned = pinned
    this.archived = archived
  }
  list = {
    getSnapshot: () => ({
      items: [{ workspaceId: 'w1', path: '/w1', title: 'w1', sessionIds: ['a', 'b', 'c', 'arch'] }],
      archivedSessionIds: this.archived,
      pinnedSessionIds: this.pinned,
      phase: 'ready',
    }),
  }
}
class UiSession {
  get current() {
    return { getSnapshot: () => ({ key: 'a' }) }
  }
}
const env = (view, workspaces = new Workspaces(), slots = new SlotSeat(view)) => ({
  slots,
  workspaces,
  sessions: { list: { getSnapshot: () => list } },
  uiSession: new UiSession(),
})

check('default:归档隐藏,置顶 c 提到列首',
  sidebarOrderedSessionIds(list, env({ groupBy: 'workspace', orderBy: 'updated', archivedFilter: 'default' })),
  ['c', 'a', 'b', 'stray'])
check('show:归档一并可见(未分区沉底)',
  sidebarOrderedSessionIds(list, env({ groupBy: 'workspace', orderBy: 'updated', archivedFilter: 'show' })),
  ['c', 'a', 'b', 'arch', 'stray'])
check('only:仅归档可见',
  sidebarOrderedSessionIds(list, env({ groupBy: 'workspace', orderBy: 'updated', archivedFilter: 'only' })),
  ['arch'])
check('archivedFilter 缺席 → 按 default',
  sidebarOrderedSessionIds(list, env({ groupBy: 'workspace', orderBy: 'updated' })),
  ['c', 'a', 'b', 'stray'])

console.log('--- C② 侧栏顺序:manual 对账 / flat 模式 / 降级 ---')
check('manual:账号序保留(置顶已在前,不再重复前置)',
  sidebarOrderedSessionIds(list, env({
    groupBy: 'workspace',
    orderBy: 'manual',
    archivedFilter: 'default',
    sessionOrderByAccount: { w1: ['b', 'a', 'c', 'arch'], '': ['stray'] },
  })),
  ['c', 'b', 'a', 'stray'])
check('flat:成员含归档(上游 sessionMemberIds),default 过滤后置顶列首',
  sidebarOrderedSessionIds(list, env({ groupBy: 'flat', orderBy: 'updated', archivedFilter: 'default' })),
  ['c', 'a', 'b', 'stray'])
check('flat + show:归档沉底',
  sidebarOrderedSessionIds(list, env({ groupBy: 'flat', orderBy: 'updated', archivedFilter: 'show' })),
  ['c', 'a', 'b', 'arch', 'stray'])
check('视图 store 不可读 → 空轴',
  sidebarOrderedSessionIds(list, { sessions: { list: { getSnapshot: () => list } }, uiSession: new UiSession() }),
  [])
check('groupBy 未知 → 空轴',
  sidebarOrderedSessionIds(list, env({ groupBy: 'unknown' })), [])
check('子代理行不进入轴', sidebarOrderedSessionIds(
  { ids: [...list.ids, 'sub'], byId: { ...byId, sub: { id: 'sub', origin: 'subagent', parentId: 'a', updatedAt: T } } },
  env({ groupBy: 'flat', orderBy: 'updated', archivedFilter: 'show' }),
).includes('sub'), false)

console.log('--- C③ 浮窗打开归档会话 → 与上游 guardedOpen 同款拒绝 ---')
{
  const services = env({ groupBy: 'flat', orderBy: 'updated', archivedFilter: 'show' })
  services.uiWorkspace = { openSession() { this.opened = (this.opened ?? 0) + 1 } }
  check('openRecentSession(归档) → false 且不调用 openSession', openRecentSession(services, 'arch'), false)
  check('openRecentSession(普通) → true 且调用一次', openRecentSession(services, 'a'), true)
  check('openSession 只被调用一次', services.uiWorkspace.opened, 1)
}

console.log('--- C④ 近期对话浮窗:归档会话恒不列出(不跟随侧栏 archivedFilter) ---')
for (const archivedFilter of ['default', 'show', 'only']) {
  const rows = recentSessionsView(env({ groupBy: 'flat', orderBy: 'updated', archivedFilter }))
    .rows.map((row) => row.sessionId)
  check(`recent(archivedFilter=${archivedFilter}):不含归档行`, rows.includes('arch'), false)
  check(`recent(archivedFilter=${archivedFilter}):普通行仍列出`, rows.includes('b'), true)
}

console.log(failures === 0 ? '\nall order probes passed' : `\n${failures} probe(s) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
