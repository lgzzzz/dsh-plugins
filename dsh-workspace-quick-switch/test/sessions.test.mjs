/**
 * 会话候选投影:顺序必须与左侧栏「单列表(groupBy=flat)+ 最近更新(orderBy=updated)+
 * 隐藏已归档(archivedFilter=default)」完全一致。
 *
 * 上游那条派生链(ui-workspace 的 `sessionMemberIds` → `orderByRecency` →
 * `pinCurrentBlank` → `deriveFlat` / `sectionMembers`)在这里逐条对应:成员筛选、排序、
 * 空白会话提前、归档隐藏、置顶前置。纯函数,不碰 React、不碰 DOM、也不读服务。
 *
 * 运行:`node test/sessions.test.mjs`(或 pnpm test 跑全部)。
 */
import { currentRowIndex } from '../src/palette.ts'
import {
  BLANK_SESSION_TITLE,
  PINNED_BADGE,
  RUNNING_BADGE,
  UNTITLED_SESSION_TITLE,
  flatMembers,
  mainViewSessionId,
  orderByRecency,
  pathBasename,
  pinCurrentBlank,
  relativeTimeLabel,
  sectionMembers,
  sessionDisplayTitle,
  sessionPaletteEntries,
  workspaceLabel,
} from '../src/sessions.ts'
import { check, checkTrue, checkUndefined, finish } from './helpers.mjs'

/** 造一条会话摘要。 */
function session(id, updatedAt, extra = {}) {
  return { id, title: `S-${id}`, updatedAt, ...extra }
}

/** 造一份会话目录(`byId` 按 `ids` 建)。 */
function catalog(rows, current) {
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
  if (current !== undefined) byId[current] = { ...byId[current], retainedBy: { mainView: 1 } }
  return { ids: rows.map((row) => row.id), byId }
}

/** 一次投影的候选标题(测试里最常断言的东西)。 */
function titles(entries) {
  return entries.map((entry) => entry.title)
}

console.log('--- S① 成员筛选:单列表口径 ---')
{
  const list = catalog([
    session('a', 300),
    session('sub', 400, { origin: 'subagent' }),
    session('blank-old', 900, { blank: true }),
    session('blank-current', 100, { blank: true }),
    session('b', 200),
  ], 'blank-current')
  check('主视图会话按 retainedBy.mainView 认出', mainViewSessionId(list), 'blank-current')
  check('subagent 子会话排除、空白会话只留当前那个', flatMembers(list, 'blank-current').map((row) => row.id), ['a', 'blank-current', 'b'])
  check('没有主视图会话时不留任何空白会话', flatMembers(list, undefined).map((row) => row.id), ['a', 'b'])
}

console.log('--- S② 最近更新:updatedAt 倒序、同刻按 id 升序 ---')
{
  const rows = [session('b', 100), session('a', 100), session('c', 300), session('d', 200)]
  check('按更新时间倒序,同刻按 id 升序', orderByRecency(rows).map((row) => row.id), ['c', 'd', 'a', 'b'])
  check('不改入参', rows.map((row) => row.id), ['b', 'a', 'c', 'd'])
}

console.log('--- S③ 当前空白会话提到最前 ---')
{
  const rows = [session('a', 300), session('blank', 100, { blank: true }), session('b', 200)]
  check('空白会话在候选里时提到最前', pinCurrentBlank(rows, 'blank').map((row) => row.id), ['blank', 'a', 'b'])
  check('当前会话不是空白时不动', pinCurrentBlank(rows, 'a').map((row) => row.id), ['a', 'blank', 'b'])
  check('当前会话不在候选里时不动', pinCurrentBlank(rows, 'zzz').map((row) => row.id), ['a', 'blank', 'b'])
  check('没有当前会话时原样复制', pinCurrentBlank(rows, undefined).map((row) => row.id), ['a', 'blank', 'b'])
}

console.log('--- S④ 分段渲染:空白 → 置顶 → 其余 ---')
{
  const rows = [session('a', 300), session('p1', 100), session('blank', 200, { blank: true }), session('p2', 50)]
  const pinned = new Set(['p1', 'p2'])
  check(
    '空白在最前、置顶次之、其余最后',
    sectionMembers(rows, pinned, new Set()).map((row) => row.id),
    ['blank', 'p1', 'p2', 'a'],
  )
  check(
    '已归档的置顶会话不算置顶行(回到其余)',
    sectionMembers(rows, pinned, new Set(['p1'])).map((row) => row.id),
    ['blank', 'p2', 'a', 'p1'],
  )
  check('三个分区内部保持传入顺序', sectionMembers(rows, new Set(), new Set()).map((row) => row.id), ['blank', 'a', 'p1', 'p2'])
}

