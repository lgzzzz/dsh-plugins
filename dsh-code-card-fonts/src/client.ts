/**
 * dsh-code-card-fonts — 浏览器半部入口(TypeScript 真源;由
 * scripts/build-client.mjs 用 esbuild 打包为 lib/client.js)。
 *
 * 功能:apply 时 1) 注入 <style data-plugin="dsh-code-card-fonts">,装载
 * src/css.ts 的卡片字号/间距补丁,并把内容字号轴 --dsh-content-font-size 钉死
 * 在 14px;2) 把 ui-theme 的「字号大小」设置也归一到 14px(设置行点击失效、
 * 持久化值写回 14),使设置项与实际渲染一致。
 *
 * 注意事项:样式标签带 data-plugin,卸载时模块加载器(HMR 驱动)会回收;这里
 * 再用 ctx.effect 注册 disposer 兜底。样式补丁必须无条件生效,故**不声明**
 * inject(不因 theme 服务缺席而整体不 apply);theme 未就绪时用 ctx.inject 按需
 * 等待。
 */
import { CSS } from './css.ts'

export const name = 'dsh-code-card-fonts'

/** 内容字号恒定值:与 src/css.ts 的 body 规则及各卡片 14px 保持一致。 */
const PINNED_FONT_SIZE = 14

/** theme 服务的最小面(ui-theme 提供;只用公开读写接口,不碰内部实现)。 */
interface ThemeService {
  getTheme(): { fontSize: number }
  setFontSize(px: number): void
}

/** apply(ctx) 的运行时上下文最小面:仅用 effect 注册清理、按需等待服务。 */
interface ClientContext {
  effect?(callback: () => void | (() => void)): void
  get?(name: string): unknown
  inject?(deps: string[], callback: (scope: ClientContext) => void): void
  on?(event: string, listener: () => void): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
  installFontSizePin(ctx)
}

/** 注入卡片字号补丁样式表(与 theme 服务无关,必须无条件生效)。 */
function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-code-card-fonts'
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}

/**
 * 把「字号大小」设置钉死在 14px。
 *
 * 渲染层由 src/css.ts 的 `body{--dsh-content-font-size:14px !important}` 保证
 * (布局服务把该变量写在 body 内联样式上,普通声明压不过内联样式);本函数负责
 * 设置行本身:归一架上的持久化值,并让 +/- 点击成为空操作。
 */
function installFontSizePin(ctx?: ClientContext): void {
  if (ctx === undefined || typeof ctx.get !== 'function') return
  const lock = (scope: ClientContext): void => {
    const theme = scope.get?.('theme')
    if (isThemeService(theme)) lockFontSize(scope, theme)
  }
  if (ctx.get('theme') !== undefined) {
    lock(ctx)
    return
  }
  // theme 尚未就绪(组成顺序不定):按需等待,不阻塞上面的样式注入。
  if (typeof ctx.inject === 'function') ctx.inject(['theme'], lock)
}

/**
 * 归一设置值并拦截写入。
 * @param ctx - 用于注册事件监听与卸载清理的上下文。
 * @param theme - ui-theme 提供的 theme 服务实例。
 */
function lockFontSize(ctx: ClientContext, theme: ThemeService): void {
  const original = theme.setFontSize
  const write = (px: number): void => {
    original.call(theme, px)
  }

  // 1) 归一架上的持久化设置:此前若为 12/13/15/16/17,写回 14(仅此一次)。
  normalize(theme, write)

  // 2) 拦截设置行的 +/-:行内闭包调用的是实例方法,改写实例属性即可让点击成为
  //    空操作(值已是 14 时 setFontSize 自身提前返回,不产生写入与重渲染)。
  let patched = false
  try {
    theme.setFontSize = () => {
      write(PINNED_FONT_SIZE)
    }
    patched = true
  } catch {
    // 服务实例被冻结时退化为下面的 theme/change 兜底(会有一帧回弹)。
  }

  // 3) 兜底:设置被 Host 侧外部改动(adopt)或第 2 步未拦截成功时,重新归一。
  if (typeof ctx.on === 'function') {
    ctx.on('theme/change', () => {
      normalize(theme, write)
    })
  }

  // 卸载时还原,避免插件已卸载却仍锁着设置。
  if (patched && typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      theme.setFontSize = original
    })
  }
}

/** 当前设置值偏离 14px 时写回 14px(setFontSize 自身会忽略等值写入)。 */
function normalize(theme: ThemeService, write: (px: number) => void): void {
  if (theme.getTheme().fontSize !== PINNED_FONT_SIZE) write(PINNED_FONT_SIZE)
}

/** 结构判断(服务由模块加载器注入,运行时类型不可信,须双重判空)。 */
function isThemeService(value: unknown): value is ThemeService {
  if (value === null || value === undefined) return false
  const candidate = value as Partial<ThemeService>
  return typeof candidate.getTheme === 'function' && typeof candidate.setFontSize === 'function'
}
