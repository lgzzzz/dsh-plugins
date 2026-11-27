/**
 * 浏览器入口：改动面板的统一行为插件。
 *
 * 装上后：
 *   - 改动卡片标题打开「本地变更」并切成全屏；右键不接管，保留浏览器原生菜单；
 *   - 点会话面板那行「本地变更」同样打开本地变更页并切成全屏（与卡片标题同一策略）；
 *   - 其余任何打开右栏的入口（文件行、过程链接、上下文菜单等）都先切回非全屏；
 *   - 改动审查标签页按面板呈现方式默认分栏、默认自动换行；
 *   - 改动卡片的 500ms 悬停浮层关闭；
 *   - 「本地变更」「变更请求」与改动审查整棵子树字号统一 14px；
 *   - 「本地变更」「变更请求」左侧文件列表的宽度固定为上游默认值：隐藏那条既是拖动入口
 *     也是键盘入口的分隔条，宽度不再可调（不再读写 localStorage 记忆宽度）；
 *   - 「本地变更」行内评论框：Enter 与「添加到输入框」等价、Shift+Enter 换行、Esc 取消。
 *
 * 不注册快捷键：原先的 `⌘⌥Y` / `Ctrl+Alt+Y`（打开变更请求，没有绑定时打开本地变更）已移除；
 * 「本地变更」仍可从改动卡片标题、会话面板那行或右栏自己的入口打开。
 *
 * 本插件的存在就是行为开关：从 profile 的 `dsh.profile.bundles` 里移除本包，全部行为立即
 * 回到上游默认。没有配置项、不注册服务或槽位；副作用只有若干 `document` 监听 / 观察器、
 * 两条 `<style>`、右栏打开入口的包层，以及文档根上的生效标记，随插件卸载一并清理。
 *
 * 上游锚点与手工验证方式见 docs/dsh-changes-behavior.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import { installChangesBehavior, name } from './install.ts'

export { name }

export function apply(ctx: Context): void {
  ctx.inject(['sidebarRight'], (scope) => {
    scope.effect(
      () => installChangesBehavior(scope),
      `${name}: changes panel behavior`,
    )
  })
}
