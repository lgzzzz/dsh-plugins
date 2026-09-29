import type { Context } from '@deepseek-ai/cordis'
import base from '../styles/base.css?inline'
import cornerShape from '../styles/corner-shape.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import focus from '../styles/focus.css?inline'
import onboarding from '../styles/onboarding.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import shiki from '../styles/shiki.css?inline'

/* fork：样式标签与去重键一律用本 fork 的插件 id，避免与仍安装着的上游
   dsh-client-ui-theme 产生同键样式表（`data-plugin-css` 去重按 id 判定）。 */
const PLUGIN_ID = 'ui-theme-lgz'

const STYLES = [
  ['base.css', base],
  ['corner-shape.css', cornerShape],
  ['design-platform.css', designPlatform],
  ['focus.css', focus],
  ['onboarding.css', onboarding],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['shiki.css', shiki],
] as const

/**
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, `ui-theme: ${name} stylesheet`)
  }
}
