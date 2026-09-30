# DSH 组件 CSS 架构：注册位置与作用域

> **一句话**：DSH 上游控制组件样式靠 **CSS Modules（哈希类名，组件局部）+ CSS 变量（`:root`/`body`，全局令牌）+ `data-*`（状态开关/JS 锚点）**；CSS 有两条注册路径——静态 `<link>` 和运行时 `<style>` 注入。插件用的 `[data-dockkit-tab][role="tab"]` 复合属性选择器是**插件自己的策略**，不是上游机制。

## 1. 上游用什么控制样式（不是复合属性选择器）

对当前构建产物 `dsh-web-frontend/dist/assets/index-BPHePDI_.css` 的量化统计：

| 选择器 / 令牌类型 | 数量 | 作用 |
|---|---|---|
| CSS Modules 哈希类（`._name_hash`） | **783** | 组件样式，主力 |
| `[data-*]` 属性选择器 | 33 | 状态开关 / 锚点 |
| `--css-variable` 引用 | 614 | 设计令牌消费 |

- **CSS Modules**：组件样式写在 `.module.css`，构建时编译成唯一哈希类名（如 `tab → _tab_6nhg2_134`），JS 通过导入的模块对象 `ve.tab` 引用。
- **CSS 变量**：颜色/字号/间距/宽度等走 `--dsw-*`（design system）/ `--dsh-*`（harness）令牌，组件消费 `var(...)` 而非写死值。
- **`data-*`**：主要当**状态标志**（`[data-pinned]`、`[data-fullscreen]`、`[data-state]`、`[data-dockkit-drop-active]`…）和 **JS 查询锚点**（`querySelectorAll("[data-dockkit-pane]")` 等），少数当结构锚点（`[data-code-block-banner]`、`[data-terminal]`…）。

## 2. CSS 在哪里注册（两条路径）

### 路径 A：静态 `<link>`（构建产物，页面加载时）

`dist/index.html` 中直接以 `<link rel="stylesheet">` 引入，加载一次、常驻：

```html
<link rel="stylesheet" href="./assets/vendor-BNsW4eBh.css">
<link rel="stylesheet" href="./assets/index-BPHePDI_.css">
```

- `index-BPHePDI_.css`：`dsh-web-frontend` 应用外壳自己打包的 CSS（含 783 个模块类、33 个 `data-*` 选择器）。
- `vendor-BNsW4eBh.css`：第三方 vendor 样式。

### 路径 B：运行时 `<style>` 注入（模块加载器）

`dsh-client-ui-*` 各包（theme/chat/conversation/tool/…）的 CSS Module 被构建系统（`\0dsh-css:` 虚拟模块）**内联成字符串**，运行时在 `document.head` 注入 `<style>`，用 `data-plugin-css="<tagId>"` 去重。见 `dsh-client-ui-theme/lib/client.js`：

```js
if (typeof document !== "undefined"
    && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-theme";
  tag.dataset.pluginCss = tagId;      // → data-plugin-css
  tag.textContent = css;              // 内联的 CSS Module 内容
  document.head.appendChild(tag);
}
```

> **关键**：这跟插件 `installStyles` 里的 `document.head.appendChild(tag)` 是**同一个模式**——上游自己也是运行时把 CSS 内联注入 `<style>`，只是多了 `data-plugin-css` 去重。

`dsh-client-ui-theme` 里共 3 处注入：`AppearanceRow.module.css`、`FontSizeRow.module.css`、`base.css`（全局令牌）。

## 3. 全局生效，还是组件局部生效？

按三类分开看（三类都加载进 `document.head`，级联上「全局」，但作用域不同）：

| 类型 | 注册位置 | 作用域 | 说明 |
|---|---|---|---|
| **CSS Modules 组件样式** | `<link>` 或运行时 `<style>` | **组件局部**（等效） | 规则用唯一哈希类名（`._tab_6nhg2_134`）选择器，只命中自己组件元素 |
| **设计令牌（CSS 变量）** | 运行时 `<style>`（`base.css.mjs`） | **全局**（刻意） | 定义在 `:root`（字体族）与 `body`（`--dsw-alias-*` 别名）、`body[data-ds-dark-theme]`（暗色覆盖），沿 DOM 级联 |
| **`data-*` 选择器** | 同上（随组件 CSS） | 全局属性选择器，但**受属性限定** | `[data-pinned]` 等匹配文档任意位置，但只命中带该属性的元素，等效局部 |

### 设计令牌定义位置（`dsh-client-ui-theme/src/styles/base.css.mjs`）

```css
:root { --dsw-font-family: …; --ds-font-family-code: …; }
body  { --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00); … }
body[data-ds-dark-theme] { --dsw-static-…: …; /* 暗色覆盖 */ }
```

## 4. 与插件的关系（一句话对照）

| | 选择器 | 作用域 | 目的 |
|---|---|---|---|
| **DSH 上游** | 哈希类 + CSS 变量 + `data-*` 状态开关 | 组件局部 + 令牌全局 | 组件自身样式、主题、状态 |
| **插件 dsh-ui-css-patches** | `[data-dockkit-tab][role="tab"]` 复合属性选择器 | 全局属性选择器（受属性限定） | 跨构建稳定锚定 dockkit tab 并覆盖上游 |

`dsh-ui-css-patches` 是统一后的 CSS 补丁插件：它合并了原 `dsh-code-card-fonts` / `dsh-rightbar-fonts` / `dsh-rightbar-tab-width` / `dsh-fullwidth-chat` 四组规则，只注入一个 `<style data-plugin="dsh-ui-css-patches">`，规则覆盖顺序由表内源码顺序唯一确定。它依赖的上游 token（`data-*` 属性 + CSS 变量）由插件目录内的 [`dsh-ui-css-patches/check-css.mjs`](dsh-ui-css-patches/check-css.mjs) + [`dsh-ui-css-patches/css-contract.json`](dsh-ui-css-patches/css-contract.json) 在每次构建后逐条静态校验（脚本默认读同目录清单），改动上游版本后重跑 `pnpm -r build` 即可发现静默失效。

插件用复合属性选择器，是因为上游类名带构建哈希、每版必变，无法可靠命中；`data-dockkit-tab` + `role="tab"` 是稳定的语义锚点，且特异性 `(0,2,0)` > 上游 `.tab` `(0,1,0)`，无需 `!important` 即可覆盖。

## 5. 已验证的关键锚点

- `dist/index.html` L12–13：静态 `<link>` 两处。
- `dsh-client-ui-theme/lib/client.js`：运行时 `<style data-plugin-css>` 注入 + 去重。
- `dsh-client-ui-theme/src/styles/base.css.mjs`：`:root` / `body` / `body[data-ds-dark-theme]` 全局令牌。
- `index-5SrrfWpU.js`（dsh-web-frontend bundle）：CSS Module 类名映射对象 `ve`（`tab: "_tab_6nhg2_134"` 等）。
- dockkit tab 真实 DOM：`<div role="tab" data-dockkit-tab="<id>" class="_tab_6nhg2_134 …">` —— 两属性同元素，复合选择器**仍然命中**（`css-contract.json` 里「复合选择器失效」的 hint 与当前构建不符）。
