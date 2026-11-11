/**
 * 纯状态层与按键规则：窗口滑动、循环绕回、滚轮一格一行、浮层六键、固定行组合的平台展开。
 * 不碰 React、不碰 DOM 服务。
 *
 * 运行：`node test/palette.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  MODEL_SWITCH_BINDING,
  MODEL_SWITCH_ID,
  PAGE_SIZE,
  clampIndex,
  clampOffset,
  createPaletteStore,
  inRange,
  maxOffset,
  modelSwitchKeys,
  modelSwitchPress,
  paletteAction,
  revealOffset,
  slideOffset,
  stepIndex,
  wheelPixels,
  wheelStep,
  windowSlice,
} from '../src/palette.ts'
import { check, checkTrue, checkUndefined, finish } from './helpers.mjs'

console.log('--- A① 固定行:逻辑 primary+alt+U 与按平台展开的键帽 ---')
{
  check('浮层 id', MODEL_SWITCH_ID, 'dsh-model-quick-switch.model-switch')
  check('逻辑组合是 primary+alt+U', [MODEL_SWITCH_BINDING.code, MODEL_SWITCH_BINDING.modifiers], ['KeyU', ['primary', 'alt']])
  check('macOS 键帽是 ⌘⌥U', modelSwitchKeys('macos'), ['⌘', '⌥', 'U'])
  check('Windows 键帽是 Ctrl+Alt+U', modelSwitchKeys('windows'), ['Ctrl', 'Alt', 'U'])
  check('Linux 键帽是 Ctrl+Alt+U', modelSwitchKeys('linux'), ['Ctrl', 'Alt', 'U'])

  checkTrue('macOS 认 ⌘⌥U', modelSwitchPress('macos', { code: 'KeyU', meta: true, alt: true }))
  check('macOS 不认 Ctrl+Alt+U', modelSwitchPress('macos', { code: 'KeyU', control: true, alt: true }), false)
  checkTrue('Windows 认 Ctrl+Alt+U', modelSwitchPress('windows', { code: 'KeyU', control: true, alt: true }))
  check('Windows 不认 ⌘⌥U', modelSwitchPress('windows', { code: 'KeyU', meta: true, alt: true }), false)
  checkTrue('Linux 认 Ctrl+Alt+U', modelSwitchPress('linux', { code: 'KeyU', control: true, alt: true }))
  check('多按 Shift 不认', modelSwitchPress('windows', { code: 'KeyU', control: true, alt: true, shift: true }), false)
  check('缺 Alt 不认', modelSwitchPress('windows', { code: 'KeyU', control: true }), false)
  check('按键不对不认', modelSwitchPress('windows', { code: 'KeyM', control: true, alt: true }), false)
  check('不抢工作区的 ⌘⌥M', modelSwitchPress('macos', { code: 'KeyM', meta: true, alt: true }), false)
  check('不抢会话的 ⌘⌥I', modelSwitchPress('macos', { code: 'KeyI', meta: true, alt: true }), false)
}

console.log('--- A② 下标收敛与步进 ---')
{
  checkTrue('0 在 [0,3) 内', inRange(0, 3))
  check('3 不在 [0,3) 内', inRange(3, 3), false)
  check('空候选固定 -1', clampIndex(5, 0), -1)
  check('负数收敛到 0', clampIndex(-4, 3), 0)
  check('越上界收敛到最后一个', clampIndex(9, 3), 2)
  check('非整数收敛到 0', clampIndex(1.5, 3), 0)
  check('空候选不动', stepIndex(0, 1, 0), -1)
  check('末尾前进绕回开头', stepIndex(2, 1, 3), 0)
  check('开头后退绕回末尾', stepIndex(0, -1, 3), 2)
  check('一次走多步', stepIndex(0, 3, 10), 3)
  check('一次走多步也绕回', stepIndex(8, 3, 10), 1)
  check('一次退多步也绕回', stepIndex(1, -3, 10), 8)
  check('走满一圈回到原位', stepIndex(4, 10, 10), 4)
}

console.log('--- A③ 窗口:最大起点、收敛、连续滑动、整屏、贴边 ---')
{
  check('一屏 10 行', PAGE_SIZE, 10)
  check('25 个候选最大起点 15', maxOffset(25), 15)
  check('正好一屏时起点只有 0', maxOffset(10), 0)
  check('不足一屏时起点只有 0', maxOffset(4), 0)
  check('11 个候选最大起点 1(显示 2–11)', maxOffset(11), 1)
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

console.log('--- A④ store:写入、批量通知、连续滑动与循环绕回 ---')
{
  const store = createPaletteStore()
  const seen = []
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))
  const initial = store.getSnapshot()
  check('初始关闭且无候选', [initial.open, initial.entries.length, initial.activeIndex, initial.binding], [false, 0, -1, null])
  checkTrue('getSnapshot 引用稳定', store.getSnapshot() === initial)

  const many = Array.from({ length: 25 }, (_, index) => ({
    key: `k${index + 1}`,
    title: `M${index + 1}`,
    subtitle: `/m${index + 1}`,
  }))
  store.sync(many)
  let action = 0
  store.open(() => { action += 1 })
  store.move(1)
  await Promise.resolve()
  check('两拍合并成一次通知', seen.length, 1)
  check('读到的是最后一次写入(第 2 行)', seen[0].activeIndex, 1)

  store.slide(1)
  check('滚一行:1–10 → 2–11', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [1, 1])
  store.turn(1)
  check('→ 滑一整屏', store.getSnapshot().offset, 11)
  check('滑完选中新窗口第一行', store.getSnapshot().activeIndex, 11)
  store.turn(1)
  check('→ 到尽头贴底', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 15])
  store.turn(1)
  check('最后一屏再 → 绕回开头', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 0])
  store.turn(-1)
  check('开头再 ← 绕回最后一屏', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 15])
  store.turn(-1)
  check('← 回退一整屏', store.getSnapshot().offset, 5)
  store.turn(-1)
  check('← 再到顶', store.getSnapshot().offset, 0)

  store.slide(-1)
  check('滚轮到顶再向上绕回最后一屏', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 15])
  store.slide(1)
  check('滚轮到最后一屏再向下绕回开头', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 0])

  store.open(() => {}, 13)
  check('打开在第 14 行 → 窗口从第 11 行起', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [10, 13])
  store.open(() => {}, 24)
  check('打开在末尾 → 窗口贴底', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [15, 24])

  store.sync(many.slice(0, 3))
  check('候选变短后回到第一行', [store.getSnapshot().offset, store.getSnapshot().activeIndex], [0, 0])
  store.turn(1)
  check('不足一屏时 → 不动', store.getSnapshot().offset, 0)
  store.slide(3)
  check('不足一屏时滚轮不动', store.getSnapshot().offset, 0)

  store.sync([])
  check('候选清空后下标为 -1', store.getSnapshot().activeIndex, -1)
  store.close()
  check('关闭清掉动作', [store.getSnapshot().open, store.getSnapshot().binding], [false, null])
  check('动作能被调用', action, 0)
  unsubscribe()
}

console.log('--- A⑤ 滚轮折算:一格一行 ---')
{
  check('像素模式原样', wheelPixels({ deltaY: 12 }), 12)
  check('行模式按 16px 折算', wheelPixels({ deltaY: 1, deltaMode: 1 }), 16)
  check('页模式按 400px 折算', wheelPixels({ deltaY: 1, deltaMode: 2 }), 400)
  check('1px 也算一行', wheelStep(1), 1)
  check('300px 也只算一行', wheelStep(300), 1)
  check('向上是 -1', wheelStep(-5), -1)
  check('零不动', wheelStep(0), 0)
  check('NaN 不动', wheelStep(Number.NaN), 0)
}

console.log('--- A⑥ 浮层内六个键 ---')
{
  const key = (name, overrides = {}) => ({ key: name, ...overrides })
  check('Escape 关闭', paletteAction(key('Escape')), 'close')
  check('Enter 确认', paletteAction(key('Enter')), 'confirm')
  check('ArrowDown 下一行', paletteAction(key('ArrowDown')), 'next')
  check('ArrowUp 上一行', paletteAction(key('ArrowUp')), 'previous')
  check('ArrowRight 下一页', paletteAction(key('ArrowRight')), 'page-next')
  check('ArrowLeft 上一页', paletteAction(key('ArrowLeft')), 'page-previous')
  checkUndefined('Ctrl+ArrowUp 放行', paletteAction(key('ArrowUp', { ctrlKey: true })))
  checkUndefined('Shift+ArrowLeft 放行', paletteAction(key('ArrowLeft', { shiftKey: true })))
  checkUndefined('Meta+Escape 放行', paletteAction(key('Escape', { metaKey: true })))
  checkUndefined('输入法组合中放行', paletteAction(key('Enter', { isComposing: true })))
  checkUndefined('已被消费放行', paletteAction(key('Escape', { defaultPrevented: true })))
  checkUndefined('长按 Enter 不确认', paletteAction(key('Enter', { repeat: true })))
  check('长按 ↓ 仍可连移', paletteAction(key('ArrowDown', { repeat: true })), 'next')
  checkUndefined('普通字符不归它', paletteAction(key('u')))
  checkUndefined('Ctrl+Alt+U 本身不归浮层', paletteAction(key('u', { ctrlKey: true, altKey: true })))
  checkUndefined('Tab 不归它', paletteAction(key('Tab')))
}

finish()
