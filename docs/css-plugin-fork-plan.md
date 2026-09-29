# 本地 CSS 插件 → 上游源码落地：仅保留 CF9 / CF15 / RB2 / RB3 / RB5 / FW1

> 分析基线：`C:\Users\LGZ\IdeaProjects\deepseek-harness` @ `4878cdabd8`（`0.2.0-rc.1`），本地插件 `C:\Users\LGZ\dsh-plugins` @ `48cb3ca`。
>
> 只保留下面 6 条规则，其余全部放弃。落位只需 **2 个 fork**：`ui-theme` 吃掉 5 条（CF9 CF15 RB2 RB3 RB5），`ui-conversation` 吃掉 1 条（FW1）。

## 规则总表

| 编号 | 来源 | 现状选择器 / 声明 | 视觉效果 | 源码落位 |
|---|---|---|---|---|
| CF9 | `dsh-code-card-fonts/src/css.ts:36-39` | `[data-chat-flow-kind] pre, [data-chat-flow-kind] pre code { font-size: 14px !important }` | **聊天内围栏代码块 11px/19px → 14px**（行高仍 19px） | `ui-theme/src/styles/gradient-shadow-text.css:169` `--dsw-font-markdown-code-block: 11px/19px` |
| CF15 | `dsh-code-card-fonts/src/css.ts:63-67`（`:69-72` 是同一 token 的补丁，被本条吸收） | `[data-tool], [data-sample] { --dsw-font-markdown-code-block-small: 14px/16px …; --dsw-font-markdown-code-block: 14px/19px … }` | **所有工具行、bash/终端样例子树里的代码块 11px/19px → 14px/19px，小块 11px/16px → 14px/16px** | `gradient-shadow-text.css:169` 与 `:177` |
| RB2 | `dsh-rightbar-fonts/src/css.ts:17-20`（`:19`） | `[data-textpreview-body] { --dsw-font-markdown-code-block: 14px/22px var(--ds-font-family-code) }` | **右侧预览的纯文本页与代码围栏 11px/19px → 14px/22px** | `gradient-shadow-text.css:169`；消费点 `ui-sidebar-documentpreview/src/client/TextPreview.module.css:101` 的 `.page` |
| RB3 | `dsh-rightbar-fonts/src/css.ts:22-24` | `[data-changes-review] { --dsw-font-markdown-code-block: 14px/22px var(--ds-font-family-code) }` | **变更审查（Review 标签）diff 正文 11px/19px → 14px/22px**（hover 预览卡走 `data-changes-hover-preview`，不受影响） | `gradient-shadow-text.css:169`；消费点 `ui-deliverables/src/client/FileDiff.module.css:5` 的 `.body` |
| RB5 | `dsh-rightbar-fonts/src/css.ts:31-35` | `[data-document-markdown] { --dsw-font-markdown-table / -table-head / -code-block: … }` | **Markdown 预览：表格 13px → 14px（行高 22px 不变），代码围栏 11px → 14px（14px/22px）** | `gradient-shadow-text.css:120` / `:127` / `:169`；作用域元素 `ui-sidebar-documentpreview/src/client/markdown/MarkdownBody.tsx:35` |
| FW1 | `dsh-fullwidth-chat/lib/client.js:7` | `[data-slot='main.conversation'] [data-conversation-content] { --dsh-chat-content-width: 100% }` | **对话列占满中央栏**（不再被 `clamp(680px, 栏宽 × 0.64, 920px)` 限制在 920px）。连带：composer 卡片变宽、宽度拖拽手柄随内容边缘归零、用户气泡轴变成体宽 70.2% | `ui-conversation/src/client/skeleton/ConversationRoot.module.css:384-387` |

## 落位要点

- **`ui-theme` fork**：`:169` 的 `--dsw-font-markdown-code-block` 改 `14px/19px`、`:177` 的 `-small` 改 `14px/16px` —— 这一步同时满足 **CF9 与 CF15**（两者要的就是 14px/19px 与 14px/16px）。
- **RB2 / RB3 / RB5 不能只靠改默认 token**：三者要的是 **22px 行高**（`calc(22px + var(--dsh-content-font-delta, 0px))`），而默认 token 是 19px。要在 `ui-theme` fork 里按原作用域保留三条重绑：`[data-textpreview-body]`（RB2）、`[data-changes-review]`（RB3）、`[data-document-markdown]` 的表格与围栏（RB5）。**不要**用"把 `--dsh-content-font-size-secondary` 全局提到 14px"来替代表格那一条 —— 那会连带放大 11 个包里约 60 处次级文本，等于把已放弃的 CF5 / CF8 / CF11 / CF13 / CF14 / RB1 一起请回来。
- **`ui-conversation` fork（FW1）**：`ConversationRoot.module.css:384-387` 去掉 `var(--dsh-chat-user-width, …)` 一层、写死 `100%`（embedded 变体 `:395` 视需要一起改），同时停掉 `ConversationWidthControls.tsx` 的宽度偏好写入（`localStorage['dsh.conversation.contentWidth']`，写入口 `:137-144` / `:158-166`）——只改 CSS 不保证全宽。
