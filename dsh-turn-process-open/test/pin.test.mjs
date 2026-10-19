/**
 * 锁定器：主会话作用域、seed 键与重试、锁标记、降级点击、可信点击拦截与卸载。
 *
 * 用假元素 + 假 fiber 链驱动；不依赖真实 DOM / React。
 */
import {
  createPinState,
  conversationRoots,
  installPin,
  interceptLockedClick,
  PIN_ATTRIBUTE,
  PIN_CSS,
  seedHeader,
  sessionIdOf,
  STYLE_ID,
  syncRoot,
  writeOpen,
} from '../src/pin.ts'
import {
  actionsProps,
  attachFiber,
  captureWarnings,
  check,
  checkFalse,
  checkTrue,
  FakeDocument,
  FakeElement,
  FakeObserver,
  finish,
  turnProcessProps,
} from './helpers.mjs'

/** 主会话页面：槽位 → 会话根 → 滚动口。 */
function page({ session = 's1' } = {}) {
  const app = new FakeElement('div')
  const main = app.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const sessionRoot = main.append(new FakeElement('div', { 'data-conversation-session': session }))
  const scroll = sessionRoot.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  return { app, main, sessionRoot, scroll }
}

/** 一个可折标题：默认展开、带 turnProcess 与 actions。 */
function header({ turn = 1, answerStep = 0, expanded = true, setOpen, record } = {}) {
  const calls = record ?? []
  const element = new FakeElement('button', {
    'data-turn-process': String(turn),
    ...(expanded === null ? {} : { 'aria-expanded': String(expanded) }),
  })
  const action = (...args) => calls.push(args)
  const props = [turnProcessProps({ turn, answerStep, setOpen })]
  if (record !== null) props.push(actionsProps(action))
  attachFiber(element, ...props)
  return element
}

console.log('--- P① 主会话作用域 ---')
{
  const { app, scroll } = page()
  const roots = conversationRoots(app)
  checkTrue('槽位内滚动口', roots.length === 1 && roots[0] === scroll)
  check('空文档', conversationRoots(new FakeElement('div')), [])

  const loose = new FakeElement('div')
  const only = loose.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const looseRoots = conversationRoots(loose)
  checkTrue('唯一滚动口回退', looseRoots.length === 1 && looseRoots[0] === only)

  const two = new FakeElement('div')
  two.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  two.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  check('多个滚动口且无槽位不猜', conversationRoots(two), [])

  const mixed = new FakeElement('div')
  const slot = mixed.append(new FakeElement('div', { 'data-slot': 'main.conversation' }))
  const inside = slot.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  mixed.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const mixedRoots = conversationRoots(mixed)
  checkTrue('主槽位优先，不误锁右栏', mixedRoots.length === 1 && mixedRoots[0] === inside)
  check('没有会话根时为空串', sessionIdOf(inside), '')
  check('槽位里的标题拿到会话 id', sessionIdOf(page().scroll), 's1')
}

console.log('--- P② 展开的标题：写记录并加锁 ---')
{
  const state = createPinState()
  const calls = []
  const element = header({ turn: 3, answerStep: 2, record: calls })
  check('结论', seedHeader(element, state), 'pinned')
  check('写入参数', calls, [[3, 2, true]])
  check('锁标记', element.getAttribute(PIN_ATTRIBUTE), '')
  check('再次同步不重复写', (seedHeader(element, state), calls.length), 1)
}

console.log('--- P③ 会话 id / 轮次 / answerStep 组成 key ---')
{
  const state = createPinState()
  const calls = []
  const { scroll, sessionRoot } = page({ session: 'alpha' })
  const element = header({ turn: 1, record: calls })
  scroll.append(element)
  seedHeader(element, state)
  check('key 含会话与轮次', state.records.get(element).key, 'alpha|1|0')
  sessionRoot.setAttribute('data-conversation-session', 'beta')
  check('已锁标题的早退不改 key（同一条 DOM 不会换会话）', (seedHeader(element, state), state.records.get(element).key), 'alpha|1|0')
}

