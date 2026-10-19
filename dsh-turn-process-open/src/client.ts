/**
 * 浏览器入口：装上轮次过程锁定器。
 *
 * 本插件的存在就是行为开关——从 profile 的 `dsh.profile.bundles` 里移除本包，
 * 下一轮“新消息到达 / 回答结束后”的自动折叠立即恢复。没有配置项、不注册槽位；
 * 副作用只有 per-session Chat store 的展开记录（内存态，刷新即清）、标题上的锁标记、
 * 一条样式与一个 document 级点击拦截，随插件卸载一并清理。
 *
 * 上游锚点与已知边界见 docs/dsh-turn-process-open.md。
 */
import { installPin } from './pin.ts'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-turn-process-open'

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const controller = installPin()
    return () => controller.dispose()
  }, `${name}: turn process lock`)
}
