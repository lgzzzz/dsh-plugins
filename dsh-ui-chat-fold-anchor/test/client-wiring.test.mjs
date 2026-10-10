/**
 * B 接线：`createRuntime` 在假 DOM 上的滚动口发现与即时折叠补偿。
 *
 * 假 DOM 复刻真实几何关系：行的视觉顶边 = 内容顶边 − 折叠掉的高度 − 滚动位置，
 * 滚动位置按可滚动范围夹取。折叠照 ui-chat 的执行顺序摆：直接给行写 `hidden`
 * （取值 `until-found`），属性观察在同一个微任务里把这一批行临时显回来量一次折叠前的几何、
 * 再按原样隐藏量第二次，并写回滚动位置。
 */
import {
  CONVERSATION_SCROLL_SELECTOR,
  DISCOVERY_THROTTLE_MS,
  SPACER_SELECTOR,
  createRuntime,
} from '../src/viewport.ts'
import { FakeElement, buildChat, check, checkTrue, finish, withFakeDom } from './helpers.mjs'

console.log('--- B① 即时折叠补回阅读位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)
  // 非共享滚动模式下滚动口就是列表，`hidden` 观察挂在它身上。
  check('列表挂上 hidden 观察', chat.scroller.observers.length, 1)

  chat.group.setAttribute('hidden', 'until-found')
  check('折叠后补回阅读位置', chat.scroller.scrollTop, 700)
  check('锚点回到原位置', chat.answer.getBoundingClientRect().top, 200)

  runtime.dispose()
  check('dispose 摘掉观察', chat.scroller.observers.length, 0)
})

console.log('--- B② 折叠发生在阅读线下方时不动滚动位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)
  // 阅读线落在过程组底部与回答行顶部的交界上（过程组视觉顶边 −100），折叠的是它下面的回答行。
  const before = chat.group.getBoundingClientRect().top

  chat.answer.setAttribute('hidden', 'until-found')
  check('锚点不动就不写', chat.scroller.scrollTop, 1000)
  check('锚点仍在原处', chat.group.getBoundingClientRect().top, before)

  runtime.dispose()
})

console.log('--- B③ 展开（移除 hidden）不补位置 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)

  chat.group.setAttribute('hidden', 'until-found')
  check('折叠补回阅读位置', chat.scroller.scrollTop, 700)

  chat.group.removeAttribute('hidden')
  check('展开不动滚动位置', chat.scroller.scrollTop, 700)

  runtime.dispose()
})

console.log('--- B④ 共享滚动模式下认外层滚动口 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat({ shared: true })
  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)
  check('外层滚动口不挂观察', chat.outer.observers.length, 0)
  check('列表挂 hidden 观察', chat.list.observers.length, 1)

  chat.group.setAttribute('hidden', 'until-found')
  check('外层滚动口补回原位置', chat.scroller.scrollTop, 700)
  runtime.dispose()
})

console.log('--- B⑤ 整批元素都不能当锚点 ---')
withFakeDom(({ doc }) => {
  const chat = buildChat()
  // 真实日志里的形状：一「批」被隐藏的元素有多个，且**批里的第一个元素与阅读线上的过程组无关**。
  // 剖面坐标：外层折叠体 700..760 在阅读线上方，过程组 900..1200 压在阅读线上，回答行
  // 1200..1400 在下方；滚动位置 1000。
  //   - 批里的第一条 = `wrapperBody`，在 `wrapper` 的子树里，与过程组无关；
  //   - 批里的第二条 = `wrapper` 自己（外层折叠体的根，带 `data-chat-anchor-key`）；
  //   - 过程组 = `chat.group`，它的折叠体 `chat.body` 也在批里。
  // 只登记批里的第一个元素，`wrapper` 与过程组根就逃过排除：过程组根被选中后随即也隐藏，
  // `measure()` 重新测量时返回 null，整次补偿被放弃。本用例钉住整批排除的结果。
  const wrapper = new FakeElement('div')
  wrapper.dataset.chatAnchorKey = 'wrapper:9'
  wrapper.contentTop = 700
  wrapper.height = 60
  const wrapperBody = new FakeElement('div')
  wrapperBody.contentTop = 700
  wrapperBody.height = 60
  wrapper.append(wrapperBody)
  chat.column.append(wrapper)

  doc.body.append(chat.outer)
  chat.scroller.scrollTop = 1000
  const runtime = createRuntime(doc)
  const top = (element) => element.getBoundingClientRect().top

  check('折叠前回答行视觉顶边在 200', top(chat.answer), 200)
  const wrapperBefore = top(wrapper)
  const answerBefore = top(chat.answer)

  // 同一个批次三条记录：wrapperBody（无关）、wrapper（外层折叠体根）、chat.body（过程组的折叠体）。
  for (const observer of [...chat.list.observers]) {
    observer.notify([
      { type: 'attributes', target: wrapperBody, attributeName: 'hidden', oldValue: null },
      { type: 'attributes', target: wrapper, attributeName: 'hidden', oldValue: null },
      { type: 'attributes', target: chat.body, attributeName: 'hidden', oldValue: null },
    ])
  }

  // 回答行不受折叠影响：上方收掉的高度由它们的共同祖先吸收，所以它相对滚动口不动。
  check('整批折叠后回答行仍钉在原处', top(chat.answer), answerBefore)
  check('整批折叠后回答行的相对位移为 0', top(chat.answer) - answerBefore, 0)
  // 折叠体自己在内容坐标里下移了 60（它收矮了 60），补偿补上同样的量，视觉上只平移 60。
  check('折叠体按补偿量平移，没有被额外顶走', top(wrapper) - wrapperBefore, 60)

  runtime.dispose()
})

console.log('--- B⑥ 运行时按限频重扫新挂载的滚动口 ---')
withFakeDom(({ doc }) => {
  const first = buildChat()
  doc.body.append(first.outer)
  const runtime = createRuntime(doc)
  check('首个滚动口已发现', first.scroller.observers.length, 1)

  const second = buildChat()
  doc.body.append(second.outer)
  check('限频窗口外的变动立即重扫', second.scroller.observers.length, 1)

  const third = buildChat()
  doc.body.append(third.outer)
  check('限频窗口内不重扫', third.scroller.observers.length, 0)
  runtime.discover()
  check('显式 discover 补上', third.scroller.observers.length, 1)
  checkTrue('限频值非零', DISCOVERY_THROTTLE_MS > 0)
  check('常量与选择器', [SPACER_SELECTOR, CONVERSATION_SCROLL_SELECTOR], ['[data-chat-turn-spacer]', '[data-conversation-scroll]'])
  runtime.dispose()
})

finish()
