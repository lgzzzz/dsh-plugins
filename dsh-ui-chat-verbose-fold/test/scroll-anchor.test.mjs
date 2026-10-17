/**
 * B 接线：`createScrollAnchorRuntime` 在假 DOM 上的滚动口发现、批次过滤与即时折叠补偿。
 *
 * 假 DOM 复刻真实几何关系：行的视觉顶边 = 内容顶边 − 折叠掉的高度 − 滚动位置，
 * 滚动位置按可滚动范围夹取。折叠照 ui-chat 的执行顺序摆：直接给行写 `hidden`
 * （取值 `until-found`），属性观察在同一个微任务里把这一批行临时显回来量一次折叠前的几何、
 * 再按原样隐藏量第二次，并写回滚动位置。
 */
import {
  CONVERSATION_SCROLL_SELECTOR,
  DISCOVERY_THROTTLE_MS,
  createScrollAnchorRuntime,
} from '../src/scroll-anchor.ts'
import { FakeElement, buildChat, withFakeDom } from './fake-dom.mjs'
import { check, checkTrue, finish } from './helpers.mjs'

const top = (chat, element) => element.getBoundingClientRect().top - chat.scroller.getBoundingClientRect().top

console.log('--- B① 共享滚动口发现与即时折叠补偿 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.scroller)
  chat.scroller.scrollTop = 1000
  chat.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)
  check('滚动口挂上 hidden 观察', chat.scroller.observers.length, 1)

  const answerBefore = top(chat, chat.answer)
  chat.group.setAttribute('hidden', 'until-found')
  check('折叠后补回阅读位置', chat.scroller.scrollTop, 700)
  check('锚点回到原位置', top(chat, chat.answer), answerBefore)
  check('补偿后重新挂回观察', chat.scroller.observers.length, 1)

  runtime.dispose()
  check('dispose 摘掉观察', chat.scroller.observers.length, 0)
})

console.log('--- B② 没有共享滚动口时不装任何观察 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  chat.scroller.removeAttribute('data-conversation-scroll')
  doc.body.append(chat.scroller)
  chat.scroller.scrollTop = 1000
  chat.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)
  check('滚动口不挂观察', chat.scroller.observers.length, 0)

  chat.group.setAttribute('hidden', 'until-found')
  check('没有写滚动位置', chat.scroller.scrollWrites, [])
  check('内容照旧被顶走', top(chat, chat.answer), -100)
  runtime.dispose()
})

console.log('--- B③ 折叠发生在阅读线下方时不动滚动位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.scroller)
  chat.scroller.scrollTop = 1000
  chat.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)
  const groupBefore = top(chat, chat.group)

  chat.answer.setAttribute('hidden', 'until-found')
  check('锚点不动就不写', chat.scroller.scrollWrites, [])
  check('锚点仍在原处', top(chat, chat.group), groupBefore)

  runtime.dispose()
})

console.log('--- B④ 展开（移除 hidden）不补位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.scroller)
  chat.scroller.scrollTop = 1000
  chat.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)

  chat.group.setAttribute('hidden', 'until-found')
  check('折叠补回阅读位置', chat.scroller.scrollTop, 700)

  chat.scroller.scrollWrites.length = 0
  chat.group.removeAttribute('hidden')
  check('展开不写滚动位置', chat.scroller.scrollWrites, [])
  check('滚动位置保持', chat.scroller.scrollTop, 700)

  runtime.dispose()
})

console.log('--- B⑤ 整批元素及其祖先/后代都不能当锚点 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  // 真实日志里的形状：一「批」被隐藏的元素有多个，且批里的第一个元素与阅读线上的过程组无关。
  // 外层折叠体 700..760 在阅读线上方，过程组 900..1200 压在阅读线上，回答行 1200..1400 在下方。
  const wrapper = new FakeElement('div')
  wrapper.dataset.chatAnchorKey = 'wrapper:9'
  wrapper.contentTop = 700
  wrapper.height = 60
  const wrapperBody = new FakeElement('div')
  wrapperBody.contentTop = 700
  wrapperBody.height = 60
  wrapper.append(wrapperBody)
  chat.column.append(wrapper)

  doc.body.append(chat.scroller)
  chat.scroller.scrollTop = 1000
  chat.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)

  const answerBefore = top(chat, chat.answer)
  const wrapperBefore = top(chat, wrapper)
  for (const observer of [...chat.scroller.observers]) {
    observer.notify([
      { type: 'attributes', target: wrapperBody, attributeName: 'hidden', oldValue: null },
      { type: 'attributes', target: wrapper, attributeName: 'hidden', oldValue: null },
      { type: 'attributes', target: chat.body, attributeName: 'hidden', oldValue: null },
    ])
  }

  check('整批折叠后回答行仍钉在原处', top(chat, chat.answer), answerBefore)
  check('折叠体按补偿量平移', top(chat, wrapper) - wrapperBefore, 60)
  runtime.dispose()
})

