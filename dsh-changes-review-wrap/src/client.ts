/**
 * 浏览器入口：给右栏的改动审查标签页装上“默认自动换行”。
 *
 * 本插件的存在就是行为开关 —— 从 profile 的 `dsh.profile.bundles` 里移除本包，下一批打开 /
 * 恢复的审查标签页立即回到上游的默认（不换行）。没有配置项、不注册服务或槽位；副作用只有
 * 每个审查标签页第一次挂载时的一次 store 写入、根元素上的 `data-dsh-review-wrap` 标记、
 * 文档根上的安装标记与一个 `MutationObserver`，随插件卸载一并清理。
 *
 * 上游锚点与手工验证方式见 docs/dsh-changes-review-wrap.md。
 */
import { installReviewWrapDefault } from './wrap-default.ts'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-changes-review-wrap'

export function apply(ctx: Context): void {
  ctx.effect(() => installReviewWrapDefault(), `${name}: review wrap default`)
}
