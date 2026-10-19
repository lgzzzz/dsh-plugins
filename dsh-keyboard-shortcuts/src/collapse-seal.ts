/**
 * `⌘⌥.` / `Ctrl+Alt+.` 折叠后的“封口”：把最新一轮的平铺明细即时呈现成历史轮次的组头形态。
 *
 * 上游「详细」模式的两种形态由 `deferCollapse` 决定：
 *
 * - 最新一个 exchange 平铺：组根带 `data-group-expanded-mode`，组头容器是普通 `hidden`，
 *   组体可见、成员逐行平铺；
 * - 更早的轮次分组：没有 `data-group-expanded-mode`，组头可见、组体 `hidden="until-found"`。
 *
 * 发下一条消息后，上一轮从前者变成后者；在 `dsh-turn-process-open` 把轮次过程锁成展开
 * 之后，那正是用户看到的“折叠样式”。本模块让快捷键在折叠的同一批动作里**立即**把
 * 最新一轮切换成同一形态，而不是等下一轮消息。
 *
 * 纯展示层，不改 React 状态、store、设置或消息数据：
 *
 * 1. 只对“最新一个带锁标记的轮次”生效（锁由 `dsh-turn-process-open` 写在标题上；
 *    插件缺席时本模块完全空转，单独使用快捷键的行为不变）；
 * 2. 组根写 `data-dsh-collapse-sealed`，移除组头容器的 `hidden`（避免下一条消息到达时
 *    `useMotionHidden` 把它当成“从隐藏到显示”跑一次 reveal 动画）；
 * 3. 一条受限 CSS 把组体 `display:none`，组头 `aria-expanded=true` 时再放回组体——
 *    组头始终是上游自己的按钮，开合状态与语义不受影响；
 * 4. 选择器要求组头容器里确实有 `[data-process-activity]` 才隐藏组体：上游结构一旦
 *    变化只会退化成“不封口”，不会出现“组头看不见、内容又被藏起来”。
 *
 * 封口随 `data-group-expanded-mode` 消失（下一轮消息到达）自动失效：CSS 选择器同时要求
 * 平铺标记，React 切到分组态后本模块的规则不再命中，组头/组体交回上游。卸载时把仍处于
 * 平铺态的组头 `hidden` 写回，并移除标记与 `<style>`。
 *
 * 与阅读位置补偿的配合：先在封口前采集 `planReadingAnchor`，再 `sealGroups`、点击标题，
 * 最后在微任务里补 `scrollTop`——封口本身会明显改变高度，必须参与补偿。
 *
 * 上游锚点与失败模式见 docs/dsh-keyboard-shortcuts/09-collapse-steps.md。
 */
import { name } from './runtime.ts'
import type { Context } from '@deepseek-ai/cordis'

/** 封口标记；写在 `[data-step-process]` 组根上。 */
export const SEAL_ATTRIBUTE = 'data-dsh-collapse-sealed'

/** 由 `dsh-turn-process-open` 写在轮次过程标题上的锁标记。 */
export const LOCK_ATTRIBUTE = 'data-turn-process-locked'

/** 平铺模式的组根标记；分组态没有它。 */
export const FLAT_ATTRIBUTE = 'data-group-expanded-mode'

/** 轮次过程标题（锁标记挂在这里）。 */
export const TURN_HEADER_SELECTOR = '[data-turn-process]'

/** 过程组根。 */
export const GROUP_SELECTOR = '[data-step-process]'

/** 过程组标题按钮。 */
export const ACTIVITY_SELECTOR = '[data-process-activity]'

/** 组体。 */
export const GROUP_BODY_SELECTOR = '[data-step-process-body]'

/** 注入样式的标识（`data-plugin-css`）。 */
export const STYLE_ID = 'dsh-keyboard-shortcuts/collapse-seal.css'

/**
 * 封口样式。三段都要求「平铺 + 已封口」：
 *
 * - 隐藏组体；组头展开时放回组体；
 * - 组头容器若被上游重新写回 `hidden`，仍然显示（正常情况下 JS 已移除该属性）。
 *
 * 前两段都要求组头容器里存在 `[data-process-activity]`：结构变化时宁可不封口，
 * 也不能让组体被藏起来而组头又显示不出来。
 */
export const SEAL_CSS = [
  '[data-step-process][data-group-expanded-mode][data-dsh-collapse-sealed]:has(> div > [data-process-activity]) > [data-step-process-body] { display: none !important; }',
  '[data-step-process][data-group-expanded-mode][data-dsh-collapse-sealed]:has(> div > [data-process-activity][aria-expanded="true"]) > [data-step-process-body] { display: block !important; }',
  '[data-step-process][data-group-expanded-mode][data-dsh-collapse-sealed] > div[hidden]:has([data-process-activity]) { display: block !important; }',
].join('\n')

/** 样式标签选择器；多个作用域共用一条。 */
const STYLE_SELECTOR = `style[data-plugin-css="${STYLE_ID}"]`

/** 当前持有该规则的安装数；多个作用域共享同一个 style 标签。 */
let holders = 0

/** 本模块插入的标签；复用到的标签不记在这里，卸载时不动它。 */
let inserted: HTMLStyleElement | undefined

