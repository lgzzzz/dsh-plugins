/**
 * 浏览器入口:装上改动文件卡片的悬停闸门。
 *
 * 本插件的存在就是开关 —— 从 profile 的 `dsh.profile.bundles` 里移除本包,浮层即恢复。
 * 没有配置项、不注册服务或 slot,也不读任何会话状态;副作用只有闸门本身(`document` 捕获阶段
 * 监听、`body` 上的网兜观察者、文档根上的生效标记),随插件卸载一并移除。
 *
 * 上游锚点、已知边界与验证方式见 docs/dsh-changes-hover-off.md。
 */
import { installHoverGate } from './hover-gate.ts'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-changes-hover-off'

export function apply(ctx: Context): void {
  ctx.effect(() => installHoverGate(), `${name}: changed-files hover gate`)
}
