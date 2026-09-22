# 视觉类插件迁移审计（0.1.6-alpha.2 → 0.1.7-alpha.1）

审计人：audit-visual（task-2） 范围：`dsh-code-card-fonts` / `dsh-rightbar-fonts` / `dsh-rightbar-tab-width` / `dsh-fullwidth-chat`
本机全局 DSH：**0.1.7-alpha.1**；对照树 `/tmp/dsh-audit/old/<pkg>`（0.1.6-alpha.2）与 `/tmp/dsh-audit/new/<pkg>`（0.1.7-alpha.1）。
本次**未修改任何插件文件**、未 git 提交、未改 `~/.dsh`、未构建 / 未 typecheck。

## 0. 取证口径与一处重要补漏

- 契约命中的"新产物"首选 Lead 提供的 `/tmp/dsh-audit/new/<pkg>`；但该树是**子集**（仅 28 个包）。
- **补漏 1（关键）**：`dsh-code-card-fonts` 的 `[data-tool]` / `[data-sample]` 两个锚点并不在 chat 包，而在 **`@deepseek-ai/dsh-client-ui-tool`**（该包不在对照树内）。已按只读方式补齐：
  - 新：`cp -R /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-tool/lib /tmp/dsh-audit/new/dsh-client-ui-tool/`（0.1.7-alpha.1）；
  - 旧：`curl registry.npmjs.org/@deepseek-ai/dsh-client-ui-tool/-/dsh-client-ui-tool-0.1.6-alpha.2.tgz` 解到 `/tmp/dsh-audit/old/dsh-client-ui-tool/`。
- **补漏 2（用于排除误报）**：`dsh-client-ui-goal` 同样不在对照树内，已同法拉取 0.1.6-alpha.2 与新包对比（结论：GoalBar 字号两版逐字相同，非 0.1.7 变化，不计入结论）。
- 行号均为 1-based，指向该文件当前快照。下文的 `new/<pkg>` 即 `/tmp/dsh-audit/new/<pkg>`，`old/<pkg>` 即 `/tmp/dsh-audit/old/<pkg>`；`dsh-client-ui-tool` 的 `old` 侧内容 = 0.1.6-alpha.2、`new` 侧内容 = 全局安装的 0.1.7-alpha.1。
- 判定三态：**需要迁移**（现状失效 / 被覆盖 / 结构错配 / 新面未覆盖而违反插件自身不变量）、**需复核风险**（契约仍在但周边结构变了或存在相互作用）、**不受影响**（逐条契约等价）。

## 1. 总览

| 插件 | 判定 | 一句话理由 |
| --- | --- | --- |
| `dsh-code-card-fonts` | **需要迁移（部分已完成，未提交）** | 过程组内间距这一处**破坏性**变更已正确修复并已 build 进 `lib/client.js`；但 0.1.7 新增的 `ToolDetails` 紧凑详情卡与 `turn-trigger` 节点卡自带 12/13px 字号，插件未覆盖，原「展开内容统一 14px」不成立 |
| `dsh-rightbar-fonts` | **不受影响**（声明范围内逐条等价）+ 1 条需复核风险 | 两处锚点（`[data-textpreview-body]` / `[data-changes-review]`）、三个 token 消费点、`[data-document-markdown]` 与行内代码规则全部逐字等价；0.1.7 新增的「改动卡片悬停单栏 diff」(`data-changes-hover-preview`) 复用同一 FileDiff 但不在 `[data-changes-review]` 内，属未覆盖的新面 |
| `dsh-rightbar-tab-width` | **不受影响** | dockkit 的 `[data-dockkit-tab][role="tab"]` 与 `chip:100` 预算算法两版逐字相同，插件结果与上游默认阈值一致 |
| `dsh-fullwidth-chat` | **不受影响** | `main.conversation` slot、`[data-conversation-content]`、`.wSkVaW_body{--dsh-chat-content-width:…}` 与消费点全部逐字等价，上游无内联写入该 token 的新路径 |

---

## 2. `dsh-code-card-fonts`

插件真源：`dsh-code-card-fonts/src/css.ts`（101 行）、`src/client.ts`（25 行未改）、`README.md`。
**工作区有未提交改动**：`README.md` / `src/css.ts` / `lib/client.js`（`git diff --stat` = 38 insertions, 3 deletions）。

### 2.1 依赖契约清单

