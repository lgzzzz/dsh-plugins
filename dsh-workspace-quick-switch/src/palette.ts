/**
 * 快速切换浮层的纯状态层:候选切片、选中项的移动规则,以及浮层自己那份可变状态。
 *
 * 两条浮层(工作区 / 会话)共用这一份:状态只关心「候选数组 + 选中下标 + 页号」,
 * 候选元素的形状由渲染方决定(本插件里两张浮层都用 {@link PaletteRow}),`createPaletteStore`
 * 的泛型参数就是它。
 *
 * 这里不碰 React、不碰 DOM、也不读任何上游服务 —— `client.ts` 把上游快照喂进来、
 * 把动作接出去,所以这一层的规则可以被测试直接驱动。
 *
 * 候选顺序就是传进来的顺序:上游 Workspace 控制器的 `list` 快照已经是宿主的持久
 * 显示顺序(`follow()` 的 order 增量跟随它),也就是左侧栏 Workspace 分组的顺序;
 * 会话候选的顺序由 `sessions.ts` 自己按左侧栏的「单列表 + 最近更新 + 隐藏已归档」投影。
 *
 * 本文件不 import React(连类型也不):这样它在没有任何前端依赖的 Node 里也能被直接
 * 加载,测试可以只驱动规则本身。
 */

/** 浮层一页最多列出的行数;更多候选用 ← / → 翻页。 */
export const PAGE_SIZE = 10

/** 工作区浮层的固定行 id(占用 `⌘⌥M` / `Ctrl+Alt+M`,并出现在快捷键目录里)。 */
export const QUICK_SWITCH_ID = 'dsh-workspace-quick-switch.quick-switch'

/** 会话浮层的固定行 id(占用 `⌘⌥I` / `Ctrl+Alt+I`,并出现在快捷键目录里)。 */
export const SESSION_SWITCH_ID = 'dsh-workspace-quick-switch.session-switch'

/**
 * 工作区浮层的逻辑组合:`primary+alt+M`。
 *
 * `primary` 是注册表认的逻辑主修饰键:macOS 上展开成 `meta`(`⌘⌥M`),Windows/Linux 上
 * 展开成 `control`(`Ctrl+Alt+M`)——同一份声明,两端各是各的键。
 */
export const QUICK_SWITCH_BINDING = {
  code: 'KeyM',
  modifiers: ['primary', 'alt'],
} as const

/** 会话浮层的逻辑组合:`primary+alt+I`(macOS `⌘⌥I`,Windows/Linux `Ctrl+Alt+I`)。 */
export const SESSION_SWITCH_BINDING = {
  code: 'KeyI',
  modifiers: ['primary', 'alt'],
} as const

/** 接收输入的设备平台;只管 `primary` 往哪边展开。 */
export type QuickSwitchPlatform = 'macos' | 'windows' | 'linux'

/** `primary` 在给定平台上展开成的物理修饰键。 */
export function primaryModifier(platform: QuickSwitchPlatform): 'meta' | 'control' {
  return platform === 'macos' ? 'meta' : 'control'
}

/**
 * 固定行在给定平台上显示的键帽。
 *
 * 固定行目录的 `keys` 是直接给 UI 用的标签(注册表只规范化 `bindings`、不动 `keys`),
 * 所以要自己按平台把 `primary` 落成 `⌘`(macOS)或 `Ctrl`(其它平台)。
 * @param platform - 接收输入的设备平台。
 * @returns 固定行的三个键帽。
 */
export function quickSwitchKeys(platform: QuickSwitchPlatform): string[] {
  return platform === 'macos' ? ['⌘', '⌥', 'M'] : ['Ctrl', 'Alt', 'M']
}

/**
 * 会话浮层固定行的键帽(与 {@link quickSwitchKeys} 同一套平台规则)。
 * @param platform - 接收输入的设备平台。
 * @returns 固定行的三个键帽。
 */
export function sessionSwitchKeys(platform: QuickSwitchPlatform): string[] {
  return platform === 'macos' ? ['⌘', '⌥', 'I'] : ['Ctrl', 'Alt', 'I']
}

/** 一次按键里本插件要读的修饰键事实(KeyboardEvent 结构上满足它)。 */
export interface QuickSwitchGesture {
  readonly code?: string
  readonly control?: boolean
  readonly alt?: boolean
  readonly shift?: boolean
  readonly meta?: boolean
}

