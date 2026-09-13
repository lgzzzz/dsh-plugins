/**
 * dsh-rightbar-tab-width — 右栏 tab 胶囊定宽补丁的 CSS 真源。
 *
 * 上游事实(DSH 0.1.5-rc.2,dockkit 被内联进 dsh-web-frontend 的
 * assets/index-*.css,类名是 CSS Module 哈希 `._tab_17p4l_156`):
 *
 *   ._tab_17p4l_156{
 *     position:relative;display:flex;flex:0 1 auto;align-items:center;
 *     min-width:80px;max-width:170px;height:28px;padding:0 10px;
 *     font-size:var(--dsh-content-font-size-secondary,13px);...
 *   }
 *
 * 该元素是 **content-box**(全应用没有 `box-sizing` 全局重置:`index-*.css`、
 * `vendor-*.css`、`index.html` 与所有内置包/本地插件的 client.js 里唯一的通用
 * 选择器规则是 dsh-client-ui-theme 的 `*,:before,:after{corner-shape:...}`),
 * 所以胶囊总宽 = 内容盒 + 左右各 10px 内边距,随标签文字在 **100px–190px** 之间
 * 浮动(chip 是 `flex:0 1 auto`,基准尺寸取 max-content,被 min/max-width 夹取,
 * 条不足宽时缩到 min-width 后改为 `_stripTabs_` 的 `overflow-x:auto` 横向滚动)。
 *
 * 本补丁:把 `min-width` 与 `max-width` 同时钉在 CAPSULE_WIDTH_PX,并改用
 * border-box,使**外宽**(border box)恰好等于该值(不再受上游 padding 变化影响;
 * 内容盒 = 该值 − 20px 内边距)。两侧同值即可完全定宽:flex 基准尺寸被 max-width
 * 夹到该值,而 shrink 因 min-width 无法再压缩,故无需覆盖上游的 `flex:0 1 auto`。
 *
 * 选择器:两个属性选择器 = (0,2,0),稳压上游单类名 (0,1,0),不依赖样式注入
 * 顺序、不需要 `!important`。两个属性都是 dockkit 自己 `querySelector` 用的钩子
 * (`data-dockkit-tab` 在停靠 chip 上,值是该 tab 的 id;`role="tab"` 是同一元素上
 * 的 ARIA 角色),比类名哈希稳定——不要改写成 `._tab_*` 类名。
 *
 * 已知耦合:dockkit 的 `ey()` 会把 pane 内第一个 `[data-dockkit-tab]` 的
 * **计算后 min-width** 当作「一枚 chip 的宽度预算」(content-box 时再加上 padding
 * 与 border;`min-width<=0` 或空 pane 则回落到内置常量 `SPLIT_MINIMUMS.chip = 100`),
 * 该读数进入分栏可行性判定 `row: pane.width/2 - extra >= 固定chrome + chip`
 * (`canSplitPane`),决定右栏「分栏」按钮是否渲染、以及把 tab 拖到格子左右边缘是否
 * 允许分栏。本补丁取 100 且为 border-box,故度量走 border-box 分支、恰好返回 100
 * ——与内置兜底常量同值,分栏判定因此与上游默认**逐字相同**(无任何偏移);同时
 * 100px 也正是上游胶囊自身的地板值(80px 内容盒 + 左右各 10px 内边距)。
 */

/** 一枚右栏 tab 胶囊的固定外宽(px)。改成别的值后必须重新构建 lib/client.js。 */
export const CAPSULE_WIDTH_PX = 100

/**
 * 注入的样式表。首行注释在 DevTools 里显示为 style 标签内容,便于现场核对来源。
 * `!important` 不需要:见文件头对特异性的说明。
 */
export const CSS = `/* dsh-rightbar-tab-width: fix every docked right-sidebar tab capsule to ${CAPSULE_WIDTH_PX}px */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: ${CAPSULE_WIDTH_PX}px;
  max-width: ${CAPSULE_WIDTH_PX}px;
}
`
