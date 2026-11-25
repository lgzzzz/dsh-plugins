/**
 * 给人读的出口 / 节点展示名。
 *
 * 节点一直存着两串字符：订阅写的原名（含 emoji 与中文），和由它折成的 ASCII 出口名（tag）。
 * 规则里的 `out`、内核配置的 outbound tag 都是**出口名**——它是稳定标识；而界面上要显示的是
 * 名字。两者可能不同批更新（宿主半部与浏览器半部各发一次），所以这里统一做兜底：标签缺席时
 * 退回名字，名字也缺席时退回出口名，面板不会因为字段缺席渲染成空白。
 */

/** 出口名 → 展示名；旧宿主不给 `exitLabels` 时是空表。 */
export type ExitLabels = Readonly<Record<string, string>>

/**
 * 出口的展示文本。
 *
 * 展示名与出口名相同（内置的 `proxy` / `direct` / `block`）时照原样显示，不额外加修饰。
 * @param exit - 出口名（规则的 `out` / `default` 取值）。
 * @param labels - 出口名 → 展示名；省略时原样显示出口名。
 * @returns 展示文本。
 */
export function exitLabel(exit: string, labels: ExitLabels = {}): string {
  const label = labels[exit]
  return label === undefined || label === '' || label === exit ? exit : label
}

/**
 * 节点的展示名：`label` → `name` → `tag` 依次退让。
 * @param node - 带可选 `label` 的节点摘要。
 * @returns 展示文本。
 */
export function nodeLabelOf(node: { label?: string; name?: string; tag: string }): string {
  const label = node.label
  if (label !== undefined && label !== '') return label
  const name = node.name
  return name === undefined || name === '' ? node.tag : name
}
