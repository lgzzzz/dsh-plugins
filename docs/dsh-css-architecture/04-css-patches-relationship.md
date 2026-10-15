# 与插件 `dsh-ui-css-patches` 的关系

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 4 册：插件用复合属性选择器覆盖上游的条件，以及它的契约校验。

-----

## 5. 与插件的关系（`dsh-ui-css-patches`）

| | 选择器 | 作用域 | 覆盖内容 |
|---|---|---|---|
| **DSH 上游** | 哈希类 + CSS 变量 + `data-*` 状态开关 | 组件局部 + 令牌全局 | 组件自身样式、主题、状态 |
| **插件 dsh-ui-css-patches** | `[data-dockkit-tab][role="tab"]` 复合属性选择器 | 全局属性选择器（受属性限定） | 跨构建稳定锚定 dockkit tab 并覆盖上游 |

`dsh-ui-css-patches` 是一个 CSS 补丁插件，规则覆盖：全宽对话正文、dockkit tab 固定宽度、会话标题栏后台任务菜单的宽度（500px → 548px，命令/输出框保持基线宽度 476px、两侧各留 36px 空隙）与字号（菜单自身与整棵子树，上游 10–12px → 14px）、右栏预览与变更审查的字号 / 行高、卡片内代码块 / 行内代码 / 表格字号、工具卡 / 样例卡的代码块令牌（字号 + 行高）、会话头部与子智能体会话树字号、过程组（`[data-step-process-content]`）成员区整棵子树的字号（`[role="img"]` 图标语义除外，保留上游字号）、改动文件卡片（`[data-changed-files="true"]`）自身与整棵子树的字号（标题 13px / 统计行 10px / 文件名行 11px / 路径与展开按钮 12px → 14px）、侧栏会话行的时间戳字号（10px → 13px）。组内成员的字号全部由过程组那条给出，所以不需要只作用于组内的卡片级规则。关键实现：

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
   - [`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)：逐条声明「依赖哪个 token（或正则）、去哪几个包的 `lib/` 里找、失效时的后果 hint」；带 `forbid` 的条目是反向契约（命中即失败），用于钉住「同样的锚点出现在别处会让选择器撞车」这类退化。
   - [`../../dsh-ui-css-patches/check-css.mjs`](../../dsh-ui-css-patches/check-css.mjs)：按清单在上游构建产物里逐个 `grep`，缺失即报错（退出码 1）。
   - `package.json` 的 `check:css` 脚本是 `node check-css.mjs`：在**构建后**单独跑（`pnpm check:css`），不在 `pnpm build` 里；升级上游版本后重跑一次即可发现静默失效。

3. **复合属性选择器的覆盖条件**：上游类名带构建哈希（`_tab_6nhg2_134` 每版构建都变），无法可靠命中；而 `data-dockkit-tab` + `role="tab"` 是稳定的语义锚点，且特异性 `(0,2,0)` 大于上游 `.tab` 的 `(0,1,0)`，因此**无需 `!important` 即可覆盖**（`css.ts` 里的 `[data-dockkit-tab][role="tab"] { box-sizing; min-width: 100px; max-width: 100px }` 即如此）。

4. **除下面两条受控例外外，其余规则同样只用稳定锚点**：`[data-slot='main.conversation'] [data-conversation-content]`、`[data-textpreview-body]`、`[data-changes-review]`、`[data-document-markdown]`、`[data-chat-flow-kind]`、`[data-step-process-content]`、`[data-turn-trigger]`、`[data-changed-files="true"]` 等，都是 `data-*` 属性 + CSS 变量；子智能体会话树改用 `div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"])` 的 role + `aria-label` 双锚点（中英文界面各一个取值）。除受控例外之一里的那一处 `:has()`（它的选择器参数同样是一个 `aria-label` 锚点）外，所有规则**不使用** `:nth-child` / `:has()` 这类位置猜测。

   `[data-changed-files="true"]` 连取值一起钉住（上游是 React 的布尔属性 `data-changed-files={true}`，渲染成 `="true"`，与卡片自己的 `[data-single=true]` 同一套写法），取值一变选择器就整条落空，由 `changed-files-attr` 契约在构建后校验。卡片内的字号由上游 `ChangedFiles.module.css` 逐个声明（标题 13px、统计行 10px、文件名行 11px、路径与展开按钮 12px），根元素自己没有 `font-size`，所以根元素与后代都要覆盖，并靠 `!important` 取胜——这条规则的后代段与上游 `.…_title` / `.…_row` 特异性同为 `(0,1,0)`，而上游 `<style>` 由模块自注入、挂载顺序不归插件掌握。两个边界：卡片里 500ms 悬停预览的 `HoverCard` 内容 portal 到 `document.body`，不在卡片子树内，这条规则覆盖不到它；卡片折叠只影响渲染的行数与按钮文案，字号不随折叠状态变化。

5. **受控例外之一，后台任务菜单那三条**：菜单 `<ul>` 上没有任何 `data-*`，并且整个菜单是 `createPortal` 到 `document.body` 的 `position:fixed` 浮层，**不是** `[data-slot="conversation.session.header.actions"]` 的后代（锚槽位会整条落空）；锚点落在菜单自身的 `aria-label` 上：`ul[aria-label="后台任务"]` / `ul[aria-label="Background jobs"]`（上游 `t("list.aria")`，中英文各一个取值，元素类型 `ul` 只用来收窄到列表元素），特异性 `(0,1,1)` 大于上游 `.…_menu` 的 `(0,1,0)`。上游 0.2.1-alpha.3 起菜单由共享的 `MenuSurface` 渲染：`<ul>` 只是容器里那个可滚动的 body（`padding:4px`、`overflow:auto`），500px 宽度、`position:fixed` 与 `overflow:hidden` 都落在容器的 `div[data-menu-material="translucent"]` 上，所以**宽度那条锚在容器上**，用 `:has(ul[aria-label=…])` 把同一个 `aria-label` 锚点从子元素翻到父元素（特异性 `(0,2,2)`）。容器上没有能区分出「后台任务菜单」的属性（`data-menu-material` 在所有菜单上都是 `translucent`，类名带构建哈希），而菜单的全部内容仍在这个 `<ul>` 子树里，所以**字号与框宽两条继续锚在 `<ul>` 上，不跟着用 `:has()`**；`:has()` 的参数不带 `>`，上游在容器与 `<ul>` 之间加一层 viewport 包裹时这条规则不必跟着改。同一槽位的 subagent-catalog 与 agent-team 菜单也 portal 到 `body`，但它们渲染的是 `div`；`dsh-client-ui-schedule` 的活动提醒菜单是另一个 portal 到 `body` 的 `<ul>`（文案「活动提醒」/「Active reminders」），由 `jobs-menu-aria-unique` 反向契约兜住。另四点：

   - **加宽必须连 `max-width` 一起覆盖**：只改 `width` 时，菜单宽度仍跟着上游的 `min(560px, 100vw − 32px)` 走，上游调小它就会让菜单缩、两侧空隙静默变小。容器与 `<ul>` 的定位由上游按实测 `offsetWidth` 重算（`menuRef` 指向容器），加宽后 `ResizeObserver` 会把菜单拉回视口内。
   - **命令/输出框保持上游基线宽度**：`[data-terminal]` 上钉 `box-sizing:border-box; width:476px; max-width:100%; margin-left:auto; margin-right:auto`——476px = 菜单 500 − 菜单内边距 2×4 − 面板左右外边距 2×8，菜单比它宽出来的 72px 因此全部变成框两侧的空隙（548 菜单下两侧各 36px = 4 + 8 + 24 居中余量，框仍是 476px、正文仍是 450px）；显式 `border-box` 是因为上游 `.…_block` 是 content-box 且带 12px 左内边距，不写会钉成 490px。
   - **提示行是已知边界**：面板里那句截断提示（「已省略 N 行」/ 输出错误）没有属性锚点、不参与居中，仍留在面板左沿。
   - **菜单自身与整棵子树统一 14px**：`ul[aria-label=…]` 与它的全部后代都写 `font-size: var(--dsh-content-font-size, 14px) !important`——菜单 `<ul>` 自己没有 `font-size`，后代（分组标题 / 停止按钮 / 命令行 / 种类 / 状态 / 时长 / 提示行）各自声明 10–12px，所以根元素与后代都要逐个覆盖，并靠 `!important` 压过后代自己的声明。会话标题栏那一行的 14px 规则覆盖不到 portal 出来的菜单，这条不能省。

   菜单宽度、框宽与字号这三条规则依赖的事实（菜单 `<ul>` 带这两个 `aria-label` 取值、它渲染在 `MenuSurface` 容器内、容器是带 `data-menu-material="translucent"` 的 `div` 且承接上游 `.…_menu` 的 500px 基线、`<ul>` 的内边距恰好 4px、面板外边距恰好 8px、`data-terminal` 存在）由 `jobs-menu-aria-zh` / `jobs-menu-aria-en` / `jobs-menu-aria-unique` / `jobs-menu-inside-surface` / `jobs-menu-surface` / `jobs-menu-surface-attr` / `jobs-menu-width` / `jobs-menu-body-padding` / `jobs-panel-margin` / `jobs-terminal-attr` 十条契约在构建后校验（[`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)）。

6. **受控例外之二，侧栏会话行的时间戳**：时间戳 `<span>` 上没有任何 `data-*`，唯一抓手是上游 CSS Module 的局部类名 `time`——生成名是 `[hash]_[local]`，构建只换 `[hash]` 前缀、`_time` 不变，所以锚在 `[class*="_time"]` 上；行的种类靠 `data-row-key` 取值前缀区分（会话行 `session:<id>`、工作区行 `workspace:<key>`、溢出提示行 `overflow:<key>`、新建会话占位行 `empty`），所以 `[data-row-key^="session:"]` 只命中会话行。这条规则把时间戳固定在 `13px`（上游 10px，行高仍是上游 16px），不引用 `--dsh-content-font-size`；特异性 `(0,2,0)` 大于上游 `._time` 的 `(0,1,0)`，因此不需要 `!important`。行锚点消失、或局部名不再叫 `time` 时整条规则落空、字号退回 10px，由 `session-row-key-anchor` / `session-time-class` 两条契约在构建后校验。
