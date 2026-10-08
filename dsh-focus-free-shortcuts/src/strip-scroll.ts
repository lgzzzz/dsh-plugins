/**
 * 右栏页签行的滚动补偿：瞬时到位 + 跨切换保持观察窗口。
 *
 * 两件事同源。dockkit 的 `TabLayout` 给每个 tab 一个 host，而页签行只在当前选中那条 tab
 * 的 host 里渲染，所以每次换页签都是旧 chip box 卸载、新 chip box 挂载，新元素的
 * `scrollLeft` 天然是 0（插件的 `⌘⌥←/→` / `Ctrl+Alt+←/→` 与鼠标点页签走同一条选中路径）。
 * kit 自己的 `useActiveChipInView` 在 layout 阶段做一次「从 0 出发」的最小可见修正，于是
 * 目标 chip 的右缘一定落在盒内 24px 处：目标必然是视野最右那颗，来源（上一次的目标）恰好
 * 也在最右、被挤出视野。`scroll-behavior: smooth` 还会让这次修正表现成一段动画。
 *
 * 本模块做两件事：
 *
 * 1. 注入一条作用域限定在右侧栏的规则，把 `scroll-behavior` 从 `smooth` 改回 `auto`，
 *    使 kit 的修正与下面第 2 步的写入都在首帧绘制之前瞬时完成；
 * 2. 在切页前后记住并还原观察窗口（`captureStripScroll` / `restoreStripScroll`）：新 chip
 *    box 挂载后先把旧窗口放回去，只有目标 chip 不在窗口里时才做最小推移，所以相邻来回切时
 *    整行完全不动、长距离跳转也只移动最小距离。
 *
 * 第 2 步复刻了 kit 的「最小可见」口径（含 24px 边缘余量）。这是本模块唯一一处复刻上游几何
 * 的地方：上游那条规则以 0 为起点，本模块要的语义是以旧窗口为起点。上游改渐隐带宽度时，
 * 最坏情形是目标 chip 与边缘的间距观感不同，不误动作。
 *
 * 不消费按键、不参与任何归属判定。样式标签按持有者计数共享一个 `<style>`：同一文档里已有
 * 同一份规则（dev / HMR 下旧实例留下的标签）就复用它，且不由本实例摘除；本实例自己插入的
 * 标签在最后一个持有者卸载时移除。没有 `document`（Node 侧测试、SSR）或 document 承载不了
 * 标签（极简 / 假 DOM）时整段是 no-op。
 *
 * 机制推导与上游锚点见 docs/dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md。
 */
import { name } from './runtime.ts'
import type {Context} from '@deepseek-ai/cordis'

/** 页面芯片的属性名：dockkit 放在每个页签芯片上，取值就是 tab id。 */
const CHIP_ATTRIBUTE = 'data-dockkit-tab'

/** chip box 的属性名：dockkit 放在页签行唯一的可滚动盒子上，取值是它所属 pane id。 */
const BOX_ATTRIBUTE = 'data-dockkit-strip-tabs'

/** 右侧栏会话根的属性名：把页面芯片的查找收在本插件作用的那个会话里。 */
const SESSION_ATTRIBUTE = 'data-sidebar-right-session'

/** 目标 chip 与 chip box 边缘之间留的余量（像素）：kit 在两端画 24px 渐隐带，贴边会被遮住。 */
const STRIP_EDGE_MARGIN = 24

/** 注入规则的 style 标签的 `data-plugin-css` 值，与构建期全局样式注入的命名同形。 */
export const STRIP_SCROLL_STYLE_ID = `${name}/strip-scroll`

/** 认领该标签的选择器，也是"同一文档里已有同一份规则"的判据。 */
export const STRIP_SCROLL_STYLE_SELECTOR = `style[data-plugin-css="${STRIP_SCROLL_STYLE_ID}"]`

/**
 * 规则文本：只作用于右侧栏的页签行。
 *
 * 两个属性选择器的特异性（0,2,0）高于 dockkit 的哈希类规则（0,1,0），与样式表顺序无关；
 * `data-dockkit-strip-tabs` 是 kit 放在 chip box 上的稳定标记，`data-sidebar-right-session`
 * 把作用面收在右侧栏 —— 对话区那套同样由 dockkit 渲染的条带不受影响。
 */
export const STRIP_SCROLL_CSS = [
  `/* ${name}:右栏页签行的滚动瞬时到位(不缓动)。 */`,
  '[data-sidebar-right-session] [data-dockkit-strip-tabs] { scroll-behavior: auto; }',
].join('\n')

/** 当前持有该规则的安装数；多个作用域共享同一个 style 标签。 */
let holders = 0

/** 本模块插入的标签；复用到的标签不记在这里，卸载时不动它。 */
let inserted: HTMLStyleElement | undefined

/**
 * 认领规则：第一个持有者插入标签，之后的持有者共用它。
 * @returns 释放本次认领的函数（重复调用无副作用）。
 */