console.log('--- S⑤ 端到端投影 = 左侧栏那个筛选组合 ---')
{
  // 目录顺序(新建在前)与「最近更新」顺序刻意不同,且混进了 subagent / 旧空白 / 归档 / 置顶。
  const rows = [
    session('newest', 900),
    session('archived-new', 800, { title: '已归档但很新' }),
    session('sub', 950, { origin: 'subagent' }),
    session('blank-old', 700, { blank: true }),
    session('pinned', 100),
    session('blank-current', 50, { blank: true }),
    session('middle', 500),
  ]
  const list = catalog(rows, 'blank-current')
  const workspaces = [
    { workspaceId: 'w1', title: 'Alpha', path: '/p/alpha', sessionIds: ['pinned', 'middle'] },
    { workspaceId: 'w2', title: 'Beta', path: '/p/beta', sessionIds: ['newest', 'archived-new', 'sub'] },
  ]
  const entries = sessionPaletteEntries({
    sessions: list,
    workspaces,
    rowState: { archivedSessionIds: ['archived-new'], pinnedSessionIds: ['pinned'] },
  }, 1_000)
  check(
    '空白在最前,置顶其次,其余按最近更新;subagent 与归档都不在候选里',
    entries.map((entry) => entry.key),
    ['blank-current', 'pinned', 'newest', 'middle'],
  )
  check('空白会话显示「新会话」', entries[0].title, BLANK_SESSION_TITLE)
  checkTrue('空白会话标成当前', entries[0].current === true)
  checkUndefined('只有当前会话带 current', entries[0].current === true && entries[1].current)

  // 第二行是「工作区 · 相对时间」,角标是置顶 / 进行中。
  check('第二行拼上工作区与相对时间', entries[2].subtitle, 'Beta · 刚刚')
  check('置顶角标', entries[1].badges, [PINNED_BADGE])
  const running = sessionPaletteEntries({
    sessions: catalog([session('r', 10, { running: true })]),
    workspaces: [],
    rowState: { pinnedSessionIds: ['r'] },
  }, 20)
  check('置顶 + 进行中两个角标按顺序', running[0].badges, [PINNED_BADGE, RUNNING_BADGE])
  check('没有工作区归属时退回 cwd 末段', running[0].workspace, '')
  check('归属与时间都缺席时第二行是空串', running[0].subtitle, '刚刚')
}

console.log('--- S⑥ 显示标题与归属标签 ---')
{
  check('空白会话', sessionDisplayTitle({ id: 'x', updatedAt: 0, blank: true }), BLANK_SESSION_TITLE)
  check('没有标题', sessionDisplayTitle({ id: 'x', updatedAt: 0 }), UNTITLED_SESSION_TITLE)
  check('只有空白字符也算没有标题', sessionDisplayTitle({ id: 'x', updatedAt: 0, title: '   ' }), UNTITLED_SESSION_TITLE)
  check('有标题就用标题', sessionDisplayTitle({ id: 'x', updatedAt: 0, title: '  重构排序  ' }), '重构排序')

  const workspaces = [
    { workspaceId: 'w1', title: 'Alpha', path: '/p/alpha', sessionIds: ['s1'] },
  ]
  check('按账下会话找到工作区', workspaceLabel(workspaces, { id: 's1', updatedAt: 0 }), 'Alpha')
  check('不属于任何工作区时退回 cwd 末段', workspaceLabel(workspaces, { id: 's2', updatedAt: 0, cwd: '/Users/lz/dsh-plugins' }), 'dsh-plugins')
  check('Windows 路径也取末段', pathBasename('C:\\Users\\lz\\proj\\'), 'proj')
  check('没有 cwd 时为空串', workspaceLabel(workspaces, { id: 's2', updatedAt: 0 }), '')
}

console.log('--- S⑦ 相对时间与初始选中行 ---')
{
  const now = 1_000_000_000_000
  check('一分钟内是刚刚', relativeTimeLabel(now - 1_000, now), '刚刚')
  check('分钟', relativeTimeLabel(now - 3 * 60_000, now), '3分钟前')
  check('小时', relativeTimeLabel(now - 5 * 3_600_000, now), '5小时前')
  check('天', relativeTimeLabel(now - 3 * 86_400_000, now), '3天前')
  check('月', relativeTimeLabel(now - 70 * 86_400_000, now), '2个月前')
  check('年', relativeTimeLabel(now - 800 * 86_400_000, now), '2年前')
  check('非法输入给空串', relativeTimeLabel(Number.NaN, now), '')

  const entries = sessionPaletteEntries({
    sessions: catalog([session('a', 300), session('b', 200)], 'b'),
    workspaces: [],
    rowState: {},
  }, now)
  check('当前会话下标', currentRowIndex(entries), 1)
  check('当前会话不在候选里时为 -1', currentRowIndex([]), -1)
  check('没有当前标记时也是 -1', currentRowIndex(entries.filter((entry) => entry.current !== true)), -1)
}

console.log('--- S⑧ 空输入 ---')
{
  check('没有会话', sessionPaletteEntries({ sessions: { ids: [], byId: {} }, workspaces: [], rowState: {} }), [])
  check('目录里有 id 但缺摘要时跳过', sessionPaletteEntries({
    sessions: { ids: ['ghost'], byId: {} },
    workspaces: [],
    rowState: {},
  }), [])
}

finish()
