/**
 * 给会话面板的分区元素打标记：接上那张只在该分区里生效的样式表，用来隐藏 forge 的连接行。
 *
 * 行元素自己被 React 管理，删掉它会影响上游的渲染；所以标记打在最近的分区 `<section>` 上，
 * 由 CSS 决定里面的哪一行不显示——上游随后怎么重渲染那一行都不用管。
 *
 * 类型只声明真正读写的成员，让行为可以在 Node 里用替身直接跑（与仓库内其它捕获层同一手法）。
 */

/** 本插件写在分区元素上的标记属性；样式表按它限范围。 */
export const MARKER_ATTRIBUTE = 'data-dsh-subagent-forge-panel'

/** 分区的锚点：会话面板给每个分区的 `<section>` 打的属性。 */
export const SECTION_SELECTOR = '[data-session-panel-section]'

/** 可 `closest`、可读写属性的最小元素形状。 */
export interface ElementLike {
  closest?(selector: string): ElementLike | null
  setAttribute?(name: string, value: string): void
  removeAttribute?(name: string): void
}

/**
 * 给行元素所在的分区打标记。
 *
 * @param row - 本插件那一行的元素；尚未挂载、或不在会话面板里时传 null。
 * @returns 卸下标记的函数；重复调用只生效一次。
 */
export function markSectionOfRow(row: ElementLike | null | undefined): () => void {
  const section = row?.closest?.(SECTION_SELECTOR) ?? null
  if (section === null || typeof section.setAttribute !== 'function') return () => {}
  section.setAttribute(MARKER_ATTRIBUTE, '')
  let marked = true
  return () => {
    if (!marked) return
    marked = false
    section.removeAttribute?.(MARKER_ATTRIBUTE)
  }
}
