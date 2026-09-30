# DSH 组件 CSS 架构：注册位置、作用域与令牌体系

> **一句话**：DSH 上游控制组件样式靠 **CSS Modules（哈希类名，组件局部） + CSS 变量（`:root`/`body`，全局令牌） + `data-*`（状态开关 / JS 锚点）** 三种机制。CSS 有两条注册路径——静态 `<link>`（应用外壳自己的构建产物）和运行时 `<style>` 注入（插件 bundle 物化时）。插件 `dsh-ui-css-patches` 用的 `[data-dockkit-tab][role="tab"]` 复合属性选择器是**插件自己的策略**，不是上游机制；它之所以可行，是因为上游类名带构建哈希、每版必变，而 `data-dockkit-tab` + `role="tab"` 是稳定的语义锚点。

---

## 1. 上游用什么控制样式（不是复合属性选择器）

对当前构建产物 `dsh-web-frontend/dist/assets/index-BPHePDI_.css` 的量化统计（这是应用外壳自己打包的 CSS）：

| 选择器 / 令牌类型 | 数量 | 作用 |
|---|---|---|
| CSS Modules 哈希类（`._name_hash`） | **783** | 组件样式，主力 |
| `[data-*]` 属性选择器 | 33 | 状态开关 / 锚点 |
| `--css-variable` 引用 | 614 | 设计令牌消费 |

三种机制的各自定位：

- **CSS Modules**：组件样式写在 `.module.css`，构建时编译成唯一哈希类名（如 `tab → _tab_6nhg2_134`）。JS 不写死类名字符串，而是导入编译产物里的「类名映射对象」（模块对象），通过 `ve.tab` 这样的成员引用哈希后的真实类名。
- **CSS 变量（设计令牌）**：颜色 / 字号 / 间距 / 宽度等走 `--dsw-*`（design system 设计系统）与 `--dsh-*`（harness）令牌。组件消费 `var(...)`，不写死具体值，这样主题切换（浅色 / 深色）只需替换令牌定义，组件样式零改动。
- **`data-*` 属性选择器**：主要当 **状态标志**（`[data-pinned]`、`[data-fullscreen]`、`[data-state]`、`[data-dockkit-drop-active]` 等）和 **JS 查询锚点**（`querySelectorAll("[data-dockkit-pane]")` 等），少数当结构锚点（`[data-code-block-banner]`、`[data-terminal]` 等）。

> 所以「上游怎么给组件加样式」的答案是：**哈希类名（局部）+ CSS 变量（全局令牌）+ data-* 状态开关**。不是「复合属性选择器」——那只是本仓库插件为了「跨构建稳定覆盖」而自己选用的手段。

---

## 2. CSS 在哪里注册（两条路径）

### 路径 A：静态 `<link>`（应用外壳的构建产物，页面加载时）

`dsh-web-frontend/dist/index.html` 里直接以 `<link rel="stylesheet">` 引入，加载一次、常驻：

```html
<link rel="stylesheet" crossorigin href="./assets/vendor-BNsW4eBh.css">
<link rel="stylesheet" crossorigin href="./assets/index-BPHePDI_.css">
```

- `index-BPHePDI_.css`：`dsh-web-frontend` 应用外壳自己打包的 CSS（含 783 个模块类、33 个 `data-*` 选择器）。
- `vendor-BNsW4eBh.css`：第三方 vendor 样式。

> 注意：这份 `dist/index.html` 是 Vite 的**静态构建快照**。真正跑起来时，DSH 的 webserver 会在 `webserver/index-inject` 阶段向这份 HTML **注入**额外的脚本（模块加载器注册队列、`window.__DSH_BOOT__` 入口图、bootstrap/application 批次脚本）——这是「路径 B」能发生的先决条件。也就是说，静态 `<link>` 只覆盖应用外壳自己的 CSS，所有插件（含官方 `dsh-client-ui-*`）的 CSS 都走下面的运行时注入。

### 路径 B：运行时 `<style>` 注入（插件 bundle 物化时）

`dsh-client-ui-*` 各包（theme / chat / conversation / tool / …）的 CSS Module 被构建系统内联成**字符串**，运行时在 `document.head` 注入 `<style>`，用 `data-plugin-css` 去重。