| # | 契约（插件用的锚点） | 新产物命中 | 证据（新：文件:行） | 旧产物对照（文件:行） | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `[data-chat-flow-kind]`＝聊天流条目根（所有卡片规则的作用域） | 是 | `new/dsh-client-ui-chat/lib/client.js:1716`（`ChatNodeSeat` 的 `.flowItem` 包裹层） | `old/dsh-client-ui-chat/lib/client.js:1622` | 等价 |
| 2 | `[data-disclosure-row]`，标题＝**第 2 个直属子**（`> span:nth-child(2)`） | 是 | `new/dsh-client-ui-primitives/lib/index.js:3026`；子序 `3033-3050` = leading / title / collapsedContent | `old/dsh-client-ui-primitives/lib/index.js:1689`；子序 `1696-1712` 同序 | 等价（title 由裸 `span` 改为 `TextShimmer`，其根仍是 `span`：new primitives:2988-2996） |
| 3 | 摘要行＝第 3 个起直属子（`> :nth-child(n+3)`） | 是 | 同上 `new/dsh-client-ui-primitives/lib/index.js:3049`（`collapsedContent`） | 同上 `old/dsh-client-ui-primitives/lib/index.js:1711` | 等价 |
| 4 | `[data-open]`＝DisclosureRow 展开根，展开正文＝其非表头直属子 | 是 | `new/dsh-client-ui-primitives/lib/index.js:3023`、`3051` | `old/dsh-client-ui-primitives/lib/index.js:1686`、`1713` | 等价 |
| 5 | `[data-markdown-variant="compact"]`＝展开正文 Markdown 根 | 是 | `new/dsh-client-ui-primitives/lib/index.js:10863` | `old/dsh-client-ui-primitives/lib/index.js:8383` | 等价 |
| 6 | ReasoningRow 展开正文＝`MarkdownText variant="compact"` | 是 | `new/dsh-client-ui-chat/lib/client.js:5309` | `old/dsh-client-ui-chat/lib/client.js:2953` | 等价 |
| 7 | 压缩标记卡 `button > span:nth-last-child(3)`（标题）/`:last-child`（摘要）/`button[aria-expanded=true] + div`（正文） | 是 | `new/dsh-client-ui-chat/lib/client.js:249-290`（button 子序：leading/title/sep/summary＝4 span；body 284-289 为 button 相邻兄弟） | `old/dsh-client-ui-chat/lib/client.js:216-257` 同形 | 等价 |
| 8 | `[data-tool]`＝工具卡根 | 是 | `/tmp/dsh-audit/new/dsh-client-ui-tool/lib/client.js:1619`（`ToolRow.module.css` 的 `.root`） | `/tmp/dsh-audit/old/dsh-client-ui-tool/lib/client.js:1289` | 等价 |
| 9 | `[data-sample]`＝bash 卡表头根；`nth-last-child(3)`＝标题、`:last-child`＝摘要、`[data-sample] + *`＝展开正文 | 是 | `new/dsh-client-ui-tool/lib/client.js:2045`；子序 `2054-2078`（leading / status（条件）/ title / sep / summary）；`bodyWrap`＝`2080` | `old/dsh-client-ui-tool/lib/client.js:1817`；子序 `1826-1846`；`bodyWrap`＝`1848` | 等价（标题/摘要改由 `TextShimmer` 渲染，根仍为 `span`：new tool:2063-2077） |
| 10 | token `--dsw-font-markdown-code-block(-small)`（被 `[data-tool]`/`[data-sample]` 重指） | 是 | 主题定义 `new/dsh-client-ui-theme/lib/client.js`：`11px/19px`、`11px/16px`（与旧同值）；工具侧消费共 5 处：`new/dsh-client-ui-tool/lib/client.js:1350`（`ToolRow.module.css`，3 处）× `:1963`（`bash-sample.module.css`，2 处） | `old/dsh-client-ui-theme/lib/client.js` 同值；`old/dsh-client-ui-tool/lib/client.js:1177`（3 处）× `:1734`（2 处） | 等价 |
| 11 | `--dsh-chat-flow-gap`（列级卡片间距），设在 `body` | 是 | `new/dsh-client-ui-chat/lib/client.js:1582`：`.EvIC1a_column>…~…{margin-top:var(--dsh-chat-flow-gap,16px)}` | `old/dsh-client-ui-chat/lib/client.js:1520` | 等价 |
| 12 | 字号轴 `--dsh-content-font-size` / `-secondary` / `-delta` | 是 | `new/dsh-client-ui-theme/lib/index.js:56`（`document.body.style.setProperty`） | `old/dsh-client-ui-theme/lib/index.js:57` | 等价 |
| 13 | **过程组容器 `[data-step-process-body]` 自身声明 `--dsh-chat-flow-gap`**（0.1.7 新增容器 `ChatGroupSeat`，class 前缀 `O_Ebla_`） | **新增** | `new/dsh-client-ui-chat/lib/client.js:1822`：`.O_Ebla_body{--dsh-chat-flow-gap:8px;…}` + `.O_Ebla_expandedBody{--dsh-chat-flow-gap:16px;…}`；结构 `2031-2061`（`data-step-process` → `data-step-process-body` → `data-step-process-content`→成员） | `old/dsh-client-ui-chat/lib/client.js`：`data-step-process*` / `data-group-expanded-mode` **0 命中** | **需要迁移 → 已在未提交改动中完成** |
| 14 | **0.1.7 新增 `ToolDetails` 紧凑详情卡**（工具历史结果 JSON→卡片） | **新增** | `new/dsh-client-ui-tool/lib/client.js:1177`（`.DXqwVW_root{font:var(--dsw-font-xs-13)}`、`_caption/_statusText/_badge/_subtitle{font-size:12px}`、`_prose/_code{font-size:13px}`）；渲染 `1541`；模型/注册 `3441`、`3545-3576` | `old/dsh-client-ui-tool/lib/client.js`：`ToolDetails` **0 命中**；旧路径为 `.ioCard`（`old tool:1381-1406`）+ `.o3BgMG_ioCard{font:var(--dsw-font-markdown-code-block-small)}`（`old tool:1177`） | **需要迁移（未做）** |
| 15 | **0.1.7 新增 `turn-trigger` 节点卡** | **新增** | `new/dsh-client-ui-chat/lib/client.js:6206`（`section[data-turn-trigger]`）；CSS `6169`：`.oz9t_a_title{font:var(--dsw-font-xs-13)}`、`_time/_explanation/_content{font:var(--dsw-font-xxs-12)}`；节点种类注册 `6289` | `old/dsh-client-ui-chat/lib/client.js`：`turn-trigger` / `TurnTriggerNodeView` **0 命中**（旧为 `TurnTailNodeView`，old:3647） | **需要迁移（未做）** |
| 16 | 过程组标题 `.O_Ebla_title` 的字体来源 | 新增 | `new/dsh-client-ui-chat/lib/client.js:1822`：`.O_Ebla_title{font:inherit;font-size:var(--dsh-content-font-size,14px)}` | 无对应物 | 需复核风险（默认轴 14px 时无差；改设置后组标题随轴、成员卡片恒 14px） |
| 17 | `--dsw-font-xs-13`（新面用的固定 13px token） | 是 | `new/dsh-client-ui-theme/lib/client.js`：`13px/20px`（与旧逐字同） | `old/dsh-client-ui-theme/lib/client.js` 同值 | 等价（但**不被插件重指**） |

