/**
 * 文件树宽度记忆：存储清洗、用户调整后写回、新挂载恢复、重试与放手、安装 / 卸载。
 *
 * 运行：`node test/tree-width.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  INSTALL_MARKER,
  MAX_ATTEMPTS,
  PANE_MARKER,
  STORAGE_KEY,
  installTreeWidthMemory,
  readStoredWidth,
  rememberTreeWidth,
  restoreTreeWidth,
  sanitizeWidth,
  widthOf,
  writeStoredWidth,
} from '../src/tree-width.ts'
import {
  FakeDocument,
  FakeObserver,
  FakeStorage,
  check,
  checkTrue,
  finish,
  keyEvent,
  makeScheduler,
  makeTree,
  makeWarningSink,
  pointerEvent,
} from './tree-width-helpers.mjs'

/** 组装一份运行期状态。 */
function makeState(options = {}) {
  const scheduler = options.scheduler ?? makeScheduler()
  const warnings = options.warnings ?? makeWarningSink()
  return {
    scheduler,
    warnings,
    state: {
      storage: options.storage ?? new FakeStorage(),
      done: new WeakSet(),
      pending: new WeakSet(),
      schedule: scheduler.schedule,
      warn: warnings.warn,
    },
  }
}

console.log('--- A 存储读取与清洗 ---')
{
  check('没有存储面', readStoredWidth(undefined), null)
  check('没存过', readStoredWidth(new FakeStorage()), null)
  check('正常值', readStoredWidth(new FakeStorage({ values: { [STORAGE_KEY]: '360' } })), 360)
  check('小数取整', readStoredWidth(new FakeStorage({ values: { [STORAGE_KEY]: '360.6' } })), 361)
  check('高于上限夹住', readStoredWidth(new FakeStorage({ values: { [STORAGE_KEY]: '9999' } })), 600)
  check('低于下限夹住', readStoredWidth(new FakeStorage({ values: { [STORAGE_KEY]: '42' } })), 200)
  check('非数字', readStoredWidth(new FakeStorage({ values: { [STORAGE_KEY]: 'wide' } })), null)
  check('读取抛错', readStoredWidth(new FakeStorage({ failGet: true })), null)

  const storage = new FakeStorage()
  check('写入返回清洗值', writeStoredWidth(storage, 420.4), 420)
  check('写入到存储', storage.values.get(STORAGE_KEY), '420')
  check('写入抛错静默', writeStoredWidth(new FakeStorage({ failSet: true }), 300), null)
  check('没有存储面时写入为空', writeStoredWidth(undefined, 300), null)

  check('sanitize 非数字', sanitizeWidth(Number.NaN), null)
  check('sanitize 取整', sanitizeWidth(240.7), 241)
}

console.log('--- B 分隔条读数与用户调整后写回 ---')
{
  const { separator, pane } = makeTree({ width: 333 })
  check('读 aria-valuenow', widthOf(separator), 333)

  const storage = new FakeStorage()
  const { state } = makeState({ storage })
  check('记住宽度', rememberTreeWidth(separator, state), 333)
  check('写入存储', storage.values.get(STORAGE_KEY), '333')
  check('pane 留下诊断标记', pane.getAttribute(PANE_MARKER), '333')

  separator.setAttribute('aria-valuenow', '900')
  check('越界宽度写回时夹住', rememberTreeWidth(separator, state), 600)
  check('存储也是夹住后的值', storage.values.get(STORAGE_KEY), '600')

  const outside = makeTree({ width: 300 })
  outside.root.removeAttribute('data-forge-changes')
  check('不在 forge 根里不记', rememberTreeWidth(outside.separator, state), null)

  const noControls = makeTree({ width: 300, controls: false })
  check('没有 aria-controls 不记', rememberTreeWidth(noControls.separator, state), null)

  const noValue = makeTree({ width: 300, valuenow: false })
  check('没有 aria-valuenow 不记', rememberTreeWidth(noValue.separator, state), null)
}

