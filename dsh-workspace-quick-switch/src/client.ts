/**
 * 浏览器半部:两张浮层,各占一条固定键。
 *
 *   - **工作区浮层**:`⌘⌥M`(macOS)/ `Ctrl+Alt+M`(Windows、Linux)按左侧栏 Workspace
 *     分组的顺序列出工作区,`Enter` 在该工作区**新建会话**;
 *   - **会话浮层**:`⌘⌥I`(macOS)/ `Ctrl+Alt+I`(Windows、Linux)按左侧栏「单列表 +
 *     最近更新 + 隐藏已归档」的顺序列出会话,`Enter` **打开**选中的会话。
 *
 * 两条固定行声明的都是逻辑组合 `primary+alt`+字母,注册表在 macOS 上展开成 `meta+alt`
 * (⌘⌥)、在 Windows/Linux 上展开成 `control+alt`(Ctrl+Alt),所以同一份声明在两端
 * 各是各的键。
 *
 * 两张浮层共用同一套面板(同一份样式、同样的窗口滑动/选中规则,状态层在
 * `palette.ts`),只是候选来源与确认动作不同:工作区候选照抄 Workspace 控制器的 `list`
 * 快照(`dsh-workspace-activity-sort` 之类改的正是这份顺序);会话候选由 `sessions.ts`
 * 按左侧栏的派生链投影,顺序与「单列表 / 最近更新 / 隐藏已归档」完全一致。一屏只渲染
 * {@link PAGE_SIZE} 行,窗口**连续滑动**:滚轮滚一格就是 1–10 → 2–11,`←` / `→` 滑一
 * 整屏,`↑` / `↓` 移选中行并在它离开窗口时把窗口滑到贴边;到两端都停住。
 * 两张浮层互斥:打开一张会先关掉另一张。
 *
 * 四条通路(两张浮层各自一份):
 *
 *   - **固定行**注册在快捷键服务里(group `application`),占据 `primary+alt+字母`,存在
 *     本身就是占用;按键经 `observeFixedInput` 的固定通道送达,只认这一条物理组合,命中时
 *     立刻 `consume()`(适配器就是 `preventDefault`)。**消费是必须的**:固定行只是「占住」
 *     组合键,上游不会替它消费,不消费的话平台会把同一次 `⌘⌥M` 再当一次自己的快捷键 ——
 *     macOS 上顺手最小化窗口就是这么来的。
 *   - **浮层**注册进 `shell.overlay`(加法式列表槽)。候选由本插件直接订阅上游快照得来
 *     (槽只给框架标准 props,容器与其注入面在 `ctx.inject` 的 scope 里造好),所以候选一变
 *     就重渲。
 *   - **浮层内的按键**由本插件在 document 捕获阶段取走(`Escape` / `Enter` / `↑` / `↓`
 *     与整屏滑动的 `←` / `→`):浮层一开它就先于任何本地控件看到按键,关掉后立即放行。
 *   - **终端内的打开键**由本插件在 window 捕获阶段取走:落在 `.xterm` 里的 keydown 到不了
 *     固定通道(终端在自己的 textarea 处理器里 `stopPropagation()`),所以另挂一个捕获监听,
 *     早于事件进入终端判定,命中即吞掉这一按并开对应的浮层(判定与固定通道共用同一函数)。
 *     macOS 上 `⌘⌥I` 还是死键(Option+I = ˆ),固定通道会把这一按标成组字中,所以另有一条
 *     只认 `key === 'Dead'` 的捕获补偿(与 `dsh-keyboard-shortcuts` 对 `⌘⌥N` 的做法同源)。
 *
 * 内核两条固定行与浮层只等 `slots` / `shortcuts`,所以两组键从一开始就占着、浮层也随时能开。
 * 候选要用的 `workspaces` / `sessions` 是另一回事 —— 它们经 gateway + WebSocket 的远程链路
 * 提供,通常比本插件激活晚得多,所以各挂一个**等待子 fiber**(`scope.inject`),服务到位后再
 * 接上订阅;服务缺席就只是没有候选(浮层照常打开并提示),不会把启动审计拖成「等待激活」。
 *
 * 动作只有两条:`uiWorkspace.startSession(workspaceId)`(与左侧栏工作区分组上的「新建会话」
 * 同一个动词,复用该工作区已有的空白会话)与 `uiWorkspace.openSession(sessionId)`(与点击
 * 左侧栏那一行同一个操作)。
 *
 * 键位冲突、启用方式与已知边界见 docs/dsh-workspace-quick-switch.md。
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ShortcutBinding,
  ShortcutCommandId,
  ShortcutFixedCommand,
  ShortcutFixedInput,
  ShortcutGesture,
  ShortcutPlatform,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// 只取模块增强:`Context['sessions'].list` 的 `SessionSummary.retainedBy.mainView`
// 由 ui-session 合并进 `SessionReferenceSourceMap`。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { name } from './runtime.ts'
import {
  PAGE_SIZE,
  QUICK_SWITCH_BINDING,
  QUICK_SWITCH_ID,
  SESSION_SWITCH_BINDING,
  SESSION_SWITCH_ID,
  bindingPress,
  clampIndex,
  clampOffset,
  createPaletteStore,
  currentRowIndex,
  paletteEntries,
  windowSlice,
  quickSwitchKeys,
  sessionSwitchKeys,
  type PaletteRow,
  type PaletteStore,
  type PaletteView,
} from './palette.ts'
import { sessionPaletteEntries } from './sessions.ts'

export { name }

/** 浮层依赖的两个客户端服务;任一缺席就整体不安装。 */
export const inject = ['slots', 'shortcuts']

