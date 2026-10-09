/**
 * 悬停开合状态机：延迟展开、延迟折叠、pin 语义（用户点击打开后离开不折叠）、
 * 宿主内位移不触发、以及卸载后不再动作。
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
} from './helpers.mjs'
import { createHoverOpen } from '../src/hover-open.ts'

/** 从宿主外进入的事件。 */
const enterEvent = () => ({ relatedTarget: undefined })
/** 离开宿主的事件。 */
const leaveEvent = () => ({ relatedTarget: undefined })

/** 组装一套装置；「用户点了一下触发器」用 `host.userClick()`（含上游 onClick 的传播建模）。 */
function setup() {
  const trigger = new FakeTrigger()
  const host = new FakeHost(trigger)
  const timer = new FakeTimer()
  const controller = createHoverOpen(host, timer)
  return { trigger, host, timer, controller }
}

console.log('--- H① 悬停延迟展开 ---')
{
  const { host, timer, trigger } = setup()
  host.emit('mouseover', enterEvent())
  check('排一个延迟回调', timer.delays, [HOVER_OPEN_DELAY_MS])
  check('延迟未到时还没点击', trigger.clicks, 0)
  timer.runAll()
  check('延迟到点后点击一次', trigger.clicks, 1)
  check('触发器已展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
}

console.log('--- H② 不足延迟就离开则不展开 ---')
{
  const { host, timer, trigger } = setup()
  host.emit('mouseover', enterEvent())
  host.emit('mouseout', leaveEvent())
  check('进来那个回调已被撤销，只剩离开的折叠回调', timer.delays, [HOVER_CLOSE_DELAY_MS])
  timer.runAll()
  check('没有展开', trigger.clicks, 0)
  check('触发器仍是关闭的', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H③ 已展开后离开延迟折叠 ---')
{
  const { host, timer, trigger } = setup()
  trigger.expanded = true
  host.emit('mouseout', leaveEvent())
  check('排一个折叠回调', timer.delays, [HOVER_CLOSE_DELAY_MS])
  timer.runAll()
  check('折叠时点击一次', trigger.clicks, 1)
  check('触发器已关闭', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H④ 点击把它钉住，离开不折叠 ---')
{
  const { host, timer, trigger, controller } = setup()
  host.userClick()
  checkTrue('点击后处于钉住状态', controller.pinned)
  check('未展开时点击放行给上游，上游 onClick 展开', trigger.clicks, 1)
  check('触发器已展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')

  host.emit('mouseout', leaveEvent())
  timer.runAll()
  check('离开后没有折叠点击', trigger.clicks, 1)
  check('触发器仍然展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
}

console.log('--- H⑤ 已展开时点击不折叠（与子代理控件一致） ---')
{
  const { host, trigger, controller } = setup()
  host.userClick()
  check('先由点击展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')

  host.userClick()
  check('已展开时那次点击被拦下，上游 toggle 没有派发', trigger.clicks, 1)
  check('触发器保持展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
  checkTrue('仍然是钉住状态', controller.pinned)

  // 悬停展开（未钉住）之后点击，同样只钉住、不折叠。
  const hovered = setup()
  hovered.host.emit('mouseover', enterEvent())
  hovered.timer.runAll()
  check('悬停展开一次', hovered.trigger.clicks, 1)
  hovered.host.userClick()
  check('悬停展开后点击也不折叠', hovered.trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')
  checkTrue('并转为钉住', hovered.controller.pinned)
}

console.log('--- H⑥ 只有受信任的触发器点击才改变 pin ---')
{
  const synthetic = setup()
  synthetic.host.emit('click', { isTrusted: false, target: synthetic.trigger })
  checkFalse('合成 click 不改 pin', synthetic.controller.pinned)
  check('合成 click 不产生额外点击', synthetic.trigger.clicks, 0)

  const menu = setup()
  const menuNode = { tag: 'menu-row' }
  menu.host.children.add(menuNode)
  menu.host.userClick(menuNode)
  checkFalse('点在菜单里不改 pin', menu.controller.pinned)
  check('点在菜单里不改变开合', menu.trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H⑦ 进入时复位被外部关闭的 pin ---')
{
  const { host, timer, trigger, controller } = setup()
  host.userClick()
  checkTrue('先钉住', controller.pinned)

  // 上游的 useDismissOnOutsidePointer 在 document 的 pointerdown 上直接关闭，不经过本状态机。
  trigger.expanded = false
  host.emit('mouseover', enterEvent())
  checkFalse('进入时读到已关闭，pin 被复位', controller.pinned)
  timer.runAll()
  check('随后悬停重新展开', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'true')

  host.emit('mouseout', leaveEvent())
  timer.runAll()
  check('复位后离开能折叠', trigger.getAttribute(EXPANDED_ATTRIBUTE), 'false')
}

console.log('--- H⑧ 指针在宿主内位移不触发开合 ---')
{
  const { host, timer, trigger } = setup()
  trigger.expanded = true
  host.emit('mouseover', { relatedTarget: trigger })
  host.emit('mouseout', { relatedTarget: trigger })
  check('没有排任何回调', timer.delays, [])
  check('没有点击', trigger.clicks, 0)
}

console.log('--- H⑨ 已展开时不重复点击 ---')
{
  const { host, timer, trigger } = setup()
  host.emit('mouseover', enterEvent())
  timer.runAll()
  check('展开一次', trigger.clicks, 1)

  host.emit('mouseout', { relatedTarget: trigger })
  host.emit('mouseover', { relatedTarget: trigger })
  timer.runAll()
  check('宿主内位移不产生第二次点击', trigger.clicks, 1)
}

console.log('--- H⑩ 卸载后不再动作 ---')
{
  const { host, timer, trigger, controller } = setup()
  host.emit('mouseover', enterEvent())
  controller.dispose()

  check('监听已摘除', host.types, [])
  check('待触发回调已清空', timer.delays, [])
  host.emit('mouseover', enterEvent())
  host.emit('mouseout', leaveEvent())
  timer.runAll()
  check('卸载后没有任何点击', trigger.clicks, 0)
}

console.log('--- H⑪ 触发器缺席时是空操作 ---')
{
  const host = new FakeHost()
  host.querySelector = () => null
  const timer = new FakeTimer()
  createHoverOpen(host, timer)
  host.emit('mouseover', enterEvent())
  timer.runAll()
  host.emit('mouseout', leaveEvent())
  timer.runAll()
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
