/**
 * 右栏 tab 胶囊定宽:`[data-dockkit-tab][role="tab"]`((0,2,0) 稳压 dockkit 单类名)钉 box-sizing:border-box + min/max-width:100px,外宽恒 100px。
 * 耦合:dockkit `ey()` 取 pane 内首个该 tab 的计算后 min-width 作胶囊宽度预算,100 与兜底常量 SPLIT_MINIMUMS.chip 同值 ⇒ 分栏判定与上游默认逐字相同。
 * 只命中停靠 chip,浮窗标题(`[data-dockkit-float-title]`)不受影响;无需 !important(特异性已胜)。
 */

/** 胶囊固定外宽(px);改动后须重新构建 lib/client.js。 */
export const CAPSULE_WIDTH_PX = 100

/** 注入的样式表;首行 CSS 注释供 DevTools 核对来源,无需 !important。 */
export const CSS = `/* dsh-rightbar-tab-width: fix every docked right-sidebar tab capsule to ${CAPSULE_WIDTH_PX}px */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: ${CAPSULE_WIDTH_PX}px;
  max-width: ${CAPSULE_WIDTH_PX}px;
}
`
