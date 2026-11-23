/**
 * `dsh-ui-css-patches` 的全部补丁规则,由 `client.ts` 挂成一条 `<style>`。
 *
 * 同特异性规则的覆盖顺序由本文件的源码顺序唯一确定(后写者胜);锚点是稳定的 `data-*` / `role` /
 * `aria-label`。一处例外:侧栏会话行的时间戳额外用了 CSS Module 的局部类名通配符(见该处注释)。
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
`
