# 构建期 CSS 处理：三个虚拟模块

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 2 册：`\0dsh-css:` / `\0dsh-global-css:` / `\0dsh-inline-css:` 三个虚拟模块。

## 3. 构建期 CSS 处理：三个虚拟模块

在 `tsdown.client.mjs` 里，CSS 通过三个 `\0` 前缀的虚拟模块 ID 处理，避免进入 tsdown 自带的 CSS 管道（由 lightningcss 直接编译）：

| 虚拟模块前缀 | 触发条件 | 产物 | 注入方式 |
|---|---|---|---|
| `\0dsh-css:` | `import "./x.module.css"` | 哈希类名映射 + 已编译 CSS 文本 | 工厂执行时**自注入** `<style>`（带 `data-plugin-css` 去重），并 `export default` 类名映射 |
| `\0dsh-global-css:` | `import "./x.css"`（非 module） | 已编译 CSS 文本 | 工厂执行时**自注入** `<style>`（带 `data-plugin-css` 去重），`export {}`（无类名映射） |
| `\0dsh-inline-css:` | `import "./x.css?inline"` | 已编译 CSS **文本**（作为默认导出字符串） | **不自注入**——由导入方自己决定何时挂载、何时卸载（插件拥有生命周期） |

关键实现（`tsdown.client.mjs`）：

- `cssModulesInlinePlugin()` 用 lightningcss 的 `transform({ cssModules: { pattern: '[hash]_[local]' }, minify: true })` 编译 `.module.css`，产出：
  - `code`：把 `.group`、`.title` 等局部类名替换成 `._8HJdBW_group`、`._8HJdBW_title` 这类哈希类名的 CSS 文本；
  - `cssExports`：`{ group: "_8HJdBW_group", … }` 的映射表，再被转换成 JS 默认导出。
- `cssGlobalInlinePlugin()` 处理普通 `.css`（副作用注入）。
- `cssTextInlinePlugin()` 处理 `.css?inline`（导出编译后的字符串，供插件自己挂载）。

**产物示例**（`@deepseek-ai/dsh-client-ui-theme/lib/client.js` 中 `AppearanceRow.module.css` 编译后的结果）：

```js
// \0dsh-css: …/AppearanceRow.module.css.mjs
const css$1 = "._8HJdBW_group{border-bottom:.5px solid var(--dsw-alias-border-l2);…}._8HJdBW_title{…}…";
const tagId$1 = "@deepseek-ai/dsh-client-ui-theme/AppearanceRow.module.css";
if (typeof document !== "undefined"
    && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-theme";
  tag.dataset.pluginCss = tagId$1;
  tag.textContent = css$1;
  document.head.appendChild(tag);
}
var AppearanceRow_module_css_default = {
  "cubeRow": "_8HJdBW_cubeRow", "group": "_8HJdBW_group", "selected": "_8HJdBW_selected",
  "themeCube": "_8HJdBW_themeCube", "title": "_8HJdBW_title"
};
```

组件 JS 侧这样用（`AppearanceRow` 里）：

```js
return jsx("div", { className: AppearanceRow_module_css_default.group, children: … })
```

即：JS 里写的是语义化的 `AppearanceRow_module_css_default.group`，落到 DOM 上是哈希类名 `_8HJdBW_group`。类名带构建哈希、每版构建都变，插件无法靠类名覆盖，只能用 `data-*` 锚点。
