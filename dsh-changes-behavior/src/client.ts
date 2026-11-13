/**
 * 浏览器入口：改动面板的统一行为插件。
 *
 * 装上后：
 *   - 改动卡片标题打开「本地变更」并切成全屏；右键不接管，保留浏览器原生菜单；
 *   - `⌘⌥Y`（由 `dsh-keyboard-shortcuts` 投递）打开「变更请求」后切成全屏；
 *   - 其余任何打开右栏的入口（文件行、过程链接、上下文菜单等）都先切回非全屏；
 *   - 改动审查标签页按面板呈现方式默认分栏、默认自动换行；
 *   - 改动卡片的 500ms 悬停浮层关闭；
 *   - 「本地变更」「变更请求」与改动审查整棵子树字号统一 14px；
 *   - 记住「本地变更」「变更请求」文件树的宽度：拖动 / 键盘调整后写入 localStorage，
 *     新挂载的文件树恢复上次的宽度。
 *
 * 本插件的存在就是行为开关：从 profile 的 `dsh.profile.bundles` 里移除本包，全部行为立即
 * 回到上游默认。没有配置项、不注册服务或槽位；副作用只有若干 `document` 监听 / 观察器、
 * 一条 `<style>`、右栏打开入口的包层，以及文档根上的生效标记，随插件卸载一并清理。
 *
 * 上游锚点与手工验证方式见 docs/dsh-changes-behavior.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import { installChangesOpenBridge } from './changes-open.ts'
import { installChangesBehavior, name } from './install.ts'

export { name }

export function apply(ctx: Context): void {
  ctx.inject(['sidebarRight'], (scope) => {
    scope.effect(
      () => installChangesBehavior(scope),
      `${name}: changes panel behavior`,
    )
  })
  // `⌘⌥Y` 打开「变更请求」与卡片标题打开「本地变更」同属 changes 打开行为，放在同一插件里
  // 共用「本次打开要全屏」的意图。服务缺席时桥自己让位，不影响其余行为。
  installChangesOpenBridge(ctx)
}
