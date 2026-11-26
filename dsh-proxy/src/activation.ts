/**
 * 改写类工具的按需暴露。
 *
 * 五个只读工具常驻；另外四个（`check` / `explain` / `write` / `subscription`）只在
 * `proxy-routing` 技能成功加载之后才进入工具列表。这样做是因为这四项合计承担了
 * 全部 9 个工具 schema 里约 2.4k token 的大头，而它们的结论只有读完技能才解释得清：
 * `uncertain` / `opaque` / `missing` 的区别、`patch` 的语义、什么时候会回滚。
 *
 * 两个解锁来源，覆盖模型和用户两条入口：
 *   1. 模型调用 `skill` 且结果成功 —— 监听 `tools/result`；
 *   2. 用户以 `/proxy-routing …` 显式调用技能 —— 监听 `session/event` 里的 `user/message`。
 *
 * 恢复与分叉：新建的 Agent 没有内存标记，所以再读一次 `session.requestHeader().tools`。
 * native 模式下工具声明随 header 落进日志，resume / fork 之后仍然看得见；PTC 的 header
 * 只有 `run_code`，因此分叉或恢复后需要重新加载技能 —— 技能正文里写明了这一点。
 *
 * 标记按 Agent 存放，`agent/disposed` 时清掉。命中过一次 header 后也记进标记，
 * 于是每个 Agent 最多付一次 header 折叠的代价。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 仅类型：`ctx.on('tools/result')` 的签名、`ToolActivationContext`、以及 skill 调用消息的 source 类型。
import type { ToolActivationContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session'

/** 工具的暴露策略：`skill` 等技能加载，`always` 一直暴露全部工具。 */
export type ToolExposure = 'skill' | 'always'

/** 激活判定的输入。 */
export interface ToolActivationOptions {
  /** 策略；`always` 时本模块不注册任何监听，返回 `undefined`。 */
  readonly exposure: ToolExposure
  /** 成功加载后解锁工具的技能名。 */
  readonly skill: string
  /** 受技能加载控制的工具名。 */
  readonly tools: readonly string[]
}

/** 逐步激活条件，与 `ctx.tools.register()` 的 `when` 同签名。 */
export type ActivationCondition = (context: ToolActivationContext) => boolean

/** 从一次工具调用的参数里取出被加载的技能名；不是 `skill` 调用时返回 `undefined`。 */
function loadedSkillName(name: string, args: unknown): string | undefined {
  if (name !== 'skill') return undefined
  if (typeof args !== 'object' || args === null || !('name' in args)) return undefined
  const skill = (args as { name: unknown }).name
  return typeof skill === 'string' ? skill : undefined
}

/**
 * 建立这套激活状态。
 * @param ctx - 注册监听用的宿主 Context。
 * @param options - 策略、技能名与受控工具名。
 * @returns 交给 `ctx.tools.register()` 的 `when`；`always` 策略下为 `undefined`。
 */
export function createToolActivation(ctx: Context, options: ToolActivationOptions): ActivationCondition | undefined {
  if (options.exposure === 'always') return undefined

  const gated = new Set(options.tools)
  const unlocked = new WeakSet<Agent>()

  /** 已经标记过、或请求头里确实声明过受控工具（恢复 / 分叉）。 */
  function isUnlocked(agent: Agent): boolean {
    if (unlocked.has(agent)) return true
    const declared = agent.session.requestHeader()?.tools
    if (declared === undefined || !declared.some((tool) => gated.has(tool.name))) return false
    // 记进标记，后面的每一步都不用再折一次 header。
    unlocked.add(agent)
    return true
  }

  ctx.effect(() => {
    const offLoaded = ctx.on('tools/result', (exec, result) => {
      if (exec.agent === undefined || result.isError) return
      if (loadedSkillName(exec.name, exec.arguments) !== options.skill) return
      unlocked.add(exec.agent)
    })
    const offInvoked = ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message') return
      const source = event.data.source
      if (source.kind !== 'skill-invocation' || source.name !== options.skill) return
      // `agents` 是可选的：没挂 Agent 注册表时这条入口不生效，模型入口照常。
      const agent = ctx.get('agents')?.get(session.id)
      if (agent !== undefined && agent.session.id === session.id) unlocked.add(agent)
    })
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => { unlocked.delete(agent) })
    return () => {
      offLoaded()
      offInvoked()
      offDisposed()
    }
  }, 'dsh-proxy: tool activation')

  return ({ agent }) => isUnlocked(agent)
}