/**
 * 浮层自己注入的样式(随本插件的 fiber 卸载一起移除)。
 *
 * 高度预算:面板不设固定上限,只吃满浮层这一层留给它的空间(`max-height: 100%` —— 浮层是
 * `inset: 0` 的定长容器,上下各留一层内边距,百分比因此有确定参照)。10 行候选在常规密度下
 * 约 613px 高,窗口够高时整份候选一次看全;视口高度不足 860px 时末尾那组 `@media` 收紧内边距,
 * 把这份高度压到约 561px,常见笔记本窗口(视口 ≥ 800px)同样一次看全。只有更矮的窗口才由
 * 列表内部滚动兜底,那时选中行靠 `scrollIntoView({ block: 'nearest' })` 跟着走。
 *
 * 指针:浮层根节点仍是 click-through(`pointer-events: none`),遮罩与**面板**吃指针
 * 事件 —— 面板因此能点(每一行就是按钮);滚轮由 `installPaletteWheel` 挂在浮层根节点上
 * 接管(见那里对被动监听与「一格一行」的说明)。
 *
 * 曾经的写法是 `max-height: min(70vh, 560px)`:面板在任何窗口里都被截到 560px,而候选列表
 * 需要 526px 放 10 行 × 50px,于是第 10 行永远在滚动区外。
 */
export const PALETTE_CSS = `
.dsh-workspace-quick-switch-overlay {
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px 24px;
  font-family: var(--dsw-font-family);
}
.dsh-workspace-quick-switch-backdrop {
  pointer-events: auto;
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));
  backdrop-filter: var(--dsw-mask-blur, none);
}
.dsh-workspace-quick-switch-panel {
  pointer-events: auto;
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: 100%;
  overflow: hidden;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0, 0, 0, 0.18));
}
.dsh-workspace-quick-switch-panel:focus {
  outline: none;
}
.dsh-workspace-quick-switch-head {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
}
.dsh-workspace-quick-switch-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.dsh-workspace-quick-switch-count {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0 8px 8px;
  list-style: none;
  overflow-y: auto;
}
.dsh-workspace-quick-switch-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-workspace-quick-switch-option[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-workspace-quick-switch-option:hover:not([data-active='true']) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-workspace-quick-switch-option:focus {
  outline: none;
}
.dsh-workspace-quick-switch-index {
  flex: none;
  width: 20px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-workspace-quick-switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
}
.dsh-workspace-quick-switch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-workspace-quick-switch-current {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  line-height: 18px;
}
.dsh-workspace-quick-switch-badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  line-height: 17px;
}
.dsh-workspace-quick-switch-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-enter {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-empty {
  padding: 8px 18px 18px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-foot {
  flex: none;
  display: flex;
  gap: 14px;
  padding: 10px 18px 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
/*
 * 视口高度不足 860px 时收紧内部留白与行高,保证一屏 10 行在常见笔记本窗口(视口 ≥ 800px)
 * 里一次看全;更矮的窗口仍由列表内部滚动兜底。
 *
 * 行高要显式写死:候选行是「名称 + 路径」两行文字,默认值 line-height: normal 会按字体
 * 给不同高度(中文 / 日文字体比拉丁字体高 2~3px/行,10 行累计差 20~30px,足以让第 10 行
 * 掉出视口)。写死之后一屏高度与标题语言无关。
 *
 * 只改内部间距,不动浮层根节点的顶部内边距 —— 那个值要让开 macOS 红绿灯 / Windows 标题栏。
 */
@media (max-height: 860px) {
  .dsh-workspace-quick-switch-head {
    padding: 12px 18px 8px;
  }
  .dsh-workspace-quick-switch-option {
    padding: 5px 10px;
  }
  .dsh-workspace-quick-switch-name {
    line-height: 18px;
  }
  .dsh-workspace-quick-switch-path {
    line-height: 15px;
  }
  .dsh-workspace-quick-switch-foot {
    padding: 8px 18px 10px;
  }
}
`

/** 工作区浮层根节点的 DOM 标记(人工排查与自动化验证都读它)。 */
export const PALETTE_ROOT_ATTR = 'data-workspace-quick-switch'

/** 工作区浮层里一行候选的 DOM 标记。 */
export const PALETTE_OPTION_ATTR = 'data-workspace-quick-switch-option'

/** 会话浮层根节点的 DOM 标记。 */
export const SESSION_ROOT_ATTR = 'data-session-quick-switch'

/** 会话浮层里一行候选的 DOM 标记。 */
export const SESSION_OPTION_ATTR = 'data-session-quick-switch-option'

/**
 * 工作区浮层的文案:标题、计数单位、空态与底栏。
 *
 * 两张浮层共用同一个组件与同一套样式,差异只在这份文案与候选来源上。
 */
export const WORKSPACE_VIEW: PaletteView = {
  id: name,
  domId: name,
  rootAttr: PALETTE_ROOT_ATTR,
  title: '新建会话于工作区',
  unit: '个工作区',
  emptyCount: '左侧栏还没有工作区',
  emptyHint: '先在左侧栏添加一个工作区。',
  listLabel: '工作区',
  enterHint: 'Enter 新建会话',
}

/**
 * 会话浮层的文案。
 *
 * 候选顺序照抄左侧栏「单列表 + 最近更新 + 隐藏已归档」,确认动作是打开该会话。
 */