### 2.2 未提交改动的落地完整度（逐项核对）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 源码 `src/css.ts` 增加 `body [data-step-process-body]{--dsh-chat-flow-gap:calc(14px*0.5)}` | **已完成** | `dsh-code-card-fonts/src/css.ts:18-20`（`git diff` 新增块） |
| README 补充 ChatGroupSeat / 特异性 / 两状态共用一条规则 / 调整说明 | **已完成且与上游逐项对得上** | 见下表"README 论断核验" |
| 产物 `lib/client.js` 是否重新 build | **已 build** | `git diff` 显示 `lib/client.js` 同一规则 +10 行（`body [data-step-process-body]` 在 `lib/client.js:43`）；mtime 序 `src/css.ts` 15:40:32 → `README.md` 15:40:35 → `lib/client.js` 15:40:37（产物晚于源码） |
| 0.1.7 **其余**变化面 | **未完成** | 契约 #14 / #15（新卡片）、#16（组标题）均未在 `src/css.ts` 中出现（全文无 `turn-trigger` / `detailsBody` 相关选择器） |

README 新论断核验（全部成立）：
- `.O_Ebla_body` 收起/滚动态 8px、`.O_Ebla_expandedBody` 展开态 16px → 命中 `new chat:1822`；
- 组内间距取 `--dsh-chat-flow-gap` 的规则确为 `.O_Ebla_content>:not([hidden]):not(:empty)~:not([hidden]):not(:empty)` → 命中 `new chat:1822`；
- `[data-step-process-body]` 与 `.O_Ebla_body`/`.O_Ebla_expandedBody` **同元素**（`new chat:2044-2048`），插件 (0,1,1) 压过上游 (0,1,0) → 修复逻辑正确；
- 成员卡元素级例外 `[data-turn-process-answer]{--dsh-chat-flow-gap:8px}` 仍在 `.flowItem` 上 → 命中 `new chat:1582`，不受影响；
- 类前缀 `O_Ebla_` 与结构 `[data-step-process] > [data-step-process-body] > [data-step-process-content]` 与上游一致。

### 2.3 迁移结论

**需要迁移 —— 属于"未提交改动已部分完成"**：
1. 已完成：过程组内卡片间距被新容器覆盖这一处**破坏性**变更（也是唯一会"凭空失效"的点），源码与产物均已到位；
2. 未完成：0.1.7 新引入的两类卡片（`ToolDetails` 紧凑详情卡、`turn-trigger` 节点卡）自带 12/13px 字号。其旧版对应物分别是 `.ioCard`（吃被插件重指的 `--dsw-font-markdown-code-block-small`，旧版下确为 14px）与旧版不存在的节点类型；因此这是插件自身不变量（"卡片标题 / 摘要行 / **展开内容** / 代码块统一 14px"）的**新缺口**：`ToolDetails` 属"迁移遗漏"（旧形态曾被覆盖），`turn-trigger` 属"新面未纳入"。
3. 需复核（决策项）：过程组标题 `.O_Ebla_title` 取字号轴而非固定 14px。

