/**
 * `dsh-forge-changes-font-14` 的全部规则,由 `client.ts` 挂成一条 `<style>`。
 *
 * 作用域是两个右栏标签页根元素的 `data-*` 锚点:
 *   - `[data-forge-changes]`:`@deepseek-ai/dsh-experimental-client-ui-forge` 的变更视图根,
 *     取值是 `local`(本地变更)或 `change`(某个变更请求的 diff);两种视图共用这一个根;
 *   - `[data-forge-panel]`:同一个包的「变更请求」面板根(检出信息、本地变更卡片、变更请求列表)。
 *
 * 上游把字号声明在 CSS Module 的哈希类名上(changes 根 12px、panel 根 13px,子树里 11/12/13px 混排)。
 * 模块样式表与本插件的 `<style>` 谁先注入不归本插件掌握,靠源码顺序压过上游的字号声明不可靠,
 * 所以两条规则都带 `!important`,并且按「根 + 全部后代」分别命中 —— `*` 不会命中根自身。
 *
 * 只覆盖 `font-size`:字体族(代码仍用 `--ds-font-family-code`)、行高(diff 行 22px 与占位行的
 * `--forge-rows * 22px` 必须一致)、颜色与布局都不动。行号列的 `--forge-number-width` 用 `ch`
 * 计算,字号变大后自动跟着变宽,不需要额外规则。
 *
 * 不覆盖:右栏标签条上的标题 chip(属于标签条,不是标签页正文)、portal 到 `document.body` 的
 * 浮层菜单(基准分支 / 范围 / 视图选项 / 文件搜索等,不在标签页 DOM 子树里),以及其它右栏标签页。
 */
export const CSS = `
[data-forge-changes],
[data-forge-panel] {
  font-size: 14px !important;
}

[data-forge-changes] *,
[data-forge-panel] * {
  font-size: 14px !important;
}
`
