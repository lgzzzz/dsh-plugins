/**
 * B 接线：`createRuntime` 在假 DOM 上的滚动口发现、折叠窗口开关、布局变化后的修正与让位条件。
 *
 * 假 DOM 复刻真实几何关系：行的视觉顶边 = 内容顶边 − 滚动位置，滚动位置按可滚动范围夹取。
 * 折叠场景照 ui-chat 的执行顺序摆：先给折叠体打 `data-chat-motion="collapse"`（几何未变），
 * 再写滚动口的 `style.overflowAnchor = "none"`（窗口打开、选锚点），之后动画才让几何变化，
 * 由 `notifyResize()` 代表 ResizeObserver 在布局之后回调。
 */
import {
  CONVERSATION_SCROLL_SELECTOR,
  DISCOVERY_THROTTLE_MS,
  SPACER_SELECTOR,
  createRuntime,
} from '../src/client.ts'
import {
  FakeElement,
  buildChat,
  check,
  checkTrue,
  finish,
  markCollapsing,
  moveUpForFold,
  withFakeDom,
} from './helpers.mjs'

console.log('--- B① 折叠窗口内把阅读位置补回去 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)
  // 每个滚动口两条属性观察:自己的 `style`(折叠窗口)与列表子树的 `hidden`(即时折叠);
  // 非共享滚动模式下滚动口就是列表,所以都落在同一个元素上。
  check('滚动口的两条属性观察都挂上', chat.scroller.observers.length, 2)
  check('流程列尺寸已观察', chat.column.resizeObservers.length, 1)

  // 窗口没开时布局变化不动滚动位置；无关的内联样式变化也不开窗口。
  chat.column.notifyResize()
  check('窗口未开时不修正', chat.scroller.scrollTop, 1000)
  chat.scroller.style.scrollBehavior = 'smooth'
  chat.column.notifyResize()
  check('无关样式不改滚动位置', chat.scroller.scrollTop, 1000)

  markCollapsing(chat)
  chat.scroller.style.overflowAnchor = 'none'
  // 窗口打开时几何还是折叠前的：锚点落在回答行上（正在折叠的过程组不做锚点）。
  moveUpForFold(chat)
  chat.column.notifyResize()
  check('锚点补回原位置', chat.answer.getBoundingClientRect().top, 200)
  check('滚动位置减少被折叠的高度', chat.scroller.scrollTop, 700)

  chat.column.notifyResize()
  check('锚点稳定后不再写', chat.scroller.scrollTop, 700)

  chat.scroller.style.overflowAnchor = ''
  chat.answer.contentTop -= 50
  chat.column.notifyResize()
  check('窗口关闭后不再修正', chat.scroller.scrollTop, 700)

  runtime.dispose()
  check('dispose 摘掉属性观察', chat.scroller.observers.length, 0)
  check('dispose 摘掉尺寸观察', chat.column.resizeObservers.length, 0)
})

console.log('--- B② 窗口关闭时补上最后一次布局变化 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)

  markCollapsing(chat)
  chat.scroller.style.overflowAnchor = 'none'
  moveUpForFold(chat)
  chat.column.notifyResize()
  check('窗口内修正', chat.scroller.scrollTop, 700)

  // 折叠收尾还会再动一点（动画最后一帧落在窗口信号写回之后）：这里让上方再收矮 50px，
  // 没有 `hidden` 变化，只有关闭窗口那一次修正能补上。
  chat.filler.collapseTo = 0
  chat.scroller.style.overflowAnchor = ''
  check('关闭时补上最后一次变化', chat.scroller.scrollTop, 650)
  runtime.dispose()
})

console.log('--- B③ 尾随输出时收尾那次修正让位 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.outer.setAttribute('data-chat-following-tail', '')
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)

  markCollapsing(chat)
  chat.scroller.style.overflowAnchor = 'none'
  moveUpForFold(chat)
  chat.column.notifyResize()
  check('窗口内仍然补', chat.scroller.scrollTop, 700)

  chat.filler.collapseTo = 0
  chat.scroller.style.overflowAnchor = ''
  check('收尾不改动跟随策略的落点', chat.scroller.scrollTop, 700)
  runtime.dispose()
})

