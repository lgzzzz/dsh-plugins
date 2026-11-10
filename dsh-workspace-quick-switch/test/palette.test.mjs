/**
 * 纯状态层:候选投影(前 10 个、顺序、当前标记)、下标收敛与环状步进,以及 store 的
 * 写入/通知行为。不碰 React、不碰 DOM。
 *
 * 运行:`node test/palette.test.mjs`(或 pnpm test 跑全部)。
 */
import {
  clampIndex,
  clampPage,
  createPaletteStore,
  inRange,
  moveIndex,
  PAGE_SIZE,
  pageCount,
  pageOf,
  pageSlice,
  paletteEntries,
  QUICK_SWITCH_ID,
  turnPage,
} from '../src/palette.ts'
import { check, checkTrue, checkUndefined, finish, workspace } from './helpers.mjs'

console.log('--- A① 候选投影:全量、顺序照抄、当前工作区打标 ---')
{
  const many = Array.from({ length: 14 }, (_, index) => workspace(`ws-${index + 1}`, `工作区 ${index + 1}`))
  const entries = paletteEntries(many, 'ws-3')
  // 候选保留完整长度:截成「前 10 个」会让第 11 个之后的工作区永远翻不到。
  check('投影保留全部工作区', entries.length, 14)
  check('顺序就是传进来的顺序', entries.slice(0, 10).map((entry) => entry.workspaceId), [
    'ws-1', 'ws-2', 'ws-3', 'ws-4', 'ws-5', 'ws-6', 'ws-7', 'ws-8', 'ws-9', 'ws-10',
  ])
  check('第 11 个之后也在候选里', entries.slice(10).map((entry) => entry.workspaceId), ['ws-11', 'ws-12', 'ws-13', 'ws-14'])
  check('当前工作区打标', entries.filter((entry) => entry.current === true).map((entry) => entry.workspaceId), ['ws-3'])
  check('路径与标题透传', [entries[0].title, entries[0].path], ['工作区 1', '/projects/ws-1'])
  check('空输入空输出', paletteEntries([], 'ws-1'), [])
  check('一页 10 行', PAGE_SIZE, 10)
}

console.log('--- A② 没有当前会话 / 当前工作区不在列表里 ---')
{
  const workspaces = [workspace('ws-1', 'A'), workspace('ws-2', 'B')]
  check('没有当前会话就没有标记', paletteEntries(workspaces, undefined).every((entry) => entry.current !== true), true)
  check('空 activeId 不匹配', paletteEntries(workspaces, '').some((entry) => entry.current === true), false)
  check('当前工作区不在候选里就没有标记', paletteEntries(workspaces, 'ws-99').some((entry) => entry.current === true), false)

  const many = Array.from({ length: 12 }, (_, index) => workspace(`ws-${index + 1}`, `W${index + 1}`))
  const entries = paletteEntries(many, 'ws-12')
  check('第 12 个工作区同样在候选里', entries.length, 12)
  check('第 12 个(第二页)带「当前」', entries.filter((entry) => entry.current === true).map((entry) => entry.workspaceId), ['ws-12'])
  checkUndefined('没打标的行不是 false 而是缺席', entries[0].current)
}

console.log('--- A③ 下标收敛 ---')
{
  checkTrue('0 在 [0,3) 内', inRange(0, 3))
  checkTrue('2 在 [0,3) 内', inRange(2, 3))
  check('3 不在 [0,3) 内', inRange(3, 3), false)
  check('-1 不在 [0,3) 内', inRange(-1, 3), false)
  check('空候选固定 -1', clampIndex(5, 0), -1)
  check('负数收敛到 0', clampIndex(-4, 3), 0)
  check('越上界收敛到最后一个', clampIndex(9, 3), 2)
  check('非整数收敛到 0', clampIndex(1.5, 3), 0)
}

