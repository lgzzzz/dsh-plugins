/**
 * 浏览器入口：改动文件卡片点击后，把打开（或聚焦）的审查标签页默认切成右栏全屏。
 *
 * 本插件的存在就是行为开关 —— 从 profile 的 `dsh.profile.bundles` 里移除本包，下一批卡片点击
 * 立即恢复上游的推挤呈现。没有配置项、不注册服务或槽位；副作用只有一条 `document` 捕获阶段的
 * click 监听、一次微任务里对 `sidebarRight.toggleFullscreen()` 的调用，以及文档根上的生效标记，
 * 随插件卸载一并清理。
 *
 * 上游锚点与手工验证方式见 docs/dsh-changes-review-fullscreen.md。
 */
import { installChangesReviewFullscreen } from './fullscreen.ts'
import type { Context } from '@deepseek-ai/cordis'
// 空导入：让 TS 加载右栏包对 `@deepseek-ai/cordis` 的模块增强，`ctx.sidebarRight` 由它声明。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

export { name } from './fullscreen.ts'

export function apply(ctx: Context): void {
  ctx.inject(['sidebarRight'], (scope) => {
    scope.effect(
      () => installChangesReviewFullscreen(scope.sidebarRight),
      'dsh-changes-review-fullscreen: review fullscreen on open',
    )
  })
}
