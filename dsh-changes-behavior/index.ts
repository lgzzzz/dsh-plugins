/**
 * 宿主半部：启动期给上游改动卡片产物打补丁，让单文件也按汇总形制渲染
 * （补丁逻辑与边界见 src/host/single-card.ts 与 docs/dsh-changes-behavior.md）。
 * 其它行为全在浏览器半部（src/client.ts）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { installSingleCardPatch, type ClientModulesFace } from './src/host/single-card.ts'

/** 插件 id：patch 行、诊断前缀与客户端 bundle 名都用它。 */
export const name = 'dsh-changes-behavior'

/**
 * 宿主依赖：`clientModules` 登记好客户端产物之后才应用本插件。
 *
 * 用静态 inject 而不是 `ctx.inject(...)`：服务刚注册时产物表可能还是空的，
 * 静态依赖让 cordis 等到服务真正可用再调用 `apply`。
 */
export const inject = ['clientModules']

/**
 * 启动期安装单文件卡片补丁。
 *
 * 诊断走 `console.error`（stderr）：`dsh web` 的日志里能看到插件用 console 打的
 * 行，而 `ctx.logger` 在当前发行版的 web 启动下不一定落到同一份日志。
 * 产物登记有延迟时由 `installSingleCardPatch` 轮询等待。
 * @param ctx - 宿主 Context，携带 `clientModules`。
 */
export function apply(ctx: Context): void {
  const modules = ctx.get('clientModules') as ClientModulesFace | undefined
  if (modules === undefined) {
    console.error('[dsh-changes-single-card] clientModules 缺席，跳过单文件卡片补丁')
    return
  }
  ctx.effect(() => installSingleCardPatch(modules, {
    info: message => { console.error(message) },
    warn: message => { console.error(message) },
  }, { retryMs: 100, timeoutMs: 15_000 }))
}
