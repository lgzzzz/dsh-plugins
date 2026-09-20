# dsh-code-card-fonts

本地持久化 Web UI 补丁：把消息区**卡片标题**、**表头摘要行**、**卡片展开内容**、
**代码块**、**内联代码**与 **Markdown 表格单元格**统一为 **14px**，并把**卡片间距**设为
`calc(14px * 0.5)` = **7px**。

- **不覆盖**内容字号轴 `--dsh-content-font-size`：设置里的「字号大小」（范围 12..17）仍
  生效，正文、行高等派生变量随设置变化；卡片内文本字号恒为 14px。
- 每条规则精确命中目标元素，**不使用** `[data-x], [data-x] * { … }` 全量覆盖选择器；
  摘要行以外的元信息（inspect 按钮 11px、时间戳等）与用户 / 助手正文保持组件自身字号。
- 保留 `!important`：用于压过子元素自带的显式 `font-size`（`.summary`、`.ioText`、
  `.ioCard`、展开正文 Markdown 根的 `.compact`、`font:` 简写、内联代码的
  `.875em !important` 等）。

## 选择器（稳定 data 属性，抗 CSS-module 哈希）

| 目标 | 选择器 |
| --- | --- |
| 卡片标题（DisclosureRow 系） | `[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2)` |
| 卡片标题（bash / 压缩标记） | `[data-sample] > span:nth-last-child(3)`；`[data-chat-flow-kind="compaction"] button > span:nth-last-child(3)`（`manual-compaction` 同形） |
| 卡片摘要行（DisclosureRow 系） | `[data-chat-flow-kind] [data-disclosure-row] > :nth-child(n+3)` |
| 卡片摘要行（bash / 压缩标记） | `[data-sample] > span:last-child`；`[data-chat-flow-kind="compaction"] button > span:last-child`（`manual-compaction` 同形） |
| 代码块 | `[data-chat-flow-kind] pre`、`[data-chat-flow-kind] pre code` |
| 内联代码 | `[data-chat-flow-kind] :not(pre) > code` |
| Markdown 表格单元格 | `[data-chat-flow-kind] table th`、`[data-chat-flow-kind] table td` |
| 卡片展开正文（DisclosureRow 系） | 包裹层 `[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row])`；正文 Markdown 根 `… [data-markdown-variant="compact"]` |
| 卡片展开正文（压缩标记） | `[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div`（`manual-compaction` 同形） |
| 工具 / bash 卡片内容 | 在 `[data-tool]` / `[data-sample]` 上重指 `--dsw-font-markdown-code-block-small` 与 `--dsw-font-markdown-code-block`（主题默认 11px）；BashRow 的展开正文是表头 `[data-sample]` 的**相邻兄弟**，另在 `[data-sample] + *` 重指 |

要点：`[data-chat-flow-kind]` 打在聊天流条目根上，`[data-tool]` / `[data-sample]` 打在卡片
根上；`DisclosureRow` 表头带 `data-disclosure-row`、根在展开时带 `data-open`，展开正文恒为
表头的兄弟节点（`turn-process` 开关也带 `data-open`，故用 `:not([data-turn-process])` 排除）。

展开正文须**两层都命中**：自上游 `0.1.6-alpha.2` 起 `ReasoningRow` 的展开正文由纯文本改为
`MarkdownText variant="compact"`，`font-size` 也随之从正文包裹层移到 Markdown 根的自带
`.compact` 上（取 `--dsh-content-font-size-secondary`，默认设置下为 13px）。元素自身的
`font-size` 声明恒胜过从父级继承的值，因此只在包裹层写 14px 对正文无效——必须在带
`data-markdown-variant="compact"` 的 Markdown 根上直接命中（该属性是上游显式出口，非
CSS-module 哈希类名）。

## 卡片间距

聊天列用 `margin-top: var(--dsh-chat-flow-gap, 16px)` 控制卡片间距。本插件在 **`body`**
（而非 `:root`）声明 `--dsh-chat-flow-gap: calc(14px * 0.5)`：自定义属性内的 `var()` 在
**声明元素**上求值，而 `--dsh-content-font-size` 是主题以**内联样式**设在 `<body>` 上的，
放 `:root` 会取不到实际设置值。紧凑回答卡的元素级例外（`.flowItem[data-turn-process-answer]`
的 8px）保持不变。

## 调整

- 改字号：替换 `src/css.ts` 中所有 `14px`（含工具 / bash 卡片 token 的 `14px/…`）。
- 改间距：改 `src/css.ts` 中 `--dsh-chat-flow-gap` 的 `calc(14px * 0.5)`。
- 改完 `npm run typecheck && npm run build`；产物变化由 client-hmr 在 500ms 内热推送，
  页面无需重启 / 刷新。

## 构建与加载

```sh
npm run typecheck && npm run build && npm run check   # esbuild(JS API) → lib/client.js
```

```sh
dsh plugin --profile web add link:.                   # 从插件目录执行；重启 App 生效
dsh plugin --profile web remove dsh-code-card-fonts   # 卸载
```

浏览器半部：`src/client.ts`（注入 `<style>`）+ `src/css.ts`（样式真源）→ esbuild →
`lib/client.js`（入仓，禁止手改）。宿主半部 `index.ts` 为空宿主（Node Type Stripping
直载）。改 `src/` 后必须重新构建，否则补丁不生效。
