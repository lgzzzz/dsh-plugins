/**
 * 上浮后的可视反馈：把侧栏「工作区 / 会话」区块的滚动条送回最上面。
 *
 * 「有工作区被放到第一位」由顺序快照判定，是纯函数（{@link frontArrival}）：只有原本已在列表里、
 * 且不在第一位的工作区被排到第一位才算一次重排到最前。基线（空列表 → 首个完整顺序）、
 * 新建工作区插到最前、删除原第一名后下一个顶上来都不算——它们没有「被排到第一位」这个动作。
 *
 * DOM 面只有两个上游锚点，都写在 TSX 的 `data-*` 上（不是 CSS Modules 生成的类名）：
 *
 *   - `[data-sidebar-list-area]`：`WorkspaceBrowser` 的 `listArea`。展开态侧栏里**唯一可见的
 *     滚动条**——侧栏 viewport 自己只负责把导航滚走（`scrollbar-width: none`），工作区分组与
 *     会话行都在这个区块里滚动。上游 README 把它列为「供测试和集成方定位的稳定标记」；
 *   - `[data-row-key^="workspace:"]`：工作区分组行。单列表视图（`groupBy: 'flat'`）、搜索
 *     结果替换列表、侧栏收起成 rail 时都没有分组行，此时工作区顺序本来就不可见，不动滚动位置。
 *     这一条是行身份键（上游没有把它写进稳定标记），只用来判断「分组视图是否在显示」。
 *
 * 两个锚点都可能被上游改名，改名后本文件只是退化成 no-op（不报错、不误滚），所以
 * `check-css.mjs` 把这两条对上游构建产物校验，让退化提前变成一次显式失败。
 *
 * 本文件只管「顺序变化算不算上浮」与「怎么滚」；断线恢复的基线、本地拖拽的静默窗口是
 * 订阅侧的状态机，在 `src/client.ts`。
 */

/** 侧栏区块自己的滚动容器（`listArea`）。 */
export const SECTION_SCROLLER_SELECTOR = '[data-sidebar-list-area]'

/** 工作区分组行；只有分组视图（按工作区 / 按工作区树）才渲染。 */
export const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'

/**
 * 本地工作区拖拽结束后仍不滚的窗口（ms）。
 *
 * 拖拽提交的顺序由上游在 `drop` / `dragend` 里乐观写入（同步通知），滚动写入排在下一帧，
 * 所以只认「拖拽中」不够：把第一名拖到后面时，拖拽期间的侧栏边缘自动滚动会把列表拉低，
 * 松手后若再跳回顶部，刚放下的行会被甩出视野。这个窗口覆盖提交到下一帧之间的空档。
 */
export const DRAG_GRACE_MS = 300

/**
 * 一次工作区拖拽最长认定的时间（ms）：`dragend` 在某些浏览器上落到页面外时可能不派发，
 * 超过这个时间就不再认为拖拽还在进行，避免一次丢失的事件永久停掉滚动。
 */
export const DRAG_STALE_MS = 30_000

/**
 * 事件起点是否在工作区分组行上（或它的子节点里）。
 *
 * 只做结构判断，不认事件类型：`dragstart` 的 target 可能是行内的图标 / 文字，所以用
 * `closest` 往上找。没有 `closest` 的 target（非 DOM、测试替身）一律不算。
 * @param target - 拖拽事件的起点。
 * @returns 起点在一条工作区分组行里时为 true。
 */
export function workspaceRowOf(target: EventTarget | null | undefined): boolean {
  if (target === null || target === undefined) return false
  const closable = target as { closest?: (selector: string) => unknown }
  if (typeof closable.closest !== 'function') return false
  return closable.closest(WORKSPACE_ROW_SELECTOR) !== null
}

/**
 * 这次顺序变化里被排到第一位的工作区；不是「重排到最前」时返回 undefined。
 *
 * 三个条件全部成立才算：
 *
 *   - 新旧顺序都有第一名，且第一名换了；
 *   - 新第一名在旧顺序里已经存在——它是被移动上来的，不是新建后插到最前；
 *   - 旧第一名在新顺序里还在——它是被挤下去的，不是被删掉后下一个顶上来的。
 *
 * 最后一条同时挡掉「访问过滤把某个工作区整行拿掉」这类替换：那种变化里旧第一名消失了，
 * 新第一名只是因为原来在它后面的行整体前移，并不是这次被排到最前。
 * @param previous - 变化前的顺序（工作区 id）。
 * @param next - 变化后的顺序（工作区 id）。
 * @returns 被排到最前的工作区 id；不构成一次重排到最前时为 undefined。
 */
export function frontArrival(
  previous: readonly string[],
  next: readonly string[],
): string | undefined {
  const first = next[0]
  const displaced = previous[0]
  if (first === undefined || displaced === undefined || first === displaced) return undefined
  if (!previous.includes(first)) return undefined
  if (!next.includes(displaced)) return undefined
  return first
}

/** 侧栏区块的滚动容器；文档里没有、或侧栏尚未渲染时返回 undefined。 */
export function sectionScroller(doc: Document | undefined): HTMLElement | undefined {
  return doc?.querySelector<HTMLElement>(SECTION_SCROLLER_SELECTOR) ?? undefined
}

/**
 * 把侧栏区块的滚动条送回最上面。
 *
 * 侧栏没渲染、区块里没有工作区分组行（单列表视图 / 搜索中 / 收起成 rail / 尚未挂载）、
 * 或者本来就在最上面时什么都不做。
 * @param doc - 页面文档；非浏览器环境（含测试）里可以缺席。
 * @returns 是否真的写入了 `scrollTop`。
 */
export function scrollWorkspaceSectionToTop(doc: Document | undefined): boolean {
  const area = sectionScroller(doc)
  if (area === undefined) return false
  if (area.querySelector(WORKSPACE_ROW_SELECTOR) === null) return false
  if (area.scrollTop === 0) return false
  area.scrollTop = 0
  return true
}
