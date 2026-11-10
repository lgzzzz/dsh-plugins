/**
 * 纯状态层:候选投影(前 10 个、顺序、当前标记)、下标收敛与环状步进,以及 store 的
 * 写入/通知行为。不碰 React、不碰 DOM。
 *
 * 运行:`node test/palette.test.mjs`(或 pnpm test 跑全部)。
 */
import {
  clampIndex,
  clampOffset,
  createPaletteStore,
  inRange,
  maxOffset,
  PAGE_SIZE,
  paletteEntries,
  QUICK_SWITCH_ID,
  revealOffset,
  SESSION_SWITCH_ID,
  slideOffset,
  stepIndex,
  windowSlice,
} from '../src/palette.ts'
import { check, checkTrue, checkUndefined, finish, workspace } from './helpers.mjs'

console.log('--- A① 候选投影:全量、顺序照抄、当前工作区打标 ---')
{
  const many = Array.from({ length: 14 }, (_, index) => workspace(`ws-${index + 1}`, `工作区 ${index + 1}`))
  const entries = paletteEntries(many, 'ws-3')
  // 候选保留完整长度:截成「前 10 个」会让第 11 个之后的工作区永远翻不到。
  check('投影保留全部工作区', entries.length, 14)
  check('顺序就是传进来的顺序', entries.slice(0, 10).map((entry) => entry.key), [
    'ws-1', 'ws-2', 'ws-3', 'ws-4', 'ws-5', 'ws-6', 'ws-7', 'ws-8', 'ws-9', 'ws-10',
  ])
  check('第 11 个之后也在候选里', entries.slice(10).map((entry) => entry.key), ['ws-11', 'ws-12', 'ws-13', 'ws-14'])
  check('当前工作区打标', entries.filter((entry) => entry.current === true).map((entry) => entry.key), ['ws-3'])
  check('路径与标题透传', [entries[0].title, entries[0].subtitle], ['工作区 1', '/projects/ws-1'])
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
  check('第 12 个(第二页)带「当前」', entries.filter((entry) => entry.current === true).map((entry) => entry.key), ['ws-12'])
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

console.log('--- A④ 选中行步进:到两端停住 ---')
{
  check('空候选不动', stepIndex(0, 1, 0), -1)
  check('单成员原地', stepIndex(0, 1, 1), 0)
  check('前进', stepIndex(0, 1, 3), 1)
  check('末尾前进停住(不环状)', stepIndex(2, 1, 3), 2)
  check('开头后退停住(不环状)', stepIndex(0, -1, 3), 0)
  check('越界下标先收敛', stepIndex(9, 1, 3), 2)
  check('一次走多步', stepIndex(0, 3, 10), 3)
}

console.log('--- A④ᵃ 窗口:最大起点、收敛、按行滑动 ---')
{
  // 25 个候选、一屏 10 行:起点可以停在 0~15(最后一行贴底)。
  check('比一屏多 15 个,最大起点 15', maxOffset(25), 15)
  check('正好一屏时起点只有 0', maxOffset(10), 0)
  check('不足一屏时起点只有 0', maxOffset(4), 0)
  check('11 个候选最大起点 1(显示 2–11)', maxOffset(11), 1)
  check('没有候选时最大起点 0', maxOffset(0), 0)
  check('页大小为 0 时最大起点 0', maxOffset(25, 0), 0)

  check('非整数起点归 0', clampOffset(1.5, 25), 0)
  check('负起点归 0', clampOffset(-3, 25), 0)
  check('越界起点收到最大值', clampOffset(99, 25), 15)
  check('没有候选时起点固定 0', clampOffset(3, 0), 0)

  check('往下滑一行', slideOffset(0, 1, 25), 1)
  check('1–10 → 2–11 就是滑一行', slideOffset(0, 1, 11), 1)
  check('滑到尽头停住', slideOffset(15, 5, 25), 15)
  check('往上滑一行', slideOffset(3, -1, 25), 2)
  check('滑到顶停住', slideOffset(0, -2, 25), 0)
  check('滑一整屏(←/→ 用)', slideOffset(0, PAGE_SIZE, 25), 10)
  check('滑一整屏到尽头贴底', slideOffset(10, PAGE_SIZE, 25), 15)

  check('已可见就不动', revealOffset(0, 5, 25), 0)
  check('选中行在上方:滑到它贴顶', revealOffset(10, 4, 25), 4)
  check('选中行在下方:滑到它贴底', revealOffset(0, 12, 25), 3)
  check('窗口末尾不足一屏时贴底', revealOffset(13, 24, 25), 15)
  check('没有选中行时不动', revealOffset(5, -1, 25), 5)

  const rows = Array.from({ length: 25 }, (_, index) => `r${index}`)
  check('一屏 10 行', windowSlice(rows, 0).length, 10)
  check('起点 1 时显示 r1..r10(即 2–11)', windowSlice(rows, 1).slice(0, 2), ['r1', 'r2'])
  check('末尾切片只剩余数', windowSlice(rows, 15), rows.slice(15))
  check('越界起点按最大起点切片', windowSlice(rows, 99)[0], 'r15')
  check('没有候选时切片为空', windowSlice([], 0), [])
}

console.log('--- A⑤ store:写入、收敛与批量通知 ---')
{
  const store = createPaletteStore()
  const seen = []
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))
  const initial = store.getSnapshot()
  check('初始关闭且无候选', [initial.open, initial.entries.length, initial.activeIndex, initial.binding], [false, 0, -1, null])
  checkTrue('getSnapshot 引用稳定', store.getSnapshot() === initial)

  store.sync([{ key: 'ws-1', title: 'A', subtitle: '/a' }, { key: 'ws-2', title: 'B', subtitle: '/b' }])
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

  store.sync([{ key: 'ws-9', title: 'Z', subtitle: '/z' }])
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
  store.sync([1, 2, 3].map((index) => ({ key: `ws-${index}`, title: `W${index}`, subtitle: `/w${index}` })))
  store.open(() => {}, 2)
  check('落在指定行', store.getSnapshot().activeIndex, 2)
  store.open(() => {}, 9)
  check('指定行越界则收敛到最后一行', store.getSnapshot().activeIndex, 2)
  store.open(() => {})
  check('不指定则回到第一行', store.getSnapshot().activeIndex, 0)
}