console.log('--- C 新挂载恢复宽度 ---')
{
  const { separator, pane, calls } = makeTree({ width: 240, state: 240 })
  const storage = new FakeStorage({ values: { [STORAGE_KEY]: '360' } })
  const { state } = makeState({ storage })
  check('恢复成功', restoreTreeWidth(pane, state, separator), 'restored')
  check('setter 收到存储值', calls, [360])
  check('分隔条宽度更新', separator.getAttribute('aria-valuenow'), '360')
  check('pane 留下诊断标记', pane.getAttribute(PANE_MARKER), '360')
  check('同一 pane 不重复处理', restoreTreeWidth(pane, state, separator), 'skipped')

  const already = makeTree({ width: 360, state: 360 })
  const alreadyRun = makeState({ storage })
  check('已经是存储值', restoreTreeWidth(already.pane, alreadyRun.state, already.separator), 'already')
  check('已经相等时不调 setter', already.calls, [])
}

console.log('--- D 没有存过 / 找不到分隔条 ---')
{
  const { pane, calls, separator } = makeTree()
  const { state } = makeState()
  check('没存过时跳过', restoreTreeWidth(pane, state, separator), 'no-saved')
  check('没存过时不调 setter', calls, [])
  check('没存过也记为已处理', state.done.has(pane), true)

  const broken = makeTree()
  broken.pane.children = []
  const run = makeState({ storage: new FakeStorage({ values: { [STORAGE_KEY]: '300' } }) })
  check('pane 里没有分隔条', restoreTreeWidth(broken.pane, run.state), 'no-separator')
}

console.log('--- E fiber 暂时取不到与重试 ---')
{
  const { pane, separator, attachFiber, calls } = makeTree({ fiber: false })
  const { state, scheduler, warnings } = makeState({ storage: new FakeStorage({ values: { [STORAGE_KEY]: '360' } }) })
  check('取不到 setter 时重试', restoreTreeWidth(pane, state, separator), 'retry')
  check('安排了一次重试', scheduler.size, 1)
  attachFiber()
  scheduler.drain()
  check('下一帧写回', calls, [360])
  check('成功时不告警', warnings.size, 0)

  const alwaysMissing = makeTree({ fiber: false })
  const givingUp = makeState({ storage: new FakeStorage({ values: { [STORAGE_KEY]: '360' } }) })
  restoreTreeWidth(alwaysMissing.pane, givingUp.state, alwaysMissing.separator)
  givingUp.scheduler.drain(MAX_ATTEMPTS + 4)
  check('重试用尽后放手', givingUp.scheduler.size, 0)
  check('连续失败告警一次', givingUp.warnings.size, 1)
  check('放手后记为已处理', givingUp.state.done.has(alwaysMissing.pane), true)

  const throwing = makeTree({ dispatchThrows: true })
  const throwRun = makeState({ storage: new FakeStorage({ values: { [STORAGE_KEY]: '360' } }) })
  restoreTreeWidth(throwing.pane, throwRun.state, throwing.separator)
  throwRun.scheduler.drain(MAX_ATTEMPTS + 4)
  check('setter 抛错也收敛为告警', throwRun.warnings.size, 1)

  for (const [label, options] of [
    ['没有 onWidth', { onWidth: null }],
    ['position 不是文件树取值', { position: 'bottom' }],
  ]) {
    const impostor = makeTree(options)
    const run = makeState({ storage: new FakeStorage({ values: { [STORAGE_KEY]: '360' } }) })
    check(`${label}时先重试`, restoreTreeWidth(impostor.pane, run.state, impostor.separator), 'retry')
    run.scheduler.drain(MAX_ATTEMPTS + 4)
    check(`${label}时不写 state`, impostor.calls, [])
    check(`${label}时告警`, run.warnings.size, 1)
  }
}

console.log('--- F 断开后不再写 ---')
{
  const { pane, separator } = makeTree({ connected: false })
  const { state } = makeState({ storage: new FakeStorage({ values: { [STORAGE_KEY]: '360' } }) })
  check('pane 已断开', restoreTreeWidth(pane, state, separator), 'detached')
}

