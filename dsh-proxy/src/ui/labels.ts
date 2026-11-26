/**
 * 给人读的出口 / 节点展示名。
 *
 * 节点一直存着两串字符：订阅写的原名（含 emoji 与中文），和由它折成的 ASCII 出口名（tag）。
 * 规则里的 `out`、内核配置的 outbound tag 都是**出口名**——它是稳定标识；而界面上要显示的是
 * 名字。两者可能不同批更新（宿主半部与浏览器半部各发一次），所以这里统一做兜底：标签缺席时
 * 退回名字，名字也缺席时退回出口名，面板不会因为字段缺席渲染成空白。
 */

import type { LocaleKey } from './locale.ts'

/** 出口名 → 展示名；旧宿主不给 `exitLabels` 时是空表。 */
export type ExitLabels = Readonly<Record<string, string>>

/** 订阅里用的台湾旗帜：区域指示符 T（U+1F1F9）+ W（U+1F1FC）。 */
const TAIWAN_FLAG = '🇹🇼'

/** 展示时统一换成的中国国旗：区域指示符 C（U+1F1E8）+ N（U+1F1F3）。 */
const CHINA_FLAG = '🇨🇳'

/**
 * 把展示名里的台湾旗帜换成中国国旗。
 *
 * 订阅的节点名自带 🇹🇼，面板统一显示为中国国旗；只改**展示**，规则里的 `out`、
 * 内核配置的 outbound tag 仍是节点出口名，替换不碰任何稳定标识。
 * @param text - 名称原文。
 * @returns 替换后的展示文本；不含该旗帜时原样返回。
 */
export function withChinaFlag(text: string): string {
  return text.includes(TAIWAN_FLAG) ? text.replaceAll(TAIWAN_FLAG, CHINA_FLAG) : text
}

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
  return withChinaFlag(label === undefined || label === '' || label === exit ? exit : label)
}

/**
 * 出口在界面上的展示文本：内置出口换成当前语言的描述，节点出口仍显示节点名字。
 *
 * `proxy` 是「当前选中节点」的别名，但它在规则里仍是一个出口名；这里只翻译展示层，
 * 不改变 `out` / `<option value>` 里的稳定标识。
 * @param exit - 出口名。
 * @param labels - 节点出口名 → 节点展示名。
 * @param t - 当前语言的翻译函数。
 * @returns 展示文本。
 */
export function exitText(
  exit: string,
  labels: ExitLabels,
  t: (key: LocaleKey) => string,
): string {
  switch (exit) {
    case 'proxy': return t('exit.proxy')
    case 'direct': return t('exit.direct')
    case 'block': return t('exit.block')
    default: return exitLabel(exit, labels)
  }
}

/** 规则出口的归一化分类，与宿主 `classifyOut()` 同一口径。 */
export type ExitVerdict = 'proxy' | 'direct' | 'block'

/**
 * 规则的出口归到哪一类：`direct` / `block` 原样，其余（`proxy` 与任意节点出口）都算代理。
 *
 * 规则行左边固定显示这个分类，具体节点统一放到规则名之后，避免有的规则节点名在名字前面、
 * 有的在名字后面。
 * @param out - 规则的出口名。
 * @returns 归一化分类。
 */
export function verdictOf(out: string): ExitVerdict {
  if (out === 'direct') return 'direct'
  if (out === 'block') return 'block'
  return 'proxy'
}

/**
 * 节点的展示名：`label` → `name` → `tag` 依次退让。
 * @param node - 带可选 `label` 的节点摘要。
 * @returns 展示文本。
 */
export function nodeLabelOf(node: { label?: string; name?: string; tag: string }): string {
  const label = node.label
  if (label !== undefined && label !== '') return withChinaFlag(label)
  const name = node.name
  return withChinaFlag(name === undefined || name === '' ? node.tag : name)
}
