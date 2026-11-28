/**
 * 关闭左栏列表的行排序动画(工作区 / 会话行在顺序变化时的 FLIP 位移)。
 *
 * 左栏的列表由上游 primitives 的 `AnimatedRows` 渲染:它把 `[data-row-key]` 元素当作行,在顺序
 * 变化(会话活动上浮、拖拽排序、置顶、分组展开、搜索过滤)前后各读一次
 * `getBoundingClientRect()`,再用 Web Animations API 给行跑一段 200ms 的 FLIP 位移
 * (`translate(dx, dy)` → `translate(0, 0)`)与进入 / 退出的 100ms 透明度过渡;被移除的行会
 * 被克隆到列表旁的 `[class*="_exits"]` 浮层里淡出。用户看到的就是「工作区排序时的动画」。
 *
 * 上游只在 `prefers-reduced-motion: reduce` 时整段跳过,而 CSS 改不到 JS 里的
 * `element.animate(...)`。这里只包一层 `Element.prototype.animate`:目标是左栏槽位
 * (`[data-slot="sidebar"]`)里的 `data-row-key` 行、或 `AnimatedRows` 的退场克隆时,把这次
 * 动画的 duration / delay / endDelay 压成 0 —— 动画仍在同一次更新里建立并立即结束,上游
 * `onfinish` 里的清理(`movements` / `exits` 回收)照常执行,行的最终位置、`rowKeys` 顺序、
 * 拖拽与点击都不变;其它元素(输入框、浮层、设置页的模型列表等)的 `animate` 原样放行。
 *
 * 依赖的上游事实:左栏注册成 root 的 `sidebar` 槽位(行渲染在 `[data-slot="sidebar"]` 下)、
 * `AnimatedRows` 用 `querySelectorAll("[data-row-key]")` 收集行、用 `element.animate(...)` 播放、
 * 退场浮层的局部类名以 `_exits` 结尾。任一改名时本补丁会静默失效(动画回来),由
 * `css-contract.json` 的 `sidebar-slot-key` / `animated-rows-export` /
 * `animated-rows-row-query` / `animated-rows-animate-call` / `animated-rows-exits-class`
 * 五条契约在构建后报失效。
 */

/** 左栏的槽位键;列表行都渲染在这棵子树里。 */
export const LEFT_SIDEBAR_SLOT_SELECTOR = '[data-slot="sidebar"]'

/** `AnimatedRows` 的行标识属性。 */
export const ROW_KEY_ATTRIBUTE = 'data-row-key'

/** `AnimatedRows` 退场克隆浮层的局部类名片段(生成名形如 `[hash]_exits`)。 */
export const EXITS_CLASS_FRAGMENT = '_exits'

/** 一次 `animate` 的选项:数字时长,或完整的选项对象(可省略)。 */
export type AnimateOptions = number | KeyframeAnimationOptions | undefined

/** `Element.prototype.animate` 的调用形状。 */
export interface AnimateMethod {
  (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: AnimateOptions,
  ): Animation
}

/** 只取 `animate` 的原型形状;真实 `Element.prototype` 与测试替身共用。 */
export interface AnimatePrototype {
  animate?: AnimateMethod
}

/**
 * 这次 `animate` 的目标是不是左栏里会被排序的行。
 *
 * 两个来源:带 `data-row-key` 的行元素(移动 / 进入动画),以及 `AnimatedRows` 放在
 * `…_exits` 浮层里的退场克隆(克隆时会去掉自己的 `data-row-key`)。两者都要求落在左栏槽位内,
 * 设置页等其它使用 `AnimatedRows` 的列表不受影响。
 * @param element - `animate` 的调用目标。
 * @returns 属于左栏列表行时为 true。
 */
export function isReorderRow(element: Element): boolean {
  if (element.closest(LEFT_SIDEBAR_SLOT_SELECTOR) === null) return false
  if (element.hasAttribute(ROW_KEY_ATTRIBUTE)) return true
  const parent = element.parentElement
  if (parent === null) return false
  // SVG 元素的 className 是 SVGAnimatedString,不是字符串;行元素都是 div,这里只做保守判断。
  const className: unknown = parent.className
  if (typeof className !== 'string') return false
  return className.split(/\s+/).some((token) => token.endsWith(EXITS_CLASS_FRAGMENT))
}

/**
 * 把一次动画的时长压成 0,保留其它选项(easing / fill / composite)。
 *
 * 数字选项直接换成 0;对象选项清空 `duration` / `delay` / `endDelay`,其余字段原样保留 ——
 * 退场克隆的 `fill: 'forwards'` 仍然生效,结束时停在最后一个关键帧上,`onfinish` 照常触发。
 * @param options - 调用方传入的选项。
 * @returns 立即结束的等价格式选项。
 */
export function withoutMotion(options: AnimateOptions): AnimateOptions {
  if (options === undefined || typeof options === 'number') return 0
  return { ...options, duration: 0, delay: 0, endDelay: 0 }
}

/**
 * 包住 `Element.prototype.animate`,让左栏排序行的动画立即结束。
 * @param prototype - `Element.prototype`(或测试替身)。
 * @returns 还原本方法的清理函数;原型上没有 `animate` 时返回空操作。
 */
export function installSidebarReorderMotionOff(prototype: AnimatePrototype): () => void {
  const original = prototype.animate
  if (typeof original !== 'function') return () => {}
  const patched: AnimateMethod = function patchedAnimate(this: Element, keyframes, options) {
    if (isReorderRow(this)) return original.call(this, keyframes, withoutMotion(options))
    return original.call(this, keyframes, options)
  }
  prototype.animate = patched
  return () => {
    // 期间若被别的补丁又包了一层,保留外层的包装,不把它的补丁一起撤掉。
    if (prototype.animate === patched) prototype.animate = original
  }
}