console.log('--- P④ 折叠后按上限重试，再放弃 ---')
{
  const state = createPinState()
  const calls = []
  const element = header({ turn: 1, expanded: false, record: calls })
  const outcomes = []
  for (let i = 0; i < 5; i += 1) outcomes.push(seedHeader(element, state))
  check('结论序列', outcomes, ['retry', 'retry', 'retry', 'gave-up', 'gave-up'])
  check('写了三次', calls.length, 3)
  check('放弃时不带锁标记', element.hasAttribute(PIN_ATTRIBUTE), false)
  // 之后被上游展开：恢复锁定。
  element.setAttribute('aria-expanded', 'true')
  check('重新展开后恢复', seedHeader(element, state), 'retry')
  checkTrue('带锁', element.hasAttribute(PIN_ATTRIBUTE))
}

console.log('--- P⑤ 折叠态下 answerStep 变化：新 key 重新写 ---')
{
  const state = createPinState()
  const calls = []
  const element = header({ turn: 2, answerStep: 0, expanded: false, record: calls })
  seedHeader(element, state)
  seedHeader(element, state)
  attachFiber(element, turnProcessProps({ turn: 2, answerStep: 5 }), actionsProps((...args) => calls.push(args)))
  seedHeader(element, state)
  check('最后一次写入用新代次', calls[calls.length - 1], [2, 5, true])
}

console.log('--- P⑥ 跳过：disabled / 无 aria-expanded ---')
{
  const state = createPinState()
  const calls = []
  const disabled = header({ record: calls })
  disabled.disabled = true
  check('disabled 跳过', seedHeader(disabled, state), 'skip')
  check('disabled 不写', calls.length, 0)

  const noExpanded = header({ expanded: null, record: calls })
  check('无 aria-expanded 跳过', seedHeader(noExpanded, state), 'skip')
  check('无 aria-expanded 不写', calls.length, 0)

  const ariaDisabled = header({ record: calls })
  ariaDisabled.setAttribute('aria-disabled', 'true')
  check('aria-disabled 跳过', seedHeader(ariaDisabled, state), 'skip')
}

console.log('--- P⑦ 没有 actions 时用 setOpen ---')
{
  const state = createPinState()
  const opens = []
  const element = header({ turn: 4, setOpen: (open) => opens.push(open), record: null })
  check('setOpen 路径', writeOpen(element, { turn: 4, answerStep: 0, setOpen: (open) => opens.push(open) }), 'setOpen')
  check('setOpen(true)', opens, [true])
  check('seed 走 setOpen', seedHeader(element, state), 'pinned')
}

console.log('--- P⑧ fiber 结构变了：折叠后合成点击，只告警一次 ---')
{
  const state = createPinState()
  const warnings = captureWarnings(() => {
    const element = new FakeElement('button', { 'aria-expanded': 'false', 'data-turn-process': '1' })
    element.onClick = (self) => self.setAttribute('aria-expanded', 'true')
    const outcomes = []
    for (let i = 0; i < 5; i += 1) {
      element.setAttribute('aria-expanded', 'false')
      outcomes.push(seedHeader(element, state))
    }
    check('点击三次后放弃', outcomes, ['fallback', 'fallback', 'fallback', 'gave-up', 'gave-up'])
    check('没有锁标记', element.hasAttribute(PIN_ATTRIBUTE), false)
    check('点了三次', element.clicks, 3)
  })
  check('只告警一次', warnings.length, 1)
}