console.log('--- A⑦ store 窗口:连续滑动、两端停住、↑/↓ 不整屏跳 ---')
{
  const many = Array.from({ length: 25 }, (_, index) => ({ key: `ws-${index + 1}`, title: `W${index + 1}`, subtitle: `/w${index + 1}` }))
  const store = createPaletteStore()
  store.sync(many)
  check('候选全量进 store', store.getSnapshot().entries.length, 25)

  store.open(() => {})
  check('打开落在窗口第一行', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 0])

  // 滚轮:按行滑,窗口是连续的。
  store.slide(1)
  check('滚一行:1–10 → 2–11', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [1, 1])
  check('被滑出去的第一行不再选中:选中贴到可见边', store.getSnapshot().activeIndex, store.getSnapshot().offset)
  store.slide(1)
  check('再滚一行:3–12', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [2, 2])

  // ←/→:滑一整屏。
  store.turn(1)
  check('→ 滑一整屏', store.getSnapshot().offset, 12)
  check('滑完选中新窗口第一行', store.getSnapshot().activeIndex, 12)
  store.turn(1)
  check('→ 到尽头贴底', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 15])
  store.turn(1)
  check('最后一屏再 → 停住(不环状)', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 15])
  store.turn(-1)
  check('← 回退一整屏', store.getSnapshot().offset, 5)
  store.turn(-1)
  check('← 再到顶停住', store.getSnapshot().offset, 0)

  // ↑/↓:到两端停住;选中行滑出窗口时窗口只滑到它贴边。
  store.move(1)
  check('↓ 选中下一行', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 1])
  store.select(9)
  check('选中最后一行仍在窗口内', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 9])
  store.move(1)
  check('↓ 越过窗口底边:窗口滑一行,选中行贴底', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [1, 10])
  store.select(0)
  check('选中第一行时窗口滑回顶部(贴边)', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 0])
  store.select(24)
  check('选中末尾:窗口贴底,选中行在最后', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 24])
  store.move(1)
  check('末尾再 ↓ 停住(不环状)', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 24])

  // 打开时指定后面的行:窗口对齐到包含它的那一屏,选中行看得见。
  store.open(() => {}, 13)
  check('打开在第 14 行 → 窗口从第 11 行起', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [10, 13])
  store.open(() => {}, 24)
  check('打开在末尾 → 窗口贴底', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 24])

  // 候选变短到装不下当前行:窗口收敛,选中行回到第一行。
  store.sync(many.slice(0, 3))
  check('候选变短后回到第一行', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 0])

  // 装不满一屏时滑不动。
  store.turn(1)
  check('不足一屏时 → 不动', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 0])
  store.slide(3)
  check('不足一屏时滚轮不动', store.getSnapshot().offset, 0)

  // 空候选。
  store.sync([])
  store.turn(1)
  store.slide(1)
  check('没有候选时滑动不动', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, -1])
}

check('工作区固定行 id 是插件命名空间下的', QUICK_SWITCH_ID.startsWith('dsh-workspace-quick-switch.'), true)
check('会话固定行 id 是插件命名空间下的', SESSION_SWITCH_ID.startsWith('dsh-workspace-quick-switch.'), true)
check('两条固定行 id 不撞车', QUICK_SWITCH_ID === SESSION_SWITCH_ID, false)

finish()
