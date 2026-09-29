import { CSS } from './css.ts'

export const name = 'dsh-ui-css-patches'

interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
}

function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
