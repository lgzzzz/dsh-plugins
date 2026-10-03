# 全局生效还是组件局部生效

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 3 册：作用域差异、设计令牌的完整定义位置、模块系统如何回收 `<style>`。

## 4. 全局生效，还是组件局部生效？

三类 CSS 都进了 `document.head`，在「级联」意义上都是全局的，但**作用域**不同：

| 类型 | 注册位置 | 作用域 | 说明 |
|---|---|---|---|
| **CSS Modules 组件样式** | `<link>`（外壳）或运行时 `<style>`（插件） | **组件局部**（等效） | 规则用唯一哈希类名选择器，只命中自己组件的元素 |
| **设计令牌（CSS 变量）** | 运行时 `<style>`（theme 包的全局 sheet） | **全局** | 定义在 `:root`、`body`，沿 DOM 级联，供所有组件消费 |
| **`data-*` 选择器** | 随组件 CSS 一起 | 全局属性选择器，但**受属性限定** | `[data-pinned]` 能匹配文档任意位置，但只命中带该属性的元素，等效局部 |

### 4.1 设计令牌的定义位置

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

theme 包的 CSS 注入合计 **2 个 CSS Module sheet（自注入）+ 8 个全局 inline sheet（`apply()` 里挂载）**；暗色覆盖 `body[data-ds-dark-theme]` 分散在 `design-platform.css`、`onboarding.css`、`gradient-shadow-text.css`、`shiki.css` 等多个 sheet 中。

### 4.2 除 theme 外，其它 `dsh-client-ui-*` 也各自内联自己的 CSS Module

其它 UI 包（chat / conversation / tool / primitives / sidebar-* / …）的 `.module.css` 也走同一套 `\0dsh-css:` 虚拟模块，被内联进各自的 `lib/client.js`，在物化时自注入 `<style data-plugin-css>`。所以一个页面最终会有**很多条**带 `data-plugin-css` 的 `<style>`，每条归某个包所有。

### 4.3 模块系统如何回收这些 `<style>`

`dsh-client-modules` 的浏览器半部有两个配套函数（`lib/client.js`）：

- `claimStyles(id)`：物化一个工厂时，把「工厂执行期间注入的、还没打 `data-plugin` 标记的 `<style>`」认领到该插件名下（`el.setAttribute("data-plugin", id)`），并收集其 `data-plugin-css` 值。
- `removeOwnedStyles(id)`：卸载 / 刷新某插件时，删除所有 `style[data-plugin="<id>"]`。

于是运行时注入的 CSS 拥有与插件生命周期一致的清理语义。