/**
 * 认领样式：第一个持有者插入标签，之后的持有者共用它。
 * @returns 释放本次认领的函数（重复调用无副作用）。
 */
function acquire(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (typeof document.createElement !== 'function' || typeof document.head?.append !== 'function') return () => {}
  if (holders === 0) {
    const existing = document.querySelector<HTMLStyleElement>(STYLE_SELECTOR)
    if (existing !== null) inserted = undefined
    else {
      const element = document.createElement('style')
      element.dataset.plugin = name
      element.dataset.pluginCss = STYLE_ID
      element.textContent = SEAL_CSS
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
    clearSeals(undefined)
  }
}

/**
 * 浏览器是否支持 `:has()`；不支持时封口会隐藏成员却显示不出组头，因此直接跳过。
 * 极简测试环境没有 `CSS` 全局，按支持处理。
 * @returns 是否可用。
 */
export function supportsSeal(): boolean {
  const css = (globalThis as { CSS?: { supports?: (condition: string) => boolean } }).CSS
  if (css === undefined || typeof css.supports !== 'function') return true
  try {
    return css.supports('selector(:has(*))')
  } catch {
    return false
  }
}

/** 组头的第一个子节点（承载 `[data-process-activity]` 的 div）。 */
function headerContainer(group: Element): Element | null {
  const children = group.children
  if (children === undefined || children === null) return null
  const first = children[0]
  if (first === undefined || first === null) return null
  if (typeof first.querySelector !== 'function') return null
  return first.querySelector(ACTIVITY_SELECTOR) === null ? null : first
}

/** 最近一个“带锁且展开”的轮次过程标题所属轮次。 */
function lockedTurn(root: ParentNode): string | null {
  if (typeof root.querySelectorAll !== 'function') return null
  const headers = [...root.querySelectorAll(TURN_HEADER_SELECTOR)]
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    const header = headers[index]
    if (!header.hasAttribute(LOCK_ATTRIBUTE)) continue
    if (header.getAttribute('aria-expanded') !== 'true') continue
    if (typeof header.closest !== 'function') continue
    const row = header.closest('[data-chat-turn]')
    const turn = row?.getAttribute('data-chat-turn') ?? null
    if (turn === null || turn === '') continue
    return turn
  }
  return null
}

/**
 * 本次要封口的组根：最新一个带锁轮次下、仍处于平铺态、尚未封口、且组头可用的组。
 * @param root - 主会话滚动口。
 * @returns 组根列表（没有锁 / 没有平铺组时为空）。
 */
export function sealableGroups(root: ParentNode): Element[] {
  if (!supportsSeal()) return []
  const turn = lockedTurn(root)
  if (turn === null) return []
  const groups: Element[] = []
  for (const group of root.querySelectorAll(GROUP_SELECTOR)) {
    if (!group.hasAttribute(FLAT_ATTRIBUTE)) continue
    if (group.hasAttribute(SEAL_ATTRIBUTE)) continue
    if (group.getAttribute('data-chat-turn') !== turn) continue
    if (headerContainer(group) === null) continue
    groups.push(group)
  }
  return groups
}

/**
 * 封口：写标记并移除组头容器的 `hidden`。
 *
 * 移除 `hidden` 是为了下一条消息到达时不再触发一次 reveal 动画：`useMotionHidden`
 * 只在 `hidden` 由真变假、且元素还带该属性时才跑高度动画。
 * @param groups - `sealableGroups` 的结果，或测试构造的组根。
 * @returns 实际封口的组数（幂等：已封口的组不重复计数）。
 */
export function sealGroups(groups: readonly Element[] | undefined): number {
  if (groups === undefined) return 0
  let sealed = 0
  for (const group of groups) {
    const header = headerContainer(group)
    if (header === null) continue
    if (!group.hasAttribute(SEAL_ATTRIBUTE)) {
      group.setAttribute(SEAL_ATTRIBUTE, '')
      sealed += 1
    }
    if (header.hasAttribute('hidden') && typeof header.removeAttribute === 'function') {
      header.removeAttribute('hidden')
    }
  }
  return sealed
}

/**
 * 撤掉封口：仍处于平铺态的组把组头 `hidden` 写回（恢复平铺形态），分组态的组只移除标记。
 * @param root - 作用域；省略时用 `document`。
 * @returns 清理的组数。
 */
export function clearSeals(root: ParentNode | undefined = typeof document === 'undefined' ? undefined : document): number {
  if (root === undefined || typeof root.querySelectorAll !== 'function') return 0
  let cleared = 0
  for (const group of root.querySelectorAll(`[${SEAL_ATTRIBUTE}]`)) {
    if (group.hasAttribute(FLAT_ATTRIBUTE)) {
      const header = headerContainer(group)
      if (header !== null && !header.hasAttribute('hidden') && typeof header.setAttribute === 'function') {
        header.setAttribute('hidden', '')
      }
    }
    group.removeAttribute(SEAL_ATTRIBUTE)
    cleared += 1
  }
  return cleared
}

/** 安装封口样式；卸载时连同仍生效的封口一起撤掉。 */
export function installCollapseSeal(ctx: Pick<Context, 'effect'>): void {
  ctx.effect(() => acquire(), `${name}: collapse seal style`)
}
