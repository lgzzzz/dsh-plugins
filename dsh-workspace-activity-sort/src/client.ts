/**
 * 浏览器半部：某个工作区被排到第一位时，把侧栏的工作区列表送回最上面。
 *
 * 宿主半部（`index.ts`）把最近活跃的工作区写回 Workspace 注册表的持久顺序，浏览器经工作区
 * 控制器的 `follow()` 增量跟随这份顺序。这里不区分「谁改的顺序」：宿主半部的自动上浮、本地
 * 拖拽、另一个客户端上的活动，最终都只是同一条 `order` 增量——只要一次变化把某个工作区从
 * 列表里排到第一位，就把侧栏区块的滚动条送回最上面，让刚浮上来的那一行落在屏幕里。
 *
 * 三类变化不动滚动位置：
 *
 *   - **断线恢复的基线**：控制器在载体失联时把 `state` 置为 `loading`（随后可能 `error`），
 *     恢复后整份投影被替换。恢复后的第一份顺序因此只是新基线——断线期间另一边造成的第一名
 *     换人不是一次可观察的上浮，不滚；
 *   - **本地工作区拖拽**：拖拽期间与结束后的一小段窗口（`DRAG_GRACE_MS`）不滚。拖拽会把
 *     侧栏边缘自动滚动，把第一名往下拖时松手后再跳回顶部，刚放下的行会被甩出视野；
 *   - **工作区分组不可见**：单列表视图、搜索中、侧栏收起成 rail 时没有分组行，顺序不可见，
 *     由 `scroll.ts` 的判断跳过。
 *
 * 判定（`frontArrival`）与 DOM 触点（两个上游 `data-*` 锚点）都在 `scroll.ts`：那里是纯函数，
 * 这里只负责订阅顺序、取出 id、按帧合并一次滚动写入。写入排到下一帧：顺序增量先到、React
 * 提交在后，隔一帧看到的才是新顺序下的 DOM（分组是否还在、行是否已挂载）。
 *
 * 工作区控制器缺席时本插件整体不挂载（`inject`），不做降级。
 *
 * 触发条件与已知边界见 docs/dsh-workspace-activity-sort.md。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：加载工作区控制器的 Context 合并（`ctx.workspaces`），不引入运行时导入。
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  DRAG_GRACE_MS,
  DRAG_STALE_MS,
  frontArrival,
  scrollWorkspaceSectionToTop,
  workspaceRowOf,
} from './scroll.ts'

/** 插件标识（浏览器里的日志名，与包名一致）。 */
export const name = 'dsh-workspace-activity-sort'

/** 依赖的客户端服务：工作区控制器就绪前不挂载。 */
export const inject = ['workspaces']

/** 挂载「上浮到第一位 → 滚回最上面」。 */
export function apply(ctx: Context): void {
  const doc = typeof document === 'undefined' ? undefined : document

  /** 宿主权威顺序的字符串投影。 */
  const order = (): string[] =>
    ctx.workspaces.list.getSnapshot().items.map((workspace) => String(workspace.workspaceId))

  // 挂载时先记下当前顺序，之后第一条通知也有得比较。
  let previous = order()
  // 控制器还没拿到第一份投影（page load / 断线）时，下一次「顺序」其实是整份替换，只更新基线。
  let resyncing = ctx.workspaces.list.getSnapshot().state !== 'idle'
  /** 已排上的滚动帧；同一帧里来多少条顺序增量都只滚一次。 */
  let frame: number | undefined
  /** 本地工作区拖拽进行中。 */
  let dragging = false
  /** 这次拖拽的开始时刻，用于识别丢失 `dragend` 的拖拽。 */
  let dragStartedAt = 0
  /** 拖拽结束后继续不滚到的时刻。 */
  let mutedUntil = 0

  /** 当前是否处在「本地拖拽」的静默窗口里。 */
  const muted = (now: number): boolean =>
    (dragging && now - dragStartedAt < DRAG_STALE_MS) || now < mutedUntil

  const scroll = (): void => {
    frame = undefined
    if (muted(Date.now())) return
    scrollWorkspaceSectionToTop(doc)
  }

  // 只有从工作区分组行上开始的拖拽会改工作区顺序；从会话行开始的拖拽不算。
  const onDragStart = (event: Event): void => {
    if (!workspaceRowOf(event.target)) return
    dragging = true
    dragStartedAt = Date.now()
  }

  // `drop` 先于 `dragend`：两次都只延长静默窗口，第一次就已经离开「拖拽中」。
  const onDragEnd = (): void => {
    if (!dragging) return
    dragging = false
    mutedUntil = Date.now() + DRAG_GRACE_MS
  }

  const unsubscribe = ctx.workspaces.list.subscribe(() => {
    const snapshot = ctx.workspaces.list.getSnapshot()
    const next = snapshot.items.map((workspace) => String(workspace.workspaceId))
    if (snapshot.state !== 'idle') {
      // 载体失联：顺序停留在断线前的样子，等恢复后的整份替换。
      resyncing = true
      previous = next
      return
    }
    if (resyncing) {
      // 恢复后的第一份顺序是新基线，不当作一次上浮。
      resyncing = false
      previous = next
      return
    }
    const arrived = frontArrival(previous, next)
    previous = next
    if (arrived === undefined || frame !== undefined) return
    frame = requestAnimationFrame(scroll)
  })

  doc?.addEventListener('dragstart', onDragStart, true)
  doc?.addEventListener('dragend', onDragEnd, true)
  doc?.addEventListener('drop', onDragEnd, true)

  ctx.effect(
    () => () => {
      unsubscribe()
      doc?.removeEventListener('dragstart', onDragStart, true)
      doc?.removeEventListener('dragend', onDragEnd, true)
      doc?.removeEventListener('drop', onDragEnd, true)
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        frame = undefined
      }
    },
    `${name}.client`,
  )
}