console.log('--- A④ 环状步进 ---')
{
  check('空候选不动', moveIndex(0, 1, 0), -1)
  check('单成员原地', moveIndex(0, 1, 1), 0)
  check('前进', moveIndex(0, 1, 3), 1)
  check('末尾前进绕回开头', moveIndex(2, 1, 3), 0)
  check('开头后退绕到末尾', moveIndex(0, -1, 3), 2)
  check('越界下标先收敛', moveIndex(9, 1, 3), 0)
}

console.log('--- A④ᵇ 分页:页数、收敛、环状翻页、切片 ---')
{
  check('没有候选就没有页', pageCount(0), 0)
  check('9 个一行仍是一页', pageCount(9), 1)
  check('10 个正好一页', pageCount(10), 1)
  check('11 个两页', pageCount(11), 2)
  check('20 个两页', pageCount(20), 2)
  check('21 个三页', pageCount(21), 3)
  check('页大小为 0 时没有页', pageCount(5, 0), 0)

  check('非整数页号归 0', clampPage(1.5, 25), 0)
  check('负页号归 0', clampPage(-3, 25), 0)
  check('越界页号收到最后一页', clampPage(9, 25), 2)
  check('没有候选时页号固定 0', clampPage(2, 0), 0)

  check('单页翻不动', turnPage(0, 1, 10), 0)
  check('前进一页', turnPage(0, 1, 25), 1)
  check('最后一页前进绕回第一页', turnPage(2, 1, 25), 0)
  check('第一页后退绕到最后一页', turnPage(0, -1, 25), 2)
  check('越界页号先收敛', turnPage(9, 1, 25), 0)

  check('第 0 行在第 0 页', pageOf(0), 0)
  check('第 9 行仍在第 0 页', pageOf(9), 0)
  check('第 10 行在第 1 页', pageOf(10), 1)
  check('第 24 行在第 2 页', pageOf(24), 2)
  check('负下标归第 0 页', pageOf(-1), 0)

  const rows = Array.from({ length: 25 }, (_, index) => `r${index}`)
  check('第一页切片', pageSlice(rows, 0).slice(0, 3), ['r0', 'r1', 'r2'])
  check('第一页长度', pageSlice(rows, 0).length, 10)
  check('最后一页只剩余数', pageSlice(rows, 2), ['r20', 'r21', 'r22', 'r23', 'r24'])
  check('越界页号按最后一页切片', pageSlice(rows, 9).length, 5)
  check('没有候选时切片为空', pageSlice([], 0), [])
}

console.log('--- A⑤ store:写入、收敛与批量通知 ---')
{
  const store = createPaletteStore()
  const seen = []
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))
  const initial = store.getSnapshot()
  check('初始关闭且无候选', [initial.open, initial.entries.length, initial.activeIndex, initial.binding], [false, 0, -1, null])
  checkTrue('getSnapshot 引用稳定', store.getSnapshot() === initial)

  store.sync([{ workspaceId: 'ws-1', title: 'A', path: '/a' }, { workspaceId: 'ws-2', title: 'B', path: '/b' }])
  let action = 0
  store.open(() => { action += 1 })
  store.move(1)
  await Promise.resolve()
  check('两拍合并成一次通知', seen.length, 1)
  check('读到的是最后一次写入(第 1 行 → 第 2 行)', seen[0].activeIndex, 1)

  store.select(1)
  await Promise.resolve()
  check('选中第 2 行', store.getSnapshot().activeIndex, 1)
  store.select(9)
  await Promise.resolve()
  check('越界选择收敛到最后一行', store.getSnapshot().activeIndex, 1)

  store.close()
  await Promise.resolve()
  check('关闭清掉动作', [store.getSnapshot().open, store.getSnapshot().binding], [false, null])

  store.sync([{ workspaceId: 'ws-9', title: 'Z', path: '/z' }])
  store.open(() => { action += 1 })
  await Promise.resolve()
  check('重新打开落在第一行', store.getSnapshot().activeIndex, 0)
  check('动作由容器接上', store.getSnapshot().binding !== null, true)
  store.sync([])
  await Promise.resolve()
  check('候选清空后下标为 -1', store.getSnapshot().activeIndex, -1)

  unsubscribe()
}

