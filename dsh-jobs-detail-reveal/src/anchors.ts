/**
 * 上游锚点：会话面板的滚动口、「后台任务」分区里那条「任务行 → 展开按钮 → 命令输出」结构。
 *
 * 全部取自上游构建产物里的稳定 `data-*` 标记，不碰 CSS Module 的哈希类名（类名每次构建都变，
 * 而 `data-*` 是上游自己写死、插件也照用的契约，见 docs/dsh-css-architecture/01-mechanisms-and-
 * registration.md）：
 *
 * | 锚点 | 元素 | 用途 |
 * | --- | --- | --- |
 * | `[data-session-panel]` | `<aside>` 会话面板 | 整块面板唯一的滚动口（`overflow-y: auto` + `max-height`）；只改它的 `scrollTop` 与 `max-height` |
 * | `[data-jobs-section]` | `<ul>` 后台任务列表 | 只是这条链路的范围；本插件不单独用它 |
 * | `[data-job-row]` | `<div>` 一行任务 | 滚动的目标行：把它顶到面板内容区顶部，收起详情的按钮就停在面板顶部 |
 * | `button[aria-expanded]` | 行里的展开按钮 | 只有它带 `aria-expanded`（停止按钮、复制按钮都不带），点它是开关详情的唯一入口 |
 * | `[data-terminal]` | 详情里的终端卡片 | 输出区块的标记，用来认出「详情已经挂载」，并沿它往上找到详情容器 |
 *
 * 两个容易踩空的结构事实：
 *
 * 1. 任务行外面还套着 HoverCard 的 `<span>`（悬停卡片的锚点容器），所以详情**不是**任务行的
 *    `nextElementSibling`；详情是 `<li>` 的一个直接子元素，旁边那个 `<span>` 才是行。
 * 2. 详情在观察到的第一帧输出到达之前不渲染（上游 `expanded && view !== undefined`），点开
 *    之后要等它挂载，见 `reveal.ts` 的等待循环。
 *
 * 另外：仅运行中的任务行才有停止按钮，它的 `aria-label` 也随状态变化；这里一律用
 * `aria-expanded` 认展开状态，不读文案、不读类名。
 */

/** 会话面板根（`data-session-panel` 的取值是 `docked` / `overlay`，选择器不带值）。 */
export const PANEL_SELECTOR = '[data-session-panel]'

/** 「后台任务」分区里的任务列表。 */
export const JOBS_LIST_SELECTOR = '[data-jobs-section]'

/** 一行任务（含展开按钮的那个 `div`）。 */
export const JOB_ROW_SELECTOR = '[data-job-row]'

/** 行里的展开按钮：只有它带 `aria-expanded`。 */
export const ROW_TOGGLE_SELECTOR = 'button[aria-expanded]'

/** 命令输出的终端卡片。 */
export const TERMINAL_SELECTOR = '[data-terminal]'

/** 任务行的 `<li>`：行与详情的外框，加高面板时按它的高度算「详情要占多高」。 */
export const JOB_ITEM_SELECTOR = 'li'

/** 一次展开的完整定位结果：面板、行、行所在的 `<li>`、命令输出详情。 */
export interface JobDetailTargets {
  /** 会话面板：滚动口，也是加高 `max-height` 的那个元素。 */
  readonly panel: HTMLElement
  /** 任务行：滚到面板顶部的那一行。 */
  readonly row: HTMLElement
  /** 行所在的 `<li>`：高度涵盖「行 + 详情」，是详情实际要占的垂直空间。 */
  readonly item: HTMLElement
  /** 命令输出详情容器（`<li>` 的直接子元素，里面有 `[data-terminal]`）。 */
  readonly detail: HTMLElement
}

/**
 * 从点击目标往上找会话面板。
 * @param target - 点击目标（或任意后代元素）。
 * @returns 面板根元素；不在会话面板里时 `null`。
 */
export function sessionPanelOf(target: Element): HTMLElement | null {
  return target.closest(PANEL_SELECTOR) as HTMLElement | null
}

/**
 * 从点击目标往上找任务行。
 * @param target - 点击目标（或任意后代元素）。
 * @returns 任务行元素；不在任务行里时 `null`。
 */
export function jobRowOf(target: Element): Element | null {
  return target.closest(JOB_ROW_SELECTOR)
}

/**
 * 从点击目标往上找**这一行的**展开按钮。
 *
 * 行里还有停止按钮（运行中才有）与右侧的箭头；只有展开按钮本身（或它的图标）算命中，点停止
 * 不触发滚动，也不改变展开状态。
 * @param target - 点击目标（或任意后代元素）。
 * @returns 展开按钮；点击的不是这一行的展开按钮时 `null`。
 */
export function rowToggleOf(target: Element): Element | null {
  const row = jobRowOf(target)
  if (row === null) return null
  const toggle = target.closest(ROW_TOGGLE_SELECTOR)
  return toggle !== null && toggle.parentElement === row ? toggle : null
}

/**
 * 读一行的展开状态。
 * @param row - 任务行元素。
 * @returns 行里的展开按钮标着 `aria-expanded="true"` 时为 `true`。
 */
export function isRowExpanded(row: Element): boolean {
  return row.querySelector(ROW_TOGGLE_SELECTOR)?.getAttribute('aria-expanded') === 'true'
}

/**
 * 定位一次展开的四个元素，认出详情是否已经挂载。
 *
 * 详情容器按结构判定：从 `[data-terminal]` 往上走，直到它的父元素就是 `<li>`。这样行外那层
 * HoverCard 的 `<span>`、详情里的提示行（`output.gap` / `output.error`）都不影响定位，上游给
 * 详情换一层包裹也不会影响。
 * @param row - 任务行元素。
 * @param panel - 会话面板根元素。
 * @returns 定位结果；详情还没挂载、或结构对不上时 `null`。
 */
export function jobDetailOf(row: Element, panel: Element): JobDetailTargets | null {
  if (panel.contains(row) !== true) return null
  const item = row.closest(JOB_ITEM_SELECTOR)
  if (item === null || item.parentElement === null) return null
  const terminal = item.querySelector(TERMINAL_SELECTOR)
  if (terminal === null) return null
  let detail: Element = terminal
  while (detail.parentElement !== null && detail.parentElement !== item) detail = detail.parentElement
  // 走到根还没碰到现在这个 <li>：终端卡片其实在别处（例如另一个任务的详情），不认。
  if (detail.parentElement !== item) return null
  return {
    panel: panel as HTMLElement,
    row: row as HTMLElement,
    item: item as HTMLElement,
    detail: detail as HTMLElement,
  }
}
