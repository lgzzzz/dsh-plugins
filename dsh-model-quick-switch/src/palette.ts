/**
 * 模型浮层的纯状态层：候选窗口、选中项移动、翻页 / 滚轮规则，以及浮层自己那份可变状态。
 *
 * 和 `dsh-workspace-quick-switch` 的浮层共用同一套交互约定（那一份是工作区 / 会话两张浮层）：
 * 一屏 {@link PAGE_SIZE} 行、窗口**连续滑动**（滚轮一格 = 1–10 → 2–11、`←` / `→` 滑一整屏、
 * `↑` / `↓` 移选中行并在它离开窗口时贴边）。列表**循环**：末行再往下回到首行、首行再往上回到
 * 末行，`←` / `→` 与滚轮到两端同样绕回。差别只在候选来源与
 * 确认动作：这里的一行是一个模型，确认后切换当前会话使用的模型。
 *
 * 本文件不 import React、不碰 DOM 服务、也不读任何上游运行时快照 —— `client.ts` 把候选喂进来、
 * 把动作接出去，所以这些规则可以被 Node 直接驱动。DOM 只出现在两个安装函数
 * （{@link installPaletteKeys} / {@link installPaletteWheel}）里，它们同样不依赖 React。
 * 固定行的键位、平台与手势事实直接取快捷键服务包（`@deepseek-ai/dsh-client-shortcuts`）的
 * 公开类型，本文件不再自己重写一遍。
 *
 * 候选顺序就是传进来的顺序（设置页里列表的顺序），本层不排序也不截断。
 */

