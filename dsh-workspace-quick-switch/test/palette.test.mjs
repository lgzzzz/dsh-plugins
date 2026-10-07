/**
 * 纯状态层:候选投影(前 10 个、顺序、当前标记)、下标收敛与环状步进,以及 store 的
 * 写入/通知行为。不碰 React、不碰 DOM。
 *
 * 运行:`node test/palette.test.mjs`(或 pnpm test 跑全部)。
 */
import { createPaletteStore, inRange, clampIndex, moveIndex, paletteEntries, QUICK_SWITCH_ID, WORKSPACE_LIMIT } from '../src/palette.ts'
import { check, checkTrue, checkUndefined, finish, workspace } from './helpers.mjs'

console.log('--- A① 候选投影:前 10 个、顺序照抄、当前工作区打标 ---')
{
  const many = Array.from({ length: 14 }, (_, index) => workspace(`ws-${index + 1}`, `工作区 ${index + 1}`))
  const entries = paletteEntries(many, 'ws-3')
  check('默认只取前 10 个', entries.length, WORKSPACE_LIMIT)
  check('顺序就是传进来的顺序', entries.map((entry) => entry.workspaceId), [
    'ws-1', 'ws-2', 'ws-3', 'ws-4', 'ws-5', 'ws-6', 'ws-7', 'ws-8', 'ws-9', 'ws-10',
  ])
  check('当前工作区打标', entries.filter((entry) => entry.current === true).map((entry) => entry.workspaceId), ['ws-3'])
  check('路径与标题透传', [entries[0].title, entries[0].path], ['工作区 1', '/projects/ws-1'])

  check('limit 可调', paletteEntries(many, undefined, 3).length, 3)
  check('limit=0 不出候选', paletteEntries(many, undefined, 0).length, 0)
  check('空输入空输出', paletteEntries([], 'ws-1'), [])
}

console.log('--- A② 没有当前会话 / 当前工作区不在前 10 个 ---')
{
  const workspaces = [workspace('ws-1', 'A'), workspace('ws-2', 'B')]
  check('没有当前会话就没有标记', paletteEntries(workspaces, undefined).every((entry) => entry.current !== true), true)
  check('空 activeId 不匹配', paletteEntries(workspaces, '').some((entry) => entry.current === true), false)
  check('当前工作区不在候选里就没有标记', paletteEntries(workspaces, 'ws-99').some((entry) => entry.current === true), false)

  const many = Array.from({ length: 12 }, (_, index) => workspace(`ws-${index + 1}`, `W${index + 1}`))
  const entries = paletteEntries(many, 'ws-12')
  check('第 12 个不在前 10 个候选里', entries.some((entry) => entry.current === true), false)
  checkUndefined('标记字段不是 false 而是缺席', entries[0].current)
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

check('固定行 id 是插件命名空间下的', QUICK_SWITCH_ID.startsWith('dsh-workspace-quick-switch.'), true)

finish()