console.log('--- A⑥ store.open 可以指定初始行 ---')
{
  const store = createPaletteStore()
  store.sync([1, 2, 3].map((index) => ({ workspaceId: `ws-${index}`, title: `W${index}`, path: `/w${index}` })))
  store.open(() => {}, 2)
  check('落在指定行', store.getSnapshot().activeIndex, 2)
  store.open(() => {}, 9)
  check('指定行越界则收敛到最后一行', store.getSnapshot().activeIndex, 2)
  store.open(() => {})
  check('不指定则回到第一行', store.getSnapshot().activeIndex, 0)
}

console.log('--- A⑦ store 分页:翻页、跨页移动、页跟随选中行 ---')
{
  const many = Array.from({ length: 25 }, (_, index) => ({ workspaceId: `ws-${index + 1}`, title: `W${index + 1}`, path: `/w${index + 1}` }))
  const store = createPaletteStore()
  store.sync(many)
  check('候选全量进 store', store.getSnapshot().entries.length, 25)

  store.open(() => {})
  check('打开落在第一页第一行', [store.getSnapshot().page, store.getSnapshot().activeIndex], [0, 0])

  store.turn(1)
  check('→ 翻到第二页,选中行落在本页第一行', [store.getSnapshot().page, store.getSnapshot().activeIndex], [1, 10])
  store.turn(1)
  check('→ 再翻到第三页', [store.getSnapshot().page, store.getSnapshot().activeIndex], [2, 20])
  store.turn(1)
  check('最后一页再 → 绕回第一页', [store.getSnapshot().page, store.getSnapshot().activeIndex], [0, 0])
  store.turn(-1)
  check('第一页 ← 绕到最后一页', [store.getSnapshot().page, store.getSnapshot().activeIndex], [2, 20])

  // 跨页移动:选中行永远留在当前页里。
  store.move(1)
  check('最后一页继续 ↓ 落在本页下一行', [store.getSnapshot().page, store.getSnapshot().activeIndex], [2, 21])
  store.select(24)
  store.move(1)
  check('整个列表最后一行再 ↓ 才绕回第一页第一行', [store.getSnapshot().page, store.getSnapshot().activeIndex], [0, 0])
  store.select(9)
  check('选到第一页最后一行仍在第一页', store.getSnapshot().page, 0)
  store.move(1)
  check('再 ↓ 跨到第二页第一行', [store.getSnapshot().page, store.getSnapshot().activeIndex], [1, 10])
  store.select(20)
  check('直接选中第三页的行,页跟着走', [store.getSnapshot().page, store.getSnapshot().activeIndex], [2, 20])

  // 打开时指定后面的行:页也要跟上,否则「选中了却看不见」。
  store.open(() => {}, 13)
  check('打开在第 14 行 → 第二页', [store.getSnapshot().page, store.getSnapshot().activeIndex], [1, 13])

  // 候选变短到装不下当前行:下标回到第一行,页回到第一页。
  store.sync(many.slice(0, 3))
  check('候选变短后回到第一页第一行', [store.getSnapshot().page, store.getSnapshot().activeIndex], [0, 0])

  // 单页时翻页不动。
  store.turn(1)
  check('单页时 → 不动', [store.getSnapshot().page, store.getSnapshot().activeIndex], [0, 0])

  // 空候选。
  store.sync([])
  store.turn(1)
  check('没有候选时翻页不动', [store.getSnapshot().page, store.getSnapshot().activeIndex], [0, -1])
}

check('固定行 id 是插件命名空间下的', QUICK_SWITCH_ID.startsWith('dsh-workspace-quick-switch.'), true)

finish()