export const SESSION_VIEW: PaletteView = {
  id: `${name}.session-switch`,
  domId: `${name}-session`,
  rootAttr: SESSION_ROOT_ATTR,
  title: '切换会话',
  unit: '个会话',
  emptyCount: '左侧栏还没有会话',
  emptyHint: '先在左侧栏新建一个会话。',
  listLabel: '会话',
  enterHint: 'Enter 打开会话',
}

/**
 * 把选中行滚进可见区(`nearest`:已经可见的行不动)。
 *
 * 窗口够高时 10 行全部可见,这里什么都不做;窗口矮到列表内部滚动时,键盘把选中行移出
 * 视口就等于「看不见」,所以每次选中行变化后都要补一次。
 * @param option - 选中行元素;缺席(浮层未开、空候选、测试替身)时静默跳过。
 */
export function keepOptionVisible(option: Element | null | undefined): void {
  option?.scrollIntoView?.({ block: 'nearest' })
}

/** 一格滚轮事件(结构与 `WheelEvent` 兼容,测试替身也能给)。 */
export interface PaletteWheelEventLike {
  readonly deltaY: number
  /** `0` 像素、`1` 行、`2` 页(DOM_DELTA_*);缺席按像素。 */
  readonly deltaMode?: number
  readonly ctrlKey?: boolean
}

/** 滚轮监听目标(浮层根节点结构上满足它)。 */
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
 * 一次滚轮折算成多少像素。
 *
 * 像素模式(触控板、多数浏览器)原样使用;行 / 页模式(部分平台的鼠标滚轮)按一行 16px、
 * 一整屏 400px 折算。幅度只用来判方向,见 {@link wheelStep}。
 * @param event - 滚轮事实。
 * @returns 纵向位移(向上为负)。
 */
export function wheelPixels(event: PaletteWheelEventLike): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * 400
  return event.deltaY
}

/**
 * 一次滚轮折算成滑几行:**一格就是一行,与幅度无关**。
 *
 * 有的鼠标一格只报十几像素、有的报到一百多,按像素折算会让前者「滚了没反应」、后者
 * 「一格跳两三行」。这里不读幅度,只看方向:非零位移一律算一行(向上为 -1)。
 * 触控板的连续事件也因此每个事件走一行 —— 手感由滚轮 / 触控板自己的节奏决定。
 * @param pixels - 这一格折算出的像素(向上为负)。
 * @returns -1 / 0 / 1。
 */
export function wheelStep(pixels: number): -1 | 0 | 1 {
  if (!Number.isFinite(pixels) || pixels === 0) return 0
  return pixels > 0 ? 1 : -1
}

/**
 * 让滚轮滑动浮层窗口(一格一行),不是滚选中行,也不整屏跳。
 *
 * 监听挂在**浮层根节点**上、`passive: false`:
 *
 *   - 指针落在浮层任何位置(面板、遮罩留白)滚轮都归浮层 —— 只挂在面板上的话,指针偏到
 *     遮罩那片留白里,滚轮就会穿到背后正文上;
 *   - 每次都 `preventDefault()`:浮层是模态的,背后的正文被遮罩盖着,不该跟着滚;
 *   - 触控板捏合在 Chrome 里报成 `ctrlKey + wheel`,那是浏览器缩放手势,原样放行;
 *   - 每一格滚轮按 {@link wheelStep} 折成一行,窗口因此是**连续**的:显示 1–10 时滚一格
 *     变成 2–11,而不是整屏跳到 11–20。
 *
 * 选中行不跟着滚轮走:高亮只由键盘与点击改;滑动把选中行带出窗口时,store 会把它贴到
 * 最近的可见边上。
 * @param root - 浮层根节点;缺席(浮层未挂载)时不装。
 * @param slide - 滑动动作,参数是行数(正数往下)。
 * @returns 卸载函数。
 */
export function installPaletteWheel(
  root: PaletteWheelTarget | null | undefined,
  slide: (rows: number) => void,
): () => void {
  if (root === null || root === undefined) return () => {}
  const onWheel = (event: WheelEvent): void => {
    // 捏合缩放在 Chrome 里报成 ctrlKey + wheel:那是浏览器缩放手势,不归浮层。
    if (event.ctrlKey === true) return
    const rows = wheelStep(wheelPixels(event))
    if (rows === 0) return
    // 浮层是模态的:滚轮一律归它,哪怕已经滑到头 —— 否则会漏到背后那层正文上。
    event.preventDefault()
    slide(rows)
  }
  root.addEventListener('wheel', onWheel, { passive: false })
  // 卸载只按 capture 匹配:`passive` 不参与「是不是同一个监听」的判定。
  return () => root.removeEventListener('wheel', onWheel, false)
}

/** 浮层内一个按键解出的动作。 */
export type PaletteAction = 'close' | 'confirm' | 'next' | 'previous' | 'page-next' | 'page-previous'

/** `paletteAction` 读到的按键事实(KeyboardEvent 结构上满足它)。 */
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

/** 会话目录服务面:上游 `ctx.sessions`(候选来源与「主视图会话」标记)。 */
type Sessions = Context['sessions']

/** 宿主工作区服务面:上游 `ctx.workspaces`(候选来源与置顶/归档集合)。 */
type Workspaces = Context['workspaces']

/** 往 `<head>` 挂一张样式表,并返回移除它的函数。 */
function installStyleTag(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = PALETTE_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}

/**
 * 一次按键解码出的动作。
 *
 * 只认没有修饰键的 `Escape` / `Enter` / `↑` / `↓`(选行)与 `←` / `→`(翻页);组合中、
 * 已被别的处理器消费、或带修饰键的按键统统放行(浮层不抢 `Ctrl+↑`、`Shift+←` 这类有主的键)。
 * @param event - 按键事实。
 * @returns 动作,或不属于浮层时的 undefined。
 */
