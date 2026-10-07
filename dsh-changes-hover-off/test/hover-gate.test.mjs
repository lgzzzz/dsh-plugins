/**
 * 闸门逻辑:归属判定、消费与放行、捕获阶段安装 / 卸载,以及无文档环境下的空操作。
 *
 * 运行:`node test/hover-gate.test.mjs`(或 pnpm test 跑全部)。
 */
import {
  CARD_SELECTOR,
  FakeDocument,
  FakeObserver,
  HOVER_GESTURES,
  MARKER_ATTRIBUTE,
  cardTarget,
  check,
  checkTrue,
  element,
  finish,
  hoverEvent,
  outsideTarget,
  plainNode,
  shellElement,
} from './helpers.mjs'
import {
  gestureElement,
  installHoverGate,
  ownsHoverGesture,
  suppressHoverGesture,
} from '../src/hover-gate.ts'

console.log('--- A 归属判定 ---')
{
  checkTrue('卡片内目标属于本浮层', ownsHoverGesture(cardTarget()))
  checkTrue('卡片外目标不属于本浮层', ownsHoverGesture(outsideTarget()) === false)
  checkTrue('null 目标不属于本浮层', ownsHoverGesture(null) === false)

  const inner = element([CARD_SELECTOR], 'inner')
  const outer = element(['[data-other]'], 'outer')
  check('composedPath 优先于 target', gestureElement(hoverEvent(outer, { path: [inner, outer] }))?.label, 'inner')
  check('无可用路径时退回 target', gestureElement(hoverEvent(inner))?.label, 'inner')
  check('两者都取不到时为 null', gestureElement({ target: null, composedPath: () => [null, 'x'] }), null)
  check('锚点常量', CARD_SELECTOR, '[data-changed-files]')
}

console.log('--- B 消费与放行 ---')
{
  const inside = hoverEvent(cardTarget())
  checkTrue('卡片内事件被消费', suppressHoverGesture(inside) === true)
  checkTrue('卡片内事件 stopPropagation', inside.stopped === true)

  const outside = hoverEvent(outsideTarget())
  checkTrue('卡片外事件不被消费', suppressHoverGesture(outside) === false)
  checkTrue('卡片外事件不 stopPropagation', outside.stopped === false)
}

console.log('--- C 捕获阶段安装与卸载 ---')
{
  const doc = new FakeDocument()
  const uninstall = installHoverGate(doc)
  check('注册的手势集合', [...doc.types].sort(), [...HOVER_GESTURES].sort())
  check(
    '全部为捕获阶段',
    HOVER_GESTURES.every((type) => (doc.listeners.get(type) ?? []).every((item) => item.capture === true)),
    true,
  )
  check('每个手势各一条监听', HOVER_GESTURES.every((type) => (doc.listeners.get(type) ?? []).length === 1), true)

  const inside = hoverEvent(cardTarget())
  doc.dispatch('pointerover', inside)
  checkTrue('卡片内 pointerover 被消费', inside.stopped === true)

  const outside = hoverEvent(outsideTarget())
  doc.dispatch('pointerover', outside)
  checkTrue('卡片外 pointerover 被放行', outside.stopped === false)

  const enter = hoverEvent(cardTarget())
  doc.dispatch('pointerenter', enter)
  checkTrue('原生 pointerenter 同样被消费', enter.stopped === true)

  uninstall()
  check('卸载后无监听', doc.types.length, 0)
  const after = hoverEvent(cardTarget())
  doc.dispatch('pointerover', after)
  checkTrue('卸载后不再消费', after.stopped === false)
}

console.log('--- D 无文档环境 ---')
{
  const uninstall = installHoverGate(undefined)
  check('无文档时返回可调用卸载函数', typeof uninstall, 'function')
  uninstall()
}

console.log('--- E 网兜:portal 外壳进入 body 即隐藏 ---')
{
  FakeObserver.reset()
  const doc = new FakeDocument()
  const uninstall = installHoverGate(doc)
  const observer = FakeObserver.last()
  checkTrue('安装了观察者', observer !== undefined)
  check('观察目标为 body', observer?.observed[0]?.target, doc.body)
  check('观察选项', observer?.observed[0]?.options, { childList: true })

  const shell = shellElement('child')
  observer.emit([{ addedNodes: [plainNode(), shell] }])
  check('带标记的外壳被隐藏', shell.style.display, 'none')
  check('无关节点不动', plainNode().style.display, '')

  const selfShell = shellElement('self')
  observer.emit([{ addedNodes: [selfShell] }])
  check('标记挂在外壳自身也能命中', selfShell.style.display, 'none')

  const foreign = shellElement('none')
  observer.emit([{ addedNodes: [foreign] }])
  check('无标记的节点不隐藏', foreign.style.display, '')

  uninstall()
  checkTrue('卸载时断开观察', observer?.disconnected === true)
  check('卸载时还原已隐藏外壳', shell.style.display, '')
}

console.log('--- F 生效标记 ---')
{
  FakeObserver.reset()
  const doc = new FakeDocument()
  const uninstall = installHoverGate(doc)
  check('装上后写入标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), '')
  uninstall()
  check('卸载后移除标记', doc.documentElement.getAttribute(MARKER_ATTRIBUTE), null)
}

console.log('--- G 网兜的降级路径 ---')
{
  FakeObserver.reset()
  const noObserver = new FakeDocument({ withObserver: false })
  const un1 = installHoverGate(noObserver)
  check('无 MutationObserver 时不装网兜', FakeObserver.instances.length, 0)
  check('闸门仍然生效', noObserver.types.length, HOVER_GESTURES.length)
  check('标记仍然写入', noObserver.documentElement.getAttribute(MARKER_ATTRIBUTE), '')
  un1()

  FakeObserver.reset()
  const noBody = new FakeDocument({ withBody: false })
  const un2 = installHoverGate(noBody)
  check('无 body 时不装网兜', FakeObserver.instances.length, 0)
  un2()
}

finish()