console.log('--- B⑥ 跟底与动画折叠都跳过 ---')
withFakeDom(({ doc }) => {
  const following = buildChat({ following: true })
  const motion = buildChat({ motion: true })
  doc.body.append(following.scroller, motion.scroller)
  following.scroller.scrollTop = 1000
  motion.scroller.scrollTop = 1000
  following.scroller.scrollWrites.length = 0
  motion.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)
  following.group.setAttribute('hidden', 'until-found')
  check('跟底时不写滚动位置', following.scroller.scrollWrites, [])
  checkTrue('跟底时过程行照常隐藏', following.group.hasAttribute('hidden'))

  motion.group.setAttribute('hidden', 'until-found')
  check('动画折叠时不写滚动位置', motion.scroller.scrollWrites, [])
  checkTrue('动画折叠时过程行照常隐藏', motion.group.hasAttribute('hidden'))

  runtime.dispose()
})

console.log('--- B⑦ 只认流程列内的锚点相关 hidden ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.scroller)
  chat.scroller.scrollTop = 1000
  chat.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)

  const plain = new FakeElement('div')
  plain.contentTop = 0
  plain.height = 100
  chat.column.append(plain)
  let plainReveals = 0
  const plainRemove = plain.removeAttribute.bind(plain)
  plain.removeAttribute = (name) => {
    if (name === 'hidden') plainReveals += 1
    plainRemove(name)
  }

  const outside = new FakeElement('div')
  outside.dataset.chatAnchorKey = 'outside:9'
  outside.contentTop = 0
  outside.height = 100
  chat.list.append(outside)
  let outsideReveals = 0
  const outsideRemove = outside.removeAttribute.bind(outside)
  outside.removeAttribute = (name) => {
    if (name === 'hidden') outsideReveals += 1
    outsideRemove(name)
  }

  plain.setAttribute('hidden', 'until-found')
  outside.setAttribute('hidden', 'until-found')
  check('非锚点行不显回', plainReveals, 0)
  check('流程列外元素不显回', outsideReveals, 0)
  check('都不写滚动位置', chat.scroller.scrollWrites, [])

  runtime.dispose()
})

console.log('--- B⑧ 限频重扫、回收与 dispose ---')
withFakeDom(({ doc }) => {
  const first = buildChat()
  doc.body.append(first.scroller)
  const runtime = createScrollAnchorRuntime(doc)
  check('首个滚动口已发现', first.scroller.observers.length, 1)

  const second = buildChat()
  doc.body.append(second.scroller)
  check('限频窗口外的变动立即重扫', second.scroller.observers.length, 1)

  const third = buildChat()
  doc.body.append(third.scroller)
  check('限频窗口内不重扫', third.scroller.observers.length, 0)
  runtime.discover()
  check('显式 discover 补上', third.scroller.observers.length, 1)

  first.scroller.setConnected(false)
  runtime.discover()
  check('断开的滚动口被回收', first.scroller.observers.length, 0)

  checkTrue('限频值非零', DISCOVERY_THROTTLE_MS > 0)
  check('选择器', CONVERSATION_SCROLL_SELECTOR, '[data-conversation-scroll]')
  runtime.dispose()
  check('dispose 摘掉其余观察', second.scroller.observers.length, 0)
})

console.log('--- B⑨ 两个滚动口互不影响 ---')
withFakeDom(({ doc }) => {
  const first = buildChat()
  const second = buildChat()
  doc.body.append(first.scroller, second.scroller)
  first.scroller.scrollTop = 1000
  second.scroller.scrollTop = 1000
  first.scroller.scrollWrites.length = 0
  second.scroller.scrollWrites.length = 0
  const runtime = createScrollAnchorRuntime(doc)

  first.group.setAttribute('hidden', 'until-found')
  check('第一个滚动口补回位置', first.scroller.scrollTop, 700)
  check('第二个滚动口不跟着写', second.scroller.scrollWrites, [])
  check('第二个滚动口位置不变', second.scroller.scrollTop, 1000)

  runtime.dispose()
})

finish()
