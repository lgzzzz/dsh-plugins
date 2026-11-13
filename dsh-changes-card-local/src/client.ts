/**
 * 浏览器入口：改动文件卡片的标题改为打开右栏「本地变更」并切成全屏，右键卡片用宿主菜单回到本轮快照。
 *
 * 本插件的存在就是行为开关 —— 从 profile 的 `dsh.profile.bundles` 里移除本包，下一次点击立即
 * 回到上游：标题打开本轮审查页，右键是浏览器原生菜单。没有配置项、不注册服务或槽位；副作用
 * 只有一条 `document` 捕获阶段的 click / contextmenu / keydown 监听、一条上下文菜单贡献
 * （第一次右键时注册）、一次 locale 字典注册，以及文档根上的生效标记，随插件卸载一并清理。
 *
 * 上游锚点与手工验证方式见 docs/dsh-changes-card-local.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import { installCardLocal } from './install.ts'

export { name } from './install.ts'

export function apply(ctx: Context): void {
  ctx.inject(['sidebarRight'], (scope) => {
    scope.effect(
      () => installCardLocal(scope),
      'dsh-changes-card-local: card title opens local changes',
    )
  })
}
