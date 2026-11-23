# 与插件 `dsh-ui-css-patches` 的关系

> 本文件是 [DSH 组件 CSS 架构](../dsh-css-architecture.md) 的第 4 册：插件用复合属性选择器覆盖上游的条件，以及它的契约校验。

-----

## 5. 与插件的关系（`dsh-ui-css-patches`）

| | 选择器 | 作用域 | 覆盖内容 |
|---|---|---|---|
| **DSH 上游** | 哈希类 + CSS 变量 + `data-*` 状态开关 | 组件局部 + 令牌全局 | 组件自身样式、主题、状态 |
| **插件 dsh-ui-css-patches** | `[data-dockkit-tab][role="tab"]` 复合属性选择器 | 全局属性选择器（受属性限定） | 跨构建稳定锚定 dockkit tab、提问卡片标题栏等上游元素并覆盖其外观 / 命中区 |

`dsh-ui-css-patches` 是一个 CSS 补丁插件，规则覆盖：dockkit tab 固定宽度、后台任务区（`[data-jobs-section]`）自身与整棵子树的字号（上游 10–12px → 14px）、右栏预览（文档预览与计划预览）与变更审查的字号 / 行高、计划预览 Markdown 的代码块 / 行内代码 / 表格字号（11px / 0.875em / 13px → 14px）、计划卡片（`[data-plan-card]`）自身与整棵子树的字号（标题 13px / 描述 10px / 打开按钮 12px → 14px）、卡片内代码块 / 行内代码 / 表格字号、工具卡 / 样例卡的代码块令牌（字号 + 行高）、会话头部与子智能体会话树字号、过程组（`[data-step-process-content]`）成员区整棵子树的字号（`[role="img"]` 图标语义除外，保留上游字号）、过程组展开体（`[data-step-process-body]`）取消上游 `max-height:min(400px,50vh)` + `overflow-y:auto` 的内层滚动限高（全部平铺）、改动文件卡片（`[data-changed-files="true"]`）自身与整棵子树的字号（标题 13px / 统计行 10px / 文件名行 11px / 路径与展开按钮 12px → 14px）、侧栏会话行的时间戳字号（10px → 13px）、提问卡片（`[data-question-key]`）标题栏的折叠热区（24px 箭头按钮 → 整条 `header`，点 eyebrow / 标题 / 空白处都能开合，X 关闭与计时卡的「花点时间」不受影响）、命令结果行（`[data-slot="conversation.chat.commandview"]`，如 `/plan` 的「Plan mode on. Use /plan off to leave.」）标题与摘要的字号（13px → 14px，改的是 `--dsh-content-font-size-secondary` 令牌）、左右栏宽度固定（隐藏 `AppFrame` 的两条列宽拖动柄 `[data-side="sidebar"]` / `[data-side="rightbar"]`，两栏停在默认宽度、不能拖动改宽）、右栏文件列表（workspace navigator）的分隔条隐藏（列表宽度停在默认 260px、指针与键盘都不能再改宽）、主对话正文列宽固定为 `max(640px, 滚动口宽 − 380px)`（面板默认打开时恰好留出停靠所需的 380px，隐藏正文列左右两条宽度拖动把手，宽度不可调整）、会话面板开关隐藏（`[data-session-panel-toggle]` 置 `display:none`，面板在页面存活期间不能被关掉；停靠判定保持上游原样）；浏览器半部另有一条启动期兜底（补写 pinned 偏好、在主对话放得下时点一次开关），见第 13 条。组内成员的字号全部由过程组那条给出，所以不需要只作用于组内的卡片级规则。关键实现：

