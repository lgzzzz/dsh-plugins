/**
 * 浏览器半部：把「团队协作」开关挂到新会话行（hero）的「新建工作树」右侧。
 *
 * 装配顺序即依赖顺序：
 *   - 内核 `slots` / `locale` 启动即有，由 `inject` 声明；
 *   - `remote.agentTeams` 可能比本插件晚到位，经 `ctx.inject(['remote', 'remote.agentTeams'])`
 *     等链路，链路撤下时随子 fiber 自动撤回注册项。
 *
 * 本插件不遮蔽上游在模型菜单里的 `conversation.input.model.options#agent-team`
 * （方案 A2）：hero 行是首轮前入口，会话中改设置仍走模型菜单。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载各包对 cordis `Context` 的服务声明
// (`slots` / `locale` / `remote`)、agentTeams Remote 命名空间,以及 ui-conversation
// 对 hero 槽键的 `SlotMap` 声明;全部是类型层,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-agent-team/remote'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TeamModeHeroToggle } from './component.ts'
import { NS, en, zh } from './locales.ts'
import { HERO_OPTIONS_SLOT, heroRegisterOptions } from './registration.ts'
import { ensureStyles } from './styles.ts'

export const name = 'dsh-agent-team-hero-toggle'

/** 内核服务：槽位注册与字典注册。 */
export const inject = ['slots', 'locale']

/** 本插件读取的 cordis 服务名。 */
type ServiceKey = 'slots' | 'locale' | 'remote'

/**
 * 读一个可选服务；服务缺席或尚未挂载时返回 undefined。
 *
 * 服务类型直接取上游 `Context` 上的声明，不再本地复写 `slots` / `locale` / `remote`
 * 的形状。
 *
 * @param ctx - 当前 fiber 的 Context。
 * @param key - 服务名。
 * @returns 服务实例或 undefined。
 */
function serviceOf<K extends ServiceKey>(ctx: Context, key: K): Context[K] | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get(key)
  return value === undefined || value === null ? undefined : value as Context[K]
}

/**
 * 注册字典、样式与 hero 开关。
 *
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  const slots = serviceOf(ctx, 'slots')
  if (slots === undefined) return
  const locale = serviceOf(ctx, 'locale')
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), `${name}: dictionaries`)
  }
  if (typeof document !== 'undefined') ensureStyles(document)

  ctx.inject(['remote', 'remote.agentTeams'], (scope) => {
    const remote = serviceOf(scope, 'remote')
    if (remote === undefined) return
    const slotService = serviceOf(scope, 'slots') ?? slots
    slotService.inject(HERO_OPTIONS_SLOT, () => slotService.register(
      heroRegisterOptions(NS, (sessionId: SessionId) => ({
        setEnabled: (enabled: boolean) => remote.agentTeams.setEnabled(sessionId, enabled),
      })),
      TeamModeHeroToggle,
    ))
  })
}
