/**
 * `dsh-ui-css-patches` 的全部补丁规则,由 `client.ts` 挂成一条 `<style>`。
 *
 * 同特异性规则的覆盖顺序由本文件的源码顺序唯一确定(后写者胜);锚点是稳定的 `data-*` / `role` /
 * `aria-label`。两处例外:
 *   - 后台任务菜单那三条锚在菜单自身 `aria-label` 上(中英文各一个取值),并额外用元素类型 `ul` 收窄:
 *     菜单 `<ul>` 上没有任何 `data-*`,而整个菜单由 `createPortal` 渲染到 `document.body`、定位是
 *     `position:fixed` —— 不是 `[data-slot="conversation.session.header.actions"]` 的后代,按槽位锚定
 *     会整条落空(上游的 `useAnchoredPosition` 会按实测 `offsetWidth` 重算 `left`,所以 portal 不影响
 *     加宽后的回拉)。其中宽度那条用 `:has()` 把同一个 `aria-label` 锚点从 `<ul>` 翻到外层菜单容器上
 *     (上游 0.2.1-alpha.3 起菜单由共享的 `MenuSurface` 渲染,宽度与 `position:fixed` 都落在容器
 *     `div[data-menu-material="translucent"]` 上,`<ul>` 只是容器里可滚动的 body);这是本文件唯一一处
 *     `:has()`,选择器参数仍是那个 `aria-label`,不是 `:nth-child` 那类位置猜测。`dsh-client-ui-schedule`
 *     的活动提醒菜单是另一个 portal 到 body 的 `<ul>`,文案不同,由 css-contract.json 的
 *     jobs-menu-aria-unique 反向契约兜住。框(终端卡)的宽度钉在上游基线 476px 上并居中:父面板没有
 *     属性锚点,所以这条约定放在框自身上(见该处注释)。
 *   - 侧栏会话行的时间戳额外用了 CSS Module 的局部类名通配符(见该处注释)。
 *
 * 锚点与令牌清单、以及构建后校验见 docs/dsh-css-architecture/04-css-patches-relationship.md。
 */
