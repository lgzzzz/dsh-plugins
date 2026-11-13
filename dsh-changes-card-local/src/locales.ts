/** 本插件的 Web 字典：只有右键菜单里的一条动作。 */

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-changes-card-local'

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  openSnapshot: '查看本轮快照 diff',
}

/** 本插件的 locale 键联合。 */
export type CardLocalKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  openSnapshot: 'View this turn’s snapshot diff',
} satisfies Record<CardLocalKey, string>

/** 翻译函数：键来自本插件字典。 */
export type Translate = (key: CardLocalKey) => string

/** locale 服务的最小面：注册字典与按命名空间绑定。 */
export interface LocaleLike {
  register(namespace: string, dictionaries: Record<string, unknown>): () => void
  bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
}

/**
 * 取一个翻译函数；locale 服务缺席（或命名空间还没注册）时退回英文字典。
 * @param locale - locale 服务，可缺席。
 * @returns 只接受本插件键的翻译函数。
 */
export function translateOf(locale: LocaleLike | undefined): Translate {
  let bound: ((key: string, params?: Record<string, string | number>) => string) | undefined
  if (locale !== undefined) {
    try {
      bound = locale.bind(NS)
    } catch {
      // 字典还没注册时退回到内置英文，菜单文案永远不会是空串。
      bound = undefined
    }
  }
  return (key) => {
    if (bound !== undefined) {
      try {
        return bound(key)
      } catch {
        // 绑定失效（插件卸载中）时同样退回内置英文。
      }
    }
    return en[key]
  }
}