1. **只注入一条 `<style data-plugin="dsh-ui-css-patches">`**：规则全部写在一个字符串 `CSS` 里（[`../../dsh-ui-css-patches/src/css.ts`](../../dsh-ui-css-patches/src/css.ts)），`installStyles` 一次挂载（[`../../dsh-ui-css-patches/src/client.ts`](../../dsh-ui-css-patches/src/client.ts)）：

   ```ts
   import type { Context } from '@deepseek-ai/cordis'

   function installStyles(ctx?: Context): void {
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

4. **除下面两条受控例外外，其余规则同样只用稳定锚点**：`[data-textpreview-body]`、`[data-changes-review]`、`[data-document-markdown]`、`[data-plan-preview]`、`[data-plan-card]`、`[data-chat-flow-kind]`、`[data-step-process-content]`、`[data-turn-trigger]`、`[data-changed-files="true"]`、`[data-slot="conversation.chat.commandview"]` 等，都是 `data-*` 属性 + CSS 变量；子智能体会话树改用 `div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"])` 的 role + `aria-label` 双锚点（中英文界面各一个取值）。除受控例外之一里的那一处 `:has()`（它的选择器参数同样是一个 `aria-label` 锚点）外，所有规则**不使用** `:nth-child` / `:has()` 这类位置猜测。

   `[data-changed-files="true"]` 连取值一起钉住（上游是 React 的布尔属性 `data-changed-files={true}`，渲染成 `="true"`，与卡片自己的 `[data-single=true]` 同一套写法），取值一变选择器就整条落空，由 `changed-files-attr` 契约在构建后校验。卡片内的字号由上游 `ChangedFiles.module.css` 逐个声明（标题 13px、统计行 10px、文件名行 11px、路径与展开按钮 12px），根元素自己没有 `font-size`，所以根元素与后代都要覆盖，并靠 `!important` 取胜——这条规则的后代段与上游 `.…_title` / `.…_row` 特异性同为 `(0,1,0)`，而上游 `<style>` 由模块自注入、挂载顺序不归插件掌握。两个边界：卡片里 500ms 悬停预览的 `HoverCard` 内容 portal 到 `document.body`，不在卡片子树内，这条规则覆盖不到它；卡片折叠只影响渲染的行数与按钮文案，字号不随折叠状态变化。

   计划预览（`section[data-plan-preview]`）的 Markdown 根节点只有构建哈希类名、没有 `data-*`，计划标题（`aria-label`）又随内容变化，所以锚在 PlanPreview 根 `<section>` 自己的 `data-plan-preview` 上，用它整棵子树承载代码块 / 表格 / 行内代码三条字号覆盖。行内代码那条写成 `section[data-plan-preview] :not(pre) > code`：上游 `.markdown :not(pre) > code` 同为 `!important` 且特异性 `(0,1,2)`，加上元素类型 `section` 后本规则是 `(0,1,3)`，不依赖 `<style>` 的挂载先后。`plan-preview-attr` / `plan-preview-section` 两条契约分别钉住属性与根元素类型。

   计划卡片（`[data-plan-card]`）是对话里的持久计划卡：根 `<button>` 自己没有 `font-size`（上游只写 `font: inherit`），标题 13px / 描述 10px / 打开按钮 12px 都声明在哈希类名上，所以规则同时覆盖根元素与整棵子树，并靠 `!important` 压过后代自己的声明（上游 `<style>` 的挂载顺序不归本插件掌握）。锚点取值是 `plan.callId`、随每次工具调用变化，选择器因此只写属性名、不带取值；`plan-card-attr` 契约钉住它。