export function paletteAction(event: PaletteEventLike): PaletteAction | undefined {
  if (event.defaultPrevented === true) return undefined
  if (event.isComposing === true) return undefined
  if (event.ctrlKey === true || event.altKey === true || event.metaKey === true || event.shiftKey === true) return undefined
  // 按住不放的重复:选择与翻页可以连按,取消与确认不行(避免一次长按连开好几个会话)。
  if (event.repeat === true && (event.key === 'Enter' || event.key === 'Escape')) return undefined
  if (event.key === 'Escape') return 'close'
  if (event.key === 'Enter') return 'confirm'
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  if (event.key === 'ArrowRight') return 'page-next'
  if (event.key === 'ArrowLeft') return 'page-previous'
  return undefined
}

/** 主视图会话所属的工作区 id;两处读数都不全时不返回(浮层就不标「当前」)。 */
function currentWorkspaceId(
  sessions: Sessions | undefined,
  workspaces: readonly WorkspaceView[],
): WorkspaceId | undefined {
  const list = sessions?.list.getSnapshot()
  if (list === undefined) return undefined
  const current = list.ids.find((id) => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0)
  if (current === undefined) return undefined
  return workspaces.find((workspace) => workspace.sessionIds?.includes(current) === true)?.workspaceId
}

/** 捕获阶段的按键目标(document 结构上满足它)。 */
export interface PaletteKeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
}

/**
 * 在捕获阶段接管浮层的六个键。
 *
 * 捕获监听先于任何本地控件看到按键,所以浮层一开,`Esc`/`Enter`/`↑`/`↓`/`←`/`→` 就归它;
 * 关掉之后立刻回到原来的归属。浮层没开时一个键都不动(两张浮层各挂一份,只认自己那个
 * store 是否打开)。
 * @param store - 浮层状态。
 * @param target - 按键目标,浏览器里是 `document`。
 * @returns 卸载函数。
 */
export function installPaletteKeys(store: PaletteStore, target: PaletteKeyTarget): () => void {
  if (target === undefined || target === null) return () => {}
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!store.getSnapshot().open) return
    const action = paletteAction(event)
    if (action === undefined) return
    // 这六个键归浮层:不让页面上任何本地控件拿到同一次按键。
    event.preventDefault()
    event.stopPropagation()
    if (action === 'close') store.close()
    else if (action === 'confirm') confirmActive(store)
    else if (action === 'page-next') store.turn(1)
    else if (action === 'page-previous') store.turn(-1)
    else store.move(action === 'next' ? 1 : -1)
  }
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}

/** 浮层组件的 props:业务 props 由容器注入,一个是 store,一个是这张浮层的文案。 */
export interface OverlayProps {
  readonly store: PaletteStore
  readonly view: PaletteView
}

/** 浮层本体:只在 `open` 为真时渲染,开着的时候按捕获阶段收到的按键动作。 */
export function PaletteOverlay(props: OverlayProps): React.ReactElement | null {
  const { store, view } = props
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const open = state.open
  const entries = state.entries
  const activeIndex = clampIndex(state.activeIndex, entries.length)
  // 一屏只渲染 PAGE_SIZE 行;窗口起点越界(候选变短)按当前候选收敛,渲染与按键读的是同一个值。
  // 窗口是连续滑动的:起点可以是任意行,所以滚一下就是 1–10 → 2–11,而不是整屏跳。
  const offset = clampOffset(state.offset, entries.length)
  const visible = windowSlice(entries, offset)

  React.useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  // 选中行必须留在可见范围:窗口不够高时列表只在内部滚动,键盘把选中行移出视口等于「看不见」。
  // 打开时(初始选中行可能就是第 10 行)与每次 ↑/↓ 之后都把它滚进来。
  React.useEffect(() => {
    if (!open) return
    const list = listRef.current
    keepOptionVisible(activeIndex < 0 ? null : list?.querySelector(`#${optionDomId(view, activeIndex)}`))
  }, [open, activeIndex, view])

  React.useEffect(() => installPaletteKeys(store, document), [store])

  // 滚轮按行滑动窗口(一格一行,1–10 → 2–11),不改选中行(选中行只由键盘与点击改)。
  // 挂在整个浮层上而不是面板上:指针偏到遮罩那片留白里时,滚轮也该归浮层,不该穿到背后
  // 正文。浮层只在打开时才渲染,所以跟着 `open` 走。
  React.useEffect(() => {
    if (!open) return
    return installPaletteWheel(rootRef.current, (rows) => store.slide(rows))
  }, [open, store])

  if (!open) return null

  const children: React.ReactNode[] = [
    React.createElement('div', { key: 'backdrop', className: 'dsh-workspace-quick-switch-backdrop' }),
    React.createElement(
      'div',
      {
        key: 'panel',
        ref: panelRef,
        className: 'dsh-workspace-quick-switch-panel',
        tabIndex: -1,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': view.title,
      },
      React.createElement(
        'div',
        { key: 'head', className: 'dsh-workspace-quick-switch-head' },
        React.createElement('span', { key: 'title', className: 'dsh-workspace-quick-switch-title' }, view.title),
        React.createElement(
          'span',
          { key: 'count', className: 'dsh-workspace-quick-switch-count' },
          entries.length === 0 ? view.emptyCount : countLabel(view, entries.length, offset),
        ),
      ),
      entries.length === 0
        ? React.createElement(
            'div',
            { key: 'empty', className: 'dsh-workspace-quick-switch-empty' },
            view.emptyHint,
          )
        : React.createElement(
            'div',
            {
              key: 'list',
              ref: listRef,
              className: 'dsh-workspace-quick-switch-list',
              role: 'listbox',
              'aria-label': view.listLabel,
              'aria-activedescendant': optionDomId(view, activeIndex),
            },
            visible.map((entry, index) => optionElement(store, view, entry, offset + index, offset + index === activeIndex)),
          ),
      React.createElement(
        'div',
        { key: 'foot', className: 'dsh-workspace-quick-switch-foot' },
        React.createElement('span', { key: 'move' }, '↑ ↓ 选择'),
        entries.length > PAGE_SIZE
          ? React.createElement('span', { key: 'page' }, '← → 翻一屏')
          : null,
        React.createElement('span', { key: 'enter' }, view.enterHint),
        React.createElement('span', { key: 'esc' }, 'Esc 关闭'),
      ),
    ),
  ]

  return React.createElement(
    'div',
    { ref: rootRef, className: 'dsh-workspace-quick-switch-overlay', [view.rootAttr]: '' },
    children,
  )
}

