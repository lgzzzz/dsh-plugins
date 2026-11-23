/**
 * `src/pin.ts` 的行为测试:偏好补写、状态巡查、放得下时才点击的兜底与停止条件。
 *
 * 不需要 DOM:文档 / 存储 / 定时器 / 时钟都用最小替身,依赖 Node 22+ 的 Type Stripping
 * 直接 import `.ts`。跑全部请用 `node test/run-all.mjs`(或 `pnpm test`)。
 */
import {
  MAIN_CONVERSATION_SELECTOR,
  PANEL_PINNED_STORAGE_KEY,
  PANEL_PROBE_SELECTOR,
  PANEL_TOGGLE_SELECTOR,
  PINNED_PROBE_SELECTOR,
  inspectPanelPin,
  keepSessionPanelOpen,
  seedPanelPinnedPreference,
} from '../src/pin.ts'

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

/** 最小 localStorage 替身:记录写入次数,内容按键存放。 */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  const storage = {
    writes: 0,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      storage.writes += 1
      data.set(key, String(value))
    },
  }
  return storage
}

/**
 * 最小元素替身:属性可读、点击可计数、宽度可改、子选择器查表可改。
 * `children` 传对象,测试可在模拟挂载 / 重渲染时增删。
 */
function fakeElement({ attributes = {}, width = 1, children = {} } = {}) {
  const state = { clicks: 0, onClick: undefined, attributes: { ...attributes }, width }
  return {
    state,
    children,
    getAttribute: (name) => (name in state.attributes ? state.attributes[name] : null),
    getBoundingClientRect: () => ({ width: state.width }),
    querySelector: (selector) => children[selector] ?? null,
    click: () => {
      state.clicks += 1
      state.onClick?.()
    },
  }
}

/** 按选择器查表的最小文档替身。 */
function fakeDocument(selectors = {}) {
  return { querySelector: (selector) => selectors[selector] ?? null }
}

/** 组一棵「主对话」子树:开关与停靠探针都挂在它下面。 */
function mainConversation({ toggle, probe } = {}) {
  const children = {}
  if (toggle !== undefined) children[PANEL_TOGGLE_SELECTOR] = toggle
  if (probe !== undefined) children[PANEL_PROBE_SELECTOR] = probe
  return fakeElement({ children })
}

/** 可推进的假时钟。 */
function fakeClock(start = 0) {
  let time = start
  return {
    now: () => time,
    advance: (ms) => {
      time += ms
    },
  }
}

/** 最小 window 替身:定时器挂在假时钟上,`runDue` 执行所有到期的回调。 */
function fakeWindow({ document, localStorage, clock }) {
  let nextId = 1
  const jobs = new Map()
  const win = {
    document,
    localStorage,
    setTimeout: (handler, ms) => {
      const id = nextId
      nextId += 1
      jobs.set(id, { handler, at: clock.now() + ms })
      return id
    },
    clearTimeout: (id) => {
      jobs.delete(id)
    },
  }
  return {
    win,
    pending: () => jobs.size,
    runDue: () => {
      for (;;) {
        let due
        for (const [id, job] of jobs) {
          if (job.at <= clock.now() && (due === undefined || job.at < due.job.at)) due = { id, job }
        }
        if (due === undefined) return
        jobs.delete(due.id)
        due.job.handler()
      }
    },
  }
}

// ---- 偏好补写 -------------------------------------------------------------

{
  const storage = fakeStorage()
  seedPanelPinnedPreference(storage)
  check('缺失时补写 true', storage.getItem(PANEL_PINNED_STORAGE_KEY), 'true')
}
{
  const storage = fakeStorage({ [PANEL_PINNED_STORAGE_KEY]: 'false' })
  seedPanelPinnedPreference(storage)
  check('历史 false 补写 true', storage.getItem(PANEL_PINNED_STORAGE_KEY), 'true')
}
{
  const storage = fakeStorage({ [PANEL_PINNED_STORAGE_KEY]: 'true' })
  seedPanelPinnedPreference(storage)
  check('已经 true 时不写', storage.writes, 0)
}
{
  const broken = {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('denied')
    },
  }
  let threw = false
  try {
    seedPanelPinnedPreference(broken)
    seedPanelPinnedPreference(undefined)
  } catch {
    threw = true
  }
  check('存储不可用时静默跳过', threw, false)
}

// ---- 状态巡查 -------------------------------------------------------------

check('探针带 reserve 即已钉住', inspectPanelPin(fakeDocument({ [PINNED_PROBE_SELECTOR]: {} })), {
  pinned: true,
  fits: true,
  toggle: null,
})

{
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false' } })
  const probe = fakeElement({ width: 1 })
  const main = mainConversation({ toggle, probe })
  check('放得下且关着时给出开关', inspectPanelPin(fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main })), {
    pinned: false,
    fits: true,
    toggle,
  })
}

{
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false' } })
  const probe = fakeElement({ width: 0 })
  const main = mainConversation({ toggle, probe })
  check('放不下时仍报 fits=false(但给出开关供判断)', inspectPanelPin(fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main })), {
    pinned: false,
    fits: false,
    toggle,
  })
}

