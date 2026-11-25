/**
 * 面板的语言上下文：把 Client locale 服务的「按命名空间绑定 + 快照订阅」包成 React 面，
 * 让插槽里任意深度的组件都能取到 `t`，并在切换语言 / 补注册字典时立即重渲染。
 */

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// 仅类型：把 `ctx.locale` 的服务契约合并进 Context。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { LocaleKey } from './locale.ts'

/** 组件树消费的翻译面：`t` 自身读取当前语言，订阅对用于触发重渲染。 */
export interface LocaleFace {
  /** 解析一个词条键，缺键时回落到英文表 / 键本身。 */
  readonly translate: (key: LocaleKey) => string
  /** 语言或字典变化时通知回调；返回退订函数。 */
  readonly subscribe: (onChange: () => void) => () => void
  /** 当前不可变语言快照（同一语言下引用稳定，可交给 `useSyncExternalStore`）。 */
  readonly getSnapshot: () => LocaleSnapshot
}

/**
 * 为一个命名空间建立稳定的翻译面。
 * @param ctx - 客户端 Context，携带 `locale` 服务。
 * @param ns - 已注册的字典命名空间。
 * @returns 可放进 `LocaleProvider` 的翻译面；引用在插件生命周期内稳定。
 */
export function createLocaleFace(ctx: Context, ns: string): LocaleFace {
  const bound = ctx.locale.bind(ns)
  return {
    translate: (key) => bound(key),
    subscribe: (onChange) => ctx.locale.subscribe(onChange),
    getSnapshot: () => ctx.locale.getSnapshot(),
  }
}

const LocaleContext = createContext<LocaleFace | null>(null)

/**
 * 把翻译面注入组件树。
 * @param props.face - {@link createLocaleFace} 的产物。
 * @param props.children - 需要语言信息的子树。
 * @returns provider 元素。
 */
export function LocaleProvider({ face, children }: { face: LocaleFace; children: ReactNode }) {
  return <LocaleContext.Provider value={face}>{children}</LocaleContext.Provider>
}

/**
 * 读取翻译函数，并订阅语言变化。
 * @returns 当前语言的 `t`。
 * @throws 组件不在 {@link LocaleProvider} 之内时抛出，避免静默渲染出原始键。
 */
export function useTranslate(): (key: LocaleKey) => string {
  const face = useContext(LocaleContext)
  if (face === null) throw new Error('dsh-proxy: <LocaleProvider> is missing above the panel')
  // 第三个参数是服务端快照：面板本身只在浏览器渲染，但它让组件在 SSR 冒烟测试里也能跑。
  useSyncExternalStore(face.subscribe, face.getSnapshot, face.getSnapshot)
  return face.translate
}