/**
 * 标题右侧的计数文案:一屏装得下时报总数,否则报当前看到的行范围。
 * @param view - 这张浮层的文案(决定计数单位)。
 * @param total - 候选总数。
 * @param offset - 窗口第一行的下标(0 起)。
 */
export function countLabel(view: PaletteView, total: number, offset: number): string {
  if (total <= PAGE_SIZE) return `${total} ${view.unit}`
  const from = offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)
  return `${total} ${view.unit} · 显示 ${from}–${to}`
}

/**
 * 一行候选项的 DOM id(与 `aria-activedescendant` 配对,滚进可见区也按它定位)。
 * @param view - 这张浮层的文案(决定 id 前缀,两张浮层的行 id 因此不会撞车)。
 * @param index - 候选在整个列表里的下标。
 * @returns DOM id。
 */
export function optionDomId(view: PaletteView, index: number): string {
  return `${view.domId}-option-${index}`
}

/** 一行候选项。 */
function optionElement(
  store: PaletteStore,
  view: PaletteView,
  entry: PaletteRow,
  index: number,
  active: boolean,
): React.ReactElement {
  const label = entry.title === '' ? entry.key : entry.title
  const badges = entry.badges ?? []
  return React.createElement(
    'button',
    {
      key: entry.key,
      type: 'button',
      id: optionDomId(view, index),
      role: 'option',
      className: 'dsh-workspace-quick-switch-option',
      'aria-selected': active ? 'true' : 'false',
      [PALETTE_OPTION_ATTR]: '',
      // 稳定身份(工作区 id / 会话 id):人工排查与自动化验证按它定位行,不依赖文案或序号。
      'data-palette-key': entry.key,
      // 悬停与键盘选中共用同一套高亮(见样式表),但只有键盘/点击会改选中行。
      'data-active': active ? 'true' : 'false',
      onClick: () => activate(store, index),
    },
    React.createElement('span', { key: 'index', className: 'dsh-workspace-quick-switch-index' }, `${index + 1}`),
    React.createElement(
      'span',
      { key: 'texts', className: 'dsh-workspace-quick-switch-texts' },
      React.createElement(
        'span',
        { key: 'label', className: 'dsh-workspace-quick-switch-label' },
        React.createElement('span', { key: 'name', className: 'dsh-workspace-quick-switch-name' }, label),
        entry.current === true
          ? React.createElement('span', { key: 'current', className: 'dsh-workspace-quick-switch-current' }, '当前')
          : null,
        badges.map((badge) => React.createElement(
          'span',
          { key: `badge:${badge}`, className: 'dsh-workspace-quick-switch-badge', 'data-badge': badge },
          badge,
        )),
      ),
      React.createElement('span', { key: 'path', className: 'dsh-workspace-quick-switch-path' }, entry.subtitle),
    ),
    active
      ? React.createElement('span', { key: 'enter', className: 'dsh-workspace-quick-switch-enter' }, 'Enter')
      : null,
  )
}

/** 确认当前选中行(Enter)。 */
function confirmActive(store: PaletteStore): void {
  activate(store, store.getSnapshot().activeIndex)
}

/**
 * 确认一行(点击或 Enter):先把选中行定到它,再关掉浮层,最后让容器执行动作。
 *
 * 顺序是有意的:动作(新建 / 打开会话)会切走主视图,先关浮层就不会留下一个悬在切换之上的遮罩。
 * @param store - 浮层状态。
 * @param index - 被确认的行(可以是越界值,由 store 收敛)。
 */
function activate(store: PaletteStore, index: number): void {
  store.select(index)
  const binding = store.getSnapshot().binding
  store.close()
  if (binding === null) return
  binding()
}

/** 工作区浮层的固定行:占据 `primary+alt+M`,键帽按平台格式化。 */
function workspaceFixedCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: QUICK_SWITCH_ID as ShortcutCommandId,
    label: () => '工作区快速切换',
    keys: quickSwitchKeys(platform),
    bindings: [QUICK_SWITCH_BINDING],
    group: 'application',
  }
}

/** 会话浮层的固定行:占据 `primary+alt+I`,键帽按平台格式化。 */
function sessionFixedCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: SESSION_SWITCH_ID as ShortcutCommandId,
    label: () => '会话快速切换',
    keys: sessionSwitchKeys(platform),
    bindings: [SESSION_SWITCH_BINDING],
    group: 'application',
  }
}

