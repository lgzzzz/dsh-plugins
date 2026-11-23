/**
 * 会话面板「保持打开」的启动期兜底。
 *
 * 面板显示与否只由一条偏好决定:`localStorage['dsh.sessionPanel.pinned']`。上游的默认值是
 * `true`(`createSnapshotStore(true, …)` 之后按 `getSnapshot() !== false` 判定),面板打开后
 * 唯一能把它关掉的入口是会话标题栏最左侧的开关按钮(带 `data-session-panel-toggle`)。
 * 本插件用 CSS 把那个按钮隐藏,所以这条偏好不会再被写成 `false`。
 *
 * 剩下的只有一种情况:升级前用户手动关过面板,存储里已经是 `false`。此时面板在
 * `pinned = false` 下恒为 `hidden`,开关又已经看不见,页面上没有恢复入口。这里做两件事:
 *
 * 1. 启动时把存储里的偏好补写成 `true` —— 下一次加载起面板一定按 `pinned = true` 判定;
 * 2. 当前页面里如果面板还关着,等它挂载、且放得下停靠面板时点一次开关。判定「放得下」
 *    读主对话停靠探针的实测宽度(>= 1px,与上游 ResizeObserver 量的是同一个尺寸):放得下时
 *    一次点击只会把 `pinned` 从 `false` 翻成 `true`、面板 docked;放不下时保持上游的
 *    hidden,绝不用点击打开浮层。点完看到探针带上 `data-session-panel-reserve` 就停。
 *
 * 开关找不到(不在 Chat 视图)、处于禁用态(该会话没有 Chat View)或已经展开(浮层)时,
 * 这一轮不点。判断只读 `aria-expanded` / `aria-disabled` 与探针上的 `data-*`,不碰 React
 * 内部;`window` 可注入,便于测试。
 */

/** 上游保存「面板钉住」偏好的 localStorage 键。 */
export const PANEL_PINNED_STORAGE_KEY = 'dsh.sessionPanel.pinned'

/** 会话标题栏上面板开关的稳定锚点。 */
export const PANEL_TOGGLE_SELECTOR = '[data-session-panel-toggle]'

/** 主对话所在的作用域:开关与停靠探针都在这棵子树里。 */
export const MAIN_CONVERSATION_SELECTOR = '[data-slot="main.conversation"]'

/** 停靠探针;它的实测宽度 >= 1px 表示当前尾部留白 (或主体愿意让出的预留) 放得下面板。 */
export const PANEL_PROBE_SELECTOR = '[data-session-panel-probe]'

/** 面板钉住时停靠探针自带的标记;出现它说明 `pinned` 已经是 `true`。 */
export const PINNED_PROBE_SELECTOR = '[data-session-panel-probe][data-session-panel-reserve]'

/** 巡查只需要 `querySelector`;真实 `Document` 与测试替身都满足。 */
export interface PanelPinDocument {
  querySelector(selector: string): Element | null
}

/** 一次巡查的结果。 */
export interface PanelPinState {
  /** 面板已经钉住。 */
  readonly pinned: boolean
  /** 主对话的尾部留白放得下停靠面板(探针 >= 1px)。 */
  readonly fits: boolean
  /** 需要点击才会打开面板的开关;`null` 表示这一轮无动作。 */
  readonly toggle: Element | null
}

/**
 * 读当前页面的面板状态,不产生副作用。
 * @param doc - 文档(测试可传替身)。
 * @returns 钉住状态与待点击的开关。
 */
