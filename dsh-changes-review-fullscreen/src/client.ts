/**
 * 浏览器入口：右栏的改动审查标签页按面板呈现方式选择默认的 diff 布局。
 *
 * 非全屏（`push`）= 单栏，全屏（`fullscreen`）= 左右对比；打开标签页时不再把它切成全屏。
 * 本插件的存在就是行为开关 —— 从 profile 的 `dsh.profile.bundles` 里移除本包，下一批打开 /
 * 恢复的审查标签页立即回到上游的默认（首次 seed 为左右对比，不随后续呈现方式变化）。
 *
 * 没有配置项、不注册服务或槽位；副作用只有每个审查标签页首次挂载 / 面板呈现方式变化时的
 * 一次 store 写入、根元素上的 `data-dsh-review-split` 标记、文档根上的安装标记与一个
 * `MutationObserver`，随插件卸载一并清理。
 *
 * 上游锚点与手工验证方式见 docs/dsh-changes-review-fullscreen.md。
 */
import { installReviewSplitDefault } from './split-default.ts'
import type { Context } from '@deepseek-ai/cordis'

export { name } from './split-default.ts'

export function apply(ctx: Context): void {
  ctx.effect(
    () => installReviewSplitDefault(),
    'dsh-changes-review-fullscreen: review split follows panel mode',
  )
}
