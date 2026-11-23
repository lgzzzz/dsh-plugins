/**
 * 本插件的 Web 字典：分区标题、上级角色标签与每一行的读屏名称。
 *
 * 角色标签只在上级链不止一级时出现：链首是最顶层的主智能体（分区标题已经说明），
 * 其余每一级都是「上级智能体」。这样一级子智能体的常见场景只有一行标题，
 * 多级时也能一眼分出顶层与中间层。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-subagent-parent-nav'

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  'section.title': '主智能体',
  'row.parent': '上级智能体',
  'row.jump': '跳转到 {title}',
  'row.jumpRunning': '跳转到 {title}（正在运行）',
}

/** 本插件的 locale 键联合。 */
export type SubagentParentKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  'section.title': 'Main agent',
  'row.parent': 'Ancestor agent',
  'row.jump': 'Open {title}',
  'row.jumpRunning': 'Open {title} (running)',
} satisfies Record<SubagentParentKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 「主智能体」一栏的文案命名空间；注册项的 `locale:` 与 `t` 座位都按它取键。 */
    'dsh-subagent-parent-nav': SubagentParentKey
  }
}
