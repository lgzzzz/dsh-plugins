/**
 * `dsh-ui-css-patches` 的全部补丁规则,由 `client.ts` 挂成一条 `<style>`。
 *
 * 同特异性规则的覆盖顺序由本文件的源码顺序唯一确定(后写者胜);锚点是稳定的 `data-*` / `role` /
 * `aria-label`。两处例外拿不到这类锚点:
 *   - 后台任务菜单那两条额外用了元素类型 `ul`:菜单 `<ul>` 上没有任何 `data-*`,且它是
 *     `[data-slot="conversation.session.header.actions"]` 里唯一内联渲染的 `ul`(该槽其余注册项里,
 *     agent-preset 的标签只渲染 `span`,subagent-catalog 与 agent-team 的菜单 portal 到 `document.body`),
 *     类型选择器是它唯一的稳定锚点。框(终端卡)的宽度钉在上游基线 478px 上并居中:父面板没有属性锚点,
 *     所以这条约定放在框自身上(见该处注释)。
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

/* 后台任务菜单加宽 500px → 548px(= 框 478 + 两侧空隙 2×35,见下一条)。
   上游是 width:500px + max-width:min(560px,100vw - 32px):max-width 也一并覆盖,菜单宽度才不跟着
   上游那个上限走(上游调小它时,菜单会跟着缩、空隙静默变小)。
   菜单是绝对定位元素,加宽不参与头部布局;上游按实测 offsetWidth 算的 left 仍会把菜单拉回视口内 */
[data-slot="conversation.session.header.actions"] ul {
  width: 548px;
  max-width: min(548px, 100vw - 32px);
}

/* 命令 + 实时输出那个框保持上游基线宽度 478px(= 菜单 500 − 内边距 2×3 − 面板左右外边距 2×8),
   菜单比它宽出来的 70px 全变成两侧空隙:548 菜单下 = 3 + 8 + 24 居中余量 = 35,由 margin:auto 对称。
   上游 .…_block 是 content-box 且带 12px 左内边距,不写 box-sizing 会变成 490px,故显式声明 border-box;
   max-width:100% 兜住窄窗口(菜单被 min(548px,100vw - 32px) 收窄时框跟着收窄,不溢出面板)。
   478 / 548 / 35 互相推导,依赖上游的 500 菜单与 8px 面板外边距 —— css-contract.json 的 jobs-menu-width /
   jobs-panel-margin 负责让构建失败。面板里的提示行(「已省略 N 行」/输出错误)没有属性锚点、不参与居中 */
[data-slot="conversation.session.header.actions"] ul [data-terminal] {
  box-sizing: border-box;
  width: 478px;
  max-width: 100%;
  margin-left: auto;
  margin-right: auto;
}

/* 子智能体会话树（role="tree" 精确锚点）自身与子元素 14px */
div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"]),
div[role="tree"]:is([aria-label="子智能体会话"], [aria-label="Subagent sessions"]) * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

/* 过程组（data-step-process）的成员区整棵子树 14px：组成员（思考 / 工具卡 / 回复）都渲染在
   [data-step-process-content] 下；它自己在上游没有任何 font-size 声明（上游 .…_content 只声明
   display / flex-direction），字号靠继承，成员内部又会各自声明更小的字号，所以容器与全部后代一起
   钉到 --dsh-content-font-size（应用字号，默认 14px）。
   这条规则的 !important 用来压过后代自己声明的小字号，覆盖的是组内每个元素的 font-size：组内成员的
   字号（披露行 / 样例卡 / 压缩卡标题与摘要、展开体正文、compact markdown 正文、工具详情卡整块）全部
   由它给出，文件里因此没有只作用于组内的卡片级字号规则。两处例外由本文件的其它规则负责：
     - 组内行内 code：上游 .markdown / .compact 的 :not(pre) > code 带更高特异性的 font-size
       !important，由 [data-chat-flow-kind] :not(pre) > code 压住；
     - 代码块 / 小号代码的行高 / 字重 / 字体族：--dsw-font-markdown-code-block 与 -small 是 font
       简写，本规则只覆盖 font-size，故工具卡 / 样例卡那两条令牌规则保留。
   行首状态标记（[role="img"]，即 + / − 变更字形）排除在这条规则之外：它是图标语义（含义由 aria-label
   承载），字号保留上游声明（工具详情卡里是 16px）。:where() 不贡献特异性，排除后这条选择器仍是
   (0,1,0)，与覆盖其余元素时一致。
   文件里其余的 [data-chat-flow-kind] 规则服务于组外节点：最终回答是一个独立的 [data-chat-flow-kind]
   流项，它的 pre / 行内 code / 表格不在组内，不能只靠这条规则覆盖。 */
[data-step-process-content],
[data-step-process-content] *:where(:not([role="img"])) {
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
