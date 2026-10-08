# 上游机制与 CSS 的两条注册路径

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 1 册：上游三种样式机制，以及静态 `<link>` / 运行时 `<style>` 两条注册路径。

## 1. 上游控制组件样式的三种机制

对当前构建产物 `dsh-web-frontend/dist/assets/index-BPHePDI_.css` 的量化统计（这是应用外壳自己打包的 CSS；数量是正则匹配的出现次数）：

| 选择器 / 令牌类型 | 数量 | 作用 |
|---|---|---|
| CSS Modules 哈希类（`._name_hash`） | **783** 处（331 个不同类名） | 组件样式 |
| `[data-*]` 属性选择器 | 91 处（37 个不同属性名） | 状态开关 / 锚点 |
| `var(--…)` 引用 | 549 处 | 设计令牌消费 |

三种机制的各自定位：

- **CSS Modules**：组件样式写在 `.module.css`，构建时编译成唯一哈希类名（如 `tab → _tab_6nhg2_134`）。JS 不写死类名字符串，而是导入编译产物里的「类名映射对象」（模块对象），通过 `styles.tab` 这样的成员引用哈希后的真实类名。
- **CSS 变量（设计令牌）**：颜色 / 字号 / 间距 / 宽度等走 `--dsw-*`（design system 设计系统）与 `--dsh-*`（harness）令牌。组件消费 `var(...)`，不写死具体值；主题切换（浅色 / 深色）只替换令牌定义，组件样式不变。
- **`data-*` 属性选择器**：主要当 **状态标志**（`[data-pinned]`、`[data-fullscreen]`、`[data-state]`、`[data-dockkit-drop-active]` 等）和 **JS 查询锚点**（`querySelectorAll("[data-dockkit-pane]")` 等），少数当结构锚点（`[data-code-block-banner]`、`[data-terminal]` 等）。

## 2. CSS 的注册位置（两条路径）

### 路径 A：静态 `<link>`（应用外壳的构建产物，页面加载时）

`dsh-web-frontend/dist/index.html` 里直接以 `<link rel="stylesheet">` 引入，加载一次、常驻：

```html
<link rel="stylesheet" crossorigin href="./assets/vendor-BNsW4eBh.css">
<link rel="stylesheet" crossorigin href="./assets/index-BPHePDI_.css">
```

- `index-BPHePDI_.css`：`dsh-web-frontend` 应用外壳自己打包的 CSS（含 783 处哈希类引用、91 处 `[data-*]` 选择器）。
- `vendor-BNsW4eBh.css`：第三方 vendor 样式。

> 这份 `dist/index.html` 是 Vite 的**静态构建快照**。DSH 的 webserver 会在 `webserver/index-inject` 阶段向这份 HTML **注入**额外的脚本（模块加载器注册队列、`window.__DSH_BOOT__` 入口图、bootstrap/application 批次脚本），这是「路径 B」能发生的先决条件。静态 `<link>` 只覆盖应用外壳自己的 CSS；所有插件（含官方 `dsh-client-ui-*`）的 CSS 都走运行时注入。

### 路径 B：运行时 `<style>` 注入（插件 bundle 物化时）

`dsh-client-ui-*` 各包（theme / chat / conversation / tool / …）的 CSS Module 被构建系统内联成**字符串**，运行时在 `document.head` 注入 `<style>`，用 `data-plugin-css` 去重。

「内联 + 注入」的模板如下（本仓库 `tsdown.client.mjs` 的 `styleInjectionModule()` 生成的就是这段代码）：

```js
const css = "…编译后的 CSS 文本…";
const tagId = "<包名>/<css 文件名>";              // 例：@deepseek-ai/dsh-client-ui-theme/AppearanceRow.module.css
if (typeof document !== "undefined"
    && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "<包名>";                   // 例：@deepseek-ai/dsh-client-ui-theme
  tag.dataset.pluginCss = tagId;                   // DOM 里表现为 data-plugin-css
  tag.textContent = css;                           // 内联的 CSS 内容
  document.head.appendChild(tag);
}
// 若是 .module.css，还额外导出类名映射：
export default { "group": "_8HJdBW_group", "title": "_8HJdBW_title", … };
```

要点：

- **去重靠 `data-plugin-css`**：同一份 CSS 只注入一次（重复执行也不重复插入）。
- **归属靠 `data-plugin`**：标记这条 `<style>` 属于哪个包，模块系统卸载插件时据此清除（见 [第 4.3 节](03-scope-and-tokens.md)）。
- **注入发生在「物化」时**：这段注入代码位于 bundle 工厂函数体内部，而工厂只在模块被 `materialize` 时执行（见 [`dsh.client.inject` 术语表](../dsh-client-inject/04-glossary.md) 的「materialize(物化)」）。

> 本仓库插件 `dsh-ui-css-patches` 的 `installStyles` 是同一模式：运行时把 CSS 内联注入 `<style>` 并打 `data-plugin` 标记；区别在于它没有 `data-plugin-css` 去重，改用 `ctx.effect(() => () => tag.remove())` 做生命周期清理（见 [第 4.3 节](03-scope-and-tokens.md)）。
