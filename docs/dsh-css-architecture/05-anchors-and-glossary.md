# 已验证的关键锚点与术语速查表

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 5 册：代码位置清单与术语表。

-----

## 6. 已验证的关键锚点（代码位置清单）

- `dsh-web-frontend/dist/index.html`：静态 `<link>` 两处（`vendor-BNsW4eBh.css`、`index-BPHePDI_.css`）。
- `dsh-web-frontend/dist/assets/index-BPHePDI_.css`：783 处哈希类引用（331 个不同类名）、91 处 `[data-*]` 选择器、549 处 `var(--…)` 引用。
- `dsh-web-frontend/dist/assets/index-5SrrfWpU.js`：应用外壳 Vite 入口 bundle（含 CSS Module 哈希类字符串，如 `_tab_6nhg2_134`，以及它们的类名映射对象）。
- `@deepseek-ai/dsh-client-ui-theme/lib/client.js`：
  - 2 个 CSS Module sheet（`AppearanceRow.module.css` → `._8HJdBW_*`、`FontSizeRow.module.css` → `.bVCLcG_*`）自注入 + 类名映射；
  - `STYLES`（8 个全局 inline sheet）+ `installThemeStyles()` 挂载；
  - `apply()`：`installThemeStyles` + `new ThemeRuntime` + `ctx.provide("theme", theme)` + 注册两个 settings 行。
- 本仓库 [`../../tsdown.client.mjs`](../../tsdown.client.mjs)：三个 CSS 虚拟模块（`\0dsh-css:` / `\0dsh-global-css:` / `\0dsh-inline-css:`）、`styleInjectionModule()`、lightningcss `cssModules: { pattern: '[hash]_[local]' }`。
- 本仓库 [`../../dsh-ui-css-patches/src/css.ts`](../../dsh-ui-css-patches/src/css.ts)、[`../../dsh-ui-css-patches/src/client.ts`](../../dsh-ui-css-patches/src/client.ts)：插件自己的 `data-*` / CSS 变量 / 局部类名规则与注入生命周期。
- 本仓库 [`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json) + [`../../dsh-ui-css-patches/check-css.mjs`](../../dsh-ui-css-patches/check-css.mjs)：构建后契约校验。
- 正文限宽的参考常量：`SIDEBAR_DEFAULT = 280` / `SIDEBAR_AUTO_COLLAPSE = 1024`（`dsh-client-ui-layout/src/client/columns.ts`）、会话面板 `--panel-clear: 40px` / `--panel-edge: 8px` / `--panel-min-width: 300px`（`dsh-client-ui-session-panel/src/client/SessionPanel.module.css`）、聊天滚动框 32px 侧内边距（`dsh-client-ui-chat/src/client/chat/ChatView.module.css`）、`--dsh-scrollbar-width: 5px`（`dsh-client-ui-theme/src/styles/scrollbar.css`）与滚动框 `margin-right: 2px`（`dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css`）；这些常量经 `css-contract.json` 的 `sidebar-default` / `sidebar-auto-collapse` / `panel-*` / `chat-scroll-*` / `scrollbar-width-var` 契约校验。
- 开关轨道动画的锚点：`[data-animating]`（`AppFrame` 只在离散的左右栏开关 / 折叠上置位，同时挂 300ms 的 `grid-template-columns` 过渡；本插件把它置为 `transition: none`，让正文列宽度与位置一步到位，不逐帧跟随中间宽度与末端预留），经 `css-contract.json` 的 `animating-attr` 契约校验。
- 右栏滑入滑出的锚点：面板根 `[data-sidebar-right-panel]`（`push` / `fullscreen`）内的 `[data-dockkit-host=dock]` / `[data-dockkit-empty]` / `[data-dockkit-divider]`；上游 `SidebarRight.module.css` 给这三块内容挂 `transform: translateX(var(--dsh-sidebar-width))`、`visibility: hidden` 与 `transition: transform …`（关闭时还带 visibility 延迟），展开态改成 `transform: none` / `visibility: visible`。本插件在 `[data-sidebar-right-panel]` 作用域内把 `transition` 置为 `none`，经 `sidebar-right-panel-attr` / `sidebar-right-slide-rule` / `dockkit-attrs` 三条契约校验。
- 左栏行排序动画的锚点：左栏槽位 `[data-slot="sidebar"]`（布局把 `sidebar` 注册成 root 的 single 槽位）、行标识 `[data-row-key]`，以及 primitives 的 `AnimatedRows`——它用 `querySelectorAll("[data-row-key]")` 收集行、用 `element.animate(...)` 播放 200ms 的 FLIP 位移（进入 / 退出 100ms 透明度），退场克隆挂在局部类名以 `_exits` 结尾的浮层里。浏览器半部包住 `Element.prototype.animate`，把这些行的时长压成 0，经 `sidebar-slot-key` / `animated-rows-export` / `animated-rows-row-query` / `animated-rows-animate-call` / `animated-rows-exits-class` 五条契约校验。
- 轮次导航轨道的锚点：`TurnNavigator` 渲染 `<nav class="[hash]_frame">` 套在 `<div class="[hash]_slot">` 里，slot 是 `container-type:inline-size` 的查询容器；上游用 `@container (width<=900px){.…_frame{display:none}}` 在窄容器里隐藏整条轨道（右栏占轨即触发）。本插件用 `[data-conversation-scroll] nav[class*="_frame"]` 与 `[class*="_slot"] > nav[class*="_frame"]` 把 frame 恢复成 `display:block`，经 `css-contract.json` 的 `turn-rail-frame-class` / `turn-rail-slot-class` / `turn-rail-nav-structure` / `conversation-scroll-attr` / `turn-rail-container-hide` 五条契约校验。
- dockkit tab 真实 DOM：`<div role="tab" data-dockkit-tab="<id>" class="_tab_6nhg2_134 …">` —— 两属性同元素，复合选择器命中。

-----

## 7. 术语速查表

| 词 | 含义 |
|---|---|
| **CSS Modules** | `.module.css` 编译成哈希类名 + 类名映射对象，组件局部 |
| **哈希类名** | `[hash]_[local]` 模式生成，如 `_8HJdBW_group`，每版构建必变 |
| **`--dsw-*`** | design system 设计系统令牌（`--dsw-static-*` 原始值、`--dsw-alias-*` 语义别名、`--dsw-font-*`、`--dsw-radius-*` 等） |
| **`--dsh-*`** | harness 侧令牌（如 `--dsh-content-font-size`、`--dsh-scrollbar-*`） |
| **`data-*`** | 状态开关 / JS 锚点 / 结构锚点，插件跨构建覆盖的稳定抓手 |
| **`body[data-ds-dark-theme]`** | 深色主题的令牌覆盖作用域 |
| **`\0dsh-css:`** | `.module.css` 的构建期虚拟模块（哈希类名 + 自注入） |
| **`\0dsh-global-css:`** | 普通 `.css` 的构建期虚拟模块（编译文本 + 自注入，无类名映射） |
| **`\0dsh-inline-css:`** | `.css?inline` 的构建期虚拟模块（导出编译文本，插件自管生命周期） |
| **`data-plugin-css`** | 运行时注入 `<style>` 的去重键（`<包名>/<css 文件名>`） |
| **`data-plugin`** | 运行时注入 `<style>` 的归属标记（卸载时据此清除） |
