/** 本插件的 Web 字典：只有右键菜单里的一条动作。 */
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
// 空导入：加载 `LocaleNamespaceMap` 这个跨包合并点（本插件在下面合并自己的命名空间）。
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-changes-card-local'

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  openSnapshot: '查看本轮快照 diff',
}

/** 本插件的 locale 键联合。 */
export type CardLocalKey = keyof typeof zh

/**
 * 把本插件的命名空间并入上游的 locale 合并表。
 *
 * 上游 `LocaleNamespaceMap` 是留给各包合并的开放点：声明之后，`LocaleRuntime.register`
 * 会按本插件的中文键集合校验字典，`bind(NS)` 返回的翻译函数也只接受这些键。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 右键菜单里「查看本轮快照 diff」这一条动作的文案。 */
    'dsh-changes-card-local': CardLocalKey
  }
}

/** 英文字典，按中文键集合校验。 */
export const en = {
  openSnapshot: 'View this turn’s snapshot diff',
} satisfies Record<CardLocalKey, string>

/** 翻译函数：键来自本插件字典。 */
export type Translate = (key: CardLocalKey) => string

/**
 * 取一个翻译函数；locale 服务缺席（或命名空间还没注册）时退回英文字典。
 * @param locale - 上游 locale 服务，可缺席。
 * @returns 只接受本插件键的翻译函数。
 */
export function translateOf(locale: LocaleRuntime | undefined): Translate {
  if (locale === undefined) return (key) => en[key]
  try {
    const bound = locale.bind(NS)
    return (key) => {
      try {
        return bound(key)
      } catch {
        // 绑定失效（插件卸载中）时同样退回内置英文。
      }
      return en[key]
    }
  } catch {
    // 字典还没注册时退回到内置英文，菜单文案永远不会是空串。
    return (key) => en[key]
  }
}
