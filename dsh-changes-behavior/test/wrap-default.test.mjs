/**
 * 默认换行逻辑：身份判定、一次写入、重试与放手、切页去重、安装 / 卸载。
 *
 * 运行：`node test/wrap-default.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  APPLIED_MARKER,
  INSTALL_MARKER,
  MAX_ATTEMPTS,
  defaultReviewWrap,
  installReviewWrapDefault,
  reviewKey,
} from '../src/wrap-default.ts'
import {
  FakeDocument,
  FakeObserver,
  check,
  finish,
  makeReview,
  makeScheduler,
  makeWarningSink,
} from './wrap-helpers.mjs'

function freshState(runtime = {}) {
  const scheduler = makeScheduler()
  const warnings = makeWarningSink()
  return {
    scheduler,
    warnings,
    state: {
      done: new Set(),
      pending: new Set(),
      warned: new Set(),
      roots: new Map(),
      schedule: scheduler.schedule,
      warn: warnings.warn,
      ...runtime,
    },
  }
}

console.log('--- A 标签页身份 ---')
{
  const withOccurrence = makeReview({ occurrence: 'occ-7', tab: 'tab9', session: 's-2' })
  check('占位实例优先', reviewKey(withOccurrence.root), 'occurrence:occ-7')

  const fallback = makeReview({ occurrence: null, tab: 'tab9', session: 's-2' })
  check('回退到会话 + 标签页', reviewKey(fallback.root), 'tab:s-2|tab9')

  const noSession = makeReview({ occurrence: null, tab: 'tab9', session: null })
  check('缺会话时回退到标签页', reviewKey(noSession.root), 'tab:|tab9')

  const nothing = makeReview({ occurrence: null, tab: null, session: 's-2' })
  check('三者都缺时为 null', reviewKey(nothing.root), null)

  const empty = makeReview({ occurrence: '', tab: null, session: null })
  check('空属性值不当作身份', reviewKey(empty.root), null)
}

console.log('--- B 一次写入与去重 ---')
{
  const { root, calls } = makeReview({ wrap: false })
  const { state } = freshState()
  check('未换行时写入一次', defaultReviewWrap(root, state), 'wrapped')
  check('换行按钮只被调用一次', calls.length, 1)
  check('根元素留下生效标记', root.getAttribute(APPLIED_MARKER), '')
  check('身份进入已处理集合', [...state.done], ['occurrence:occ-1'])

  const remount = makeReview({ wrap: false })
  check('同一标签页重挂后跳过', defaultReviewWrap(remount.root, state), 'skipped')
  check('重挂不再次写换行', remount.calls.length, 0)
}

console.log('--- C 已经换行的标签页 ---')
{
  const byBody = makeReview({ wrap: true })
  const stateA = freshState()
  check('正文已带 data-review-wrap', defaultReviewWrap(byBody.root, stateA.state), 'already')
  check('已是换行态时不调用按钮', byBody.calls.length, 0)

  const byButton = makeReview({ wrap: false })
  byButton.button.setAttribute('aria-pressed', 'true')
  const stateB = freshState()
  check('按钮 aria-pressed=true', defaultReviewWrap(byButton.root, stateB.state), 'already')
  check('按钮已按下时不重复调用', byButton.calls.length, 0)
}

console.log('--- D 找不到身份 / 按钮 / handler ---')
{
  const noKey = makeReview({ occurrence: null, tab: null, session: null })
  const { state, warnings } = freshState()
  check('没有身份时跳过', defaultReviewWrap(noKey.root, state), 'skipped')
  check('没有身份时不调用按钮', noKey.calls.length, 0)
  check('没有身份时告警一次', warnings.size, 1)

  const noButton = makeReview({ button: false })
  const noButtonRun = freshState()
  check('缺按钮时先重试', defaultReviewWrap(noButton.root, noButtonRun.state), 'retry')
  noButtonRun.scheduler.drain()
  check('重试用尽后放手', noButtonRun.scheduler.size, 0)
  check('缺按钮告警一次', noButtonRun.warnings.size, 1)

  const noHandler = makeReview({ handler: null })
  const noHandlerRun = freshState()
  defaultReviewWrap(noHandler.root, noHandlerRun.state)
  noHandlerRun.scheduler.drain()
  check('缺 onClick 告警一次', noHandlerRun.warnings.size, 1)
}

console.log('--- E seed 竞态与重试 ---')
{
  let attempts = 0
  const flaky = makeReview({
    handler() {
      attempts += 1
      if (attempts === 1) throw new Error('no review state for tab "tab2"')
    },
  })
  const run = freshState()
  check('首次抛错时先重试', defaultReviewWrap(flaky.root, run.state), 'retry')
  check('已安排一次重试', run.scheduler.size, 1)
  run.scheduler.drain()
  check('下一帧写入成功', attempts, 2)
  check('成功后进入已处理集合', run.state.done.has('occurrence:occ-1'), true)
  check('成功时不告警', run.warnings.size, 0)
}

console.log('--- F 连续失败与断开 ---')
{
  const alwaysThrows = makeReview({
    handler() {
      throw new Error('still missing')
    },
  })
  const run = freshState()
  defaultReviewWrap(alwaysThrows.root, run.state)
  run.scheduler.drain(MAX_ATTEMPTS + 4)
  check('重试用尽后不再排队', run.scheduler.size, 0)
  check('连续失败告警一次', run.warnings.size, 1)
  check('失败时不标记生效', alwaysThrows.root.getAttribute(APPLIED_MARKER), null)

  const detached = makeReview({ connected: false })
  const detachedRun = freshState()
  check('根已断开时直接放弃', defaultReviewWrap(detached.root, detachedRun.state), 'detached')
  check('断开时不安排重试', detachedRun.scheduler.size, 0)
}

console.log('--- G 用户关掉后切页再回来 ---')
{
  const first = makeReview({ wrap: false })
  const run = freshState()
  defaultReviewWrap(first.root, run.state)
  check('首次打开默认换行', first.calls.length, 1)

  // 用户手动关闭换行：正文属性消失、按钮回到未按下。
  const reloaded = makeReview({ wrap: false })
  check('切页重挂不再改写', defaultReviewWrap(reloaded.root, run.state), 'skipped')
  check('不会把用户关掉的换行又打开', reloaded.calls.length, 0)

  // 关闭标签页后重新打开：新的占位实例 id，重新按默认开启。
  const reopened = makeReview({ occurrence: 'occ-2', wrap: false })
  check('新标签页重新默认换行', defaultReviewWrap(reopened.root, run.state), 'wrapped')
  check('新标签页调用一次', reopened.calls.length, 1)
}

console.log('--- H 安装与卸载 ---')
{
  FakeObserver.reset()
  const doc = new FakeDocument()
  const run = freshState()
  const dispose = installReviewWrapDefault(doc, {
    schedule: run.state.schedule,
    warn: run.state.warn,
  })
  check('观察 body', FakeObserver.last().observed[0]?.target, doc.body)
  check('观察 childList + subtree', FakeObserver.last().observed[0]?.options, { childList: true, subtree: true })
  check('安装标记写入文档根', doc.documentElement.getAttribute(INSTALL_MARKER), '')

  const { root, calls } = makeReview({ wrap: false })
  FakeObserver.last().emit([{ addedNodes: [root] }])
  check('新增审查根时写入一次', calls.length, 1)

  dispose()
  check('卸载后断开观察', FakeObserver.last().disconnected, true)
  check('卸载后移除安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), null)
}

console.log('--- I 安装时扫到已存在的审查根 ---')
{
  FakeObserver.reset()
  const existing = makeReview({ occurrence: 'occ-existing', wrap: false })
  const doc = new FakeDocument({ roots: [existing.root] })
  const run = freshState()
  installReviewWrapDefault(doc, { schedule: run.state.schedule, warn: run.state.warn })
  check('安装时扫到的根也写入', existing.calls.length, 1)
}

console.log('--- J 无 body / 无观察器 ---')
{
  FakeObserver.reset()
  const noBody = new FakeDocument({ withBody: false })
  installReviewWrapDefault(noBody, {})
  check('无 body 时不安装观察器', FakeObserver.instances.length, 0)
  check('无 body 时不写安装标记', noBody.documentElement.getAttribute(INSTALL_MARKER), null)

  const noObserver = new FakeDocument({ withObserver: false })
  const previous = globalThis.MutationObserver
  delete globalThis.MutationObserver
  try {
    installReviewWrapDefault(noObserver, {})
  } finally {
    if (previous !== undefined) globalThis.MutationObserver = previous
  }
  check('无观察器时不安装', FakeObserver.instances.length, 0)
  check('无观察器时不写安装标记', noObserver.documentElement.getAttribute(INSTALL_MARKER), null)
}

finish()