import type {
  ShortcutBinding,
  ShortcutCommandId,
  ShortcutPlatform,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { ShortcutGesture } from '@deepseek-ai/dsh-client-shortcuts/client'

/** 浮层一屏最多列出的行数；更多候选用 ← / → 翻页或滚轮连续滑动。 */
export const PAGE_SIZE = 10

/**
 * 模型浮层的固定行 id（占用 `primary+alt+U`，并出现在快捷键目录里）。
 *
 * 上游把命令 id 品牌化成 `ShortcutCommandId`，品牌只在类型层；运行期仍是这个字符串，
 * 这里在常量声明处一次性标记，后续注册与目录比对全程沿用上游类型。
 */
export const MODEL_SWITCH_ID: ShortcutCommandId = 'dsh-model-quick-switch.model-switch' as ShortcutCommandId

/**
 * 模型浮层的逻辑组合：`primary+alt+U`。
 *
 * 与仓库里其它自挂固定键（`⌘⌥M` / `⌘⌥I` / `⌘⌥J` / `⌘⌥K` 等）同一套规则：`primary` 由注册表
 * 按设备展开成 `meta`（macOS 上是 `⌘⌥U`）或 `control`（Windows / Linux 上是 `Ctrl+Alt+U`）。
 * 键帽也要按同一个平台展开，见 {@link modelSwitchKeys}。
 */
export const MODEL_SWITCH_BINDING = {
  code: 'KeyU',
  modifiers: ['primary', 'alt'],
} as const

/** 接收输入的设备平台（上游 `ShortcutPlatform`）；`primary` 按它展开成 `meta`（macOS）或 `control`（其余）。 */
export type QuickSwitchPlatform = ShortcutPlatform

/** `primary` 在给定平台上展开成的物理修饰键。 */
export function primaryModifier(platform: QuickSwitchPlatform): 'meta' | 'control' {
  return platform === 'macos' ? 'meta' : 'control'
}

/**
 * 固定行在快捷键目录里显示的键帽。
 *
 * 组合是逻辑 `primary+alt+U`，键帽按接收输入的设备展开：macOS 上 `⌘⌥U`，其余平台
 * `Ctrl+Alt+U`。固定行目录的 `keys` 是直接给 UI 用的标签（注册表只规范化 `bindings`、
 * 不动 `keys`），所以这里必须自己按平台落字。
 * @param platform - 接收输入的设备平台。
 * @returns 固定行的三个键帽。
 */
export function modelSwitchKeys(platform: QuickSwitchPlatform): string[] {
  return platform === 'macos' ? ['⌘', '⌥', 'U'] : ['Ctrl', 'Alt', 'U']
}

/**
 * 一次按键里本插件要读的修饰键事实。
 *
 * 字段名与含义全部来自上游 `ShortcutGesture`；固定通道读数与 `KeyboardEvent` 都只带其中一部分
 * （`KeyboardEvent` 用 `ctrlKey` 等、没有 `composing`），所以这里取上游类型的 `Partial`，
 * 读者函数只按 `=== true` 判断需要的字段。
 */
export type ModelSwitchGesture = Partial<ShortcutGesture>

/**
 * 这次按键是否就是给定逻辑组合在给定平台上的物理形态。
 *
 * 要求修饰键集合**完全相等**：`primary` 落成 `meta`（macOS）或 `control`（其余），
 * `alt` / `shift` 原样；多按或漏按任何一个都不算。
 * @param platform - 接收输入的设备平台。
 * @param binding - 固定行声明的逻辑组合（上游 `ShortcutBinding`）。
 * @param gesture - 按键事实。
 * @returns 完全匹配时为 true。
 */
export function bindingPress(
  platform: QuickSwitchPlatform,
  binding: ShortcutBinding,
  gesture: ModelSwitchGesture,
): boolean {
  if (gesture.code !== binding.code) return false
  const wanted = new Set(binding.modifiers.map((modifier) => (modifier === 'primary' ? primaryModifier(platform) : modifier)))
  for (const modifier of ['control', 'alt', 'shift', 'meta'] as const) {
    if ((gesture[modifier] === true) !== wanted.has(modifier)) return false
  }
  return true
}

/**
 * 这次按键是否就是模型浮层固定行占用的组合（macOS `⌘⌥U`，其余平台 `Ctrl+Alt+U`）。
 * @param platform - 接收输入的设备平台。
 * @param gesture - 按键事实。
 * @returns 完全匹配时为 true。
 */
export function modelSwitchPress(platform: QuickSwitchPlatform, gesture: ModelSwitchGesture): boolean {
  return bindingPress(platform, MODEL_SWITCH_BINDING, gesture)
}

/**
 * 浮层里的一行。
 *
 * `key` 是稳定身份（这里是一个「提供方 + 模型 + 推理强度」的复合键），`title` 是主标题
 * （模型名），`subtitle` 是第二行（提供方 · 推理强度）；`current` 由渲染方画成「当前」角标，
 * `badges` 是其余角标（例如「目录外」）。
 */
export interface PaletteRow {
  readonly key: string
  readonly title: string
  readonly subtitle: string
  readonly current?: boolean
  readonly badges?: readonly string[]
}

/** 一张浮层的静态文案。 */
export interface PaletteView {
  /** 浮层标识（槽位注册 id）。 */
  readonly id: string
  /** 行 DOM id 的前缀；必须是合法的 CSS 标识符。 */
  readonly domId: string
  /** 根节点的 DOM 标记属性名。 */
  readonly rootAttr: string
  /** 面板标题。 */
  readonly title: string
  /** 计数单位，如「个模型」。 */
  readonly unit: string
  /** 没有候选时标题右侧的文案。 */
  readonly emptyCount: string
  /** 空态主文案。 */
  readonly emptyHint: string
  /** 列表的 aria-label。 */
  readonly listLabel: string
  /** 底栏的确认提示，如「Enter 切换模型」。 */
  readonly enterHint: string
}

/**
 * 浮层状态快照。
 *
 * `entries` 是全部候选、不截断；`activeIndex` 是选中行下标（空候选为 -1）；`offset` 是窗口
 * 第一行的下标 —— 窗口连续滑动、一屏 {@link PAGE_SIZE} 行，不按页对齐。
 * `binding` 是确认动作（Enter / 点击同一行都执行它）。
 */
export interface PaletteState<T = PaletteRow> {
  readonly open: boolean
  readonly entries: readonly T[]
  readonly activeIndex: number
  readonly offset: number
  readonly binding: (() => void) | null
}

/** 浮层状态的动作面。 */
export interface PaletteStore<T = PaletteRow> {
  getSnapshot(): PaletteState<T>
  subscribe(listener: () => void): () => void
  open(binding: () => void, index?: number): void
  close(): void
  select(index: number): void
  move(delta: number): void
  turn(delta: number): void
  slide(rows: number): void
  sync(entries: readonly T[]): void
}

/** 一个下标在给定长度里是否合法（0 ≤ index < length）。 */
export function inRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length
}

/**
 * 把下标收进合法范围：非整数取 0，越界取最近的边界；空候选固定为 -1。
 * @param index - 待收敛的下标。
 * @param length - 候选数量。
 * @returns 合法下标，或空候选时的 -1。
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1
  if (!Number.isInteger(index)) return 0
  if (index < 0) return 0
  if (index >= length) return length - 1
  return index
}

/**
 * 步进后的下标：从 `activeIndex` 走 `delta` 步，**到两端绕回另一端**（循环列表）。
 * @param activeIndex - 当前下标（可以是 -1/越界，按 {@link clampIndex} 收敛）。
 * @param delta - 位移，通常为 ±1。
 * @param length - 候选数量。
 * @returns 新下标；没有候选时为 -1。
 */