### 2.4 若需迁移，需要改什么（具体到文件与符号，不实施）

写入文件仅 `dsh-code-card-fonts/src/css.ts`（改后 `npm run typecheck && npm run build` 重建 `lib/client.js`；README 同步）。

1. **`ToolDetails` 紧凑详情卡（工具历史结果）** — 需要新规则；注意 ToolDetails 根（`.DXqwVW_root`，`new tool:1313-1317`）**自带** `font:var(--dsw-font-xs-13)`，因此"只改包裹层字号靠继承"无效（元素自身声明胜继承），必须**直接命中该根**。它只有条件属性 `data-inspect`（有 inspect 时）与 `data-caption`（有 caption 时），**没有**无条件稳定 data 属性，滚动类名是 CSS-module 哈希，不能写。
   - 可选方案 A（结构锚点）：在 `src/css.ts` 末尾追加
     `[data-tool] [data-open] > div > * { font-size: 14px !important; }`
     —— 命中 `bodyWrap`（`new tool:1495-1496`，`detailsBodyWrap` 是哈希类名）下的 ToolDetails 根（`:1541`）及其它分支（CodeBlock / TerminalBlock / DiffBlock / ReadBlock / SearchBlock），这些分支本来就被 token 重指成 14px，放大无副作用；**但需要在浏览器采样后补豁免清单**：ToolDetails 内部按设计应为小号的元信息（`_caption`/`_badge`/`_subtitle`/`_statusText` 12px、`_prose`/`_code` 13px，`new tool:1177`）与代码块 banner 的复制按钮，否则会违反插件 README 第 10 行"摘要行以外的元信息保持组件自身字号"。
   - 可选方案 B（token 局部重指，**不建议**）：在 `[data-tool]` 内重指 `--dsw-font-xs-13` / `--dsw-font-xxs-12` —— 这两个 token 同时被 `searchRecovery` / `imageLabel` / `imageMeta` 等大量无关元素消费（`new tool:1350`），会波及卡片外文本。
   - 精确选择器与豁免清单需在浏览器里对真实 DOM 采样后定稿（本次审计不能加载/刷新页面 → **未确证**）。
2. **`turn-trigger` 节点卡** — 稳定锚点齐备，可直接加两条（`new chat:6213-6258` 的实际子序：header `button` 内 = `span.icon` / `span.title` / `time` / chevron svg；body `div` 内 = `p.explanation` / `div.content`）：
   - `[data-turn-trigger] button > span:nth-child(2) { font-size: 14px !important }`（标题 `.oz9t_a_title`，`new chat:6230-6233`）；
   - `[data-turn-trigger] > div > p, [data-turn-trigger] > div > div { font-size: 14px !important }`（`.oz9t_a_explanation` / `.oz9t_a_content`，`new chat:6244-6256`；`time` 时间戳按既有约定保持自身字号，不选）。
3. **过程组标题（决策项，可选）** — 若决定与成员卡片标题一致钉死 14px，可加
   `[data-step-process] button[aria-controls] { font-size: 14px !important }`（`new chat:1928-1932` 的 `ProcessGroupHeader` 按钮带 `aria-controls`/`aria-expanded`，是稳定锚点）。保持现状则无需改动，但 README 的"卡片标题统一 14px"需补充说明该例外。

---

## 3. `dsh-rightbar-fonts`

插件真源：`dsh-rightbar-fonts/src/css.ts`（85 行）、`src/client.ts`；无未提交改动。

### 3.1 依赖契约清单

