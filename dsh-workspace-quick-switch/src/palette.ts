/**
 * 工作区快速切换浮层的纯状态层:候选切片、选中项的移动规则,以及浮层自己那份可变状态。
 *
 * 这里不碰 React、不碰 DOM、也不读任何上游服务 —— `client.ts` 把上游快照喂进来、
 * 把动作接出去,所以这一层的规则可以被测试直接驱动。
 *
 * 候选顺序就是传进来的顺序:上游 Workspace 控制器的 `list` 快照已经是宿主的持久
 * 显示顺序(`follow()` 的 order 增量跟随它),也就是左侧栏 Workspace 分组的顺序。
 *
 * 本文件不 import React(连类型也不):这样它在没有任何前端依赖的 Node 里也能被直接
 * 加载,测试可以只驱动规则本身。
 */

/** 浮层最多列出的工作区数量。 */
export const WORKSPACE_LIMIT = 10

/** 本插件挂载的固定行 id(占用 `Ctrl+Alt+M`,并出现在快捷键目录里)。 */
export const QUICK_SWITCH_ID = 'dsh-workspace-quick-switch.quick-switch'

/** 固定行占用的唯一物理组合:`Ctrl+Alt+M`。 */
export const QUICK_SWITCH_BINDING = {
  code: 'KeyM',
  modifiers: ['control', 'alt'],
} as const

/** 宿主侧的一个工作区(本插件只读这几个字段;形状沿用 Workspace 控制器的 `items` 元素)。 */
export interface HostWorkspace {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  /** 账下会话(只读;用来把主视图会话映射回它所属的工作区)。 */
  readonly sessionIds?: readonly string[]
}

/** 浮层里的一行:一个工作区,外加「它是不是当前会话所在的那个」。 */
export interface PaletteEntry {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly current?: boolean
}

/**
 * 浮层状态快照。
 *
 * `entries` 由渲染方从上游快照投影而来(见 `paletteEntries`),`activeIndex` 是选中行
 * 在 `entries` 里的下标;`entries` 为空时 `activeIndex` 固定为 -1。
 * `binding` 是本次打开时的动作:Enter / 点击都是「在选中工作区新建会话」。
 */
export interface PaletteState {
  readonly open: boolean
  readonly entries: readonly PaletteEntry[]
  readonly activeIndex: number
  readonly binding: (() => void) | null
}

/** 浮层状态的动作面。 */
export interface PaletteStore {
  /** 当前快照;引用在未变化时保持稳定。 */
  getSnapshot(): PaletteState
  /** 订阅状态变化;返回退订函数。 */
  subscribe(listener: () => void): () => void
  /** 打开浮层;`index` 指定初始选中行(默认第一行)。 */
  open(binding: () => void, index?: number): void
  /** 关闭浮层并清掉动作。 */
  close(): void
  /** 选中某一行;越界时不做动作。 */
  select(index: number): void
  /** 相对位移选中行(`delta` 为 ±1),到两端环状回头;没有候选时不动。 */
  move(delta: number): void
  /** 同步渲染方投影出来的候选;选中行已不在候选里时退回第一行。 */
  sync(entries: readonly PaletteEntry[]): void
}

/**
 * 投影浮层候选:按给定顺序取前 `limit` 个,并把「当前工作区」标出来。
 * @param workspaces - 上游工作区,已经是左侧栏显示顺序。
 * @param activeId - 当前会话所属的工作区 id;没有则为 undefined。
 * @param limit - 最多取几个。
 * @returns 浮层候选行。
 */
export function paletteEntries(
  workspaces: readonly HostWorkspace[],
  activeId: string | undefined,
  limit: number = WORKSPACE_LIMIT,
): PaletteEntry[] {
  const capped = limit > 0 ? workspaces.slice(0, limit) : []
  return capped.map((workspace) => {
    if (activeId === undefined || activeId === '' || workspace.workspaceId !== activeId) {
      return { workspaceId: workspace.workspaceId, title: workspace.title, path: workspace.path }
    }
    return { workspaceId: workspace.workspaceId, title: workspace.title, path: workspace.path, current: true }
  })
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
 * 环状步进后的下标:从 `activeIndex` 走 `delta` 步,到头绕回另一端。
 * @param activeIndex - 当前下标(可以是 -1/越界,按 `clampIndex` 收敛)。
 * @param delta - 位移,通常为 ±1。
 * @param length - 候选数量。
 * @returns 新下标;没有候选时为 -1。
 */
export function moveIndex(activeIndex: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const current = clampIndex(activeIndex, length)
  const steps = Number.isFinite(delta) ? Math.trunc(delta) : 1
  const next = (current + steps) % length
  return next < 0 ? next + length : next
}

/** 空状态:关闭、没有候选、没有动作。 */
function emptyState(): PaletteState {
  return { open: false, entries: [], activeIndex: -1, binding: null }
}

/**
 * 造一个浮层状态存储。
 *
 * 通知按微任务批量合并:同一拍里的多次写入只通知一次,订阅者读到的永远是最后一次写入
 * 之后的快照(React 的 useSyncExternalStore 正是这样消费)。
 * @returns 存储。
 */
export function createPaletteStore(): PaletteStore {
  let state: PaletteState = emptyState()
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

  const commit = (next: PaletteState): void => {
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
      commit({ ...state, open: true, binding, activeIndex: clampIndex(wanted, state.entries.length) })
    },
    close() {
      commit({ ...state, open: false, binding: null })
    },
    select(index) {
      if (index === state.activeIndex) return
      commit({ ...state, activeIndex: clampIndex(index, state.entries.length) })
    },
    move(delta) {
      if (state.entries.length === 0) return
      commit({ ...state, activeIndex: moveIndex(state.activeIndex, delta, state.entries.length) })
    },
    sync(entries) {
      const keep = inRange(state.activeIndex, entries.length)
      commit({ ...state, entries, activeIndex: keep ? state.activeIndex : entries.length > 0 ? 0 : -1 })
    },
  }
}
