/**
 * `src/motion.ts` 的行为测试：判定哪些目标属于左栏排序行、只压动画时长不动其它选项、
 * 包装与还原 `Element.prototype.animate`。
 *
 * 不需要真实 DOM：原型、行元素与退场浮层都用最小替身。运行：
 * `node test/motion.test.mjs`（或 `pnpm test` 跑全部）。
 */
import {
  LEFT_SIDEBAR_SLOT_SELECTOR,
  ROW_KEY_ATTRIBUTE,
  installSidebarReorderMotionOff,
  isReorderRow,
  withoutMotion,
} from '../src/motion.ts'

let failures = 0

function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/**
 * 最小元素替身：`closest` 只认左栏槽位选择器，`parentElement.className` 模拟退场浮层。
 * @param {{ key?: string, inSidebar?: boolean, parentClass?: string }} shape
 */
function fakeElement({ key, inSidebar = true, parentClass = '' } = {}) {
  return {
    hasAttribute: (name) => name === ROW_KEY_ATTRIBUTE && key !== undefined,
    closest: (selector) => (selector === LEFT_SIDEBAR_SLOT_SELECTOR && inSidebar ? {} : null),
    parentElement: { className: parentClass },
  }
}

/** 记录调用的 `animate` 原型替身。 */
function fakePrototype() {
  const calls = []
  const original = function animate(keyframes, options) {
    calls.push({ self: this, keyframes, options })
    return { animation: true }
  }
  return { prototype: { animate: original }, calls, original }
}

console.log('--- M① 只有左栏槽位里的行与退场克隆才算排序行 ---')
{
  check('左栏里的工作区行', isReorderRow(fakeElement({ key: 'workspace:a' })), true)
  check('左栏里的会话行', isReorderRow(fakeElement({ key: 'session:a' })), true)
  check('左栏外的行（设置页的模型列表）', isReorderRow(fakeElement({ key: 'model:a', inSidebar: false })), false)
  check('左栏里的退场克隆（父级是 _exits 浮层）', isReorderRow(fakeElement({ parentClass: 'e2VKQa_exits' })), true)
  check('父级类名只是含 _exits 片段的其它浮层', isReorderRow(fakeElement({ parentClass: 'e2VKQa_exitsBox' })), false)
  check('左栏外的退场克隆', isReorderRow(fakeElement({ parentClass: 'e2VKQa_exits', inSidebar: false })), false)
  check('左栏里既不是行也不在浮层下的元素', isReorderRow(fakeElement({ parentClass: 'bhn1Oq_list' })), false)
}

console.log('--- M② 只把时长压成 0，其它选项原样保留 ---')
{
  check('数字时长', withoutMotion(200), 0)
  check('缺省选项', withoutMotion(undefined), 0)
  check('对象选项', withoutMotion({ duration: 200, delay: 40, endDelay: 10, easing: 'ease-out', fill: 'forwards' }), {
    duration: 0,
    delay: 0,
    endDelay: 0,
    easing: 'ease-out',
    fill: 'forwards',
  })
}

console.log('--- M③ 包装后：排序行的动画立即结束，其它元素不动 ---')
{
  const { prototype, calls, original } = fakePrototype()
  const dispose = installSidebarReorderMotionOff(prototype)
  const row = fakeElement({ key: 'workspace:a' })
  const option = { duration: 200, easing: 'ease-out' }

  prototype.animate.call(row, [{ opacity: 0 }, { opacity: 1 }], option)
  check('行元素收到 0 时长', calls[0].options, { duration: 0, easing: 'ease-out', delay: 0, endDelay: 0 })
  check('原来的 this 与关键帧不变', [calls[0].self, calls[0].keyframes], [row, [{ opacity: 0 }, { opacity: 1 }]])

  prototype.animate.call(row, [], 200)
  check('数字时长也被压成 0', calls[1].options, 0)

  const other = fakeElement({ key: 'model:a', inSidebar: false })
  prototype.animate.call(other, [], option)
  check('左栏以外的 animate 原样放行', calls[2].options, option)

  check('退场克隆同样立即结束', (() => {
    prototype.animate.call(fakeElement({ parentClass: 'e2VKQa_exits' }), [], { duration: 100, fill: 'forwards' })
    return calls[3].options
  })(), { duration: 0, fill: 'forwards', delay: 0, endDelay: 0 })

  dispose()
  check('卸载后恢复原方法', prototype.animate === original, true)
  check('卸载后排序行重新按原时长播放', (() => {
    prototype.animate.call(row, [], option)
    return calls[4].options
  })(), option)
}

console.log('--- M④ 重复卸载与缺少 animate 的原型 ---')
{
  const { prototype, original } = fakePrototype()
  const dispose = installSidebarReorderMotionOff(prototype)
  const patched = prototype.animate
  dispose()
  check('还原成原始函数', prototype.animate === original, true)
  check('包装函数确实被换下来', patched === original, false)
  dispose()
  check('重复卸载不报错且保持原函数', prototype.animate === original, true)

  const empty = {}
  const stop = installSidebarReorderMotionOff(empty)
  check('没有 animate 时返回可调用的空清理函数', typeof stop, 'function')
  stop()
  check('没有 animate 时不写入属性', Object.keys(empty), [])
}

finish()