/**
 * 一条固定行的逻辑组合(`code` + 逻辑修饰键)。
 *
 * `primary` 是平台相关的那一个;其余修饰键是逻辑名,与物理键一一对应。
 */
export interface LogicalBinding {
  readonly code: string
  readonly modifiers: readonly string[]
}

/**
 * 这次按键是否就是给定逻辑组合在给定平台上的物理形态。
 *
 * 要求修饰键集合**完全相等**:`primary` 落成 `meta`(macOS)或 `control`(其余),
 * `alt` / `shift` 原样;多按或漏按任何一个都不算。
 * @param platform - 接收输入的设备平台。
 * @param binding - 固定行声明的逻辑组合。
 * @param gesture - 按键事实。
 * @returns 完全匹配时为 true。
 */
export function bindingPress(
  platform: QuickSwitchPlatform,
  binding: LogicalBinding,
  gesture: QuickSwitchGesture,
): boolean {
  if (gesture.code !== binding.code) return false
  const wanted = new Set(binding.modifiers.map((modifier) => (modifier === 'primary' ? primaryModifier(platform) : modifier)))
  for (const modifier of ['control', 'alt', 'shift', 'meta'] as const) {
    if ((gesture[modifier] === true) !== wanted.has(modifier)) return false
  }
  return true
}

/**
 * 这次按键是否就是工作区浮层固定行在给定平台上占用的物理组合。
 *
 * macOS 上要 `meta+alt`、且不许同时按下另一侧的主修饰键(`control`);Windows/Linux 上
 * 要 `control+alt`、且不许 `meta`;两边都拒绝 `shift` 与别的键。
 * @param platform - 接收输入的设备平台。
 * @param gesture - 按键事实。
 * @returns 完全匹配时为 true。
 */
export function quickSwitchPress(platform: QuickSwitchPlatform, gesture: QuickSwitchGesture): boolean {
  return bindingPress(platform, QUICK_SWITCH_BINDING, gesture)
}

/**
 * 这次按键是否就是会话浮层固定行在给定平台上占用的物理组合(`⌘⌥I` / `Ctrl+Alt+I`)。
 * @param platform - 接收输入的设备平台。
 * @param gesture - 按键事实。
 * @returns 完全匹配时为 true。
 */
export function sessionSwitchPress(platform: QuickSwitchPlatform, gesture: QuickSwitchGesture): boolean {
  return bindingPress(platform, SESSION_SWITCH_BINDING, gesture)
}

/** 宿主侧的一个工作区(本插件只读这几个字段;形状沿用 Workspace 控制器的 `items` 元素)。 */
export interface HostWorkspace {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  /** 账下会话(只读;用来把主视图会话映射回它所属的工作区)。 */
  readonly sessionIds?: readonly string[]
}

/**
 * 浮层里的一行 —— 工作区与会话共用这一份视图模型。
 *
 * `key` 是稳定身份(工作区 id / 会话 id),`title` 是主标题,`subtitle` 是第二行(路径 /
 * 「工作区 · 相对时间」);`current` 由渲染方画成「当前」角标,`badges` 是其余角标
 * (置顶 / 进行中之类),顺序即渲染顺序。
 */
export interface PaletteRow {
  readonly key: string
  readonly title: string
  readonly subtitle: string
  readonly current?: boolean
  readonly badges?: readonly string[]
}

/**
 * 一张浮层的静态文案。
 *
 * 两个浮层共用同一个组件,差异只在这份文案与候选来源上:工作区浮层的确认动作是「新建
 * 会话」,会话浮层是「打开会话」。
 */
export interface PaletteView {
  /** 浮层标识(槽位注册 id)。 */
  readonly id: string
  /** 行 DOM id 的前缀;必须是合法的 CSS 标识符(`#…` 选择器要用它)。 */
  readonly domId: string
  /** 根节点的 DOM 标记属性名。 */
  readonly rootAttr: string
  /** 面板标题。 */
  readonly title: string
  /** 计数单位,如「个工作区」「个会话」。 */
  readonly unit: string
  /** 没有候选时标题右侧的文案。 */
  readonly emptyCount: string
  /** 空态主文案。 */
  readonly emptyHint: string
  /** 列表的 aria-label。 */
  readonly listLabel: string
  /** 底栏的确认提示,如「Enter 新建会话」。 */
  readonly enterHint: string
}

