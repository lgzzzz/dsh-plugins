/**
 * `dsh-ui-css-patches` 的全部补丁规则,由 `client.ts` 挂成一条 `<style>`。
 *
 * 同特异性规则的覆盖顺序由本文件的源码顺序唯一确定(后写者胜);锚点是稳定的 `data-*` / `role` /
 * `aria-label`。例外是几处只有 CSS Module 局部类名可抓的元素:侧栏会话行的时间戳、授权卡的
 * 状态条、工具行的体量后缀,以及轮次导航轨道的 frame / slot(各自见该处注释)。
 *
 * 后台任务区是会话面板里的一个 section(`<ul class="…_list" data-jobs-section>`,槽位
 * `conversation.session.panel.section`),由上游按面板宽度自然排布;补丁只统一它的字号,
 * 锚点 `data-jobs-section`(见该处注释)。
 *
 * 锚点与令牌清单、以及构建后校验见 docs/dsh-css-architecture/04-css-patches-relationship.md。
 */
export const CSS = `
/* 左右栏宽度固定为上游默认值(左栏 280px;右栏首次打开时视口的 45%,下限 300px),且不能拖动改宽。
   两栏的「改宽」只有一个入口:AppFrame 的两条拖动柄 —— 8px 宽、无可见样式(上游注释明说
   "No handle draws a visible pill")的绝对定位条,只带 data-side="sidebar" / data-side="rightbar",
   宽度偏好经它们的 pointer 手势写进 layout store(左栏 setSidebar、右栏 setRightbar)。
   把这两种取值的柄 display:none 掉,写入路径随之消失,两栏只剩上游自己算的默认值;
   toggleSidebar 只会写 0 或 280,不是拖动改宽,仍然可用。
   data-side 在别处还有取值:tooltip / popover 的 left|right|top|bottom,以及对话宽度柄
   ConversationWidthControls 的 left|right(见其 widthHandle[data-side='left'] 规则),都不叫
   sidebar / rightbar,不会撞车。柄只在可拖的状态下挂载(左栏收起 / 抽屉 / 折叠屏居中时没有左柄,
   右栏折叠 / 全屏时没有右柄),规则在这些状态下无事可做。
   呈现类的状态不受影响:收起后的 56px 图标轨道、窄屏抽屉、折叠屏居中侧栏、右栏的折叠与全屏
   都由 AppFrame 的渲染条件与 data-* 开关决定,不经过拖动柄;右栏仍按上游的让位规则收缩。
   上游 .…_handle 没有声明 display,本选择器特异性与它相同((0,1,0)),!important 只为不被
   模块样式重新挂载时的顺序翻盘。
   柄上不再有 data-side 或侧别取值改名时,规则整条落空、两栏恢复可拖动,由 css-contract.json 的
   layout-drag-handle / layout-handle-side-values 两条契约在构建后报失效。 */
[data-side="sidebar"],
[data-side="rightbar"] {
  display: none !important;
}

/* 左栏的收起按钮只在左栏已经收起时(56px 图标轨道 / 抽屉关闭)保留为「打开侧边栏」入口;
   展开状态下隐藏。收起方向本身由 src/sidebar.ts 的守卫禁掉:任何 toggleSidebar 在展开态
   都是空操作,左栏只会因为窗口变窄被自动收起,所以展开态的这个按钮已经没有可做的动作,
   隐藏它同时去掉「收起侧边栏」的提示与快捷键键帽。
   按钮根带 data-sidebar-toggle;收起标记 data-sidebar-collapsed 在 AppFrame 的帧元素上,
   只在 sidebarCollapsed 时输出(React 渲染成 data-sidebar-collapsed="true"),是侧栏子树
   的祖先。展开时属性缺席,第二条规则落空,按钮保持 display:none;收起时按钮按上游
   .…_iconButton 的 inline-flex 显示。上游给 .…_iconButton 声明了 display:inline-flex,
   两条规则都用 !important,不依赖本插件 <style> 与模块样式的挂载顺序。
   按钮锚点或收起标记改名时规则整条落空、收起按钮重新出现在展开态,由 css-contract.json 的
   sidebar-toggle-attr / sidebar-collapsed-attr 两条契约在构建后报失效。 */
[data-sidebar-toggle] {
  display: none !important;
}

[data-sidebar-collapsed] [data-sidebar-toggle] {
  display: inline-flex !important;
}

/* 右栏文件列表(workspace navigator)宽度不可调整:隐藏左缘那条既是拖动入口也是键盘入口的分隔条。
   文件列表的宽度偏好只有一个写入者 —— 分隔条自己的手势调 actions.resized:指针拖动、方向键 ±20px、
   Home(最窄)/ End(最宽)都挂在这条 8px 宽、绝对定位的分隔条上(类 css.separator,left:-4px,
   cursor:col-resize,带 role="separator" 与 data-files-navigator-resize)。它只在「预览旁」的
   push / overlay 两种布局渲染;铺满(fill)、files 页(wholePage)与 <768px 的全屏视口本来就没有它。
   隐藏它以后指针与键盘两个入口一起失效,文件列表停在上游 260px 的默认宽度;窄行仍按上游
   navigatorGeometry 的钳制收缩(并排 ≥560px 时至多行宽 − 336px,悬浮 400–560px 时至多行宽 − 120px)。
   本规则只拿掉调节入口,不碰内联的 --files-navigator-width,响应式钳制照旧。
   上游 .…_separator 没有声明 display,本选择器与它特异性相同((0,1,0)),!important 只为不被
   模块样式重新挂载时的顺序翻盘(本插件 <style> 与模块样式谁先生效不归本插件掌握)。
   分隔条改挂到别处、或属性改名时规则整条落空、文件列表恢复可拖动,由 css-contract.json 的
   files-navigator-resize-attr 契约在构建后报失效。 */
[data-files-navigator-resize] {
  display: none !important;
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

/* 对话流内的行内代码 14px（卡片与最终回答正文都在这棵子树里）。
   上游 .…_markdown :not(pre) > code 声明 font-size: .875em !important，特异性 (0,1,2)；本插件的
   <style> 在启动期挂到 head 前部（实测排在模块样式之前），!important 让平局只剩源码顺序可比，
   所以旧选择器 [data-chat-flow-kind] :not(pre) > code 同为 (0,1,2) 时会输给后注入的模块样式，
   正文行内代码落到 12.25px。把锚点属性重复一次只把特异性抬到 (0,2,2)，命中范围不变，不再依赖
   挂载先后；compact 变体（思考等过程文本，font-size: 1em）本来就继承父级的 14px，这条对它是幂等的。 */
[data-chat-flow-kind][data-chat-flow-kind] :not(pre) > code {
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

/* 编辑 / 写入 / apply_patch 的工具行不再显示体量后缀(「4KB」)。
   上游 FileMutationRow 把工具参数里正在流式生成或已经落定的正文(content / old_string /
   new_string)算成整数 KB,用 t('tool.preparing.content', {kilobytes}) 取文案后作为 summarySuffix
   交给 ToolRow:摘要那一列是文件路径,后缀就是紧随其后的「4KB」,同一行还可能再跟着 diff 统计
   (+12 −3)。这些行只出现在过程组里,改的是工具行自身。
   三个工具注册在同一个工具视图(FileMutationRow)上,ToolRow 根上带 data-tool(取值就是注册键
   apply_patch / edit / write)与 data-state;data-tool 是工具行自身的稳定锚点。
   体量后缀与 diff 统计共用 ToolRow 的 summarySuffix 局部类名,后者还额外带 diffStat 局部类名;
   选择器在通配符上排除 diffStat,只压掉体量后缀、保留 +/− 统计。
   这两个 span 上没有 data-* 属性,唯一抓手是 CSS Module 的局部类名:生成名是 [hash]_[local],
   构建只换 [hash] 前缀、局部名不变就不影响 [class*="_summarySuffix"] / [class*="_diffStat"],
   与侧栏时间戳的 _time、授权卡状态条的 _strip 是同一套写法。
   本规则特异性 (0,3,0),大于上游 .…_summarySuffix 与 TextShimmer 根 .…_root(display:
   inline-grid)的 (0,1,0),display 不依赖 <style> 的挂载顺序,因此不需要 !important。
   上游改掉工具行结构 / 局部类名 / 把体量后缀从 summarySuffix 挪走时规则整条落空、KB 重新出现,
   由 css-contract.json 的 file-mutation-tool-keys / tool-name-attr / tool-summary-suffix-class /
   tool-diffstat-class / tool-summary-suffix-diffstat / tool-preparing-suffix 六条契约在构建后报失效。 */
[data-tool="edit"] [class*="_summarySuffix"]:not([class*="_diffStat"]),
[data-tool="write"] [class*="_summarySuffix"]:not([class*="_diffStat"]),
[data-tool="apply_patch"] [class*="_summarySuffix"]:not([class*="_diffStat"]) {
  display: none;
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

/* 后台任务区自身与整棵子树 14px(默认 14px,跟随 --dsh-content-font-size)。
   区块根是 <ul class="…_list" data-jobs-section>,渲染在会话面板的 section 槽位里,
   宽度由面板给,不需要补丁。
   区里的分组标题 / 停止按钮 / 命令行 / 种类 / 状态 / 时长 / 提示行各自声明了 10–12px,
   <ul> 自己反而没有 font-size,所以根元素与后代都要显式覆盖,且要 !important 压过后代声明。
   这条不能省:面板在右栏里,不在会话标题栏那一行,[data-slot="conversation.session.header"] *
   那条 14px 覆盖不到它。锚点 data-jobs-section 是上游这个 section 唯一的语义标记,
   由 css-contract.json 的 jobs-section-attr 在构建后报失效。 */
[data-jobs-section],
[data-jobs-section] * {
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

/* 过程组（data-step-process）展开体改为平铺，取消内层限高滚动口。
   上游 ChatGroupSeat 在组根下直接渲染 [data-step-process-body]：.…_body 是
     max-height:min(400px,50vh); overflow-y:auto; scrollbar-gutter:stable
   的内层滚动口；只有 grouped=false（「完全展开」，或详细模式下轮次仍打开 / 延迟收起）时才追加
   .…_expandedBody { scrollbar-gutter:auto; max-height:none; overflow:visible }。
   详细 / 标准 / 简洁模式的分组仍保留限高，展开过程组时内容超过 400px 就要滚内层。
   这里把上游 expandedBody 的三条声明钉在组根的滚动体上；[data-step-process-body]
   是组根的直接子元素，展开时可见，收起时由 hidden 属性隐藏。
   特异性 (0,2,0) 大于上游 .…_body 的 (0,1,0)，不需要 !important。
   限高去掉后 body 不再垂直溢出，useProcessScroll 的 ResizeObserver 会把 edges 归零，
   fadeTop / fadeBottom 不再挂上；展开 / 收起动画期间上游 inline overflow/height 优先，
   本规则不干扰。
   上游 DOM 没有把「工作步骤展示」模式写成属性（transcriptView 只在设置数据里），
   因此这条规则对所有分组模式生效；已经处于 expandedBody 状态的组本来就没有限高，规则幂等。
   锚点消失时规则静默落空，由 css-contract.json 的 step-process-root /
   step-process-body-attr 在构建后报失效。 */
[data-step-process] > [data-step-process-body] {
  max-height: none;
  overflow: visible;
  scrollbar-gutter: auto;
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
   不在卡片子树里,字号不由这条规则负责(装 dsh-changes-behavior 后它也不再打开)。 */
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

/* 提问卡片(ask_user_question 的 composer 顶替卡片)的折叠热区:右侧 24px 箭头按钮 → 整条标题栏。
   上游 header 里只有箭头按钮(button[aria-expanded])自己绑了开合 onClick;eyebrow、标题与空白处
   都是纯文本 / 空 flex 间隙,不响应点击。本规则只放大这个按钮的命中区,不改组件与状态:
     - header 设为定位祖先,箭头按钮钉成 position:static(上游以后即使给它加 position,包含块仍是 header);
     - 按钮的透明 ::after 绝对定位、inset:0,盖住 header 的 padding box;伪元素属于按钮本身,
       命中即派发按钮自己的 click,React 的 setMinimized 照旧翻转;
     - header 里的其余按钮(X 关闭、计时卡的「花点时间」)抬到 z-index:1,仍在伪元素之上,
       关闭 / 继续等待先收到点击;没有交互的状态文字留在伪元素下面,点它同样开合。
   锚点:[data-question-key] 只属于这张提问卡片(plan-review 卡片是 data-plan-review-key,且没有
   折叠按钮,不在范围;已定局回复气泡的 toggle 本来就是整宽,也不受影响),section > header 是上游
   渲染结构,button[aria-expanded] 是折叠按钮的稳定语义属性。
   代价:标题文字被伪元素覆盖,鼠标不能再选中 / 复制;悬停整条 header 会触发箭头按钮的 :hover 与
   title 提示,这正好是「整条 header 即按钮」的反馈。计时卡上点 header 会让答案输入框失焦、倒计时
   恢复,与今天点箭头按钮完全一致。
   本组选择器特异性为 (0,1,2) 到 (0,2,4),均高于上游 .…_header 与 .…_iconButton 的
   (0,1,0),不需要 !important。
   上游改掉 data-question-key / header 结构 / aria-expanded 时规则整条落空,由 css-contract.json 的
   question-key-attr / question-header-structure / question-collapse-expanded 三条契约在构建后报失效。
   已知边界:若上游把 headerActions 或别的中间层改成定位元素,伪元素的包含块会缩小到那一层,
   热区随之变小;当前 header 与 headerActions 都没有定位,按钮自身由本规则显式钉成 static。 */
[data-question-key] > section > header {
  position: relative;
}

[data-question-key] > section > header button[aria-expanded] {
  position: static;
}

[data-question-key] > section > header button[aria-expanded]::after {
  content: "";
  position: absolute;
  inset: 0;
  cursor: pointer;
}

[data-question-key] > section > header button:not([aria-expanded]) {
  position: relative;
  z-index: 1;
}

/* 命令结果行 14px(斜杠命令在消息流里的那一行,例如 /plan 的
   「Plan mode on. Use /plan off to leave.」,上游默认 13px)。
   CommandNodeView 把命令结果渲染进 [data-slot="conversation.chat.commandview"] 槽位;行内两段文字
   各自声明字号:标题是 DisclosureRow 原语的 .…_title,摘要是 GenericCommandCard 的 .…_summary,
   两者都取 --dsh-content-font-size-secondary。该令牌在 body 上由主题算成
   min(主字号 − 1px, max(13px, 主字号 − 2px)),默认主字号 14px 时即 13px。
   这里在槽位包装上把该令牌改成主字号:两段文字一起跟随,展开体 <pre> 用的是代码字体令牌,不受影响。
   槽位包装是 display:contents、不生成盒子,自定义属性照常继承;改的是变量而不是 font-size,
   因此不需要 !important,也不与上游 .…_title / .…_summary 的特异性竞争。
   规则对整个槽位生效:所有斜杠命令的结果行走同一个槽位,各命令注册的自定义视图也在其中,
   它们的次要字号一并变成主字号。槽位键消失时整条落空、字号退回 13px,
   由 css-contract.json 的 commandview-slot 契约在构建后报失效。 */
[data-slot="conversation.chat.commandview"] {
  --dsh-content-font-size-secondary: var(--dsh-content-font-size, 14px);
}

/* 授权卡片(conversation.approval.card)里的小字 14px。
   卡片自己的字号都是固定 px:大字标题 .…_headline 是 15px/24px;顶部「等待审批」状态条
   .…_strip 是 13px/18px,说明行 .…_description 与命令行 .…_command 都是 13px/20px。
   三处小字都写死 14px、不引用 --dsh-content-font-size,保持「15 大字 > 14 小字」的层级
   不随应用字号翻转;行高保持上游(状态条 18px,说明行 / 命令行 20px)。三处小字的锚点:
     - 状态条:它没有 data-* 属性,唯一抓手是 CSS Module 的局部类名 strip —— 生成名是
       [hash]_strip,构建只换前缀,与侧栏时间戳的 _time 是同一套写法;锚点写成
       [data-approval-key] [class*="_strip"],作用域限定在授权卡片内,卡片里没有别的类名
       以 _strip 结尾;
     - 说明行:调用方传入 description 时渲染成正文容器 [data-approval-scroll] 的直接子元素
       <p>(工具审批不带 description;CUA 应用授权等 factory 调用方会带);
     - 命令行:工具审批的详情子槽位 conversation.approval.detail,由 SlotOutlet 渲染成
       [data-slot="conversation.approval.detail"] 的 display:contents 包装,包在 .…_command
       (13px)里。字号落在包装上,包装里的文本继承 14px;自定义详情内容自己声明的字号仍以自己为准。
   锚点:[data-approval-key] 是 ApprovalCard 根元素上的请求键属性(approval:<n>),三处小字都在
   它的子树里。三条选择器的特异性分别是 (0,2,0) / (0,2,1) / (0,2,0),都大于上游 .…_strip /
   .…_description / .…_command 的 (0,1,0),不依赖源码顺序;!important 只为不被模块样式重新
   挂载时的顺序翻盘(本插件 <style> 在启动期挂载,与模块样式谁先挂上不归本插件掌握)。
   上游改掉卡片根 / strip 这个局部名 / 正文容器 / 说明行的渲染方式 / 子槽位键时,对应规则
   整条落空,由 css-contract.json 的 approval-key-attr / approval-strip-class /
   approval-scroll-attr / approval-description-structure / approval-detail-slot 五条契约在
   构建后报失效。 */
[data-approval-key] [class*="_strip"],
[data-approval-key] [data-approval-scroll] > p,
[data-approval-key] [data-slot="conversation.approval.detail"] {
  font-size: 14px !important;
}

/* 主对话正文列最大宽度 =「左边栏开启、右栏关闭、会话面板打开」时的宽度,由整个窗口宽度
   减去该状态下其余元素的宽度动态算出:
     100vw − 左栏 280 − 会话面板预留 348(40 净空 + 8 边距 + 300 面板)
           − 正文列左缘 52(32 滚动框内边距 + 20 居中余量)− 滚动条 5
           (--dsh-scrollbar-width)− 2(滚动框的 2px 偏移)
   左栏参考宽度按 AppFrame 的 SIDEBAR_AUTO_COLLAPSE(1024)取:≥1024 左栏正常展开,本插件
   已把它钉在 280,参考值取 280;低于 1024 时上游会自动收起左栏(抽屉 / 图标轨道),
   参考值取 0,最大宽度 = 100vw − 407。
   正文列实际宽度取 min(最大宽度, 滚动口宽 V − 104):右栏占轨把中心列压窄时,正文跟着
   滚动口收窄,只留左右各 52;滚动口比参考状态宽(左栏收起 / 窗口更宽)时,正文停在最大
   宽度,多余空间留在两侧,不再随左栏收起继续变宽。窗口极窄、最大宽度或 V − 104 算成
   负数时,max-width 失效为 none,正文按内容框铺开(与旧规则相同的极端窄窗口兜底)。
   V 是滚动口 clientWidth,计数包含末端预留的 padding,面板让位不会反过来改变 V;
   --dsh-conversation-viewport-width 由上游 ConversationWidthControls 持续发布,未发布时
   按 1040px 估算。
   **停靠探针与正文宽度**:上游探针宽度 = max(尾部空档 − 348 + 1px, reserve-room),
   reserve-room 由 reserve-max = V − 正文宽 − 32 与面板请求的 348 比较得出,尾部空档
   = (V − 正文宽) / 2 + 末端 inset / 2。正文停在本规则的最大宽度时 reserve-max = 368px
   (左栏收起时 648px)≥ 348,探针回报 1px、面板 docked;右栏占轨时正文通常退到 V − 104,
   reserve-max = 72px、尾部空档 52px,探针回报 0;左栏收起释放的空间大于右栏时正文仍可
   停在最大宽度,但尾部空档不足 348px、reserve-max 也低于 348,探针同样回报 0、面板 hidden。
   所以面板是否停靠只由正文宽度与预留空间决定,没有单独的右栏开关:右栏一占轨,正文要么
   退到 V − 104,要么尾部空档不足以停靠面板,探针归零、面板让位;右栏关闭、正文回到最大
   宽度,探针恢复、面板重新 docked。
   居中:正文列沿用上游 .column 的 margin: 0 auto(本插件不再把它改成左对齐),最大宽度
   留下多余空间时列在聊天框里居中;输入卡片同样居中,宽度为正文 + 32px、比正文每侧宽
   16px,两者始终同轴。左缘 52 = 滚动框 32 + 居中余量 20 在内容框恰为正文 + 40px 的状态
   (参考态 / 右栏占轨)成立;左栏收起、正文停在最大宽度时,列在聊天框里居中,窗口位置与
   参考状态相同,释放出的左栏宽度留在左侧空白区。
   两条宽度变量仍用 !important 压过内联与模块样式;作用域限定 main.conversation,嵌入的
   侧边对话(.embeddedBody)保持自己的宽度。上游 40 / 8 / 300、SIDEBAR_DEFAULT、
   SIDEBAR_AUTO_COLLAPSE、--dsh-scrollbar-width、滚动框 32px 内边距 / 2px 偏移、reserve
   公式、探针 >= 1px 判定、两个宽度变量或默认 pinned 改名/改值时,规则会静默退化;由
   css-contract.json 的 main-slot / content-attr / width-handle-attr / viewport-width-var /
   viewport-width-published / resolved-width-declared / content-width-alias /
   chat-scroll-side-padding / chat-scroll-margin / panel-clear / panel-edge / panel-min-width /
   sidebar-default / sidebar-auto-collapse / scrollbar-width-var / composer-side-clearance /
   reserve-rule / reserve-max-formula / reserve-room-step / probe-measure /
   presentation-docked / panel-docked-attr / pinned-default 23 条契约在构建后报失效;
   下面「开关不做轨道动画」那条另由 animating-attr 契约钉住。 */
[data-slot="main.conversation"] [data-conversation-content] {
  --dsh-chat-ref-sidebar: 280px;
  --dsh-chat-content-cap: calc(
    100vw - var(--dsh-chat-ref-sidebar) - 348px - 52px
      - var(--dsh-scrollbar-width, 5px) - 2px
  );
  --dsh-chat-content-width-resolved: min(
    var(--dsh-chat-content-cap),
    calc(var(--dsh-conversation-viewport-width, 1040px) - 104px)
  ) !important;
  --dsh-chat-content-width: var(--dsh-chat-content-width-resolved) !important;
}

@media (width < 1024px) {
  [data-slot="main.conversation"] [data-conversation-content] {
    --dsh-chat-ref-sidebar: 0px;
  }
}

/* 开关左右栏不做轨道动画:正文列的宽度、末端预留与居中位置都由滚动口宽 V 派生,
   上游 AppFrame 只在离散的开关 / 折叠上给 grid-template-columns 挂 300ms 过渡
   (data-animating),过渡期间中心列逐帧变窄,会把中间态一帧一帧写进正文列。实测
   (headless Chrome,1600×1000,右栏 720px):打开右栏时列左缘 332 → 465(面板预留让位
   的那一帧)→ 312 → 332、宽度 913 → 489 连续收窄;关闭右栏反向一遍;左栏收起 / 展开
   也有约「每帧 V 变化量一半」的左右摆动(慢放到 3s 时仍有 5px)。这里把帧自己的过渡
   置为 none:布局一步到位,正文列每帧位置恒为 332、宽度只变一次(实测 913 → 489),
   不再有中间态。
   作用域只有帧本身:左右栏内部的淡入淡出、抽屉的遮罩用各自的元素,照旧播放;右栏面板
   内容的滑入 / 滑出(dockkit 项的 transform)由下面那条单独关掉;窗口缩放不置
   data-animating,行为不变。
   特异性 (0,1,0) 低于上游 .frame[data-animating] 的 (0,2,0),!important 是必需的
   (上游那条不带 !important)。属性改名时本规则整条落空、抖动回来,由 animating-attr
   契约在构建后报失效。 */
[data-animating] {
  transition: none !important;
}

/* 右栏打开 / 关闭不做滑入滑出:面板内容一步到位。
   上游 SidebarRight.module.css 给面板里的三块 dockkit 内容挂了同一组过渡 ——
   [data-dockkit-host="dock"](有标签页时的整块面板)、[data-dockkit-empty](没有标签页时的
   引导页)、[data-dockkit-divider](分栏分隔条):
       transform: translateX(var(--dsh-sidebar-width)); visibility: hidden;
       transition: transform var(--ds-transition-duration-slow) …, visibility 0s linear …;
   面板展开时这三块改成 transform:none / visibility:visible,收起时回到平移 + 隐藏,首次
   展开还叠加一条 @starting-style 的 translateX 起始值。于是右栏打开时内容从窗口右缘外
   滑进来、关闭时滑出去,各 300ms(实测 720px 右栏:transform 逐帧 720 → 696 → 498 →
   219 → 12 → 0,dockkit 的 host 与 empty 都是这样),即使 AppFrame 的列宽过渡已经被上一条
   关掉,这层滑入仍然存在。
   把这三块的 transition 置为 none:transform 与 visibility 直接落到当前状态的声明值,
   展开时内容立刻出现在面板里、收起时立刻移出并隐藏;稳态的位移 / 隐藏仍由上游那两条规则
   决定,本规则不改它们(实测:开 / 关的首帧 transform 就是 none / translateX(720px),
   document.getAnimations() 里不再有 300ms 的 transform 过渡,也没有起始帧的平移)。
   !important 用来压过上游两条规则 —— 关闭态 .…_panel [data-dockkit-host=dock] 是
   (0,2,0)、展开态 .…_panel[data-sidebar-right-open] [data-dockkit-host=dock] 是 (0,3,0),
   两条都不带 !important,而本插件 <style> 在启动期挂载,与模块样式谁先挂上不归本插件掌握。
   作用域限定在 [data-sidebar-right-panel] 面板内:该属性由面板根输出(push / fullscreen),
   dockkit 的 host / empty / divider 属性在右侧栏以外(别的 dockkit 用法、分栏)也出现,
   不能全局关掉。
   面板根属性、三块 dockkit 内容或上游那组过渡改名 / 删除时,规则整条落空、滑入滑出回来,
   由 css-contract.json 的 sidebar-right-panel-attr / sidebar-right-slide-rule / dockkit-attrs
   三条契约在构建后报失效。 */
[data-sidebar-right-panel] [data-dockkit-host="dock"],
[data-sidebar-right-panel] [data-dockkit-empty],
[data-sidebar-right-panel] [data-dockkit-divider] {
  transition: none !important;
}

/* 宽度不可调整:隐藏正文列左右两条 10px 的宽度拖动条(指针拖动与把手上的滚轮滚动一并消失)。
   上游 .widthHandle 没有声明 display,本选择器特异性更高,!important 只为不被模块样式
   重新挂载时的顺序翻盘。 */
[data-slot="main.conversation"] [data-width-handle] {
  display: none !important;
}

/* 轮次导航轨道(TurnNavigator,左侧那排轮次刻度)常显:每个刻度悬停显示该轮的用户消息与
   最终回复,点击跳到该轮的用户消息。上游在轨道自己的宽度容器上挂了一条
   @container (width<=900px){.…_frame{display:none}} —— 容器是轨道外层 .…_slot 的内容盒
   (滚动口去掉左右各 32px 内边距后剩下的宽度),所以右栏一占轨、中心列被压到 900px 以下,
   整条轨道就消失;这是它唯一的隐藏入口(轮次数 < 2 时组件自己返回 null,与宽度无关)。
   规则只把 frame 恢复成 display:block,宽度 / 位置 / 预览都不动:轨道仍在滚动口左缘
   (left:12px、28px 宽),正文列左缘由上面的限宽规则固定在 32px 内边距 + 20px 居中余量
   = 52px(右栏占轨时恒为 52px;左栏收起 / 窗口更宽时列居中,只会更靠右),20px 宽的
   刻度线与正文之间总留出 12px 以上。容器变窄时预览卡跟着 min(300px, 100cqw − 120px)
   收缩,不会把正文挤出窗口。
   锚点:nav 上只有 CSS Module 的局部类名 frame(生成名 [hash]_frame,构建只换 hash
   前缀),父元素是同一个模块的 slot([hash]_slot)。主选择器 [data-conversation-scroll]
   nav[class*="_frame"] 借会话滚动口限定(上游给 .…_slot 的 sticky 也用同一祖先);再补一条
   [class*="_slot"] > nav[class*="_frame"]:ChatView 自己拥有滚动时轨道不在
   [data-conversation-scroll] 里,这条按父子关系命中,不依赖祖先。
   上游那条 display:none 不带 !important,本规则用 !important 只为不被模块样式重挂时的
   顺序翻盘;两条选择器的特异性 (0,2,1) 也都高于 .…_frame 的 (0,1,0)。
   局部类名改名、nav 改挂到 slot 以外、容器查询改阈值 / 改锚点、或上游不再隐藏轨道时,
   规则整条落空或变成多余的兜底,由 css-contract.json 的 turn-rail-frame-class /
   turn-rail-slot-class / turn-rail-nav-structure / conversation-scroll-attr /
   turn-rail-container-hide 五条契约在构建后报失效。 */
[data-conversation-scroll] nav[class*="_frame"],
[class*="_slot"] > nav[class*="_frame"] {
  display: block !important;
}

/* 会话面板开关隐藏:会话标题栏最左侧那个按钮(上游注册 id session-panel,渲染成带
   data-session-panel-toggle 的 Button)。面板是否显示由 pinned 偏好
   (localStorage dsh.sessionPanel.pinned,默认 true)与停靠探针共同决定,而这是唯一的
   关闭入口;隐藏它以后 pinned 偏好不会再被关掉。面板是否停靠由正文宽度派生:正文达到
   上面的最大宽度时停靠探针回报 1px、面板 docked;右栏占轨把正文压到最大宽度以下
   (或滚动口太窄)时探针归零、面板 hidden,空间恢复后自动重新 docked。
   只把按钮 display:none:按钮仍在 DOM 里,React 的事件绑定与 aria-* 不变,本插件启动期的
   兜底(见 src/pin.ts)可以在它上面派发一次 click 把历史上关掉的面板重新打开;标题栏里
   其它动作照常排布。
   按钮属性改名或改挂到别处时规则整条落空、开关重新出现、面板又能被关掉,由 css-contract.json
   的 session-panel-toggle-attr / session-panel-toggle-expanded / session-panel-toggle-disabled
   契约在构建后报失效。 */
[data-session-panel-toggle] {
  display: none !important;
}

/* 停靠面板固定 300px。上游 .panel 的宽度是
   clamp(300px, 尾部空档 − 40px − 8px, 360px):尾部空档更宽时会长到 360px。本插件的
   348px 预留让停靠时的尾部空档恰为 348px,clamp 本来就落在 300px;这条规则把停靠态钉成
   300px,避免上游 clamp / 尾部空档变化时面板悄悄变宽,40px 净空、8px 边距与 348px 预留的
   对应关系保持原样。只选 docked:浮层仍是上游的 min(280px, 100% − 16px)。
   data-session-panel="docked" 由上游 presentationOf 产出;属性或取值改名时规则落空、面板
   恢复上游 clamp 宽度,由 css-contract.json 的 panel-docked-attr 契约在构建后报失效。 */
[data-session-panel='docked'] {
  width: 300px !important;
}

/* 会话面板([data-session-panel])自身与整棵子树 14px(跟随 --dsh-content-font-size,默认 14px)。
   面板的内容是各插件注册的 section:环境(工作目录 / 工作树 / 项目)、变更请求、主智能体、
   子智能体会话树、共享任务、今日 Token 用量、后台任务。字号散落在几十个 CSS Module 里:
   区块标题 12px/18px(._…_title 的 var(--dsw-font-xxs-12))、行 13px/20px(._…_row 的
   var(--dsw-font-xs-13))、行的第二行 12px/17px、折叠行 12px/16px、环境备注 12px/18px、
   后台任务区 10–12px、子智能体会话树 12px、各 section 的操作按钮/计数也各自声明 10–13px。
   逐个组件覆盖既容易漏、又会随 section 增删漂移,所以按面板根锚点统一整棵子树。
   面板根 aside 自己没有 font-size,继承 body 的 16px;后代又各自声明更小的字号,因此根元素
   与后代都要覆盖,并靠 !important 压过后代自己的声明(上游 <style> 由模块自注入,挂载顺序
   不归本插件掌握)。
   只改 font-size:行高 / 字重 / 字体族 / 颜色保持上游 —— 行高仍按上游的 17–20px 排版,
   区块标题保留 --dsw-font-xxs-12 里的 18px 行高,只把字号提到 14px;面板宽度固定 300px
   (见上一条),字号变大后长文本按上游的 ellipsis / nowrap 截断,不会撑破面板。
   --dsh-content-font-size 由主题写在 document.body 的行内样式上(默认 14px),aside 在 body
   下、变量可继承;取值与 [data-jobs-section]、子智能体会话树两条窄作用域规则一致,字号设置
   变大时整个面板一起跟随(默认即 14px)。
   面板里的右键菜单 / tooltip 是 portal 到 document.body 的共享浮层,不在 [data-session-panel]
   子树里,字号不变;面板行详情的 HoverCard 是面板自己的详情视图(portal 到 body,标题本来就是
   14px,说明行 / 状态 / 指标是 12px),单独用 [data-session-panel-details] 锚点一并提到 14px。
   锚点:data-session-panel 是 aside 根上的呈现态属性(docked / overlay),data-session-panel-details
   是 PanelDetails 根上的标记。属性改名时规则整条落空、面板字号回到上游 10–13px,
   由 css-contract.json 的 panel-docked-attr / session-panel-details-attr 两条契约在构建后报失效。 */
[data-session-panel],
[data-session-panel] *,
[data-session-panel-details],
[data-session-panel-details] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 会话统计 / Token 用量浮窗不跟着正文滚动上移:纵向锚点从按钮位置改成停靠条的高度。
   两个浮窗(portal 到 body 的 position:fixed 层,正文各自带 data-session-stats-details /
   data-session-stats-usage)由上游用 CSS anchor positioning 放在触发按钮上方:
   bottom: max(12px, calc(anchor(top) + 8px))。按钮在 sticky 的 composer 座位里,Chromium 158
   的 anchor(top) 取的是按钮的静态(未补偿 sticky)位置:正文跟着流式输出向下滚时,浮窗按 scrollTop
   的增量逐帧上移——实测滚 40px 上移 40px、滚 320px 后顶边到视口外;按钮本身仍在原位,所以不是
   布局变化,只是锚点读错了位置。把纵向换成停靠条([data-composer-dock])的 anchor-size(height):
   同一个盒子,但只取尺寸;停靠条高度不随滚动变化,也不随卡片里的草稿行数变化(草稿只把卡片
   向上撑高,停靠条仍贴在座位底部),只在字号设置变大时按 --dsh-content-font-delta-secondary 增长。
   bottom = 高度 + 8px 与上游的 8px 间隙一致:停靠条底距座位底 4px(root 的 padding-bottom)、按钮顶
   距停靠条顶 4px(dock 的 padding-top),两者抵消后浮窗底边仍停在按钮顶上方 8px;实测两种浮窗
   的 y 与修复前完全相同,滚动时不动。
   水平轴不动:竖向滚动不影响 anchor(left),仍锚在各自按钮的左缘;只把左缘夹在视口内,窄窗口里
   浮窗不越出右边(按钮被压缩到负 x 时也落在 12px)。高度上限按停靠条上方的可用空间算,超长内容
   在浮窗内部滚动;position-try-fallbacks 关掉,因为上游那五条兜底全部仍用 anchor(top),一旦
   触发会把同一段上移带回来。字体增量由 anchor-size 自动跟随;不支持 anchor-size 的浏览器用前一条
   声明(34px + 增量)兜底——34px 就是当前停靠条 26px + 间隙 8px 的等价常量。
   只选这两个会话统计浮窗:每轮用量的浮窗锚在消息尾部、本来就该随正文滚动,不在本规则里;
   上下文占用浮窗是另一个组件(没有 data-session-stats-* 锚点),未纳入。
   锚点改名(按钮正文的 data-session-stats-* 或停靠条的 data-composer-dock)时规则整条落空,
   浮窗回到上游的上移;上游若改成别的定位方式,本规则变成多余。由 css-contract.json 的
   composer-dock-attr / stats-dialog-details-attr / stats-dialog-usage-attr / stats-dialog-anchor-top
   四条契约在构建后报失效。级联测试用上游真实的 stat-dialog 模块 CSS 搭了同一棵树:禁用插件样式时
   滚动 240px 浮窗上移 240px,启用后位置不变。 */
[data-composer-dock] {
  anchor-name: --dsh-css-dock-anchor;
}

[role="dialog"]:has([data-session-stats-details]),
[role="dialog"]:has([data-session-stats-usage]) {
  top: auto !important;
  bottom: calc(34px + var(--dsh-content-font-delta-secondary, 0px)) !important;
  bottom: calc(anchor-size(--dsh-css-dock-anchor height) + 8px) !important;
  left: clamp(12px, anchor(left), calc(100vw - 12px - min(440px, 100vw - 24px))) !important;
  max-height: calc(100dvh - anchor-size(--dsh-css-dock-anchor height) - 8px - max(12px, var(--dsh-frame-overlay-top, 12px))) !important;
  position-try-fallbacks: none !important;
}
`