function acquire(): () => void {
  if (typeof document === 'undefined') return () => {}
  // 极简 / 假 document 可能只实现了一部分读数（例如测试装置只给选择查询）：
  // 承载不了标签就什么都不做 —— 补偿本来就是可有可无的视图规则，退化即可。
  if (typeof document.createElement !== 'function' || typeof document.head?.append !== 'function') return () => {}
  if (holders === 0) {
    const existing = document.querySelector<HTMLStyleElement>(STRIP_SCROLL_STYLE_SELECTOR)
    if (existing !== null) inserted = undefined
    else {
      const element = document.createElement('style')
      element.dataset.plugin = name
      element.dataset.pluginCss = STRIP_SCROLL_STYLE_ID
      element.textContent = STRIP_SCROLL_CSS
      document.head.append(element)
      inserted = element
    }
  }
  holders += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders > 0) return
    inserted?.remove()
    inserted = undefined
  }
}

/**
 * 安装右栏页签行的滚动补偿：瞬时到位（注入规则）+ 跨切换保持观察窗口（切页前后的采集 / 还原）。
 * 由页面切换桥在自己的注入作用域里调用一次，随该作用域卸载；没有可承载标签的 `document`
 * （无 document / 极简 DOM）时只登记一个空释放函数，不插入任何东西。
 */
export function installInstantStripScroll(ctx: Pick<Context, 'effect'>): void {
  ctx.effect(() => acquire(), `${name}: instant strip scroll`)
}

/** 一次切页前记下的观察窗口：某条 chip box 与它当时的滚动位置。 */
export interface StripScrollPosition {
  /** chip box 的 `data-dockkit-strip-tabs` 值（它所属 pane）：切页后用它确认还是同一条条带。 */
  readonly boxId: string
  /** 记下的 `scrollLeft`。 */
  readonly left: number
}

/**
 * 某个会话里此刻渲染出来的页面芯片。
 *
 * 与 `pageCycle.ts` 的 `sidebarRoot` 同一条纪律：id 不拼进选择器，取回候选后按属性值比较；
 * 同时要求芯片的最近会话根就是本会话（页面 id 由各面自己铸造，不跨面比较）。浮动 pane 的
 * 标题、尚未挂载的页面都没有这个芯片，返回 undefined。
 */
function renderedChip(sessionId: string, tabId: string): Element | undefined {
  if (typeof document === 'undefined') return undefined
  return [...document.querySelectorAll(`[${CHIP_ATTRIBUTE}]`)].find((chip) =>
    chip.getAttribute(CHIP_ATTRIBUTE) === tabId
    && chip.closest(`[${SESSION_ATTRIBUTE}]`)?.getAttribute(SESSION_ATTRIBUTE) === sessionId)
}

/** 页面芯片所在的 chip box；芯片不在任何条带里（浮动 pane、结构变了）时返回 undefined。 */
function chipBox(chip: Element): HTMLElement | undefined {
  return chip.closest<HTMLElement>(`[${BOX_ATTRIBUTE}]`) ?? undefined
}

/**
 * 记下当前活动页面所在 chip box 的滚动位置。
 *
 * 必须在 `sidebar.focus()` **之前**调用（那之后当前页就换人了）。找不到该芯片的条带
 * （浮动 pane、页面尚未挂载、没有 document）时返回 undefined，调用方照常切页。
 */
export function captureStripScroll(sessionId: string, tabId: string | undefined): StripScrollPosition | undefined {
  if (tabId === undefined) return undefined
  const chip = renderedChip(sessionId, tabId)
  const box = chip === undefined ? undefined : chipBox(chip)
  if (box === undefined) return undefined
  const boxId = box.getAttribute(BOX_ATTRIBUTE)
  if (boxId === null) return undefined
  return { boxId, left: box.scrollLeft }
}

/**
 * 换页签后（下一次绘制之前）把观察窗口还回去。
 *
 * 新 chip box 从 `scrollLeft = 0` 开始，kit 的修正又只在"目标不可见"时从 **0** 出发推移，
 * 所以这里改成以**旧窗口**为起点：先把位置放回去，只有目标芯片不在窗口里时才做最小推移
 * （留 24px 边缘余量）。写入与 kit 的那次修正一样落在首帧之前，中间态不会被画出来。
 *
 * 跨 pane（浮动 pane 与 dock 没有共同的条带）、目标芯片尚未渲染、没有记下窗口时都不动作，
 * 交给 kit 原来的规则。
 */
export function restoreStripScroll(
  position: StripScrollPosition | undefined,
  sessionId: string,
  tabId: string,
): void {
  if (position === undefined) return
  const chip = renderedChip(sessionId, tabId)
  if (chip === undefined) return
  const box = chipBox(chip)
  if (box === undefined || box.getAttribute(BOX_ATTRIBUTE) !== position.boxId) return
  box.scrollLeft = position.left
  const bounds = box.getBoundingClientRect()
  const rect = chip.getBoundingClientRect()
  if (rect.left < bounds.left) box.scrollLeft += rect.left - bounds.left - STRIP_EDGE_MARGIN
  else if (rect.right > bounds.right) box.scrollLeft += rect.right - bounds.right + STRIP_EDGE_MARGIN
}