/**
 * 浮层状态快照。
 *
 * `entries` 由渲染方从上游快照投影而来(工作区见 `paletteEntries`,会话见 `sessions.ts`),
 * **是全部候选**、不截断;`activeIndex` 是选中行在 `entries` 里的下标(`entries` 为空时固定为
 * -1);`offset` 是窗口第一行在 `entries` 里的下标 —— 窗口连续滑动,一屏 {@link PAGE_SIZE}
 * 行,不按页对齐(第 2 行起头时显示的是 2–11 这样的跨页窗口)。
 * `binding` 是本次打开时的动作:Enter / 点击都执行它(工作区是「新建会话」,会话是
 * 「打开会话」)。
 *
 * 泛型参数是候选行的类型:store 只按长度与下标工作,不读候选的字段。
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
  /** 当前快照;引用在未变化时保持稳定。 */
  getSnapshot(): PaletteState<T>
  /** 订阅状态变化;返回退订函数。 */
  subscribe(listener: () => void): () => void
  /** 打开浮层;`index` 指定初始选中行(默认第一行)。 */
  open(binding: () => void, index?: number): void
  /** 关闭浮层并清掉动作。 */
  close(): void
  /** 选中某一行;越界时不做动作。 */
  select(index: number): void
  /**
   * 相对位移选中行(`delta` 为 ±1),到两端停住(不环状);选中行移出窗口时窗口跟着滑,
   * 但只滑到它刚好可见。没有候选时不动。
   */
  move(delta: number): void
  /** 窗口滑动一整屏(`delta` 为 ±1),到两端停住;滑完选中行落在新窗口第一行。 */
  turn(delta: number): void
  /** 窗口滑动若干行(滚轮用,正数往下);到两端停住,选中行留在窗口内。 */
  slide(rows: number): void
  /** 同步渲染方投影出来的候选;选中下标越出候选范围时退回第一行,窗口跟着收敛。 */
  sync(entries: readonly T[]): void
}

/**
 * 投影浮层候选:整份工作区按给定顺序排出(不截断),并把「当前工作区」标出来。
 *
 * 一屏放 {@link PAGE_SIZE} 行,窗口切片由 {@link windowSlice} 在渲染时做 —— 候选本身保留
 * 完整长度,滚轮与 ← / → 才能滑到后面的工作区。
 * @param workspaces - 上游工作区,已经是左侧栏显示顺序。
 * @param activeId - 当前会话所属的工作区 id;没有则为 undefined。
 * @returns 浮层候选行。
 */
export function paletteEntries(
  workspaces: readonly HostWorkspace[],
  activeId: string | undefined,
): PaletteRow[] {
  return workspaces.map((workspace) => {
    const matched = activeId !== undefined && activeId !== '' && workspace.workspaceId === activeId
    return {
      key: workspace.workspaceId,
      title: workspace.title,
      subtitle: workspace.path,
      ...matched ? { current: true } : {},
    }
  })
}

/**
 * 「当前」那一条候选的下标(浮层打开时的初始选中行)。
 * @param entries - 浮层候选。
 * @returns 下标;没有带 `current` 的候选时为 -1。
 */
export function currentRowIndex(entries: readonly PaletteRow[]): number {
  return entries.findIndex((entry) => entry.current === true)
}

/**
 * 一个下标在给定长度里是否合法(0 ≤ index < length)。
 * @param index - 待检验的下标。
 * @param length - 候选数量。
 * @returns 合法时为 true。
 */
export function inRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length
}

/**
 * 把下标收进合法范围:非整数取 0,越界取最近的边界;空候选固定为 -1。
 * @param index - 待收敛的下标。
 * @param length - 候选数量。
 * @returns 合法下标,或空候选时的 -1。
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1
  if (!Number.isInteger(index)) return 0
  if (index < 0) return 0
  if (index >= length) return length - 1
  return index
}

/**
 * 步进后的下标:从 `activeIndex` 走 `delta` 步,到两端停住(不环状回头)。
 *
 * 浮层的 ↑/↓ 用它:到第一行再 ↑、到最后一行再 ↓ 都停住,与窗口「滑到两端就停」一致。
 * @param activeIndex - 当前下标(可以是 -1/越界,按 `clampIndex` 收敛)。
 * @param delta - 位移,通常为 ±1。
 * @param length - 候选数量。
 * @returns 新下标;没有候选时为 -1。
 */
export function stepIndex(activeIndex: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const current = clampIndex(activeIndex, length)
  const steps = Number.isFinite(delta) ? Math.trunc(delta) : 1
  return clampIndex(current + steps, length)
}