/**
 * 安装两张浮层:注册两条固定行、把两个浮层挂进 `shell.overlay`、接上固定输入通道。
 *
 * 本插件只等 `slots` / `shortcuts`:它们一就绪,两组键与两张浮层就都在了。工作区与会话
 * 服务(都走远程链路,比这里晚)由等待子 fiber 接上,缺席时浮层按空候选打开并提示;
 * `uiWorkspace` 缺席时固定行照旧在(快捷键目录里可见),按键不做动作。
 * @param ctx - 客户端上下文。
 */
export function apply(ctx: Context): void {
  ctx.inject(inject, (scope) => {
    const slots = readSlots(scope)
    if (slots === undefined) return
    const shortcuts = readShortcuts(scope)
    if (shortcuts === undefined) {
      warn('shortcuts 服务不可用:固定行与快捷键输入未安装')
      return
    }

    const workspaceStore = createPaletteStore()
    const sessionStore = createPaletteStore()
    // 平台只决定 `primary` 往哪边展开;服务缺席时按 Windows/Linux 的 `Ctrl+Alt` 兜底。
    const platform: ShortcutPlatform = (shortcuts.platform as ShortcutPlatform | undefined) ?? 'windows'

    /**
     * 把上游当前读数投影进两个 store:候选、当前标记与选中行一起对齐。
     *
     * 每拍都从 `scope` 重新读服务,不缓存读数:`workspaces` / `sessions` 可能在订阅建立之后
     * 才到位(见下面的等待子 fiber),缓存住那一次 `undefined` 就再也补不回来了。
     */
    const refresh = (): void => {
      const workspaces = readWorkspaces(scope)
      const snapshot = workspaces?.list.getSnapshot()
      const hosts = snapshot?.items ?? []
      const sessions = readSessions(scope)
      const list = sessions?.list.getSnapshot()
      workspaceStore.sync(paletteEntries(hosts, currentWorkspaceId(sessions, hosts)))
      sessionStore.sync(list === undefined ? [] : sessionPaletteEntries({
        sessions: list,
        workspaces: hosts,
        rowState: {
          archivedSessionIds: snapshot?.archivedSessionIds ?? [],
          pinnedSessionIds: snapshot?.pinnedSessionIds ?? [],
        },
      }))
    }

    /** 打开会话浮层:先关掉工作区浮层(两张浮层互斥),动作为「打开选中会话」。 */
    const openSessionPalette = (): void => {
      workspaceStore.close()
      openSessionStore(sessionStore, readNavigation(scope))
    }

    /** 打开工作区浮层:先关掉会话浮层,动作为「在选中工作区新建会话」。 */
    const openWorkspacePalette = (): void => {
      sessionStore.close()
      openWorkspaceStore(workspaceStore, readNavigation(scope))
    }

    scope.effect(installStyleTag, `${name}: palette styles`)
    // 固定行要先挂载,固定输入观察者才读得到它;三者同属一个 scope,卸载时按登记逆序跑清理函数。
    scope.effect(() => {
      const disposeWorkspace = registerFixedRow(shortcuts, workspaceFixedCommand(platform))
      const disposeSession = registerFixedRow(shortcuts, sessionFixedCommand(platform))
      return () => {
        disposeWorkspace?.()
        disposeSession?.()
      }
    }, `${name}: quick switch fixed rows`)
    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        const target = ownedPalette(shortcuts, platform, fixedGesture(input))
        if (target === undefined) return
        // 先把这次按键收归本插件,再开浮层:consume() 一调用,平台就不会把同一次 ⌘⌥M 再执行
        // 一遍自己的快捷键,排在后面的固定行观察者也会看到已消费输入。
        consumeFixedInput(input)
        if (target === 'session') openSessionPalette()
        else openWorkspacePalette()
      }),
      `${name}: quick switch key`,
    )
    // 终端那一半:落在 `.xterm` 内的 keydown 到不了上面的固定通道(终端在自己的 textarea
    // 处理器里 `stopPropagation()`),本捕获监听早一个阶段看到它,在事件进入终端前判定并
    // 吞掉这一按,再开对应的浮层。判定与固定通道共用 `ownedPalette`,两条路径互斥。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (element === null || element.closest('.xterm') === null) return
        const target = ownedPalette(shortcuts, platform, keyGesture(event))
        if (target === undefined) return
        // 在终端自身处理器之前拦截:事件到此为止,xterm 既收不到这一按,也不会把
        // `Ctrl+Alt+M` / `Ctrl+Alt+I` 当成 AltGr 字符送进 shell。
        event.preventDefault()
        event.stopPropagation()
        if (target === 'session') openSessionPalette()
        else openWorkspacePalette()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: quick switch terminal capture`)
    // macOS 的死键补偿:Option+I 是死键(ˆ),官方固定通道会把这一按标成组字中,观察者于是
    // 让位。这一条在同一阶段认领 `key === 'Dead'` 的 ⌘⌥I / ⌘⌥M。焦点在 `.xterm` 内时让给
    // 上面的终端捕获(它只读 `isComposing`,不受死键影响)。
    scope.effect(() => {
      if (platform !== 'macos' || typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown' || event.key !== 'Dead') return
        if (event.isComposing === true || event.defaultPrevented === true) return
        const element = composedElement(event)
        if (element !== null && element.closest('.xterm') !== null) return
        const target = ownedPalette(shortcuts, platform, keyGesture(event))
        if (target === undefined) return
        // 先吞掉这一按:不让浏览器开始死键组合,也不让官方固定通道再看到它。
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat === true) return
        if (target === 'session') openSessionPalette()
        else openWorkspacePalette()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: quick switch dead key capture`)
    scope.effect(() => {
      let disposeWorkspace: undefined | (() => void)
      let disposeSession: undefined | (() => void)
      // `slots.inject` / `slots.register` 以槽位服务对象本身为接收者调用:它们是上游使用
      // `this` 的原型方法,服务代理会据此把 `this.ctx` 换成我们这个 scope(于是注册项与
      // 清理函数都挂在同一个 fiber 上)。自己 bind 到 scope 会让上游连 `this.ctx` 都读不到。
      slots.inject('shell.overlay', () => {
        disposeWorkspace = slots.register(
          {
            name: 'shell.overlay',
            id: name,
            order: 60,
            // 业务 props 只能由 inject 交出来:渲染器对条目做的是 jsx(entry.component, props)。
            inject: () => ({ store: workspaceStore, view: WORKSPACE_VIEW }),
          },
          PaletteOverlay,
        )
        disposeSession = slots.register(
          {
            name: 'shell.overlay',
            id: SESSION_VIEW.id,
            order: 61,
            inject: () => ({ store: sessionStore, view: SESSION_VIEW }),
          },
          PaletteOverlay,
        )
        return () => {
          disposeWorkspace?.()
          disposeSession?.()
        }
      })
      // 槽已经声明时回调同步跑完,dispose 此刻已经拿到;还没声明(ui-layout 尚未装配)
      // 时由回调自己交出的那个清理函数负责,这里什么都不用做。
      return () => {
        disposeWorkspace?.()
        disposeSession?.()
      }
    }, `${name}: palette overlays`)

    // 候选来源:`workspaces` 由工作区控制器经远程链路提供,激活时通常还不存在。
    // 工作区浮层的顺序与「当前工作区」、会话浮层的归属标签与置顶/归档集合都从这里来。
    scope.inject(['workspaces'], (inner) => {
      refresh()
      const workspaces = readWorkspaces(inner)
      if (workspaces === undefined) return
      inner.effect(() => workspaces.list.subscribe(refresh), `${name}: palette candidates`)
    })
    // 会话目录既是工作区浮层的「当前」标记来源,也是会话浮层的候选来源:主视图会话一换,
    // 两份读数都要跟着对齐。它同属远程链路,所以同样用等待子 fiber。
    scope.inject(['sessions'], (inner) => {
      refresh()
      const list = readSessions(inner)?.list
      if (list === undefined || typeof list.subscribe !== 'function') return
      inner.effect(() => list.subscribe?.(refresh), `${name}: palette current`)
    })
  })
}

