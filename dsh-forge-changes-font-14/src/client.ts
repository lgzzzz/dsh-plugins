/**
 * 浏览器入口:把 `css.ts` 的全部规则挂成一条 `<style>`,并在插件卸载时连同文档根上的生效标记一起移除。
 *
 * 本插件的存在就是开关 —— 从 profile 的 `dsh.profile.bundles` 里移除本包,字号即回到上游默认。
 * 没有配置项、不注册服务或 slot,也不读任何会话状态;副作用只有样式表本身与一个 `data-*` 标记。
 *
 * `ctx` 是可选的:调用方可能不传;传入的运行时上下文没有 `effect` 时,样式与标记不随卸载移除。
 *
 * 上游锚点、覆盖边界与手工验证方式见 docs/dsh-forge-changes-font-14.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import { CSS } from './css.ts'

export const name = 'dsh-forge-changes-font-14'

/** 文档根元素上的生效标记:装上样式表时写入,卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-forge-changes-font-14'

export function apply(ctx?: Context): void {
  installStyles(ctx)
}

function installStyles(ctx?: Context): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = CSS
  document.head.appendChild(tag)
  document.documentElement.setAttribute(MARKER_ATTRIBUTE, '')
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => {
      tag.remove()
      document.documentElement.removeAttribute(MARKER_ATTRIBUTE)
    })
  }
}