| # | 契约 | 新产物命中 | 证据（新：文件:行） | 旧产物对照（文件:行） | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `[data-textpreview-body]`＝右栏文本/代码/Markdown 预览正文容器 | 是 | `new/dsh-client-ui-sidebar-documentpreview/lib/client.js:945`（text 态，class 同 `.dhJKeW_body`）、`:786`（unsupported 态） | `old/…/documentpreview/lib/client.js:927`、`:788` | 等价 |
| 2 | 该容器 CSS：`font-size:var(--dsh-content-font-size-secondary,13px)`（插件 ① 覆盖点） | 是（逐字相同） | `new/…/documentpreview/lib/client.js:476`（CSS 常量里的 `.dhJKeW_body{…font-size:var(--dsh-content-font-size-secondary,13px);font-family:var(--dsw-font-mono…);…}`） | `old/…/documentpreview/lib/client.js:476` 同串 | 等价 |
| 3 | `[data-textpreview-page]`（纯文本分页 `<pre>`，吃代码 token） | 是 | `new/…/documentpreview/lib/client.js:522`；CSS `.dhJKeW_page{font:var(--dsw-font-markdown-code-block)}` 在 `:476` | `old`：`:525`；CSS 同串在 `:476` | 等价 |
| 4 | `[data-changes-review]`＝变更审阅 tab 根（插件 ② 覆盖点） | 是 | `new/dsh-client-ui-deliverables/lib/client.js:1825`（根 div 同时带 `FileDiff_module_css_default.root`） | `old/dsh-client-ui-deliverables/lib/client.js:1506`（旧为 `ReviewTab_module_css_default.root`） | 等价（模块被拆出 `FileDiff.module.css`，根节点、属性不变） |
| 5 | diff 正文吃 `font:var(--dsw-font-markdown-code-block)` | 是 | `new/dsh-client-ui-deliverables/lib/client.js:620`（`.IP6KhG_body{…font:var(--dsw-font-markdown-code-block);…}`） | `old/…/deliverables/lib/client.js:1244`（`.ZDDmpq_body{…font:var(--dsw-font-markdown-code-block);…}`） | 等价 |
| 6 | `[data-diff-line]`＝每个 diff 行（三形态：`line`/`splitLine`/`sideLine`） | 是 | `new/…/deliverables/lib/client.js:906`（sideLine）、`:959`（splitLine）、`:981`（line）；行高硬编码 `min-height:22px;line-height:22px` 在 `:620` CSS | `old/…/deliverables/lib/client.js:1740`、`:1784`、`:1806`；`:1244` CSS | 等价 |
| 7 | `[data-document-markdown]`＝右栏 Markdown 预览的 MarkdownBody 根，且位于 `[data-textpreview-body]` 内 | 是 | `new/…/documentpreview/lib/client.js:1561`（`MarkdownBody_module_css_default.document`，注册在 `sidebar.right.tab.document`：`1616`）；渲染进 `[data-textpreview-body]` 的 `renderSlot(...)` 在 `:960` | `old`：`:1429`；注册 `:1483`；`renderSlot` `:942` | 等价（new 多传 `pathImages`，见 release note 的本地图片修复） |
| 8 | `--dsw-font-markdown-table` / `-table-head`（表格单元格 secondary 档） | 是 | 主题：`new/dsh-client-ui-theme/lib/client.js`（`…secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px))`）；消费 `new/dsh-client-ui-primitives/lib/markdown/MarkdownText.module.css:249`（th）/`:258`（td） | `old` 主题同值；`MarkdownText.module.css` 同文件（见 #10） | 等价 |
| 9 | 行内代码：`.markdown :not(pre)>code{font-size:.875em !important}` + `.tableScroll table code{font-size:11px}` | 是 | `new/…/primitives/lib/markdown/MarkdownText.module.css:163-169`、`:273-274` | `old/…/MarkdownText.module.css` 同文件、同行号 | 等价 |
| 10 | `MarkdownText.module.css` 整体是否有变 | 是（仅 1 处无关改动） | `new:210`：`padding-bottom: var(--dsh-scrollbar-width, 5px)` | `old:210`：`…, 8px)` | 等价（与字号无关） |
| 11 | 代码块 token `--dsw-font-markdown-code-block`（固定 11px 的来源） | 是 | 主题 `new/dsh-client-ui-theme/lib/client.js`：`11px/19px var(--ds-font-family-code)`、`-small:11px/16px` | `old` 逐字同值 | 等价 |
| 12 | `--dsh-content-font-size` 轴 + `--dsh-content-font-delta`（行高增量） | 是 | `new/dsh-client-ui-theme/lib/index.js:56`（内联设在 `document.body`）；delta 定义在 `new/dsh-client-ui-theme/lib/client.js` | `old/…/theme/lib/index.js:57`；delta 同值 | 等价 |
| 13 | CodeBlock 预览走 `[data-textpreview-body]` 内（`data-code-preview`） | 是 | `new/…/documentpreview/lib/client.js:5016`（`data-code-preview`，注册为 `sidebar.right.tab.document` 渲染器）→ 落在 `:960` 的 slot 内 | `old`：`:2239`、`:942` | 等价 |
| 14 | **0.1.7 新增：改动卡片悬停单栏 diff 预览**（`data-changes-hover-preview`）复用同一 FileDiff | **新增** | `new/…/deliverables/lib/client.js:1179-1210`（`ChangedFilePreview`；根 `:1190-1192`，`split:false`） | `old/…/deliverables/lib/client.js`：`data-changes-hover-preview` **0 命中**；旧仅 `TextDiff` 一处渲染（`:1689`） | **需复核风险**（新面不在 `[data-changes-review]` 内 → ②、③ 规则均不覆盖；该面仍是固定 11px + 22px 行高） |
| 15 | 0.1.7 新增预览类型（Excel/CSV、PDF/Office/图片缩放） | 新增 | `new/…/documentpreview/lib/client.js`：`data-document-zoom-*`（`:4238-4730`）、`data-image-preview`（`:4716`）、`data-html-preview`（`:3998`）；Excel 在 `client.excel.js`（`data-excel-preview`） | 旧已有 `data-image-preview` / `data-html-preview`，无 Excel / zoom | 不受影响（均不在 `[data-textpreview-body]` 内 —— `grep -c data-textpreview-body client.excel.js client.pdf.js` = 0；非字号轴文本面，不在插件声明范围） |