export function stepIndex(activeIndex: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const span = Math.trunc(length)
  const current = clampIndex(activeIndex, span)
  const steps = Number.isFinite(delta) ? Math.trunc(delta) : 1
  return ((current + steps) % span + span) % span
}

/**
 * 窗口能滑到的最大起点（最后一行贴底）；候选比一屏还少时固定为 0。
 * @param length - 候选数量。
 * @param size - 一屏几行。
 * @returns 最大起点下标。
 */
export function maxOffset(length: number, size: number = PAGE_SIZE): number {
  const span = Math.max(0, Math.trunc(size))
  if (!Number.isFinite(length) || length <= 0 || span === 0) return 0
  return Math.max(0, length - span)
}

/**
 * 把窗口起点收进合法范围：非整数取 0，越界取最近的边界；候选不足一屏固定为 0。
 * @param offset - 待收敛的起点。
 * @param length - 候选数量。
 * @param size - 一屏几行。
 * @returns 合法起点。
 */
export function clampOffset(offset: number, length: number, size: number = PAGE_SIZE): number {
  const max = maxOffset(length, size)
  if (!Number.isInteger(offset)) return 0
  if (offset < 0) return 0
  if (offset > max) return max
  return offset
}

/**
 * 窗口滑动若干行后的起点（夹在两端之间，不环状）。
 * @param offset - 当前起点（可以是越界值，按 {@link clampOffset} 收敛）。
 * @param rows - 位移行数，正数往下。
 * @param length - 候选数量。
 * @param size - 一屏几行。
 * @returns 新起点。
 */
export function slideOffset(offset: number, rows: number, length: number, size: number = PAGE_SIZE): number {
  const current = clampOffset(offset, length, size)
  const steps = Number.isFinite(rows) ? Math.trunc(rows) : 0
  return clampOffset(current + steps, length, size)
}

/**
 * 让某个下标落进窗口所需的最小滑动：已经可见就不动，否则只滑到它贴边为止。
 * @param offset - 当前起点（越界按 {@link clampOffset} 收敛）。
 * @param index - 必须可见的下标。
 * @param length - 候选数量。
 * @param size - 一屏几行。
 * @returns 新起点。
 */
export function revealOffset(
  offset: number,
  index: number,
  length: number,
  size: number = PAGE_SIZE,
): number {
  const span = Math.max(1, Math.trunc(size))
  const current = clampOffset(offset, length, size)
  if (!inRange(index, length)) return current
  if (index < current) return clampOffset(index, length, size)
  if (index >= current + span) return clampOffset(index - span + 1, length, size)
  return current
}

/**
 * 窗口在候选里的那一段（渲染一屏用它）。
 * @param entries - 全部候选。
 * @param offset - 窗口起点（越界按 {@link clampOffset} 收敛）。
 * @param size - 一屏几行。
 * @returns 这一屏的候选；末尾不足一屏时自然短一些。
 */
export function windowSlice<T>(entries: readonly T[], offset: number, size: number = PAGE_SIZE): T[] {
  const span = Math.max(0, Math.trunc(size))
  const start = clampOffset(offset, entries.length, size)
  return entries.slice(start, start + span)
}

/** 空状态：关闭、没有候选、没有动作。 */
function emptyState<T>(): PaletteState<T> {
  return { open: false, entries: [], activeIndex: -1, offset: 0, binding: null }
}

/**
 * 造一个浮层状态存储。通知按微任务批量合并：同一拍里的多次写入只通知一次。
 * @returns 存储。
 */