先看这个「内联 + 注入」的模板本身（本仓库 `tsdown.client.mjs` 的 `styleInjectionModule()` 生成的就是这段代码；官方 `dsh-client-ui-theme/lib/client.js` 里的产物完全同构）：

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
- **归属靠 `data-plugin`**：标记这条 `<style>` 属于哪个包，模块系统卸载插件时据此清除（见第 3 节）。
- **注入发生在「物化」时**：因为这段注入代码位于 bundle 工厂函数体内部，而工厂只在模块被 `materialize` 时执行（见 `dsh-client-inject.md` 的「物化」术语）。

> 这跟本仓库插件 `dsh-ui-css-patches` 自己写的 `installStyles` 是**同一个模式**（运行时把 CSS 内联注入 `<style>`、打 `data-plugin` 标记），区别在于：上游的 `styleInjectionModule` 多了一层 `data-plugin-css` 去重，而 `dsh-ui-css-patches` 没有去重、改用 `ctx.effect(() => () => tag.remove())` 做生命周期清理（见第 4 节）。

---

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

**产物长什么样**（真实截取自 `@deepseek-ai/dsh-client-ui-theme/lib/client.js`，展示 `AppearanceRow.module.css` 编译后的样子）：

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

即：JS 里写的是语义化的 `AppearanceRow_module_css_default.group`，落到 DOM 上是哈希类名 `_8HJdBW_group`。类名对插件作者**不可预测**，这就是为什么插件不能靠类名覆盖，只能靠 `data-*` 锚点。

---

## 4. 全局生效，还是组件局部生效？

三类 CSS 都进了 `document.head`，在「级联」意义上都是全局的，但**作用域**不同：

| 类型 | 注册位置 | 作用域 | 说明 |
|---|---|---|---|
| **CSS Modules 组件样式** | `<link>`（外壳）或运行时 `<style>`（插件） | **组件局部**（等效） | 规则用唯一哈希类名选择器，只命中自己组件的元素 |
| **设计令牌（CSS 变量）** | 运行时 `<style>`（theme 包的全局 sheet） | **全局**（刻意） | 定义在 `:root`、`body`，沿 DOM 级联，供所有组件消费 |
| **`data-*` 选择器** | 随组件 CSS 一起 | 全局属性选择器，但**受属性限定** | `[data-pinned]` 能匹配文档任意位置，但只命中带该属性的元素，等效局部 |

### 4.1 设计令牌的完整定义位置（不是只有 `base.css`）

官方 theme 包 `@deepseek-ai/dsh-client-ui-theme` 的客户端 bundle 里，令牌被拆成 **8 个全局 sheet**，统一在 `apply()` 里由 `installThemeStyles()` 挂载（每个 sheet 一个 `<style data-plugin data-plugin-css>`，并通过 `ctx.effect` 在插件卸载时移除）：

```js
const STYLES = [
  ["base.css", base_css_default],
  ["corner-shape.css", corner_shape_css_default],
  ["design-platform.css", design_platform_css_default],
  ["focus.css", focus_css_default],
  ["onboarding.css", onboarding_css_default],
  ["scrollbar.css", scrollbar_css_default],
  ["gradient-shadow-text.css", gradient_shadow_text_css_default],
  ["shiki.css", shiki_css_default],
]

function installThemeStyles(ctx) {
  for (const [name, css] of STYLES) ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
    tag.textContent = css
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, `ui-theme: ${name} stylesheet`)
}
```

这 8 个 sheet 各自定义什么（节选真实内容）：

