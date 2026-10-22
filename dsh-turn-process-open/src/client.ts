/**
 * 浏览器入口：轮次过程锁定器 + `⌘⌥.` 折叠桥。
 *
 * 本插件的存在就是行为开关——从 profile 的 `dsh.profile.bundles` 里移除本包，
 * 下一轮“新消息到达 / 回答结束后”的自动折叠立即恢复。没有配置项、不注册槽位；
 * 锁定器的副作用只有 per-session Chat store 的展开记录（内存态，刷新即清）、标题上的
 * 锁标记、一条样式与一个 document 级点击拦截，随插件卸载一并清理。
 *
 * 折叠桥在本插件自己的命名空间下注册固定行 `dsh-turn-process-open.collapse-steps`：
 * 一次收所有展开的轮次过程（带锁的除外）与过程组标题，没有外层时再收单步详情，
 * 把最新一轮的平铺明细封口成历史轮次的组头形态，并按阅读线补偿滚动位置。
 *
 * 上游锚点与已知边界见 docs/dsh-turn-process-open.md。
 */
import { installCollapseSeal } from './collapse-seal.ts'
import { installCollapseStepsBridge } from './collapse-steps.ts'
import { installPin } from './pin.ts'
import { name } from './runtime.ts'
import type { Context } from '@deepseek-ai/cordis'

export { name }

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const controller = installPin()
    return () => controller.dispose()
  }, `${name}: turn process lock`)
  installCollapseSeal(ctx)
  installCollapseStepsBridge(ctx)
}