/**
 * 注册一条固定行;注册失败只告警(该组合键不归本插件),不影响另一条。
 * @param shortcuts - 快捷键服务。
 * @param command - 固定行声明。
 * @returns 注销函数;注册失败时为 undefined。
 */
function registerFixedRow(shortcuts: Shortcuts, command: ShortcutFixedCommand): (() => void) | undefined {
  try {
    return shortcuts.registerFixed(command)
  } catch (error) {
    warn(`固定行注册失败(${command.keys.join('+')} 未占用):`, error)
    return undefined
  }
}

/** 打开工作区浮层:动作为「在选中工作区新建会话」,初始选中行落在当前会话所在的工作区。 */
function openWorkspaceStore(store: PaletteStore, navigation: UiWorkspace | undefined): void {
  if (navigation === undefined) {
    warn('uiWorkspace 服务不可用:无法新建会话')
    return
  }
  const entry = (): void => {
    const snapshot = store.getSnapshot()
    const index = clampIndex(snapshot.activeIndex, snapshot.entries.length)
    const picked = index < 0 ? undefined : snapshot.entries[index]
    if (picked === undefined) return
    try {
      navigation.startSession(picked.key as WorkspaceId)
    } catch (error) {
      warn(`新建会话失败(${picked.key}):`, error)
    }
  }
  const current = currentRowIndex(store.getSnapshot().entries)
  store.open(entry, current < 0 ? 0 : current)
}

/**
 * 打开会话浮层:动作为「打开选中会话」,初始选中行落在主视图会话上。
 *
 * `openSession` 缺席(上游换了动词名)时只告警、不开浮层 —— 打开一个按 Enter 什么也不做的
 * 列表比不打开更让人困惑。
 */
function openSessionStore(store: PaletteStore, navigation: UiWorkspace | undefined): void {
  const openSession = navigation?.openSession
  if (navigation === undefined || typeof openSession !== 'function') {
    warn('uiWorkspace 服务不可用:无法打开会话')
    return
  }
  const entry = (): void => {
    const snapshot = store.getSnapshot()
    const index = clampIndex(snapshot.activeIndex, snapshot.entries.length)
    const picked = index < 0 ? undefined : snapshot.entries[index]
    if (picked === undefined) return
    try {
      navigation.openSession?.(picked.key as SessionId)
    } catch (error) {
      warn(`打开会话失败(${picked.key}):`, error)
    }
  }
  const current = currentRowIndex(store.getSnapshot().entries)
  store.open(entry, current < 0 ? 0 : current)
}

/** 固定输入读数里的按键事实;不是 keydown 或没有 gesture 时返回 undefined。 */
function fixedGesture(input: ShortcutFixedInput): ShortcutGesture | undefined {
  if (input.type !== 'keydown') return undefined
  // 上游类型保证 keydown 一定带 gesture;测试替身可能省略或给 null,按「缺席」处理。
  return (input.gesture as ShortcutGesture | null | undefined) ?? undefined
}

/** 命中的是哪张浮层。 */
export type PaletteKind = 'workspace' | 'session'