### 3.2 迁移结论

**不受影响**（声明范围内 13 条契约逐条等价，插件三条规则的作用链完整）：
- ① `[data-textpreview-body]` 仍是 `.dhJKeW_body`，仍取 secondary 档、其内 `<pre data-textpreview-page>` 仍吃固定 11px 代码 token → 重指 token + `font-size` 覆盖仍有效；Markdown/CodeBlock 预览仍是该容器的 slot 子内容；
- ② `[data-changes-review]` 根节点与 `[data-diff-line]` 三形态齐全，`.body` 仍消费 `--dsw-font-markdown-code-block`，行高仍硬编码 22px → token 重指与行高增量规则仍有效（0.1.7 把 diff 抽成 `FileDiff.module.css`，但根 div 同时挂了新旧两个 class，DOM 属性未变）；
- ③ `[data-document-markdown]` 仍是 `[data-textpreview-body]` 的后代，th/td 仍吃 `--dsw-font-markdown-table(-head)`，行内代码仍是 `.875em !important`（(0,2,2)+`!important` 仍压过上游 (0,1,2)+`!important`）。

**需复核风险（新增面，非回归）**：0.1.7 新增「改动卡片悬停查看单栏差异」（release note：*"文件改动卡片支持悬停查看单栏差异，无需先打开侧边栏；侧边栏仍默认左右分栏"*）。该面复用同一 `FileDiff`（`data-diff-line` 齐全），但容器是 `data-changes-hover-preview` 且**不在** `[data-changes-review]` 内，位置在对话区而非右栏 → 插件的 token 重指与 22px 行高增量对它无效，它保持上游默认（固定 11px 代码 token + 22px 行高）。**这符合插件 README 声明范围（"右栏…"），故不判"需要迁移"**；若用户希望"变更 diff 全局跟随字号轴"，才需扩展。

### 3.3 若需迁移，需要改什么（具体到文件与符号，不实施）

仅在用户决定覆盖新悬停面时，改 `dsh-rightbar-fonts/src/css.ts`（然后 `npm run build`）：

1. 在 `CSS` 模板串中，把现有两条 `[data-changes-review] …` 规则的锚点改为"与集"形式，或另加一组同体规则，锚点用 `[data-changes-hover-preview]`：
   - `[data-changes-hover-preview] { --dsw-font-markdown-code-block: ${CODE_FONT}; }`（对应现有 ② 第 53-55 行那条）；
   - `[data-changes-hover-preview] [data-diff-line] { min-height: ${LINE_HEIGHT} !important; line-height: ${LINE_HEIGHT} !important; }`（对应现有 58-61 行）。
2. 注意该面是**对话区**内的悬停卡（`new deliverables:1190`），与 `dsh-code-card-fonts` 的 `[data-chat-flow-kind]` 作用域可能重叠（悬停卡由改动卡片弹出）；若两个插件同时覆盖同一元素，需确认字号目标一致（两者都是 14px 轴档，不冲突）。
3. 另可选：新预览类型（Excel/PDF/图片缩放）不属字号轴面，**不建议**纳入。

---

## 4. `dsh-rightbar-tab-width`

插件真源：`dsh-rightbar-tab-width/src/css.ts`（16 行，一条规则）。无未提交改动。
dockkit 全部位于 `dsh-web-frontend` 打包产物内（`dist/assets/index-*.js`，128 行压缩文件，证据统一落在 `:124`；CSS 为 2 行文件，证据落在 `:1`）。

### 4.1 依赖契约清单

