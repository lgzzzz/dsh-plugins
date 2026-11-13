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
 * 等 `clientModules` 就绪后安装补丁。
 *
 * 没有 web 产物的运行（例如纯 CLI）里该服务缺席或 `clientPath` 为空，
 * `installSingleCardPatch` 只记一条告警并返回空操作，不会影响启动。
 * @param ctx - 宿主 Context。
 * @returns 插件函数：`ctx.inject` 的 fiber 负责在卸载时恢复上游产物。
 */
export function apply(ctx: Context): void {
  ctx.inject(['clientModules'], (scope) => {
    const modules = scope.get('clientModules') as ClientModulesFace | undefined
    if (modules === undefined) return
    return installSingleCardPatch(modules, {
      info: message => ctx.logger.info(message),
      warn: message => ctx.logger.warn(message),
    })
  })
}
