/**
 * 悬停开合状态机：延迟展开、延迟折叠、pin 语义（用户点击打开后离开不折叠）、
 * 入口的幂等、以及卸载后不再动作。
 *
 * 指针进出由 React 的 enter/leave 负责判定，本状态机只接收结果，因此这里直接调用
 * `controller.enter()` / `controller.leave()`，不构造 DOM 事件。
 *
 * 运行：`node test/hover-open.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  EXPANDED_ATTRIBUTE,
  FakeHost,
  FakeTimer,
  FakeTrigger,
  HOVER_CLOSE_DELAY_MS,
  HOVER_OPEN_DELAY_MS,
  check,
  checkFalse,
  checkTrue,
  finish,
  userClick,
} from './helpers.mjs'
import { createHoverOpen } from '../src/hover-open.ts'

/** 组装一套装置；「用户点了一下触发器」用 `userClick(controller, trigger)`（含上游 onClick 的传播建模）。 */
function setup(expanded = false) {
  const trigger = new FakeTrigger(expanded)
  const host = new FakeHost(trigger)
  const timer = new FakeTimer()
  const controller = createHoverOpen(host, timer)
  return { trigger, host, timer, controller }
}

console.log('--- H① 悬停延迟展开 ---')
{
  const { host, timer, trigger, controller } = setup()
  controller.enter()
  check('排一个延迟回调', timer.delays, [HOVER_OPEN_DELAY_MS])
  check('延迟未到时还没点击', trigger.clicks, 0)
  timer.runAll()
  check('延迟到点后点击一次', trigger.clicks, 1)
  check('触发器已展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
  check('宿主只用来定位触发器', host.querySelector('button[aria-expanded]'), trigger)
}

console.log('--- H② 不足延迟就离开则不展开 ---')
{
  const { timer, trigger, controller } = setup()
  controller.enter()
  controller.leave()
  check('进来那个回调已被撤销，只剩离开的折叠回调', timer.delays, [HOVER_CLOSE_DELAY_MS])
  timer.runAll()
  check('没有展开', trigger.clicks, 0)
  check('触发器仍是关闭的', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H③ 已展开后离开延迟折叠 ---')
{
  const { timer, trigger, controller } = setup(true)
  controller.leave()
  check('排一个折叠回调', timer.delays, [HOVER_CLOSE_DELAY_MS])
  timer.runAll()
  check('折叠时点击一次', trigger.clicks, 1)
  check('触发器已关闭', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H④ 点击把它钉住，离开不折叠 ---')
{
  const { timer, trigger, controller } = setup()
  userClick(controller, trigger)
  checkTrue('点击后处于钉住状态', controller.pinned)
  check('未展开时点击放行给上游，上游 onClick 展开', trigger.clicks, 1)
  check('触发器已展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')

  controller.leave()
  timer.runAll()
  check('离开后没有折叠点击', trigger.clicks, 1)
  check('触发器仍然展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
}

console.log('--- H⑤ 已展开时点击不折叠（与子代理控件一致） ---')
{
  const { trigger, controller } = setup()
  userClick(controller, trigger)
  check('先由点击展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')

  userClick(controller, trigger)
  check('已展开时那次点击被拦下，上游 toggle 没有派发', trigger.clicks, 1)
  check('触发器保持展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
  checkTrue('仍然是钉住状态', controller.pinned)

  // 悬停展开（未钉住）之后点击，同样只钉住、不折叠。
  const hovered = setup()
  hovered.controller.enter()
  hovered.timer.runAll()
  check('悬停展开一次', hovered.trigger.clicks, 1)
  userClick(hovered.controller, hovered.trigger)
  check('悬停展开后点击也不折叠', hovered.trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
  checkTrue('并转为钉住', hovered.controller.pinned)
}

console.log('--- H⑥ 只有受信任的触发器点击才改变 pin ---')
{
  const synthetic = setup()
  synthetic.controller.click({ isTrusted: false, target: synthetic.trigger })
  checkFalse('合成 click 不改 pin', synthetic.controller.pinned)
  check('合成 click 不产生额外点击', synthetic.trigger.clicks, 0)

  const menu = setup()
  const menuNode = { tag: 'menu-row' }
  menu.controller.click({ isTrusted: true, target: menuNode })
  checkFalse('点在 portal 出去的菜单里不改 pin', menu.controller.pinned)
  check('点在菜单里不改变开合', menu.trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')

  const inner = setup()
  const countLabel = { tag: 'count-label' }
  inner.trigger.contains = (node) => node === inner.trigger || node === countLabel
  inner.controller.click({ isTrusted: true, target: countLabel })
  checkTrue('点在触发器内部（计数文本）也钉住', inner.controller.pinned)
}

console.log('--- H⑦ 进入时复位被外部关闭的 pin ---')
{
  const { timer, trigger, controller } = setup()
  userClick(controller, trigger)
  checkTrue('先钉住', controller.pinned)

  // 上游的 useDismissOnOutsidePointer 在 document 的 pointerdown 上直接关闭，不经过本状态机。
  trigger.expanded = false
  controller.enter()
  checkFalse('进入时读到已关闭，pin 被复位', controller.pinned)
  timer.runAll()
  check('随后悬停重新展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')

  controller.leave()
  timer.runAll()
  check('复位后离开能折叠', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H⑧ 重复进入 / 离开不叠加回调 ---')
{
  const { timer, trigger, controller } = setup()
  controller.enter()
  controller.enter()
  check('两次进入只留一个展开回调', timer.delays, [HOVER_OPEN_DELAY_MS])

  controller.leave()
  controller.leave()
  check('两次离开只留一个折叠回调', timer.delays, [HOVER_CLOSE_DELAY_MS])

  timer.runAll()
  check('进来的回调已被撤销，没有展开点击', trigger.clicks, 0)
  check('触发器是关闭的', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H⑨ 已展开时不重复点击 ---')
{
  const { timer, trigger, controller } = setup()
  controller.enter()
  timer.runAll()
  check('展开一次', trigger.clicks, 1)

  controller.enter()
  timer.runAll()
  check('再次进入不产生第二次点击', trigger.clicks, 1)
}

console.log('--- H⑩ 卸载后不再动作 ---')
{
  const { timer, trigger, controller } = setup()
  controller.enter()
  controller.dispose()

  check('待触发回调已清空', timer.delays, [])
  controller.enter()
  controller.leave()
  controller.click({ isTrusted: true, target: trigger })
  timer.runAll()
  check('卸载后没有任何点击', trigger.clicks, 0)
  checkFalse('卸载后不进入钉住状态', controller.pinned)
}

console.log('--- H⑪ 触发器缺席时是空操作 ---')
{
  const host = new FakeHost()
  host.querySelector = () => null
  const timer = new FakeTimer()
  const controller = createHoverOpen(host, timer)
  controller.enter()
  timer.runAll()
  controller.leave()
  timer.runAll()
  controller.click({ isTrusted: true, target: {} })
  checkTrue('全程不抛错', true)
}

console.log('--- H⑫ 两个延迟常量与子代理控件同值 ---')
{
  // 这一半钉住本插件的取值，另一半由 contract.json 的 subagent-hover-*-delay 钉住上游子代理
  // 控件仍是这两个数：两边同时成立才谈得上「手感一致」。
  check('展开延迟', HOVER_OPEN_DELAY_MS, 150)
  check('折叠延迟', HOVER_CLOSE_DELAY_MS, 120)
}

finish()