| # | 契约 | 新产物命中 | 证据（新） | 旧产物对照 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `[data-dockkit-tab]` 与 `role="tab"` 在**同一元素** | 是 | `new/dsh-web-frontend/dist/assets/index-DU8FBaxM.js:124`：`jsxs("div",{role:"tab","aria-selected":…,className:…_tab…,"data-dockkit-tab":x,…})` | `old/…/index-8VXBH-f-.js:124` 同形 | 等价 |
| 2 | 上游胶囊默认宽＝地板（内容盒 80px + 左右各 10px 内边距） | 是（逐字相同） | `new/dsh-web-frontend/dist/assets/index-Uv-aF9RH.css:1`：`._tab_11olo_134{…min-width:80px;max-width:170px;height:28px;padding:0 10px;…}`（无 `box-sizing`，即 content-box） | `old/…/index-lP1BfJ4l.css:1`：`._tab_eq9i1_156{…min-width:80px;max-width:170px;height:28px;padding:0 10px;…}` | 等价 |
| 3 | 芯片宽度预算＝取 pane 内首个 `[data-dockkit-tab]` 的计算后 `min-width`（border-box 判定 + padding/border 回加） | 是（逐字相同） | `new/…/index-DU8FBaxM.js:124`：`function eS(n){const i=n.querySelector("[data-dockkit-tab]");if(i===null)return d1.chip;const o=getComputedStyle(i),s=W1(o.minWidth);return s<=0?d1.chip:o.boxSizing==="border-box"?s:s+W1(o.paddingLeft)+…}` | `old/…/index-8VXBH-f-.js:124`：`function jw(e){…s<=0?sn.chip:i.boxSizing==="border-box"?s:s+Pn(i.paddingLeft)+…}` | 等价 |
| 4 | `SPLIT_MINIMUMS.chip`（预算地板值） | 是（同值） | `new/…/index-DU8FBaxM.js:124`：`const d1={divider:0,chip:100,body:48}` | `old/…/index-8VXBH-f-.js:124`：`const sn={divider:0,chip:100,body:48}` | 等价 |
| 5 | 分栏判定用该 chip 预算（`row: f>=u+n.chip`） | 是（逐字相同） | `new/…/index-DU8FBaxM.js:124`：`function v8(e,n=d1){…return{row:f>=u+n.chip,column:p>=s.height+n.body}}`；预算入口 `function rS(e,n=!1){const o={divider:tS(e),chip:eS(e),body:d1.body},…` | `old/…/index-8VXBH-f-.js:124`：`function l7(e,r=sn){…}`；`function Mw(e,r=!1){const i={divider:bw(e),chip:jw(e),body:sn.body},…` | 等价 |
| 6 | 无全局 / 针对 dockkit tab 的 `box-sizing` 重置会改变上游默认预算 | 确认为否 | `new/…/index-Uv-aF9RH.css`：`box-sizing` 共 14 处，但 **无** `*` / `html` / `body` / `:root` / `::before` 全局选择器带该属性；`_tab_*` 中带 `box-sizing` 的只有 `._tab_9vpp4_37`（另一模块 9vpp4＝SegmentedTabs），dockkit 的 `._tab_11olo_134` 不含 → dockkit tab 保持 content-box | `old/…/index-lP1BfJ4l.css`：`box-sizing` 共 11 处，同样无全局重置、无 `_tab_*` 带该属性 | 等价 |
| 7 | 胶囊 CSS 的其它选择器是否也用 `[data-dockkit-tab]` 设宽度（会与插件同特异性竞争） | 确认为否 | `new/…/index-Uv-aF9RH.css:1` 中 `data-dockkit-tab` 的 2 处命中均为 `[data-dockkit-tab-clipped]` 蒙版规则 | `old/…/index-lP1BfJ4l.css:1` 同样 2 处 | 等价 |

### 4.2 迁移结论

**不受影响**。插件规则 `[data-dockkit-tab][role="tab"]{box-sizing:border-box;min-width:100px;max-width:100px}`（特异性 (0,2,0)）仍压过上游单类名 `._tab_xxx` (0,1,0)；上游把该 tab 的**计算后** `min-width` 当胶囊预算，border-box 下读到 100，与 `chip:100` 相等 → 分栏判定与上游默认**逐字等价**（上游 content-box 默认：80 + 10 + 10 = 100）。0.1.7 未改动 dockkit 的 tab DOM、CSS 与预算算法。

### 4.3 若需迁移，需要改什么

无。（`CAPSULE_WIDTH_PX` 仍为 100；若未来上游改 80/10 或引入全局 border-box 重置，才需重算 —— 建议在 README 里把"100 = 上游地板"的依据指向 `index-*.js` 的 `chip:100` 与 `._tab_*` 的 `min-width:80px;padding:0 10px` 两处，便于下次核对。）

---

## 5. `dsh-fullwidth-chat`

纯 JS 插件，`lib/client.js` 即源码（32 行有效代码，一条规则）。无未提交改动。

### 5.1 依赖契约清单