{
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false' } })
  const main = mainConversation({ toggle })
  check('没有探针时 fits=false', inspectPanelPin(fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main })), {
    pinned: false,
    fits: false,
    toggle,
  })
}

{
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'true' } })
  const main = mainConversation({ toggle, probe: fakeElement({ width: 1 }) })
  check('已展开(浮层)时不动', inspectPanelPin(fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main })), {
    pinned: false,
    fits: true,
    toggle: null,
  })
}

{
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false', 'aria-disabled': 'true' } })
  const main = mainConversation({ toggle, probe: fakeElement({ width: 1 }) })
  check('禁用态(会话没有 Chat View)时不动', inspectPanelPin(fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main })), {
    pinned: false,
    fits: true,
    toggle: null,
  })
}

check('没有主对话子树时不动', inspectPanelPin(fakeDocument()), { pinned: false, fits: false, toggle: null })

// ---- 点击兜底 -------------------------------------------------------------

{
  const clock = fakeClock()
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'true' } })
  const main = mainConversation({ toggle, probe: fakeElement({ width: 1 }) })
  const storage = fakeStorage()
  const io = fakeWindow({
    document: fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main, [PINNED_PROBE_SELECTOR]: {} }),
    localStorage: storage,
    clock,
  })
  const stop = keepSessionPanelOpen(io.win, { intervalMs: 100, now: clock.now })
  clock.advance(100)
  io.runDue()
  check('已经钉住时开关一次都不点', toggle.state.clicks, 0)
  check('已经钉住时巡查立即结束', io.pending(), 0)
  stop()
}

{
  const clock = fakeClock()
  const selectors = {}
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false' } })
  const probe = fakeElement({ width: 1 })
  const main = mainConversation({ toggle, probe })
  selectors[MAIN_CONVERSATION_SELECTOR] = main
  toggle.state.onClick = () => {
    selectors[PINNED_PROBE_SELECTOR] = {}
    toggle.state.attributes['aria-expanded'] = 'true'
  }
  const io = fakeWindow({ document: fakeDocument(selectors), localStorage: fakeStorage(), clock })
  const stop = keepSessionPanelOpen(io.win, { intervalMs: 100, now: clock.now })
  clock.advance(100)
  io.runDue()
  check('放得下且关着时点击打开', toggle.state.clicks, 1)
  clock.advance(100)
  io.runDue()
  check('打开后停止巡查', io.pending(), 0)
  check('打开后不再点击', toggle.state.clicks, 1)
  stop()
}

{
  const clock = fakeClock()
  const selectors = {}
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false' } })
  const probe = fakeElement({ width: 0 })
  const main = mainConversation({ toggle, probe })
  selectors[MAIN_CONVERSATION_SELECTOR] = main
  const io = fakeWindow({ document: fakeDocument(selectors), localStorage: fakeStorage(), clock })
  const stop = keepSessionPanelOpen(io.win, { intervalMs: 100, maxChecks: 6, now: clock.now })
  clock.advance(100)
  io.runDue()
  clock.advance(100)
  io.runDue()
  check('放不下时不打开浮层', toggle.state.clicks, 0)
  probe.state.width = 1
  clock.advance(100)
  io.runDue()
  check('窗口变宽后补点一次', toggle.state.clicks, 1)
  stop()
}

{
  const clock = fakeClock()
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false' } })
  const main = mainConversation({ toggle, probe: fakeElement({ width: 1 }) })
  const io = fakeWindow({
    document: fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main }),
    localStorage: fakeStorage(),
    clock,
  })
  const stop = keepSessionPanelOpen(io.win, { intervalMs: 100, maxChecks: 2, now: clock.now })
  clock.advance(100)
  io.runDue()
  clock.advance(100)
  io.runDue()
  check('恰好巡查 maxChecks 轮后停止', io.pending(), 0)
  check('未变成钉住时只点一次(冷却期内不重复)', toggle.state.clicks, 1)
  stop()
}

{
  const clock = fakeClock()
  const toggle = fakeElement({ attributes: { 'aria-expanded': 'false', 'aria-disabled': 'true' } })
  const main = mainConversation({ toggle, probe: fakeElement({ width: 1 }) })
  const io = fakeWindow({
    document: fakeDocument({ [MAIN_CONVERSATION_SELECTOR]: main }),
    localStorage: fakeStorage(),
    clock,
  })
  const stop = keepSessionPanelOpen(io.win, { intervalMs: 100, maxChecks: 1, now: clock.now })
  clock.advance(100)
  io.runDue()
  check('禁用态开关不点击', toggle.state.clicks, 0)
  stop()
}

{
  const clock = fakeClock()
  const io = fakeWindow({ document: fakeDocument(), localStorage: fakeStorage(), clock })
  const stop = keepSessionPanelOpen(io.win, { intervalMs: 100, maxChecks: 5, now: clock.now })
  check('安装后立即排一轮', io.pending(), 1)
  stop()
  check('停止函数清掉定时器', io.pending(), 0)
}

finish()