export const CSS = `
/* 对话正文撑满可用宽度 */
[data-slot='main.conversation'] [data-conversation-content] {
  --dsh-chat-content-width: 100%;
}

/* 右栏 tab 固定 100px 宽 */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: 100px;
  max-width: 100px;
}

/* 右栏预览正文跟随应用字号（默认 14px），代码块同样 14px */
[data-textpreview-body] {
  font-size: var(--dsh-content-font-size, 14px) !important;
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 变更审查代码块字体 14px */
[data-changes-review] {
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 变更审查 diff 行高 22px（随 --dsh-content-font-delta 缩放） */
[data-changes-review] [data-diff-line] {
  min-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
  line-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
}

/* 文档表格 / 表头 14px，代码块 14px */
[data-document-markdown] {
  --dsw-font-markdown-table: var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-table-head: 500 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 文档行内代码跟随正文 1em */
[data-textpreview-body] [data-document-markdown] :not(pre) > code {
  font-size: 1em !important;
}

/* 计划预览（右栏 PlanPreview）的 Markdown 正文与文档预览同一套字号：代码块 14px / 22px
   （上游 11px / 19px）、表格与表头 14px / 22px（上游 13px / 22px）、行内代码 1em
   （上游 .875em，即 12.25px）。PlanPreview 的 Markdown 根节点是只有构建哈希类名的
   <div class="_markdown_…">，没有 data-*；aria-label 是计划标题、随内容变化，也不能当锚点，
   所以锚在本节自己的 data-plan-preview 上。行内代码那条用元素类型 section 把特异性提到 (0,1,3)：
   上游 .markdown :not(pre) > code 是 (0,1,2) 且同样带 !important，仅靠源码顺序在模块样式
   后注入时会失效；section 是上游渲染的根元素类型，不是位置猜测，由 css-contract.json 的
   plan-preview-section 钉住。代码块与表格只改令牌、不碰 pre / table 元素：上游分别经
   --dsl-code-block-content-font 与 font: var(--dsw-font-markdown-table[-head]) 消费这三个令牌。 */
section[data-plan-preview] {
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
  --dsw-font-markdown-table: var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-table-head: 500 var(--dsh-content-font-size, 14px) / calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
}

section[data-plan-preview] :not(pre) > code {
  font-size: 1em !important;
}

/* 计划卡片（对话里的持久计划卡，data-plan-card）自身与整棵子树 14px。
   卡片根元素没有 font-size（上游只写 font: inherit），标题 13px、描述 10px、打开按钮 12px
   各自声明在哈希类名上；根元素与后代都要覆盖，并靠 !important 压过后代自己的声明
   （上游 <style> 由模块自注入、挂载顺序不归本插件掌握）。
   锚在 data-plan-card 上：取值是 plan.callId，随每次工具调用变化，所以选择器不带取值；
   属性名稳定，与 data-plan-artifacts / data-plan-preview 是同一套命名。 */
[data-plan-card],
[data-plan-card] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 卡片内代码块 14px */
[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 卡片内行内代码 14px */
[data-chat-flow-kind] :not(pre) > code {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 卡片内表格 14px */
[data-chat-flow-kind] table th,
[data-chat-flow-kind] table td {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 工具卡 / 样例卡代码块与小号代码 14px */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 2px) var(--ds-font-family-code);
  --dsw-font-markdown-code-block: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 5px) var(--ds-font-family-code);
}

/* 样例卡后续内容代码块与小号代码 14px */
[data-sample] + * {
  --dsw-font-markdown-code-block-small: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 2px) var(--ds-font-family-code);
  --dsw-font-markdown-code-block: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 5px) var(--ds-font-family-code);
}

/* 触发条标题固定 14px */
[data-turn-trigger] > button {
  --dsh-content-font-size: var(--dsh-content-font-size, 14px);
}

/* 触发条展开体正文 14px / 21px */
[data-turn-trigger] > div {
  --dsw-font-xxs-12: var(--dsh-content-font-size, 14px)/calc(var(--dsh-content-font-size, 14px) + 7px) var(--dsw-font-family);
}

/* 会话标题栏(动作图标那一行)整行 14px */
[data-slot="conversation.session.header"] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 后台任务菜单加宽 500px → 548px(= 框 476 + 两侧空隙 2×36,见下一条)。
   菜单 <ul> 上没有任何 data-*,而整个菜单是 createPortal 到 document.body 的 position:fixed 浮层,
   不在 header.actions 槽的子树里,所以锚在菜单自身的 aria-label 上(t("list.aria"),中英文两个取值);
   ul 只用来收窄到列表元素。
   上游 0.2.1-alpha.3 起菜单由共享的 MenuSurface 渲染:<ul> 只是容器里那个可滚动的 body
   (padding 4px / gap / overflow),500px 宽度、position:fixed 与 overflow:hidden 都在容器的
   div[data-menu-material="translucent"] 上 —— 宽度钉在 <ul> 上只会撑宽内层、被容器的 overflow:hidden
   裁掉,菜单外框仍是 500px。容器上没有能区分出「后台任务菜单」的属性(所有菜单的 data-menu-material
   都是 translucent,类名带构建哈希),而菜单的全部内容仍在这个 <ul> 子树里,所以宽度经 :has() 锚到
   「内含该 <ul> 的容器」上:锚点与关系都是语义的,不用类名通配符、也不数元素位置。
   :has() 的参数不带 >,上游在容器与 <ul> 之间加一层 viewport 包裹时这条规则不必跟着改。
   上游是 width:500px + max-width:min(560px,100vw - 32px):max-width 也一并覆盖,菜单宽度才不跟着
   上游那个上限走(上游调小它时,菜单会跟着缩、空隙静默变小)。
   菜单的 left/top 由上游按实测 offsetWidth 算(menuRef 指向容器),加宽后它经 ResizeObserver
   重算,仍会把菜单拉回视口内 */
div[data-menu-material="translucent"]:has(ul[aria-label="后台任务"]),
div[data-menu-material="translucent"]:has(ul[aria-label="Background jobs"]) {
  width: 548px;
  max-width: min(548px, 100vw - 32px);
}

/* 命令 + 实时输出那个框保持上游基线宽度 476px(= 菜单 500 − 菜单内边距 2×4 − 面板左右外边距 2×8),
   菜单比它宽出来的 72px 全变成两侧空隙:548 菜单下 = 4 + 8 + 24 居中余量 = 36,由 margin:auto 对称。
   上游 .…_block 是 content-box 且带 12px 左内边距,不写 box-sizing 会变成 490px,故显式声明 border-box;
   max-width:100% 兜住窄窗口(菜单被 min(548px,100vw - 32px) 收窄时框跟着收窄,不溢出面板)。
   476 / 548 / 36 互相推导,依赖上游的 500 菜单、4px 菜单内边距与 8px 面板外边距 —— css-contract.json 的
   jobs-menu-width / jobs-menu-body-padding / jobs-panel-margin 负责让构建失败。面板里的提示行
   (「已省略 N 行」/输出错误)没有属性锚点、不参与居中 */
ul[aria-label="后台任务"] [data-terminal],
ul[aria-label="Background jobs"] [data-terminal] {
  box-sizing: border-box;
  width: 476px;
  max-width: 100%;
  margin-left: auto;
  margin-right: auto;
}

/* 后台任务菜单自身与整棵子树 14px(默认 14px,跟随 --dsh-content-font-size)。
   菜单里的分组标题 / 停止按钮 / 命令行 / 种类 / 状态 / 时长 / 提示行各自声明了 10–12px,
   菜单 <ul> 自己反而没有 font-size,所以根元素与后代都要显式覆盖,且要 !important 压过后代声明。
   这条不能省:菜单由 createPortal 挂到 document.body,不在会话标题栏那一行里,
   [data-slot="conversation.session.header"] * 那条 14px 覆盖不到它。
   锚点仍是菜单自身的 aria-label(中英文两个取值),ul 只用来收窄到列表元素。字号不受容器换代影响:
   MenuSurface 只搬走了宽度与定位,菜单里的全部内容都还在这个 <ul> 子树里,所以这条不跟着用 :has()。 */
ul[aria-label="后台任务"],
ul[aria-label="Background jobs"],
ul[aria-label="后台任务"] *,
ul[aria-label="Background jobs"] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 子智能体会话树（role="tree" 精确锚点）自身与子元素 14px */
div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"]),
div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"]) * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 过程组（data-step-process）的成员区整棵子树 14px：组成员（思考 / 工具卡 / 回复）都渲染在
   [data-step-process-content] 下；它自己在上游没有任何 font-size 声明（上游 .…_content 只声明
   display / flex-direction），字号靠继承，成员内部又会各自声明更小的字号。
   这条规则的 !important 用来压过后代自己声明的小字号，覆盖的是组内每个元素的 font-size：组内成员的
   字号（披露行 / 样例卡 / 压缩卡标题与摘要、展开体正文、compact markdown 正文、工具详情卡整块）全部
   由它给出，文件里因此没有只作用于组内的卡片级字号规则。两处例外由本文件的其它规则负责：
     - 组内行内 code：上游 .markdown / .compact 的 :not(pre) > code 带更高特异性的 font-size
       !important，由 [data-chat-flow-kind] :not(pre) > code 压住；
     - 代码块 / 小号代码的行高 / 字重 / 字体族：--dsw-font-markdown-code-block 与 -small 是 font
       简写，本规则只覆盖 font-size，故工具卡 / 样例卡那两条令牌规则保留。
   行首状态标记（[role="img"]，即 + / − 变更字形）排除在这条规则之外：字号保留上游声明（工具详情卡里是 16px）。:where() 不贡献特异性，
   排除后这条选择器仍是(0,1,0)，与覆盖其余元素时一致。
   文件里其余的 [data-chat-flow-kind] 规则服务于组外节点：最终回答是一个独立的 [data-chat-flow-kind]
   流项，它的 pre / 行内 code / 表格不在组内，不能只靠这条规则覆盖。 */
[data-step-process-content],
[data-step-process-content] *:where(:not([role="img"])) {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 改动文件卡片(data-changed-files="true")自身与整棵子树 14px。
   卡片内的字号由上游 ChangedFiles.module.css 各自声明:标题 13px、统计行 10px、文件名行 11px、
   路径 12px、展开按钮 12px;卡片根元素自己反而没有 font-size,所以根元素与后代都要覆盖,
   并靠 !important 压过后代自己的声明 —— 本选择器的后代段与上游 .…_title / .…_row 同为 (0,1,0),
   而上游的 <style> 由模块自注入、挂载顺序不归本插件掌握,不能只靠源码顺序取胜。
   取值钉在 "true" 上:上游写作 "data-changed-files": true(React 把布尔属性渲染成 ="true"),
   与卡片自己的 [data-single=true] 是同一套写法,取值变了选择器就整条落空,
   由 css-contract.json 的 changed-files-attr 在构建后报失效。
   500ms 悬停预览(ChangedFilePreview)是 HoverCard 的内容、portal 到 document.body,
   不在卡片子树里,字号不由这条规则负责(装 dsh-changes-hover-off 后它也不再打开)。 */
[data-changed-files="true"],
[data-changed-files="true"] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 侧栏会话行的时间戳 13px(上游 10px;行高不动,仍是上游 16px)。固定值,不引用 --dsh-content-font-size。
   这个 span 上没有任何 data-* 属性,唯一的抓手是 CSS Module 的局部类名 time:生成名是 [hash]_[local],
   构建只换 [hash] 前缀、_time 不变,所以用 [class*="_time"] 通配符匹配类名。
   行锚点靠 data-row-key 的取值前缀区分行的种类 —— 会话行 session:<id>、工作区行 workspace:<key>、
   溢出提示行 overflow:<key>、新建会话占位行 empty,所以 [data-row-key^="session:"] 只命中会话行。
   特异性 (0,2,0) 大于上游 .…_time 的 (0,1,0),无需 !important。
   行锚点消失、或局部名不再叫 time 时本规则整条落空,字号退回上游 10px,由 css-contract.json 的
   session-row-key-anchor / session-time-class 两条契约在构建后报「失效规则」。 */
[data-row-key^="session:"] [class*="_time"] {
  font-size: 13px;
}
`
