# 已验证的关键锚点与术语速查表

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 5 册：代码位置清单与术语表。

---

## 6. 已验证的关键锚点（代码位置清单）

- `dsh-web-frontend/dist/index.html`：静态 `<link>` 两处（`vendor-BNsW4eBh.css`、`index-BPHePDI_.css`）。
- `dsh-web-frontend/dist/assets/index-BPHePDI_.css`：783 个哈希类、33 个 `data-*`、614 处 `var(--…)`。
- `dsh-web-frontend/dist/assets/index-5SrrfWpU.js`：应用外壳 Vite 入口 bundle（含 CSS Module 类名映射对象 `ve`，如 `tab: "_tab_6nhg2_134"`）。
- `@deepseek-ai/dsh-client-ui-theme/lib/client.js`：
  - 2 个 CSS Module sheet（`AppearanceRow.module.css` → `._8HJdBW_*`、`FontSizeRow.module.css` → `.bVCLcG_*`）自注入 + 类名映射；
  - `STYLES`（8 个全局 inline sheet）+ `installThemeStyles()` 挂载；
  - `apply()`：`installThemeStyles` + `new ThemeRuntime` + `ctx.provide("theme", theme)` + 注册两个 settings 行。
- 本仓库 [`../../tsdown.client.mjs`](../../tsdown.client.mjs)：三个 CSS 虚拟模块（`\0dsh-css:` / `\0dsh-global-css:` / `\0dsh-inline-css:`）、`styleInjectionModule()`、lightningcss `cssModules: { pattern: '[hash]_[local]' }`。
- 本仓库 [`../../dsh-ui-css-patches/src/css.ts`](../../dsh-ui-css-patches/src/css.ts)、[`../../dsh-ui-css-patches/src/client.ts`](../../dsh-ui-css-patches/src/client.ts)：插件自己的 `data-*` + CSS 变量规则与注入生命周期。
- 本仓库 [`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json) + [`../../dsh-ui-css-patches/check-css.mjs`](../../dsh-ui-css-patches/check-css.mjs)：构建后契约校验。
- dockkit tab 真实 DOM：`<div role="tab" data-dockkit-tab="<id>" class="_tab_6nhg2_134 …">` —— 两属性同元素，复合选择器**仍然命中**（`css-contract.json` 里「复合选择器失效」的 hint 与当前构建不符，当前是命中的）。

---

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
| **`\0dsh-inline-css:`** | `.css?inline` 的构建期虚拟模块（导出编译文本，插件自管生命周期） |
| **`data-plugin-css`** | 运行时注入 `<style>` 的去重键（`<包名>/<css 文件名>`） |
| **`data-plugin`** | 运行时注入 `<style>` 的归属标记（卸载时据此清除） |