export function createPaletteStore<T = PaletteRow>(): PaletteStore<T> {
  let state: PaletteState<T> = emptyState<T>()
  const listeners = new Set<() => void>()
  let notifyScheduled = false

  const notify = (): void => {
    if (notifyScheduled) return
    notifyScheduled = true
    queueMicrotask(() => {
      notifyScheduled = false
      for (const listener of [...listeners]) listener()
    })
  }

  const commit = (next: PaletteState<T>): void => {
    state = next
    notify()
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open(binding, index) {
      const wanted = index === undefined ? 0 : index
      const activeIndex = clampIndex(wanted, state.entries.length)
      // 打开时选中行可能落在后面：窗口对齐到包含它的那一屏；末尾不足一屏时贴底。
      const aligned = Math.floor(activeIndex / PAGE_SIZE) * PAGE_SIZE
      const offset = clampOffset(aligned, state.entries.length)
      commit({ ...state, open: true, binding, activeIndex, offset })
    },
    close() {
      commit({ ...state, open: false, binding: null })
    },
    select(index) {
      if (index === state.activeIndex) return
      const activeIndex = clampIndex(index, state.entries.length)
      const offset = revealOffset(state.offset, activeIndex, state.entries.length)
      commit({ ...state, activeIndex, offset })
    },
    move(delta) {
      if (state.entries.length === 0) return
      const activeIndex = stepIndex(state.activeIndex, delta, state.entries.length)
      if (activeIndex === state.activeIndex) return
      const offset = revealOffset(state.offset, activeIndex, state.entries.length)
      commit({ ...state, activeIndex, offset })
    },
    turn(delta) {
      const length = state.entries.length
      if (length === 0) return
      const max = maxOffset(length)
      // 只有一屏时没有「下一页」可翻，← / → 不动。
      if (max === 0) return
      const direction = Number.isFinite(delta) ? Math.trunc(delta) : 1
      if (direction === 0) return
      // 在最后一屏继续 →（或第一屏继续 ←）就绕回另一端；否则只走到相邻的那一屏。
      const offset = direction > 0
        ? state.offset >= max ? 0 : Math.min(state.offset + PAGE_SIZE, max)
        : state.offset <= 0 ? max : Math.max(state.offset - PAGE_SIZE, 0)
      const activeIndex = clampIndex(offset, length)
      if (offset === state.offset && activeIndex === state.activeIndex) return
      commit({ ...state, offset, activeIndex })
    },
    slide(rows) {
      const length = state.entries.length
      if (length === 0) return
      const max = maxOffset(length)
      // 只有一屏时窗口没有可滑的余地，滚轮不动。
      if (max === 0) return
      const steps = Number.isFinite(rows) ? Math.trunc(rows) : 0
      if (steps === 0) return
      const raw = state.offset + steps
      let offset: number
      let activeIndex: number
      if (raw > max) {
        offset = 0
        activeIndex = 0
      } else if (raw < 0) {
        offset = max
        activeIndex = max
      } else {
        offset = raw
        const active = clampIndex(state.activeIndex, length)
        const first = offset
        const last = Math.min(offset + PAGE_SIZE, length) - 1
        activeIndex = active < first ? first : active > last ? last : active
      }
      if (offset === state.offset && activeIndex === state.activeIndex) return
      commit({ ...state, offset, activeIndex })
    },
    sync(entries) {
      const keep = inRange(state.activeIndex, entries.length)
      const activeIndex = keep ? state.activeIndex : entries.length > 0 ? 0 : -1
      const offset = clampOffset(revealOffset(state.offset, activeIndex, entries.length), entries.length)
      commit({ ...state, entries, activeIndex, offset })
    },
  }
}

/** 浮层内一个按键解出的动作。 */
export type PaletteAction = 'close' | 'confirm' | 'next' | 'previous' | 'page-next' | 'page-previous'

/** `paletteAction` 读到的按键事实（KeyboardEvent 结构上满足它）。 */
export interface PaletteEventLike {
  readonly key: string
  readonly repeat?: boolean
  readonly isComposing?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
  readonly defaultPrevented?: boolean
}

/**
 * 一次按键解码出的动作。
 *
 * 只认没有修饰键的 `Escape` / `Enter` / `↑` / `↓`（选行）与 `←` / `→`（翻页）；组合中、
 * 已被别的处理器消费、或带修饰键的按键统统放行。按住不放的重复只允许移动与翻页。
 * @param event - 按键事实。
 * @returns 动作，或不属于浮层时的 undefined。
 */
export function paletteAction(event: PaletteEventLike): PaletteAction | undefined {
  if (event.defaultPrevented === true) return undefined
  if (event.isComposing === true) return undefined
  if (event.ctrlKey === true || event.altKey === true || event.metaKey === true || event.shiftKey === true) return undefined
  if (event.repeat === true && (event.key === 'Enter' || event.key === 'Escape')) return undefined
  if (event.key === 'Escape') return 'close'
  if (event.key === 'Enter') return 'confirm'
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  if (event.key === 'ArrowRight') return 'page-next'
  if (event.key === 'ArrowLeft') return 'page-previous'
  return undefined
}

/** 捕获阶段的按键目标（document 结构上满足它）。 */
export interface PaletteKeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
}

/**
 * 确认当前选中行：先把选中行定到目标，再执行浮层的确认动作（本插件里就是切换模型）。
 *
 * 与工作区浮层不同，这里**不先关闭**：模型切换可能要等 Host 回应，失败时浮层要留在原地显示
 * 错误；成功后的关闭由容器自己做。
 * @param store - 浮层状态。
 * @param index - 被确认的行（越界值由 store 收敛）。
 */