- **`base.css`**：` :root { --dsw-font-family; --dsw-font-family-brand; --ds-font-family-code; --ds-ease-in-out; --ds-transition-duration*; --dsw-radius-xs/sm/md/lg/xl/panel }`，以及 `body { --dsw-alias-settings-card-fill; --dsw-alias-settings-card-stroke }`、`[data-dsh-automatic-focus]` 的焦点重置。
- **`design-platform.css`**（最大，约 19 KB）：`--dsw-static-*` **原始色板**（`--dsw-static-neutral-bluish-00` 等数百个具体颜色值）与 `--dsw-alias-*` **语义别名**（`--dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00)` 等）。**浅色 / 深色两套都用 `body {}` 与 `body[data-ds-dark-theme] {}` 分别定义**。
- **`focus.css`**：`--dsw-focus-ring-width` 与 `:focus-visible` 焦点环。
- **`onboarding.css`**：onboarding 相关渐变 / 卡片令牌，含 `body[data-ds-dark-theme]` 暗色覆盖。
- **`scrollbar.css`**：`--dsh-scrollbar-*` 滚动条令牌。
- **`gradient-shadow-text.css`**：`--dsw-shadow-*`、`--dsw-elevation-*` 阴影/层级令牌，以及 `--dsh-content-font-delta`、`--dsh-content-font-size-secondary`、`--dsw-font-markdown-*` 这些**正文排版令牌**（也是本仓库 CSS 补丁插件依赖的关键令牌）。
- **`shiki.css`**：`--shiki-*` 代码高亮配色，含 `body[data-ds-dark-theme]` 暗色覆盖。
- **`corner-shape.css`**：`@supports (corner-shape: superellipse(1.5))` 下的圆角形状开关。

> 也就是说，原文档「theme 里就 3 处注入（AppearanceRow.module.css / FontSizeRow.module.css / base.css）」是不完整的。真实情况是：**2 个 CSS Module sheet（自注入）+ 8 个全局 inline sheet（apply 里挂载）**。而暗色覆盖 `body[data-ds-dark-theme]` 也不是只在 `base.css` 里，而是分散在 `design-platform.css`、`onboarding.css`、`gradient-shadow-text.css`、`shiki.css` 等多个 sheet 中。

### 4.2 除 theme 外，其它 `dsh-client-ui-*` 也各自内联自己的 CSS Module

theme 只是其中一个例子。其它 UI 包（chat / conversation / tool / primitives / sidebar-* / …）的 `.module.css` 也走同一套 `\0dsh-css:` 虚拟模块，被内联进各自的 `lib/client.js`，在物化时自注入 `<style data-plugin-css>`。所以一个页面最终会有**很多条**带 `data-plugin-css` 的 `<style>`，每条归某个包所有。

### 4.3 模块系统如何回收这些 `<style>`

`dsh-client-modules` 的浏览器半部有两个配套函数（`lib/client.js`）：

- `claimStyles(id)`：物化一个工厂时，把「工厂执行期间注入的、还没打 `data-plugin` 标记的 `<style>`」认领到该插件名下（`el.setAttribute("data-plugin", id)`），并收集其 `data-plugin-css` 值。
- `removeOwnedStyles(id)`：卸载 / 刷新某插件时，删除所有 `style[data-plugin="<id>"]`。

这套机制让「运行时注入的 CSS」拥有了和插件生命周期一致的清理语义。

---

## 5. 与插件的关系（`dsh-ui-css-patches`）

| | 选择器 | 作用域 | 目的 |
|---|---|---|---|
| **DSH 上游** | 哈希类 + CSS 变量 + `data-*` 状态开关 | 组件局部 + 令牌全局 | 组件自身样式、主题、状态 |
| **插件 dsh-ui-css-patches** | `[data-dockkit-tab][role="tab"]` 复合属性选择器 | 全局属性选择器（受属性限定） | 跨构建稳定锚定 dockkit tab 并覆盖上游 |

`dsh-ui-css-patches` 是统一后的 CSS 补丁插件，合并了原 `dsh-code-card-fonts` / `dsh-rightbar-fonts` / `dsh-rightbar-tab-width` / `dsh-fullwidth-chat` 四组规则。它的关键设计：

1. **只注入一条 `<style data-plugin="dsh-ui-css-patches">`**：规则全部写在一个字符串 `CSS` 里（[`../dsh-ui-css-patches/src/css.ts`](../dsh-ui-css-patches/src/css.ts)），`installStyles` 一次挂载（[`../dsh-ui-css-patches/src/client.ts`](../dsh-ui-css-patches/src/client.ts)）：

   ```ts
   function installStyles(ctx?: ClientContext): void {
     const tag = document.createElement('style')
     tag.dataset.plugin = name
     tag.textContent = CSS
     document.head.appendChild(tag)
     if (typeof ctx?.effect === 'function') {
       ctx.effect(() => () => tag.remove())   // 卸载时清理
     }
   }
   ```

   规则覆盖顺序由 `css.ts` 里的**源码顺序唯一确定**（后写者胜，用于同特异性规则）。