export function inspectPanelPin(doc: PanelPinDocument): PanelPinState {
  if (doc.querySelector(PINNED_PROBE_SELECTOR) !== null) return { pinned: true, fits: true, toggle: null }
  const main = doc.querySelector(MAIN_CONVERSATION_SELECTOR)
  const probe = main?.querySelector(PANEL_PROBE_SELECTOR) ?? null
  const fits = probe !== null && probe.getBoundingClientRect().width >= 1
  const toggle = main?.querySelector(PANEL_TOGGLE_SELECTOR) ?? null
  if (toggle === null) return { pinned: false, fits, toggle: null }
  if (toggle.getAttribute('aria-expanded') !== 'false') return { pinned: false, fits, toggle: null }
  if (toggle.getAttribute('aria-disabled') === 'true') return { pinned: false, fits, toggle: null }
  return { pinned: false, fits, toggle }
}

/**
 * 把存储里的偏好补写成 `true`。
 *
 * 已经是 `true` 时不写,避免每次加载都碰一次存储。写入失败(隐私模式、配额、存储被禁用)
 * 只影响下次加载,当前页面仍由点击兜底,所以吞掉异常。
 * @param storage - 浏览器 `localStorage`;不可用时传 `undefined`。
 */
export function seedPanelPinnedPreference(storage: Storage | undefined): void {
  if (storage === undefined) return
  try {
    if (storage.getItem(PANEL_PINNED_STORAGE_KEY) === 'true') return
    storage.setItem(PANEL_PINNED_STORAGE_KEY, 'true')
  } catch {
    // 存储不可写:忽略。
  }
}

/** 巡查用到的窗口面;真实 `window` 与测试替身共用。 */
export interface PanelPinWindow {
  readonly document: PanelPinDocument
  readonly localStorage?: Storage
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(handle: number): void
}

/** 巡查节奏。 */
export interface PanelPinTiming {
  /** 两次巡查的间隔(毫秒),默认 120。 */
  readonly intervalMs?: number
  /** 最多巡查几轮,默认 40(约 4.8s,足够覆盖应用挂载与一次点击后的重渲染)。 */
  readonly maxChecks?: number
  /** 两次点击之间的最小间隔(毫秒),默认 700;避免点击后的重渲染还没到就再点一次。 */
  readonly clickCooldownMs?: number
  /** 当前时间(毫秒),默认 `Date.now`;测试注入假时钟。 */
  readonly now?: () => number
}

/**
 * 安装启动期兜底:补写偏好,并在面板关着时点一次开关。
 * @param win - 浏览器 `window`(或测试替身)。
 * @param timing - 巡查节奏与时钟。
 * @returns 停止巡查并清理定时器的函数。
 */
export function keepSessionPanelOpen(win: PanelPinWindow, timing: PanelPinTiming = {}): () => void {
  // window.localStorage 的 getter 本身在「站点数据被禁」时也会抛,读它也放进 try。
  let storage: Storage | undefined
  try {
    storage = win.localStorage
  } catch {
    storage = undefined
  }
  seedPanelPinnedPreference(storage)
  const interval = timing.intervalMs ?? 120
  const maxChecks = timing.maxChecks ?? 40
  const cooldown = timing.clickCooldownMs ?? 700
  const now = timing.now ?? (() => Date.now())
  let checks = 0
  let clickedAt = Number.NEGATIVE_INFINITY
  let timer: number | undefined
  let stopped = false

  const stop = (): void => {
    stopped = true
    if (timer !== undefined) win.clearTimeout(timer)
    timer = undefined
  }

  const tick = (): void => {
    timer = undefined
    if (stopped) return
    checks += 1
    const state = inspectPanelPin(win.document)
    if (state.pinned) {
      stop()
      return
    }
    if (state.fits && state.toggle !== null && typeof (state.toggle as HTMLElement).click === 'function') {
      const stamp = now()
      if (stamp - clickedAt >= cooldown) {
        clickedAt = stamp
        try {
          ;(state.toggle as HTMLElement).click()
        } catch {
          // 上游点击处理抛错:本轮放弃,冷却后再试。
        }
      }
    }
    if (checks < maxChecks) timer = win.setTimeout(tick, interval)
  }

  timer = win.setTimeout(tick, interval)
  return stop
}
