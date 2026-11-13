/**
 * 身份 / 呈现方式读数、首次默认值、切页重挂与呈现方式切换、失败收敛，以及观察器装配行为。
 *
 * 运行：`node test/split-default.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  APPLIED_MARKER,
  FULLSCREEN,
  INSTALL_MARKER,
  MAX_ATTEMPTS,
  PANEL_ATTRIBUTE,
  PUSH,
  createSplitState,
  installReviewSplitDefault,
  panelModeOf,
  reviewKey,
  syncReviewSplit,
} from '../src/split-default.ts'
import {
  FakeDocument,
  FakeElement,
  FakeObserver,
  check,
  checkTrue,
  finish,
  makeReview,
  makeScheduler,
  makeWarningSink,
} from './split-helpers.mjs'

console.log('--- U① 身份与面板呈现方式读数 ---')
{
  check('占位实例身份优先', reviewKey(makeReview({ occurrence: 'occ-9' }).root), 'occurrence:occ-9')
  check('回退身份 = 会话 + 标签页',
    reviewKey(makeReview({ occurrence: null, session: 's1', tab: 't2' }).root), 'tab:s1|t2')
  check('没有标签页 id：不猜', reviewKey(makeReview({ occurrence: null, tab: null }).root), null)
  check('push', panelModeOf(makeReview({ mode: PUSH }).root), PUSH)
  check('fullscreen', panelModeOf(makeReview({ mode: FULLSCREEN }).root), FULLSCREEN)

  const orphan = new FakeElement('div')
  orphan.append(new FakeElement('div', { 'data-changes-review': '' }))
  check('没有面板：undefined', panelModeOf(orphan.querySelector('[data-changes-review]')), undefined)
}

console.log('--- U② 首次挂载：等 seed 后按呈现方式设默认值 ---')
{
  const scheduler = makeScheduler()
  const warnings = makeWarningSink()
  const state = createSplitState({ schedule: scheduler.schedule, warn: warnings.warn })

  const push = makeReview({ mode: PUSH, pressed: false, occurrence: 'occ-push' })
  check('seed 前：等待', syncReviewSplit(push.root, state), 'retry')
  check('还没调用', push.calls, [])
  push.setPressed(true)
  check('seed 后重试一帧', scheduler.drain(), 1)
  check('push：切成单栏一次', push.calls, ['unified'])
  check('记住呈现方式', state.applied.get('occurrence:occ-push'), PUSH)
  check('根元素标记', push.root.getAttribute(APPLIED_MARKER), PUSH)

  const full = makeReview({ mode: FULLSCREEN, pressed: false, occurrence: 'occ-full' })
  check('全屏 seed 前同样等待', syncReviewSplit(full.root, state), 'retry')
  full.setPressed(true)
  check('重试一帧', scheduler.drain(), 1)
  check('fullscreen：保持左右对比（默认值本身已是 true）', full.calls, [])
  check('记住全屏', state.applied.get('occurrence:occ-full'), FULLSCREEN)

  const seeded = makeReview({ mode: PUSH, pressed: true, occurrence: 'occ-seeded' })
  check('首帧就已 seed：直接切单栏', syncReviewSplit(seeded.root, state), 'applied')
  check('调用一次', seeded.calls, ['unified'])
}

console.log('--- U③ 切页重挂与呈现方式变化 ---')
{
  const scheduler = makeScheduler()
  const warnings = makeWarningSink()
  const state = createSplitState({ schedule: scheduler.schedule, warn: warnings.warn })

  const first = makeReview({ mode: PUSH, pressed: true, occurrence: 'occ-mode' })
  syncReviewSplit(first.root, state)

  const remount = makeReview({ mode: PUSH, pressed: false, occurrence: 'occ-mode' })
  check('同一呈现方式下重挂：跳过，尊重用户选择', syncReviewSplit(remount.root, state), 'skipped')
  check('不调用', remount.calls, [])

  remount.setMode(FULLSCREEN)
  check('进入全屏：切到左右对比', syncReviewSplit(remount.root, state), 'applied')
  check('调用一次', remount.calls, ['split'])

  remount.setMode(FULLSCREEN)
  check('同一呈现方式再次同步：跳过', syncReviewSplit(remount.root, state), 'skipped')
  check('调用仍只有一次', remount.calls, ['split'])

  remount.setMode(PUSH)
  check('退出全屏：切回单栏', syncReviewSplit(remount.root, state), 'applied')
  check('调用两次', remount.calls, ['split', 'unified'])

  const pending = makeReview({ mode: PUSH, pressed: false, occurrence: 'occ-pending' })
  check('首次同步排队', syncReviewSplit(pending.root, state), 'retry')
  check('排队期间再同步：不重复', syncReviewSplit(pending.root, state), 'skipped')
}

console.log('--- U④ 失败收敛 ---')
{
  const scheduler = makeScheduler()
  const warnings = makeWarningSink()
  const state = createSplitState({ schedule: scheduler.schedule, warn: warnings.warn })

  const missing = makeReview({ mode: PUSH, pressed: true, occurrence: 'occ-nobtn', button: false })
  check('没有分栏按钮：重试', syncReviewSplit(missing.root, state), 'retry')
  scheduler.drain(MAX_ATTEMPTS + 4)
  check('用尽帧数后告警一次', warnings.size, 1)
  check('不再排队', state.pending.has('occurrence:occ-nobtn'), false)

  const disconnected = makeReview({ mode: PUSH, pressed: true, occurrence: 'occ-off', connected: false })
  check('已断开：不动作', syncReviewSplit(disconnected.root, state), 'detached')

  const anonymous = makeReview({ occurrence: null, tab: null })
  check('没有身份：跳过', syncReviewSplit(anonymous.root, state), 'skipped')
  check('告警一次', warnings.size, 2)

  let attempts = 0
  const calls = []
  const throwing = makeReview({
    mode: PUSH,
    pressed: true,
    occurrence: 'occ-throw',
    handler: () => {
      attempts += 1
      if (attempts < 3) throw new Error('no review state for tab')
      calls.push('split')
    },
  })
  check('handler 抛错：重试', syncReviewSplit(throwing.root, state), 'retry')
  scheduler.drain()
  check('第三次成功', calls, ['split'])
  check('一共尝试三次', attempts, 3)
  check('成功后记住', state.applied.get('occurrence:occ-throw'), PUSH)
}

console.log('--- U⑤ 观察器：挂载与呈现方式变化 ---')
{
  FakeObserver.reset()
  const scheduler = makeScheduler()
  const warnings = makeWarningSink()
  const initial = makeReview({ mode: PUSH, pressed: true, occurrence: 'occ-a' })
  const doc = new FakeDocument({ roots: [initial.root] })
  const dispose = installReviewSplitDefault(doc, { schedule: scheduler.schedule, warn: warnings.warn })

  check('安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), '')
  check('初始审查根已处理', initial.calls, ['unified'])
  const observer = FakeObserver.last()
  check('同时观察子树与面板属性', observer.observed[0].options, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [PANEL_ATTRIBUTE],
  })

  const added = makeReview({ mode: FULLSCREEN, pressed: false, occurrence: 'occ-b' })
  observer.emit([{ addedNodes: [added.root] }])
  check('新审查根先等 seed', added.calls, [])
  added.setPressed(true)
  scheduler.drain()
  check('全屏下保持左右对比', added.calls, [])
  check('应用 fullscreen 标记', added.root.getAttribute(APPLIED_MARKER), FULLSCREEN)

  initial.setMode(FULLSCREEN)
  observer.emit([{ target: initial.panel }])
  check('面板切全屏：切到左右对比', initial.calls, ['unified', 'split'])

  initial.setMode(PUSH)
  observer.emit([{ target: initial.panel }])
  check('面板切回推挤：切回单栏', initial.calls, ['unified', 'split', 'unified'])

  dispose()
  check('卸载断开观察', observer.disconnected, true)
  check('卸载移除安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), null)
}

console.log('--- U⑥ 非浏览器环境：空操作 ---')
{
  const noBody = new FakeDocument({ withBody: false })
  const dispose = installReviewSplitDefault(noBody, {})
  check('没有 body：返回空卸载函数', typeof dispose, 'function')
  dispose()
  checkTrue('不抛错', true)
}

finish()