/**
 * 窗口能滑到的最大起点(最后一行贴底)。
 *
 * 候选比一屏还少时固定为 0 —— 没有可滑的余地。
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
 * 把窗口起点收进合法范围:非整数取 0,越界取最近的边界;候选不足一屏固定为 0。
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
 * 窗口滑动若干行后的起点(夹在两端之间,不环状)。
 * @param offset - 当前起点(可以是越界值,按 `clampOffset` 收敛)。
 * @param rows - 位移行数,正数往下。
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
 * 让某个下标落进窗口所需的最小滑动:已经可见就不动,否则只滑到它贴边为止。
 *
 * 打开浮层时不用它(那里对齐到一屏的整数倍,见 `createPaletteStore` 的 `open`);
 * 它管的是点击 / ↑↓ / 候选变短之后「选中行必须看得见」。
 * @param offset - 当前起点(越界按 `clampOffset` 收敛)。
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
  // 没有选中行(-1 / 越界)时窗口不动:那不是「要看见某一行」的请求。
  if (!inRange(index, length)) return current
  const target = index
  if (target < current) return clampOffset(target, length, size)
  if (target >= current + span) return clampOffset(target - span + 1, length, size)
  return current
}

/**
 * 窗口在候选里的那一段(渲染一屏用它)。
 * @param entries - 全部候选。
 * @param offset - 窗口起点(越界按 `clampOffset` 收敛)。
 * @param size - 一屏几行。
 * @returns 这一屏的候选;末尾不足一屏时自然短一些。
 */
export function windowSlice<T>(entries: readonly T[], offset: number, size: number = PAGE_SIZE): T[] {
  const span = Math.max(0, Math.trunc(size))
  const start = clampOffset(offset, entries.length, size)
  return entries.slice(start, start + span)
}

/** 空状态:关闭、没有候选、没有动作。 */
function emptyState<T>(): PaletteState<T> {
  return { open: false, entries: [], activeIndex: -1, offset: 0, binding: null }
}

/**
 * 造一个浮层状态存储。
 *
 * 通知按微任务批量合并:同一拍里的多次写入只通知一次,订阅者读到的永远是最后一次写入
 * 之后的快照(React 的 useSyncExternalStore 正是这样消费)。
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
      // 打开时选中行可能落在后面(当前会话是第 90 个):窗口对齐到包含它的那一屏,
      // 与「开在当前那一页」同感;末尾不足一屏时贴底,选中行照样看得见。
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
      // 到两端停住(不环状);选中行滑出窗口时只滑到它贴边,不整屏跳。
      const activeIndex = stepIndex(state.activeIndex, delta, state.entries.length)
      if (activeIndex === state.activeIndex) return
      const offset = revealOffset(state.offset, activeIndex, state.entries.length)
      commit({ ...state, activeIndex, offset })
    },
    turn(delta) {
      if (state.entries.length === 0) return
      const offset = slideOffset(state.offset, (Number.isFinite(delta) ? Math.trunc(delta) : 1) * PAGE_SIZE, state.entries.length)
      if (offset === state.offset) return
      // 滑完一整屏后选中行落在新窗口第一行:↑/↓ 与 Enter 都接着新的一屏走。
      commit({ ...state, offset, activeIndex: clampIndex(offset, state.entries.length) })
    },
    slide(rows) {
      if (state.entries.length === 0) return
      const offset = slideOffset(state.offset, rows, state.entries.length)
      if (offset === state.offset) return
      // 选中行尽量留在窗口里;滑出去之后贴到最近的边(不整屏跳,滚轮只负责「看到哪一段」)。
      const active = clampIndex(state.activeIndex, state.entries.length)
      const first = offset
      const last = Math.min(offset + PAGE_SIZE, state.entries.length) - 1
      const activeIndex = active < first ? first : active > last ? last : active
      commit({ ...state, offset, activeIndex })
    },
    sync(entries) {
      const keep = inRange(state.activeIndex, entries.length)
      const activeIndex = keep ? state.activeIndex : entries.length > 0 ? 0 : -1
      // 窗口不整屏跳:候选变短后只把起点收到合法范围,选中行仍然露在窗口里。
      const offset = clampOffset(revealOffset(state.offset, activeIndex, entries.length), entries.length)
      commit({ ...state, entries, activeIndex, offset })
    },
  }
}