export function activatePaletteRow(store: PaletteStore, index: number): void {
  const snapshot = store.getSnapshot()
  store.select(index)
  const binding = snapshot.binding
  if (binding === null) return
  binding()
}

/**
 * 在捕获阶段接管浮层的六个键。
 *
 * 捕获监听先于任何本地控件看到按键，所以浮层一开，`Esc`/`Enter`/`↑`/`↓`/`←`/`→` 就归它；
 * 关掉之后立刻回到原来的归属。浮层没开时一个键都不动。
 * @param store - 浮层状态。
 * @param target - 按键目标，浏览器里是 `document`。
 * @param confirm - 自定义确认动作；缺席时执行 store 里登记的 binding。
 * @param options - `back` 存在时 `Esc` 先执行它（从第二步退回第一步），否则关闭浮层。
 * @returns 卸载函数。
 */
export function installPaletteKeys(
  store: PaletteStore,
  target: PaletteKeyTarget,
  confirm?: () => void,
  options: { readonly back?: () => void } = {},
): () => void {
  if (target === undefined || target === null) return () => {}
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!store.getSnapshot().open) return
    const action = paletteAction(event)
    if (action === undefined) return
    event.preventDefault()
    event.stopPropagation()
    if (action === 'close') {
      if (options.back !== undefined) options.back()
      else store.close()
    }
    else if (action === 'confirm') {
      if (confirm !== undefined) confirm()
      else {
        const binding = store.getSnapshot().binding
        if (binding !== null) binding()
      }
    } else if (action === 'page-next') store.turn(1)
    else if (action === 'page-previous') store.turn(-1)
    else store.move(action === 'next' ? 1 : -1)
  }
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}

/** 一格滚轮事件（结构与 `WheelEvent` 兼容）。 */
export interface PaletteWheelEventLike {
  readonly deltaY: number
  /** `0` 像素、`1` 行、`2` 页；缺席按像素。 */
  readonly deltaMode?: number
  readonly ctrlKey?: boolean
}

/** 滚轮监听目标（浮层根节点结构上满足它）。 */
export interface PaletteWheelTarget {
  addEventListener(
    type: 'wheel',
    listener: (event: WheelEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void
  removeEventListener(
    type: 'wheel',
    listener: (event: WheelEvent) => void,
    options?: EventListenerOptions | boolean,
  ): void
}

/**
 * 一次滚轮折算成多少像素：像素模式原样；行 / 页模式按一行 16px、一整屏 400px 折算。
 * @param event - 滚轮事实。
 * @returns 纵向位移（向上为负）。
 */
export function wheelPixels(event: PaletteWheelEventLike): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * 400
  return event.deltaY
}

/**
 * 一次滚轮折算成滑几行：**一格就是一行，与幅度无关**。
 * @param pixels - 这一格折算出的像素（向上为负）。
 * @returns -1 / 0 / 1。
 */
export function wheelStep(pixels: number): -1 | 0 | 1 {
  if (!Number.isFinite(pixels) || pixels === 0) return 0
  return pixels > 0 ? 1 : -1
}

/**
 * 让滚轮滑动浮层窗口（一格一行）。监听挂在浮层根节点上、`passive: false`，每次都
 * `preventDefault()`（模态）；触控板捏合（`ctrlKey + wheel`）原样放行。
 * @param root - 浮层根节点；缺席时不装。
 * @param slide - 滑动动作，参数是行数（正数往下）。
 * @returns 卸载函数。
 */
export function installPaletteWheel(
  root: PaletteWheelTarget | null | undefined,
  slide: (rows: number) => void,
): () => void {
  if (root === null || root === undefined) return () => {}
  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey === true) return
    const rows = wheelStep(wheelPixels(event))
    if (rows === 0) return
    event.preventDefault()
    slide(rows)
  }
  root.addEventListener('wheel', onWheel, { passive: false })
  return () => root.removeEventListener('wheel', onWheel, false)
}

/**
 * 把选中行滚进可见区（`nearest`：已经可见的行不动）。
 * @param option - 选中行元素；缺席时静默跳过。
 */
export function keepOptionVisible(option: Element | null | undefined): void {
  option?.scrollIntoView?.({ block: 'nearest' })
}

/** 「当前」那一条候选的下标（浮层打开时的初始选中行）。 */
export function currentRowIndex(entries: readonly PaletteRow[]): number {
  return entries.findIndex((entry) => entry.current === true)
}
