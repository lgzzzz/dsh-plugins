# 与插件 `dsh-ui-css-patches` 的关系

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 4 册：插件用复合属性选择器覆盖上游的条件，以及它的契约校验。

## 5. 与插件的关系（`dsh-ui-css-patches`）

| | 选择器 | 作用域 | 覆盖内容 |
|---|---|---|---|
| **DSH 上游** | 哈希类 + CSS 变量 + `data-*` 状态开关 | 组件局部 + 令牌全局 | 组件自身样式、主题、状态 |
| **插件 dsh-ui-css-patches** | `[data-dockkit-tab][role="tab"]` 复合属性选择器 | 全局属性选择器（受属性限定） | 跨构建稳定锚定 dockkit tab 并覆盖上游 |

`dsh-ui-css-patches` 是一个 CSS 补丁插件，规则覆盖四组：全宽对话正文、dockkit tab 固定宽度、右栏预览与变更审查字号、对话卡片标题 / 摘要 / 正文 / 代码 / 表格字号。关键实现：

1. **只注入一条 `<style data-plugin="dsh-ui-css-patches">`**：规则全部写在一个字符串 `CSS` 里（[`../../dsh-ui-css-patches/src/css.ts`](../../dsh-ui-css-patches/src/css.ts)），`installStyles` 一次挂载（[`../../dsh-ui-css-patches/src/client.ts`](../../dsh-ui-css-patches/src/client.ts)）：

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

2. **依赖上游 token 的「契约」**：补丁选择器和变量引用都建立在「上游存在这些 `data-*` 属性 + CSS 变量」的前提上。一旦上游改名 / 删 token，补丁会**静默失效**（选择器落空不报错）。插件配了构建后静态校验：
   - [`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)：逐条声明「依赖哪个 token（或正则）、去哪几个包的 `lib/` 里找、失效时的后果 hint」。
   - [`../../dsh-ui-css-patches/check-css.mjs`](../../dsh-ui-css-patches/check-css.mjs)：按清单在上游构建产物里逐个 `grep`，缺失即报错（退出码 1）。
   - `package.json` 的 `build` 脚本是 `tsdown && node check-css.mjs`，即**每次构建后自动校验**；升级上游版本后重跑 `pnpm -r build` 即可发现静默失效。

3. **复合属性选择器的覆盖条件**：上游类名带构建哈希（`_tab_6nhg2_134` 每版构建都变），无法可靠命中；而 `data-dockkit-tab` + `role="tab"` 是稳定的语义锚点，且特异性 `(0,2,0)` 大于上游 `.tab` 的 `(0,1,0)`，因此**无需 `!important` 即可覆盖**（`css.ts` 里的 `[data-dockkit-tab][role="tab"] { box-sizing; min-width: 100px; max-width: 100px }` 即如此）。

4. **其它规则同样只用稳定锚点**：`[data-slot='main.conversation'] [data-conversation-content]`、`[data-textpreview-body]`、`[data-changes-review]`、`[data-document-markdown]`、`[data-chat-flow-kind]`、`[data-turn-trigger]` 等，全部是 `data-*` 属性 + CSS 变量，**不使用** `:nth-child` / `:has()` 这类位置猜测。