5. **受控例外之一，后台任务区**：后台任务区渲染在会话面板的 section 槽位（`conversation.session.panel.section`）里，区块根是 `<ul class="…_list" data-jobs-section>`，宽度由面板给、补丁不介入，只统一字号：`[data-jobs-section]` 与它的全部后代都写 `font-size: var(--dsh-content-font-size, 14px) !important`。区块 `<ul>` 自己没有 `font-size`，后代（分组标题 / 停止按钮 / 命令行 / 种类 / 状态 / 时长 / 提示行）各自声明 10–12px，所以根元素与后代都要逐个覆盖，并靠 `!important` 压过后代自己的声明；面板在右栏里，会话标题栏那一行的 14px 规则覆盖不到它，这条不能省。

   这条规则依赖的事实（区块根 `<ul>` 带 `data-jobs-section`）由 `jobs-section-attr` 契约在构建后校验（[`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)）。

6. **受控例外之二，侧栏会话行的时间戳**：时间戳 `<span>` 上没有任何 `data-*`，唯一抓手是上游 CSS Module 的局部类名 `time`——生成名是 `[hash]_[local]`，构建只换 `[hash]` 前缀、`_time` 不变，所以锚在 `[class*="_time"]` 上；行的种类靠 `data-row-key` 取值前缀区分（会话行 `session:<id>`、工作区行 `workspace:<key>`、溢出提示行 `overflow:<key>`、新建会话占位行 `empty`），所以 `[data-row-key^="session:"]` 只命中会话行。这条规则把时间戳固定在 `13px`（上游 10px，行高仍是上游 16px），不引用 `--dsh-content-font-size`；特异性 `(0,2,0)` 大于上游 `._time` 的 `(0,1,0)`，因此不需要 `!important`。行锚点消失、或局部名不再叫 `time` 时整条规则落空、字号退回 10px，由 `session-row-key-anchor` / `session-time-class` 两条契约在构建后校验。


7. **过程组展开体：取消内层滚动限高**：上游 `ChatGroupSeat` 在组根 `[data-step-process]` 下直接渲染滚动体 `[data-step-process-body]`，其 `.…_body` 上是 `max-height:min(400px,50vh)` + `overflow-y:auto` + `scrollbar-gutter:stable`；只有 `grouped === false`（「完全展开」，或详细模式下轮次仍处于打开状态 / 延迟收起）时才追加 `.…_expandedBody { scrollbar-gutter:auto; max-height:none; overflow:visible }`。插件用 `[data-step-process] > [data-step-process-body]` 把这三条声明钉到组根的滚动体上，让详细 / 标准 / 简洁模式下展开的过程组也全部平铺；特异性 `(0,2,0)` 大于上游 `(0,1,0)`，不需要 `!important`。上游 DOM 没有把「工作步骤展示」模式写成属性（`transcriptView` 只存在于设置数据），所以规则不区分模式；已经处于 `expandedBody` 状态的组本来就没有限高，规则幂等。限高去掉后 body 不再垂直溢出，上游 `useProcessScroll` 的 `ResizeObserver` 会把 `data-scroll-up` / `data-scroll-down` 与淡出类清掉；展开 / 收起动画期间上游 inline `overflow` / `height` 优先，本规则不干扰。工具详情卡、命令输出、代码块等其它内层滚动口不在本规则范围内。`step-process-root` / `step-process-body-attr` 两条契约钉住组根与滚动体标记。

8. **提问卡片折叠热区：只放大命中区，不改组件**：`ask_user_question` 的 composer 顶替卡片在根 `[data-question-key]` 下渲染 `section > header`；header 里只有右侧 24px 的 `iconButton`（带 `aria-expanded`）绑了开合 `onClick`，eyebrow / 标题 / 空白处都不响应点击。插件把 header 设为定位祖先、把该按钮钉成 `position:static`，再给按钮挂一个 `position:absolute; inset:0` 的透明 `::after`：伪元素属于按钮本身，命中即派发按钮自己的 click，React 的 `setMinimized` 照旧翻转，按钮的图标 / `aria-label` / `aria-expanded` / 键盘焦点 / 禁用态都不变。header 里其余按钮（X 关闭、计时卡的「花点时间」）用 `position:relative; z-index:1` 抬到伪元素之上，关闭与继续等待先收到点击；没有交互的状态文字留在伪元素下面，点它同样开合。规则只锚 `[data-question-key]`（plan-review 卡片是 `[data-plan-review-key]` 且没有折叠按钮，不在范围；已定局回复气泡的 toggle 本来就是整宽），不会误伤其它卡片。代价是标题文字被伪元素覆盖、鼠标不能再选中 / 复制；悬停整条 header 会触发箭头按钮的 `:hover` 与 `title` 提示（这正是「整条 header 即按钮」的反馈）；计时卡上点 header 会让答案输入框失焦、倒计时恢复，与今天点箭头按钮完全一致。四条规则都不需要 `!important`：`[data-question-key] > section > header` / `... header button[aria-expanded]` 的特异性高于上游 `.…_header` / `.…_iconButton`。上游改结构 / 去掉属性时规则整条落空，由 `question-key-attr` / `question-header-structure` / `question-collapse-expanded` 三条契约在构建后报失效；另有一个已知边界：若上游把 `headerActions` 或别的中间层改成定位元素，伪元素的包含块会缩小到那一层、热区随之变小，当前 `header` 与 `headerActions` 都没有定位，按钮自身由本规则显式钉成 `static`。

9. **命令结果行：改次要字号令牌，让标题与摘要一起 14px**：斜杠命令在消息流里渲染成一行结果（`/plan` 的「Plan mode on. Use /plan off to leave.」就是这一行），`CommandNodeView` 把它渲染进 `[data-slot="conversation.chat.commandview"]` 槽位。行内两段文字各自声明字号：标题来自 DisclosureRow 原语的 `._…title`，摘要来自 GenericCommandCard 的 `._…summary`，两者都取 `--dsh-content-font-size-secondary`——该令牌在 `body` 上由主题算成 `min(主字号 − 1px, max(13px, 主字号 − 2px))`，默认主字号 14px 时即 13px。插件在槽位包装上把该令牌改成主字号（`var(--dsh-content-font-size, 14px)`）：两段文字一起跟随，展开体 `<pre>` 走的是代码字体令牌、不受影响；槽位包装是 `display:contents`、不生成盒子，自定义属性照常继承；改的是变量而不是 `font-size`，因此不需要 `!important`，也不与上游 `._…title` / `._…summary` 的特异性竞争。规则对整个槽位生效：所有斜杠命令的结果行走同一个槽位，各命令注册的自定义视图也在其中，它们的次要字号一并变成主字号。槽位键消失、或两段文字改用别的令牌时规则静默失效，由 `commandview-slot` / `commandview-summary-token` / `commandview-title-token` 三条契约在构建后报失效。

10. **左右栏宽度固定在默认值，拖动改宽被移除**：两栏的宽度偏好只由 `AppFrame` 的两条拖动柄写入——8px 宽、无可见样式的绝对定位条（上游注释明说「No handle draws a visible pill」），只带 `data-side="sidebar"` / `data-side="rightbar"`，各自由 pointer 手势调 `setSidebar` / `setRightbar`（左栏默认 `SIDEBAR_DEFAULT = 280`，右栏首次打开时 `viewport × 0.45`、下限 300px、上限 70%）。插件把这两种取值的柄 `display:none !important` 掉，宽度偏好再无写入者，两栏停在默认值：左栏 280px（收起后的 56px 图标轨道、窄屏覆盖抽屉、折叠屏居中侧栏都由 `AppFrame` 的渲染条件与 `data-*` 开关决定，不经过拖动柄），右栏保持上游首次打开算出的 45% 宽、窗口收窄时仍按上游让位规则收缩。`toggleSidebar` 只写 0 或 280，不是拖动改宽，收起 / 展开照常可用。`data-side` 在别处还有取值（tooltip / popover 的 `left|right|top|bottom`、对话宽度柄 `ConversationWidthControls` 的 `left|right`），都不叫 `sidebar` / `rightbar`，不会撞车；柄只在可拖的状态下挂载（左栏收起 / 抽屉 / 折叠屏居中没有左柄，右栏折叠 / 全屏没有右柄）。上游 `.…_handle` 没有声明 `display`，本规则与它特异性同为 `(0,1,0)`，`!important` 只为不被模块样式重挂时的顺序翻盘。柄上的 `data-side` 属性或侧别取值改名时规则整条落空、两栏恢复可拖动，由 `layout-drag-handle` / `layout-handle-side-values` 两条契约在构建后校验（[`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)）。实测（headless Chrome，1600px 视口）：右栏关闭时轨道 `280px 1320px 0px`、打开后 `280px 600px 720px`；在左列边框拖 +100px、右栏左边界拖 −120px，轨道都不变。

