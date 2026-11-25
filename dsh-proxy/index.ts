/**
 * 宿主半部：注册工具、`/proxy-api`、技能与存储域，并管理 xray 内核进程。
 * 浏览器半部在 `src/client.tsx`（组件在 `src/ui/`），由 tsdown 打包成 `lib/client.js`。
 *
 * 插件不 import 任何其它 Harness 包的**值**：类型从 `@deepseek-ai/dsh-*` 借用，
 * 运行时只碰 Node 内置模块与两个纯工具函数包（存储域声明、工具定义）。
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：把 `ctx.tools` / `ctx.webServer` / `ctx.skills` / `ctx.subprocess` / `ctx.storageDomain`
// / `ctx.agents` 的服务契约合并进 `Context`（真正的导入都在各自模块里）。
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-agent'
import { createToolActivation } from './src/activation.ts'
import { resolveConfig } from './src/config.ts'
import { registerApi } from './src/http.ts'
import { RingLog } from './src/log.ts'
import { ProxyService } from './src/service.ts'
import { routingSkill } from './src/skill.ts'
import { ProxyStore } from './src/store.ts'
import { registerTools, SKILL_GATED_TOOLS } from './src/tools.ts'

/** 插件 id：patch 行、客户端 bundle 名、诊断前缀都用它。 */
export const name = 'dsh-proxy'

/**
 * 宿主依赖：缺任何一个都不注册，而不是半死不活地加载。
 * `agents` 不在其中：它只用于「用户 `/proxy-routing` 显式调用」这条解锁入口，
 * 缺席时模型侧入口照常工作。
 */
export const inject = ['tools', 'webServer', 'skills', 'subprocess', 'storageDomain']

/**
 * 装配整份插件。
 * @param ctx - 宿主 Context，携带上面五个服务。
 * @param config - `cordis.patch.yml` 里这一行的 config，字段见 `src/config.ts`。
 */
export async function apply(ctx: Context, config: unknown): Promise<void> {
  const resolved = resolveConfig(config)
  const log = new RingLog()

  const store = await ProxyStore.open(ctx)
  const service = new ProxyService(ctx, resolved, store, log)

  // 技能先注册：`proxy-routing` 是改写类工具的解锁条件。
  ctx.effect(() => ctx.skills.register(routingSkill), 'dsh-proxy: routing skill')
  const activation = createToolActivation(ctx, {
    exposure: resolved.toolExposure,
    skill: routingSkill.name,
    tools: SKILL_GATED_TOOLS,
  })
  ctx.effect(() => registerTools(ctx, service, activation), 'dsh-proxy: tools')
  ctx.effect(() => registerApi(ctx, service, log), 'dsh-proxy: proxy-api')
  // 卸载时先停内核，再关存储域；顺序不能反 —— 停内核会读当前配置。
  ctx.effect(
    () => () => service.shutdown(),
    'dsh-proxy: kernel and store',
  )

  log.push('action', `插件已加载，运行时目录 ${resolved.dataDir}`)
  void service.startupReport().then((report) => {
    log.push('action', report)
    if (report.includes('没有找到') || report.includes('无法执行')) console.error(`[dsh-proxy] ${report}`)
  })
}