| # | 契约 | 新产物命中 | 证据（新：文件:行） | 旧产物对照（文件:行） | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `[data-slot="main.conversation"]`＝`display:contents` 的 SlotOutlet 锚点 | 是 | `new/dsh-client-ui-renderer/lib/client.js:1099-1102`（`div[data-slot=slotKey][style=display:contents]`）；slot key 注册 `new/dsh-client-ui-conversation/lib/client.js:17734`，渲染 `:16162`；类型 `…/lib/types/client/contract/slots.d.ts:122` | `old/dsh-client-ui-renderer/lib/client.js:1099-1102`；conversation `:16830`、`:15289`；types `:118` | 等价 |
| 2 | `[data-conversation-content]`＝会话内容节点（`.wSkVaW_body`） | 是 | `new/dsh-client-ui-conversation/lib/client.js:16139-16143`（`className: clsx(ConversationRoot_module_css_default.body, variant==="embedded" && …embeddedBody)` + `"data-conversation-content": ""`） | `old/dsh-client-ui-conversation/lib/client.js:15266-15270` 同形 | 等价 |
| 3 | 该节点自身声明 `--dsh-chat-content-width`（插件必须打在同一元素上） | 是（逐字相同） | `new/dsh-client-ui-conversation/lib/client.js:15623`：`.wSkVaW_body{--dsh-chat-content-width:var(--dsh-chat-user-width,clamp(680px, calc(var(--dsh-conversation-column-width,0px)*.64), 920px));--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);…}`；`.wSkVaW_embeddedBody{--dsh-chat-content-width:min(calc(100% - 32px), 920px);…}` | `old/…/conversation/lib/client.js:14743` 同串、逐字相同 | 等价 |
| 4 | 上游是否有**内联**写入 `--dsh-chat-content-width` 的新路径（内联会压过样式表规则） | 确认为否 | `grep -- '--dsh-chat-content-width' new/dsh-client-ui-conversation/lib/client.js` = **1 处，即上述 CSS 常量** | `old` 同样只有 1 处 | 等价 |
| 5 | 上游内联设置的宽度变量只在祖先上 | 是 | `new/…/conversation/lib/client.js:15785`（`setProperty("--dsh-conversation-column-width", …)`）、`:15787-15788`（`--dsh-chat-user-width` 或 remove）、`:15807`；均在 `target`/`container.parentElement` | `old`：`:14899`、`:14901-14902`、`:14921` 同形 | 等价 |
| 6 | 消费点 `.EvIC1a_column{max-width:var(--dsh-chat-content-width)}`（聊天列） | 是 | `new/dsh-client-ui-chat/lib/client.js:1582`：`.EvIC1a_column{max-width:var(--dsh-chat-content-width);flex-direction:column;width:100%;margin:0 auto;display:flex}` | `old/dsh-client-ui-chat/lib/client.js:1520` 同串 | 等价 |
| 7 | `--dsh-composer-card-max-width`（composer 卡片）在同元素上由被覆盖的 token 派生 | 是 | 同 #3（同一声明块）；消费 `new/dsh-client-ui-conversation/lib/client.js:15623` 内 `.wSkVaW_*` 与 chat 侧 | `old` 同 | 等价 |
| 8 | `[data-width-handle]`（拖拽手柄，插件 README 里"归零"的已知限制） | 是 | `new/…/conversation/lib/client.js:15767`（`"data-width-handle": props.side`，class `.widthHandle`） | `old/…/conversation/lib/client.js:14880` | 等价（new 去掉 `data-dragging`，与插件无关） |
| 9 | `.EvIC1a_flowItem:empty` 语义变化是否影响全宽 | 有变化但不影响本插件 | `new chat:1582`：`.EvIC1a_flowItem:empty{height:0}` | `old chat:1520`：`.EvIC1a_flowItem:empty{display:none}` | 不受影响（与宽度轴无关） |

### 5.2 迁移结论

**不受影响**。插件规则 `[data-slot='main.conversation'] [data-conversation-content]{--dsh-chat-content-width:100%}`（(0,2,0)）仍命中：`data-slot` 锚点由 SlotOutlet 原样渲染（`display:contents`，仍构成祖先关系），`data-conversation-content` 与上游 token 声明仍在同一元素，特异性仍压过 `.wSkVaW_body`/`.wSkVaW_embeddedBody` (0,1,0)，且上游仍只在祖先上内联写 `--dsh-chat-user-width`/`--dsh-conversation-column-width`（不写目标 token），故 100% 仍生效、`--dsh-composer-card-max-width` 仍随之重算。已知限制（拖拽手柄归零）与 0.1.6 相同。

### 5.3 若需迁移，需要改什么

无。

---

## 6. 复现命令（只读）

```sh
# 契约存在性（示例）
grep -nF 'data-step-process-body' /tmp/dsh-audit/new/dsh-client-ui-chat/lib/client.js
grep -nF 'data-sample'          /tmp/dsh-audit/{old,new}/dsh-client-ui-tool/lib/client.js
grep -nF 'data-changes-review'  /tmp/dsh-audit/{old,new}/dsh-client-ui-deliverables/lib/client.js
grep -noF 'chip:100'            /tmp/dsh-audit/{old,new}/dsh-web-frontend/dist/assets/index-*.js
grep -nF 'data-conversation-content' /tmp/dsh-audit/{old,new}/dsh-client-ui-conversation/lib/client.js

# 未提交改动的产物一致性（code-card-fonts）
git -C /Users/lz/dsh-plugins diff -- dsh-code-card-fonts
stat -f '%Sm %N' /Users/lz/dsh-plugins/dsh-code-card-fonts/src/css.ts \
                 /Users/lz/dsh-plugins/dsh-code-card-fonts/lib/client.js
```

## 7. 未确证 / 需后续在浏览器验证的点

1. `ToolDetails` 紧凑详情卡要豁免哪些"小号元信息"元素（复制按钮、inspect 按钮等）——需要真实 DOM 采样；本审计只确证现存选择器命不中它、以及它自带 12/13px。
2. 过程组标题是否应由插件钉死 14px（设计决策，不是契约问题）。
3. `dsh-client-ui-tool` / `dsh-client-ui-goal` 两份对照包由本审计临时补齐于 `/tmp/dsh-audit/`（源：npm registry tarball 与全局安装目录），不是 Lead 原始对照树的组成部分。