11. **右栏文件列表宽度固定，拖动分隔条被隐藏**：右栏 Sidebar 里预览文件时，文件列表（workspace navigator）的宽度偏好只有一个写入者——它左缘那条 8px 宽、`left:-4px` 的绝对定位分隔条（类 `css.separator`，`cursor:col-resize`），带 `role="separator"`、`aria-valuemin/max/now` 与稳定的 `data-files-navigator-resize`；指针拖动、方向键 ±20px、Home（最窄）/ End（最宽）都挂在这条分隔条自己的事件上，最终调 `actions.resized(paneId, width)`。插件把 `[data-files-navigator-resize]` 置为 `display:none !important`，指针与键盘两个入口一起失效，宽度偏好再无写入者，列表停在上游 `DEFAULT_NAVIGATOR_WIDTH = 260` 的默认值。分隔条只在「预览旁」的 `push` / `overlay` 两种布局渲染，铺满的 `fill`、`files` 页（`wholePage`）与 <768px 全屏视口本来就没有它，规则在这些状态下无事可做。本规则只拿掉调节入口，不碰 aside 上内联的 `--files-navigator-width`，所以窄行仍按上游 `navigatorGeometry` 收缩（并排 ≥560px 时至多行宽 − 336px、悬浮 400–560px 时至多行宽 − 120px、更窄时铺满），文件列表不会在窄窗口里撑破行。上游 `._separator` 没声明 `display`，本选择器与它特异性同为 `(0,1,0)`，`!important` 只为不被模块样式重挂时的顺序翻盘。属性改名或分隔条改挂到导航栏外时规则整条落空、列表恢复可拖动，由 `files-navigator-resize-attr` 契约在构建后校验（[`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)）。

12. **主对话正文列宽固定，宽度手柄被隐藏**：正文宽度轴由 `ConversationWidthControls` 用内联样式持续重写 `--dsh-chat-user-width`，最终消费点是 `--dsh-chat-content-width-resolved`（同时是末端预留公式的输入）与别名 `--dsh-chat-content-width`；左右两条 10px 的 `[data-width-handle]` 条是唯一的拖动入口。插件把两个宽度变量固定在 `max(640px, calc(var(--dsh-conversation-viewport-width) - 380px))`，并隐藏手柄。`380 = 40（面板与正文净空）+ 8（面板距 Chat 末端边缘）+ 300（面板最小宽）+ 32（起始安全区）`，恰好是会话面板停靠所需的最小尾部余量：`V − 正文宽 = 380` 时 `--dsh-chat-end-reserve-max` 正好 348px，停靠探针的 `reserve-room` 步进在边界上回报 1px，面板默认（`pinned = true`）直接以 `docked` 出现；面板隐藏（历史偏好 `pinned = false`）时宽度不变、余量仍在，恢复打开也直接停靠，没有先开浮层再自动关闭的闪烁。宽度规则与面板状态无关，因此不会振荡。作用域限定 `[data-slot="main.conversation"]`，嵌入的侧边对话（`.embeddedBody`）保持自己的宽度与把手；`V` 是滚动口 `clientWidth`，计数包含末端预留的 padding，让位不会改变它。`V < 1020px` 时 `max()` 取 640px（与上游 `CONTENT_MIN` 一致），尾部余量不足 380，面板回到上游的 `hidden`（第 13 条隐藏了开关，浮层入口不再暴露给用户），窗口重新变宽、余量回到 380 后自动恢复 `docked`。两条规则用 `!important` 压过内联与模块样式（上游 `.widthHandle` 没有声明 `display`，隐藏规则的特异性已更高，`!important` 只为不被模块样式重新挂载的顺序翻盘）。实测（headless Chrome，1600×1000 视口，侧栏 280px）：V=1313、正文宽 933px、`--dsh-chat-end-inset=316px`、面板 `docked` 300px、探针 1px、间隔 40px；关闭后正文仍 933px，再打开直接停靠；1000×900 时正文 640px、面板 `hidden`（开关原本可开 280px 浮层；第 13 条隐藏开关后这个入口不再暴露）；hero 与轨迹视图也走同一宽度轴。边界：面板关闭时正文不扩宽，宽屏正文可远超上游 880px，打开面板时起始留白固定 32px、面板固定 300px。上游 40/8/300、`reserve-room` 步进、探针 `>= 1px` 判定、两个宽度变量或默认 `pinned` 改名/改值时规则静默退化，由 `main-slot` / `content-attr` / `width-handle-attr` / `viewport-width-var` / `viewport-width-published` / `resolved-width-declared` / `content-width-alias` / `content-min` / `panel-clear` / `panel-edge` / `panel-min-width` / `composer-side-clearance` / `reserve-rule` / `reserve-max-formula` / `reserve-room-step` / `probe-measure` / `presentation-docked` / `pinned-default` 18 条契约在构建后校验（[`../../dsh-ui-css-patches/css-contract.json`](../../dsh-ui-css-patches/css-contract.json)）。

13. **会话面板常开：开关隐藏 + 启动期补写 pinned 偏好**：会话面板的显示只由两条上游事实决定——`localStorage['dsh.sessionPanel.pinned']`（默认 `true`）与停靠探针的实测宽度。`presentationOf` 的规则是「探针 ≥ 1px 且 pinned → `docked`；探针 ≥ 1px 且未 pinned → `hidden`；探针 < 1px → 只有该会话的浮层」。插件只改「谁来写 pinned」这一侧：`[data-session-panel-toggle] { display: none !important }` 把标题栏最左侧的开关隐藏——它是唯一能写 `pinned = false` 的入口，隐藏之后面板在页面存活期间不会再被关掉。**停靠条件保持上游原样**：探针仍由「尾部留白是否够 348px」或 `reserve-room` 决定，正文宽固定在 `V − 380` 时宽窗口恰好 1px、面板 `docked`；`V < 1020px` 时正文停在 640px 下限，探针为 0，面板按上游规则 `hidden`（开关已隐藏，用户不再有手动开浮层的入口），窗口重新变宽后自动恢复 `docked`。这保留了窄窗口的旧行为，不做任何布局或判定改写。

    浏览器半部另有一条启动期兜底（[`../../dsh-ui-css-patches/src/pin.ts`](../../dsh-ui-css-patches/src/pin.ts)，由 `client.ts` 在挂载样式后安装）：升级前手动关过面板的浏览器里，存储里已经是 `false`，而开关刚被隐藏、页面上没有恢复入口。兜底先在该键不是 `true` 时补写 `true`（下次加载起一定按 `pinned = true` 判定），再在页面里巡查——探针带 `data-session-panel-reserve` 即已钉住，立即停止；否则只在**主对话的停靠探针量到 ≥ 1px**（与上游 `ResizeObserver` 读的是同一个尺寸）且开关 `aria-expanded="false"`、未 `aria-disabled` 时派发一次 `click`。放得下时这一次点击只会把 `pinned` 从 `false` 翻成 `true`；放不下时不点，面板保持上游的 `hidden`，绝不会用点击打开浮层。点击间隔有 700ms 冷却，默认最多巡查 40 轮（约 4.8s）；非 Chat 视图、禁用态与已展开（浮层）时不点。巡查只读 `aria-*` 与 `data-*`，不碰 React 内部。

    相关契约：`session-panel-toggle-attr` / `session-panel-toggle-expanded` / `session-panel-toggle-disabled` 钉住开关的 `data-*` 与两个 `aria-*`，`session-panel-probe-attr` 钉住兜底读取的探针锚点，`session-panel-reserve-attr` 钉住「已钉住」信号，`pinned-storage-key` 钉住存储键；探针 `>= 1px` 的判定本身沿用既有的 `probe-measure` 契约。已知边界：窄窗口下面板按上游 `hidden` 并随窗口变宽自动恢复；当前页面里若面板被历史偏好关掉、窗口又一直窄于停靠阈值，则要等窗口变宽或下次加载后才会恢复。
