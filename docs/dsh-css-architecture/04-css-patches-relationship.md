# 与插件 `dsh-ui-css-patches` 的关系

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 4 册：插件用复合属性选择器覆盖上游的条件，以及它的契约校验。

-----

## 5. 与插件的关系（`dsh-ui-css-patches`）

| | 选择器 | 作用域 | 覆盖内容 |
|---|---|---|---|
| **DSH 上游** | 哈希类 + CSS 变量 + `data-*` 状态开关 | 组件局部 + 令牌全局 | 组件自身样式、主题、状态 |
| **插件 dsh-ui-css-patches** | `[data-dockkit-tab][role="tab"]` 复合属性选择器 | 全局属性选择器（受属性限定） | 跨构建稳定锚定 dockkit tab 并覆盖上游 |

`dsh-ui-css-patches` 是一个 CSS 补丁插件，规则覆盖：全宽对话正文、dockkit tab 固定宽度、会话标题栏后台任务菜单的宽度（500px → 548px，命令/输出框保持基线宽度 478px、两侧各留 35px 空隙）、右栏预览与变更审查的字号 / 行高、对话卡片（披露行 / 样例卡 / 压缩卡 / 工具卡 / 工具详情卡 / 表格 / 代码块）字号、会话头部与子智能体会话树字号。关键实现：

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
   - `package.json` 的 `check:css` 脚本是 `node check-css.mjs`：在**构建后**单独跑（`pnpm check:css`），不在 `pnpm build` 里；升级上游版本后重跑一次即可发现静默失效。

3. **复合属性选择器的覆盖条件**：上游类名带构建哈希（`_tab_6nhg2_134` 每版构建都变），无法可靠命中；而 `data-dockkit-tab` + `role="tab"` 是稳定的语义锚点，且特异性 `(0,2,0)` 大于上游 `.tab` 的 `(0,1,0)`，因此**无需 `!important` 即可覆盖**（`css.ts` 里的 `[data-dockkit-tab][role="tab"] { box-sizing; min-width: 100px; max-width: 100px }` 即如此）。

4. **其它规则同样只用稳定锚点**：`[data-slot='main.conversation'] [data-conversation-content]`、`[data-textpreview-body]`、`[data-changes-review]`、`[data-document-markdown]`、`[data-chat-flow-kind]`、`[data-turn-trigger]`、工具详情卡的 `[data-inspect]` / `[data-caption]` 等，都是 `data-*` 属性 + CSS 变量；子智能体会话树改用 `div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"])` 的 role + `aria-label` 双锚点（中英文界面各一个取值）。所有规则**不使用** `:nth-child` / `:has()` 这类位置猜测。

5. **后台任务菜单那两条是一个受控例外**：菜单 `<ul>` 上没有任何 `data-*`，且它是 `[data-slot="conversation.session.header.actions"]` 里唯一内联渲染的 `ul`（该槽其余注册项里，agent-preset 的标签只渲染 `span`，subagent-catalog 与 agent-team 的菜单 portal 到 `document.body`），所以宽度规则锚在 `[data-slot="conversation.session.header.actions"] ul` 上（属性 + 类型，特异性 `(0,1,1)` 大于上游 `.…_menu` 的 `(0,1,0)`）。另两点：

   - **加宽必须连 `max-width` 一起覆盖**：只改 `width` 时，菜单宽度仍跟着上游的 `min(560px, 100vw − 32px)` 走，上游调小它就会让菜单缩、两侧空隙静默变小。
   - **命令/输出框保持上游基线宽度**：`[data-terminal]` 上钉 `box-sizing:border-box; width:478px; max-width:100%; margin-left:auto; margin-right:auto`——478px = 菜单 500 − 菜单内边距 2×3 − 面板左右外边距 2×8，菜单比它宽出来的 70px 因此全部变成框两侧的空隙（548 菜单下两侧各 35px = 3 + 8 + 24 居中余量，框仍是 478px、正文仍是 452px）；显式 `border-box` 是因为上游 `.…_block` 是 content-box 且带 12px 左内边距，不写会钉成 490px。
   - **提示行是已知边界**：面板里那句截断提示（「已省略 N 行」/ 输出错误）没有属性锚点、不参与居中，仍留在面板左沿。

   菜单宽度与框宽这两条规则依赖的事实（`<ul>` 是菜单、上游 500px 基线、面板外边距恰好 8px、`data-terminal` 存在）由 `jobs-menu-element` / `jobs-menu-width` / `jobs-panel-margin` / `jobs-terminal-attr` 四条契约在构建后校验（[`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)）。
