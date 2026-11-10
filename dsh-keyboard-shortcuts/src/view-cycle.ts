/**
 * 右栏收起时 `⌘⌥←` / `⌘⌥→`(macOS)或 `Ctrl+Alt+←` / `Ctrl+Alt+→`(Windows、Linux)的另一半：
 * 在**会话视图**标签(「对话」/「轨迹」/ 插件注册的其它 `conversation.view`)之间环状切换。
 *
 * 为什么按 DOM 读、按 DOM 点：上游把 View 选择保存在每个 Session 的 Conversation store 里
 * (`actions.setView` / `navigation.selectView`)，那是 Slot 座位内部的 React 面，本插件
 * 拿不到；唯一的公开入口就是标签行里的那颗 `role="tab"` 按钮 —— 点它与用户点页签是同一次
 * `selectView`，持久化偏好、激活 target、宽预算折叠都由上游自己处理。所以这里只做两件事：
 * 读出「此刻真的画出来的」标签，把方向换算成下一颗按钮，然后 `click()` 它。
 *
 * 候选口径与页面循环(`page-cycle.ts`)一致，只取**眼睛看得见的**标签：宽度预算把某个 View
 * 折进「更多会话视图」菜单后，它的按钮不在行里，也就不进候选 —— 切不到看不见的页签，
 * 与点击页签的可用集合相同。右栏里没有会话视图标签行，但为防将来嵌进右栏(或别的
 * 内嵌 occurrence)时误认，右侧栏会话根之下的标签行一律跳过。
 *
 * DOM 锚点 `[data-conversation-tabs]`（以及行内的 `[role="tab"]` / `aria-selected`）由
 * `css-contract.json` 的 conversation-view-tabs 一条契约兜住；上游改名时这里退化成
 * 空候选(不动作、不消费)，而不是猜。
 *
 * 机制与边界见 docs/dsh-keyboard-shortcuts/03-fixed-input-and-pane-keys.md。
 */

/** 会话视图标签行(上游 Conversation 头部的 `Views` 行)。 */
const TABS_ROW_SELECTOR = '[data-conversation-tabs]'

/** 行内的一颗页签按钮。 */
const TAB_SELECTOR = '[role="tab"]'

/** 右侧栏会话根：它下面的标签行不属于主会话，跳过。 */
const RIGHT_SIDEBAR_SELECTOR = '[data-sidebar-right-session]'

/** 一次切换的方向:与页面循环的 `PageStep` 同一套取值。 */
export type ViewCycleStep = 'previous' | 'next'

/**
 * 一颗此刻渲染出来的会话视图页签。
 *
 * `active` 直接读 `aria-selected="true"`：上游按 `resolveActiveView(...)` 的结论写这个属性，
 * 也就是「眼下的内容区画的是哪一页」。当前页没被渲染出来(例如它被折进「更多」菜单、
 * 而标签行里没有一颗选中)时整行都没有 `active`。
 */
export interface DisplayedViewTab {
  /** 在该行里的位置(显示顺序)。 */
  readonly index: number
  /** 页签文案，只用于诊断；切换不依赖它。 */
  readonly label: string
  /** 是否是当前会话视图。 */
  readonly active: boolean
  /** 页签按钮本身：`click()` 与用户点击是同一次 `selectView`。 */
  readonly element: Element
}

/**
 * 主会话此刻渲染出来的会话视图页签，按显示顺序。
 *
 * 只认第一行有页签的标签行；右侧栏会话根之下的行跳过。没有 document、没有标签行、
 * 或行里一颗页签都没有(会话还停在 Hero、或只有 Chat 一个 View)时返回空数组。
 */
export function displayedViewTabs(): DisplayedViewTab[] {
  if (typeof document === 'undefined') return []
  for (const row of document.querySelectorAll(TABS_ROW_SELECTOR)) {
    if (row.closest(RIGHT_SIDEBAR_SELECTOR) !== null) continue
    const elements = [...row.querySelectorAll(TAB_SELECTOR)]
    if (elements.length === 0) continue
    return elements.map((element, index) => ({
      index,
      label: (element.textContent ?? '').trim(),
      active: element.getAttribute('aria-selected') === 'true',
      element,
    }))
  }
  return []
}

/**
 * 标签行里与当前页相邻的那一颗，方向为环状。
 *
 * 少于两颗时不动作(没有"下一个视图");当前页不在行里(被折进「更多」菜单、或上游没写
 * `aria-selected`)时，`next` 落行首、`previous` 落行尾 —— 与页面循环、会话导航同一套
 * 「当前不在候选里」的退回规则。
 */
export function steppedViewTab(
  tabs: readonly DisplayedViewTab[],
  step: ViewCycleStep,
): DisplayedViewTab | undefined {
  if (tabs.length < 2) return undefined
  const current = tabs.findIndex((tab) => tab.active)
  const delta = step === 'next' ? 1 : -1
  const index = current < 0
    ? (step === 'next' ? 0 : tabs.length - 1)
    : (current + delta + tabs.length) % tabs.length
  const next = tabs[index]
  if (next === undefined || next.active) return undefined
  return next
}

/**
 * 选中一颗页签：点它与用户点击同一次上游 `selectView`。
 *
 * 只调按钮自己的 `click()`，不碰焦点：视图切换不改变键盘落点，与用户点页签一致。
 */
export function activateViewTab(tab: DisplayedViewTab): void {
  const clickable = tab.element as unknown as { click?: () => void }
  clickable.click?.()
}
