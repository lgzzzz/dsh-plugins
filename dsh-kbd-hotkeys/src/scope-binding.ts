/** 会话作用域绑定取数(供 slots.resolveStore 解析会话级 store 活实例)。
 * dsh 0.1.6-alpha.2 起上游删除了 uiSession.resolve(sessionId):绑定改由 uiSession.bindingSource(reference) 物化,
 * reference = { sessionId, binding: sessions.binding(sessionId) }(上游只校验 reference.binding 与 sessions.binding 同一)。
 * 任一层不可用即 undefined(调用方 no-op,不回退 DOM、不做旧 API 兼容)。 */
import type { ScopeBindingLike, Services } from './types.ts'

/** 取某会话已物化的作用域绑定(带字符串 key);服务面缺一即 undefined。 */
export function sessionScopeBinding(services: Services, sessionId: string): ScopeBindingLike | undefined {
  const uiSession = services.uiSession
  const sessions = services.sessions
  if (uiSession === null || uiSession === undefined) return undefined
  if (sessions === null || sessions === undefined) return undefined
  const bindingSource = uiSession.bindingSource
  if (typeof bindingSource !== 'function') return undefined
  const owner = sessions.binding?.(sessionId)
  if (owner === null || owner === undefined) return undefined

  let source: unknown
  try {
    source = bindingSource.call(uiSession, { sessionId, binding: owner })
  } catch {
    return undefined
  }
  const getSnapshot = (source as { getSnapshot?: unknown } | undefined)?.getSnapshot
  if (typeof getSnapshot !== 'function') return undefined
  let binding: unknown
  try {
    binding = (getSnapshot as () => unknown).call(source)
  } catch {
    return undefined
  }
  return asScopeBinding(binding)
}

/** 形状校验:必须是对象且带非空字符串 key(缺席投影的 key 为 undefined)。 */
function asScopeBinding(value: unknown): ScopeBindingLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const key = (value as { key?: unknown }).key
  return typeof key === 'string' && key !== '' ? (value as ScopeBindingLike) : undefined
}