console.log('--- G 安装、观察与事件 ---')
{
  FakeObserver.reset()
  const storage = new FakeStorage({ values: { [STORAGE_KEY]: '360' } })
  const existing = makeTree()
  const doc = new FakeDocument({ storage })
  doc.mount(existing.root)
  const { scheduler, warnings } = makeState()
  const dispose = installTreeWidthMemory(doc, { storage, schedule: scheduler.schedule, defer: (callback) => callback(), warn: warnings.warn })
  check('装上后写入安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), '')
  check('装上后恢复已存在的文件树', existing.calls, [360])
  checkTrue('观察 body', FakeObserver.last()?.observed[0]?.target === doc.body)
  check('监听 pointerup / keyup', doc.types.sort(), ['keyup', 'pointerup'])

  const mounted = makeTree()
  FakeObserver.last().emit([{ addedNodes: [mounted.root] }])
  check('新增标签页根时恢复', mounted.calls, [360])

  const lateTree = makeTree({ withPane: false })
  doc.mount(lateTree.root)
  FakeObserver.last().emit([{ addedNodes: [lateTree.root] }])
  check('只有根时什么也不做', lateTree.calls, [])
  lateTree.root.append(lateTree.pane)
  FakeObserver.last().emit([{ addedNodes: [lateTree.pane] }])
  check('先有根、后插入 pane 也能恢复', lateTree.calls, [360])

  lateTree.separator.setAttribute('aria-valuenow', '420')
  doc.dispatch('pointerup', pointerEvent(lateTree.separator))
  check('指针调整后写回', storage.values.get(STORAGE_KEY), '420')
  check('写回后 pane 标记更新', lateTree.pane.getAttribute(PANE_MARKER), '420')

  lateTree.separator.setAttribute('aria-valuenow', '380')
  doc.dispatch('keyup', keyEvent(lateTree.separator, 'ArrowLeft'))
  check('方向键调整后写回', storage.values.get(STORAGE_KEY), '380')

  const before = storage.values.get(STORAGE_KEY)
  lateTree.separator.setAttribute('aria-valuenow', '300')
  doc.dispatch('keyup', keyEvent(lateTree.separator, 'Enter'))
  check('其它按键不写', storage.values.get(STORAGE_KEY), before)

  dispose()
  check('卸载后无监听', doc.types, [])
  check('卸载后移除安装标记', doc.documentElement.getAttribute(INSTALL_MARKER), null)
  checkTrue('卸载后断开观察', FakeObserver.last()?.disconnected === true)
}

console.log('--- H 宽度读取推迟到 React 提交之后 ---')
{
  const storage = new FakeStorage({ values: { [STORAGE_KEY]: '360' } })
  const tree = makeTree({ width: 360, state: 360 })
  const doc = new FakeDocument({ storage })
  doc.mount(tree.root)
  const queued = []
  const dispose = installTreeWidthMemory(doc, {
    storage,
    schedule: (callback) => callback(),
    defer: (callback) => queued.push(callback),
    warn: () => {},
  })
  tree.separator.setAttribute('aria-valuenow', '420')
  doc.dispatch('pointerup', pointerEvent(tree.separator))
  check('事件发生时还没写', storage.values.get(STORAGE_KEY), '360')
  check('读取已排队', queued.length, 1)
  tree.separator.setAttribute('aria-valuenow', '480')
  queued.shift()?.()
  check('提交后读到最终宽度', storage.values.get(STORAGE_KEY), '480')
  dispose()
}

console.log('--- I 没有 body / 观察器时空操作 ---')
{
  checkTrue('没有 body 时返回卸载函数', typeof installTreeWidthMemory({ body: null }) === 'function')
  checkTrue('没有观察器时返回卸载函数', typeof installTreeWidthMemory({
    body: new (class {})(),
    defaultView: {},
  }) === 'function')
}

finish()