console.log('--- P⑨ 可信点击拦截 ---')
{
  const { app, scroll } = page()
  const element = header()
  scroll.append(element)
  element.setAttribute(PIN_ATTRIBUTE, '')
  const trusted = {
    isTrusted: true,
    target: element,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1 },
    stopPropagation() { this.stopped += 1 },
  }
  checkTrue('可信点击命中锁定标题', interceptLockedClick(trusted))
  check('preventDefault / stopPropagation', [trusted.prevented, trusted.stopped], [1, 1])

  const child = element.append(new FakeElement('span'))
  const onChild = { isTrusted: true, target: child, preventDefault() {}, stopPropagation() {} }
  checkTrue('目标在标题内部也命中', interceptLockedClick(onChild))

  const untrusted = { isTrusted: false, target: element, preventDefault() {}, stopPropagation() {} }
  checkFalse('不可信点击放行（降级路径）', interceptLockedClick(untrusted))

  const outside = { isTrusted: true, target: app, preventDefault() {}, stopPropagation() {} }
  checkFalse('标题外不拦', interceptLockedClick(outside))

  const unlocked = header()
  scroll.append(unlocked)
  const plain = { isTrusted: true, target: unlocked, preventDefault() {}, stopPropagation() {} }
  checkFalse('没有锁标记的标题不拦', interceptLockedClick(plain))
}

console.log('--- P⑩ installPin：初始同步、观察、样式与卸载 ---')
{
  const { app, scroll } = page()
  const calls = []
  const element = header({ record: calls })
  scroll.append(element)
  const doc = new FakeDocument({ root: app, withObserver: true })
  FakeObserver.reset()
  const controller = installPin(doc)
  check('初始同步写入', calls.length, 1)
  check('锁定标题', element.getAttribute(PIN_ATTRIBUTE), '')
  check('样式只插一条', doc.head.nodes.length, 1)
  check('样式内容', doc.head.nodes[0]?.textContent, PIN_CSS)
  check('样式标识', doc.head.nodes[0]?.dataset?.pluginCss, STYLE_ID)
  check('点击监听注册', doc.listeners.filter((item) => item.type === 'click' && item.capture === true).length, 1)
  checkTrue('观察 documentElement', FakeObserver.last()?.observed[0]?.target === app)

  // 新标题在观察回调后的一帧里同步。
  const late = header({ turn: 2, record: calls })
  scroll.append(late)
  FakeObserver.last()?.emit()
  await new Promise((resolve) => setTimeout(resolve, 40))
  check('观察回调补 seed', late.getAttribute(PIN_ATTRIBUTE), '')

  controller.dispose()
  check('卸载移除锁标记', element.hasAttribute(PIN_ATTRIBUTE), false)
  check('卸载移除样式', doc.head.nodes[0]?.removed, true)
  check('卸载移除监听', doc.listeners.length, 0)
  checkTrue('卸载断开观察', FakeObserver.last()?.disconnected === true)
  check('卸载后 sync 不再写', (controller.sync(), calls.length), 2)
}

console.log('--- P⑪ installPin：右栏会话不锁 ---')
{
  const { app, scroll } = page()
  const right = app.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
  const mainHeader = header({ turn: 1 })
  const sideHeader = header({ turn: 1 })
  scroll.append(mainHeader)
  right.append(sideHeader)
  const doc = new FakeDocument({ root: app })
  const controller = installPin(doc)
  check('主会话锁定', mainHeader.getAttribute(PIN_ATTRIBUTE), '')
  check('右栏不锁', sideHeader.hasAttribute(PIN_ATTRIBUTE), false)
  controller.dispose()
}

console.log('--- P⑫ syncRoot 计数与无 fiber 的标题 ---')
{
  const state = createPinState()
  const { scroll } = page()
  scroll.append(header({ turn: 1 }))
  scroll.append(new FakeElement('button', { 'aria-expanded': 'false', 'data-turn-process': '2' }))
  scroll.append(new FakeElement('button', { 'data-turn-process': '3' }))
  let counts
  captureWarnings(() => { counts = syncRoot(scroll, state) })
  check('展开 1 / 无 fiber 1 / 无 aria 1', [counts.pinned, counts.fallback, counts.skip], [1, 1, 1])
}

finish()