console.log('--- B④ 锚点被折叠掉时停手 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)

  markCollapsing(chat)
  chat.scroller.style.overflowAnchor = 'none'
  chat.answer.setAttribute('hidden', 'until-found')
  chat.column.notifyResize()
  check('锚点失效当次不写滚动位置', chat.scroller.scrollTop, 1000)

  chat.answer.contentTop -= 50
  chat.column.notifyResize()
  check('失效之后不再接手', chat.scroller.scrollTop, 1000)
  runtime.dispose()
})

console.log('--- B⑤ 折叠在阅读线下方时不动滚动位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  const tail = new FakeElement('div')
  tail.dataset.chatAnchorKey = 'group:10'
  tail.contentTop = 1400
  tail.height = 300
  chat.column.append(tail)
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)

  // 阅读线落在过程组 9 上（视觉顶边 −100），折叠的是它下面的过程组 10：锚点不动。
  tail.dataset.chatMotion = 'collapse'
  chat.scroller.style.overflowAnchor = 'none'
  tail.height = 0
  chat.column.notifyResize()
  check('锚点在下方的折叠不写滚动位置', chat.scroller.scrollTop, 1000)
  runtime.dispose()
})

console.log('--- B⑥ 共享滚动模式下认外层滚动口 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat({ shared: true })
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)
  // 折叠窗口写在滚动口的 style 上，`hidden` 观察挂在承载行的列表上。
  check('外层滚动口观察折叠窗口', chat.outer.observers.length, 1)
  check('列表观察 hidden', chat.list.observers.length, 1)

  markCollapsing(chat)
  chat.outer.style.overflowAnchor = 'none'
  moveUpForFold(chat)
  chat.column.notifyResize()
  check('外层滚动口补回原位置', chat.scroller.scrollTop, 700)
  runtime.dispose()
})

console.log('--- B⑧ 即时折叠（没有折叠窗口信号）也补回阅读位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)

  // ui-chat 不带折叠动画的路径：只写 `hidden`，不碰滚动口的 overflow-anchor。
  chat.group.setAttribute('hidden', 'until-found')
  check('即时折叠补回阅读位置', chat.scroller.scrollTop, 700)
  check('锚点回到原位置', chat.answer.getBoundingClientRect().top, 200)

  chat.column.notifyResize()
  check('没有窗口时尺寸变化不动位置', chat.scroller.scrollTop, 700)
  runtime.dispose()
})

console.log('--- B⑨ 折叠窗口接管过的元素不再补第二次 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)

  markCollapsing(chat)
  chat.scroller.style.overflowAnchor = 'none'
  moveUpForFold(chat)
  chat.column.notifyResize()
  check('窗口内先补一次', chat.scroller.scrollTop, 700)

  // 折叠收尾照 ui-chat 的顺序：先清掉动画留下的内联高度，再写 `hidden`。
  chat.group.collapseTo = undefined
  chat.group.setAttribute('hidden', 'until-found')
  check('收尾的 hidden 不再按折叠前几何补一次', chat.scroller.scrollTop, 700)
  runtime.dispose()
})

console.log('--- B⑦ 运行时按限频重扫新挂载的滚动口 ---')
withFakeDom(({ doc }) => {
  const first = buildChat()
  doc.body.append(first.outer)
  const runtime = createRuntime(doc)
  check('首个滚动口已发现', first.scroller.observers.length, 2)

  const second = buildChat()
  doc.body.append(second.outer)
  check('限频窗口外的变动立即重扫', second.scroller.observers.length, 2)

  const third = buildChat()
  doc.body.append(third.outer)
  check('限频窗口内不重扫', third.scroller.observers.length, 0)
  runtime.discover()
  check('显式 discover 补上', third.scroller.observers.length, 2)
  checkTrue('限频值非零', DISCOVERY_THROTTLE_MS > 0)
  check('常量与选择器', [SPACER_SELECTOR, CONVERSATION_SCROLL_SELECTOR], ['[data-chat-turn-spacer]', '[data-conversation-scroll]'])
  runtime.dispose()
})

finish()
