/**
 * 「本地变更」「变更请求」与改动审查标签页统一 14px。
 *
 * 这三块界面来自两个上游包，字号声明在各自的 CSS Module 哈希类名上：forge 的 changes 根
 * 12px、panel 根 13px，审查页 11/12/13px 混排。上游没有字号配置，模块样式表与本插件注入的
 * `<style>` 谁先生效也不由本插件掌握，所以规则带 `!important`，并且按「根 + 全部后代」
 * 分别命中 —— `*` 不会命中根自身。
 *
 * 作用域是两个 `data-*` 锚点：
 *   - `[data-forge-changes]`：`@deepseek-ai/dsh-experimental-client-ui-forge` 的变更视图根，
 *     取值是 `local`（本地变更）或 `change`（某个变更请求的 diff）；
 *   - `[data-forge-panel]`：同一个包的「变更请求」面板根。
 *
 * 不覆盖改动审查（`[data-changes-review]`）与其它右栏标签页。
 *
 * 只覆盖 `font-size`：字体族（代码仍用 `--ds-font-family-code`）、行高（diff 行 22px 与
 * 占位行的 `--forge-rows * 22px` 必须一致）、颜色、行号列宽度与布局都不动。
 *
 * 不覆盖：右栏标签条上的标题 chip、portal 到 `document.body` 的浮层菜单，以及其它右栏标签页。
 */
export const CSS = `
[data-forge-changes],
[data-forge-panel] {
  font-size: 14px !important;
}

[data-forge-changes] *,
[data-forge-panel] * {
  font-size: 14px !important;
}
`

/** 文档根元素上的生效标记：装上样式表时写入，卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-behavior-font-14'

/** 本插件注入的 `<style>` 上的标记，便于在 Elements 面板里认出它。 */
export const STYLE_ATTRIBUTE = 'data-dsh-changes-behavior-font-14'

/** 样式元素的最小形状（生产环境是 `HTMLStyleElement`，测试接缝）。 */
export interface StyleTagLike {
  readonly dataset?: Record<string, string>
  textContent: string
  remove?(): void
}

/** 打标记的最小根元素形状。 */
export interface MarkedRootLike {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** 字体安装需要的文档能力（生产环境是 `Document`，测试接缝）。 */
export interface FontDocumentLike {
  readonly head?: { appendChild(node: StyleTagLike): void; removeChild?(node: StyleTagLike): void } | null
  readonly documentElement?: MarkedRootLike | null
  createElement?(tag: string): StyleTagLike
}

/**
 * 装上 14px 样式表并写入生效标记。
 * @param doc - 目标文档；没有 `head` / `createElement` 时只写标记，不抛错。
 * @returns 卸载函数：移除样式与标记。
 */
export function installFont14(
  doc: FontDocumentLike | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as FontDocumentLike,
): () => void {
  if (doc === undefined) return () => {}
  let tag: StyleTagLike | undefined
  try {
    if (doc.head !== undefined && doc.head !== null && typeof doc.createElement === 'function') {
      tag = doc.createElement('style')
      if (tag.dataset !== undefined) tag.dataset.plugin = 'dsh-changes-behavior'
      tag.textContent = CSS
      doc.head.appendChild(tag)
    }
  } catch {
    // 非浏览器 / 受限文档：只留标记，不阻止插件其余部分安装。
    tag = undefined
  }
  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')
  return () => {
    try {
      if (tag?.remove !== undefined) tag.remove()
      else if (tag !== undefined) doc.head?.removeChild?.(tag)
    } catch {
      // 样式已被页面卸载带走：忽略。
    }
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}