/**
 * 一次按键事实归哪张浮层。
 *
 * 两条投递路径(固定通道的观察者与终端前的捕获拦截)共用本判定:平台物理组合完全匹配
 * (先试工作区的 `⌘⌥M` / `Ctrl+Alt+M`,再试会话的 `⌘⌥I` / `Ctrl+Alt+I`)、不是组字 / 长按 /
 * 已被消费的输入,且对应的固定行真的还挂在目录里(被别的注册者挤掉时这一按就"无主")。
 * @param shortcuts - 快捷键服务。
 * @param platform - 接收输入的设备平台。
 * @param gesture - 按键事实(KeyboardEvent 或固定通道读数结构上都满足);缺席时无主。
 * @returns 归属的浮层;不归本插件时 undefined。
 */
export function ownedPalette(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  gesture: ShortcutGesture | undefined,
): PaletteKind | undefined {
  if (gesture === undefined) return undefined
  if (gesture.composing === true || gesture.repeat === true || gesture.defaultPrevented === true) return undefined
  if (bindingOwns(shortcuts, platform, QUICK_SWITCH_BINDING, QUICK_SWITCH_ID, gesture)) return 'workspace'
  if (bindingOwns(shortcuts, platform, SESSION_SWITCH_BINDING, SESSION_SWITCH_ID, gesture)) return 'session'
  return undefined
}

/** 物理组合匹配 + 固定行仍在目录里。 */
function bindingOwns(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  binding: ShortcutBinding,
  id: string,
  gesture: ShortcutGesture,
): boolean {
  if (!bindingPress(platform, binding, gesture)) return false
  const rows = shortcuts.fixedCatalog?.getSnapshot()
  return rows === undefined || rows.some((row) => row.id === id)
}

/**
 * 这次固定输入是否就是工作区浮层那条组合(macOS `⌘⌥M`,Windows/Linux `Ctrl+Alt+M`)。
 *
 * 保留为独立导出:终端捕获与固定通道共用 `ownedPalette`,这里只回答「是不是工作区那张」。
 */
export function quickSwitchOwns(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  gesture: ShortcutGesture | undefined,
): boolean {
  return ownedPalette(shortcuts, platform, gesture) === 'workspace'
}

/** 这次固定输入是否就是会话浮层那条组合(macOS `⌘⌥I`,Windows/Linux `Ctrl+Alt+I`)。 */
export function sessionSwitchOwns(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  gesture: ShortcutGesture | undefined,
): boolean {
  return ownedPalette(shortcuts, platform, gesture) === 'session'
}

/** 从一次原生 keydown 里取出本插件要读的手势事实(捕获阶段 `defaultPrevented` 恒为 false)。 */
function keyGesture(event: KeyboardEvent): ShortcutGesture {
  return {
    code: event.code,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    repeat: event.repeat,
    composing: event.isComposing,
    defaultPrevented: false,
  }
}

/**
 * 事件组合路径上的第一个 Element(按 `closest` 这一项能力做鸭子类型判断,测试可以传普通假元素)。
 */
function composedElement(event: KeyboardEvent): Element | null {
  for (const value of event.composedPath()) {
    if (typeof value === 'object' && value !== null && 'closest' in value) return value as Element
  }
  return null
}

/**
 * 把这次固定输入收归本插件:调用适配器交出来的 `consume`(它就是 `event.preventDefault()`)。
 *
 * 固定行只「占住」组合键,上游**不会**替它消费:`effectiveShortcuts` 把带 `fixed` 的行排除在
 * 可配置行之外,于是 `dispatch` 里那条「处理成功就 `consume()`」永远轮不到固定行。所以不主动
 * 消费的话,这次按键会被平台再执行一遍自己的快捷键 —— macOS 上 `⌘⌥M` 顺手最小化窗口正是
 * 这一条。消费必须发生在按键派发的同一拍里,而固定通道本来就是同步回调。
 * @param input - 固定输入读数;没有 `consume` 的替身输入(测试夹具)直接跳过。
 */
function consumeFixedInput(input: ShortcutFixedInput): void {
  if (input.type !== 'keydown') return
  if (typeof input.consume === 'function') input.consume()
}

/** 从注入面读槽位服务。 */
function readSlots(scope: Context): SlotRegistry | undefined {
  const value = scope.get('slots')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.inject !== 'function' || typeof value.register !== 'function') return undefined
  return value
}

/** 从注入面读快捷键服务。 */
function readShortcuts(scope: Context): Shortcuts | undefined {
  const value = scope.get('shortcuts')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.registerFixed !== 'function' || typeof value.observeFixedInput !== 'function') return undefined
  return value
}

/** 从注入面读 `uiWorkspace`。 */
function readNavigation(scope: Context): UiWorkspace | undefined {
  const value = scope.get('uiWorkspace')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.startSession !== 'function') return undefined
  return value
}

/** 从注入面读宿主工作区控制器(缺席时浮层按空候选打开)。 */
function readWorkspaces(scope: Context): Workspaces | undefined {
  const value = scope.get('workspaces')
  if (typeof value !== 'object' || value === null) return undefined
  if (value.list === undefined || typeof value.list.getSnapshot !== 'function' || typeof value.list.subscribe !== 'function') {
    return undefined
  }
  return value
}

/** 从注入面读会话目录(缺席时两张浮层都只是空候选)。 */
function readSessions(scope: Context): Sessions | undefined {
  const value = scope.get('sessions')
  if (typeof value !== 'object' || value === null) return undefined
  if (value.list === undefined || typeof value.list.getSnapshot !== 'function') return undefined
  return value
}

/** 输出一行带插件前缀的诊断。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}