2. **依赖上游 token 的「契约」**：补丁选择器和变量引用都建立在「上游存在这些 `data-*` 属性 + CSS 变量」的前提上。一旦上游改名 / 删 token，补丁会**静默失效**（选择器落空不报错）。为此插件配了构建后静态校验：
   - [`../dsh-ui-css-patches/css-contract.json`](../dsh-ui-css-patches/css-contract.json)：逐条声明「依赖哪个 token（或正则）、去哪几个包的 `lib/` 里找、失效时的后果 hint」。
   - [`../dsh-ui-css-patches/check-css.mjs`](../dsh-ui-css-patches/check-css.mjs)：按清单在上游构建产物里逐个 `grep`，缺失即报错（退出码 1）。
   - `package.json` 的 `build` 脚本是 `tsdown && node check-css.mjs`，即**每次构建后自动校验**；升级上游版本后重跑 `pnpm -r build` 即可发现静默失效。

3. **为什么用复合属性选择器而不是类名**：上游类名带构建哈希（`_tab_6nhg2_134` 每版必变），无法可靠命中；而 `data-dockkit-tab` + `role="tab"` 是稳定的语义锚点，且特异性 `(0,2,0)` 大于上游 `.tab` 的 `(0,1,0)`，因此**无需 `!important` 即可覆盖**（`css.ts` 里的 `[data-dockkit-tab][role="tab"] { box-sizing; min-width: 100px; max-width: 100px }` 即如此）。

4. **其它规则同样只用稳定锚点**：`[data-slot='main.conversation'] [data-conversation-content]`、`[data-textpreview-body]`、`[data-changes-review]`、`[data-document-markdown]`、`[data-chat-flow-kind]`、`[data-turn-trigger]` 等，全部是 `data-*` 属性 + CSS 变量，**不使用** `:nth-child` / `:has()` 这类位置猜测。

---

## 6. 已验证的关键锚点（代码位置清单）

- `dsh-web-frontend/dist/index.html`：静态 `<link>` 两处（`vendor-BNsW4eBh.css`、`index-BPHePDI_.css`）。
- `dsh-web-frontend/dist/assets/index-BPHePDI_.css`：783 个哈希类、33 个 `data-*`、614 处 `var(--…)`。
- `dsh-web-frontend/dist/assets/index-5SrrfWpU.js`：应用外壳 Vite 入口 bundle（含 CSS Module 类名映射对象 `ve`，如 `tab: "_tab_6nhg2_134"`）。
- `@deepseek-ai/dsh-client-ui-theme/lib/client.js`：
  - 2 个 CSS Module sheet（`AppearanceRow.module.css` → `._8HJdBW_*`、`FontSizeRow.module.css` → `.bVCLcG_*`）自注入 + 类名映射；
  - `STYLES`（8 个全局 inline sheet）+ `installThemeStyles()` 挂载；
  - `apply()`：`installThemeStyles` + `new ThemeRuntime` + `ctx.provide("theme", theme)` + 注册两个 settings 行。
- 本仓库 [`../tsdown.client.mjs`](../tsdown.client.mjs)：三个 CSS 虚拟模块（`\0dsh-css:` / `\0dsh-global-css:` / `\0dsh-inline-css:`）、`styleInjectionModule()`、lightningcss `cssModules: { pattern: '[hash]_[local]' }`。
- 本仓库 [`../dsh-ui-css-patches/src/css.ts`](../dsh-ui-css-patches/src/css.ts)、[`../dsh-ui-css-patches/src/client.ts`](../dsh-ui-css-patches/src/client.ts)：插件自己的 `data-*` + CSS 变量规则与注入生命周期。
- 本仓库 [`../dsh-ui-css-patches/css-contract.json`](../dsh-ui-css-patches/css-contract.json) + [`../dsh-ui-css-patches/check-css.mjs`](../dsh-ui-css-patches/check-css.mjs)：构建后契约校验。
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
