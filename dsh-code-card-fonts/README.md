# dsh-code-card-fonts

本地持久化 Web UI 补丁:把**消息显示区域所有卡片的标题**统一为 **15px**,把**卡片表头的摘要行**、**卡片展开后的内容**、**代码块**与**内联代码**统一为 **14px**;同时把**消息卡片之间的间距**设为内容字号的一半(14px × 0.5 = 7px)。

- 卡片标题 15px,与「字号大小」设置项无关,统一写死。
- 卡片表头摘要(标题右侧的单行预览:工具结果摘要、思考首行、命令/上下文摘要等)与卡片展开后的内容(工具输入/输出、思考正文、命令正文、上下文/系统提示词正文、代码块、内联代码等)统一为 14px。
- **不再使用 `[data-x], [data-x] * { ... }` 这类全量覆盖选择器**:每条规则都精确命中目标元素;摘要行以外的元信息(inspect 按钮 11px、时间戳、卡片内其他小字)以及用户/助手正文,都保持组件自身的字号,不再被压成同一档。
- 保留 `!important`:作用是压过卡片内部子元素自带的显式 `font-size`(`.summary`、`.ioText`、`.ioCard`、`font:` 简写、内联代码的 `.875em !important` 等),保证"标题 15px / 摘要与内容 14px"的核心效果。

## 消息卡片间距(内容字号的一半)

- 聊天列(`dsh-client-ui-chat`)用 `margin-top: var(--dsh-chat-flow-gap, 16px)` 控制相邻卡片间距,默认回退 16px,全局无其他定义。本插件在 `body` 上声明 `--dsh-chat-flow-gap: calc(14px * 0.5)`,即间距 = 14px × 0.5 = 7px。
- 覆盖声明在 `body` 而非 `:root`:自定义属性内部的 `var()` 在**声明元素**上求值,而 `--dsh-content-font-size` 是主题插件以**内联样式**设在 `<body>` 上的——放 `:root` 会取不到实际设置值、恒用回退 14px。
- 紧凑回答卡自带元素级规则 `.flowItem[data-turn-process-answer]{--dsh-chat-flow-gap:8px}`,元素级声明优先于继承,该例外(8px)保持不变。
- 调整比例:改 `src/css.ts` 中 `* 0.5` 为目标系数,`npm run build` 重建后重启 App 即可。

## 解决的问题

- 代码块(`pre`/`pre code`)由 Shiki 渲染,直接对文本所在元素设 font-size 即可生效。
- 内联代码(`` `...` ``)由 Markdown 渲染为 `code`,应用侧规则 `._markdown_* :not(pre)>code` 自带 `font-size: .875em !important`,特异性(0,1,2)高于一般属性选择器,因此用等特异性选择器 `[data-chat-flow-kind] :not(pre) > code` 覆盖(等特异性 + 本插件 `<style>` 后注入,靠文档顺序胜出)。
- 卡片根元素设 font-size 无效:卡片内部的大多数文本元素(`.summary`、`.ioText`、`.ioCard` 等)自带显式 font-size,覆盖了继承值。因此按目标元素分别精确覆盖,而不是对根 + 全部后代(`*`)一刀切。
- 标题 15px / 摘要 14px 是通过**更高特异性**的选择器覆盖内容规则实现的,不是调整继承。摘要行(而非摘要 + 全部后代)通过行内结构定位:DisclosureRow 表头里标题恒为第 2 个子元素,其后所有直属子元素即摘要行。
- 工具/bash 卡片的内容文本(I/O 文本、终端、code/read/diff/search/web 正文)由 `--dsw-font-markdown-code-block-small` / `--dsw-font-markdown-code-block` 两个字体 token 驱动(主题默认 **11px**,过小):在卡片根上重指这两个 token,只有消费它们的元素会变,inspect 按钮等次要文本不受影响。
- Bash 卡片(BashRow)是结构特例:`data-sample` 只打在**表头行**上,展开后的正文 `.bodyWrap`(命令输入/执行结果的 ioCard、TerminalBlock)是表头的**相邻兄弟节点**,既不在 `[data-sample]` 内、也不是 `[data-tool]` 的后代,因此须在表头的下一个兄弟 `[data-sample] + *` 上重指 token,命令与执行结果文本才会从默认 11px 变为 14px。

## 选择器依据(稳定 data 属性,抗 CSS-module 哈希)

| 目标 | 选择器 |
| --- | --- |
| 卡片标题(DisclosureRow 系:工具/思考/命令/上下文/系统提示词/workflow-run/cordis) | `[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2)` |
| 卡片标题(bash 卡片,BashRow) | `[data-sample] > span:nth-last-child(3)` |
| 卡片标题(压缩标记) | `[data-chat-flow-kind="compaction"] button > span:nth-last-child(3)`、`[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3)` |
| 卡片摘要行(DisclosureRow 系:标题之后的整条预览:分隔符/来源/摘要/后缀) | `[data-chat-flow-kind] [data-disclosure-row] > :nth-child(n+3)` |
| 卡片摘要行(bash 卡片,BashRow) | `[data-sample] > span:last-child` |
| 卡片摘要行(压缩标记) | `[data-chat-flow-kind="compaction"] button > span:last-child`、`[data-chat-flow-kind="manual-compaction"] button > span:last-child` |
| 代码块 | `[data-chat-flow-kind] pre`、`[data-chat-flow-kind] pre code` |
| 内联代码 | `[data-chat-flow-kind] :not(pre) > code` |
| 卡片展开正文(DisclosureRow 系:思考/命令/上下文/系统提示词/workflow-run 等) | `[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row])` |
| 卡片展开正文(压缩标记) | `[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div`、`[data-chat-flow-kind="manual-compaction"] button[aria-expanded="true"] + div` |
| 工具/bash 卡片内容(I/O 文本、终端、read/diff/search/web 正文) | 在 `[data-tool]`、`[data-sample]` 上重指 `--dsw-font-markdown-code-block-small` 与 `--dsw-font-markdown-code-block`;Bash 卡片(BashRow)展开正文是表头 `[data-sample]` 的**相邻兄弟节点**,另在 `[data-sample] + *` 上重指 |

说明:

- `[data-chat-flow-kind]` 打在每条聊天流条目的根元素上;`[data-tool]` / `[data-sample]` / `[data-variant="think"]` 打在卡片根上。
- 共享原语 `DisclosureRow` 在表头行打 `data-disclosure-row`,在根元素打 `data-open`(展开时),展开正文恒为表头行的**兄弟节点**,因此 `[data-open] > :not([data-disclosure-row])` 精确命中展开正文;`turn-process` 开关按钮也带 `data-open`,故用 `:not([data-turn-process])` 排除。
- 摘要行定位:表头行内标题恒为第 2 个直属子元素,其后所有直属子元素(分隔符圆点、来源标签、摘要文本、后缀)即整条预览/摘要行,故 `[data-disclosure-row] > :nth-child(n+3)` 命中摘要行而不触碰标题;bash/compaction 用「末位 span」等价定位。
- 展开正文内部大多 `font: inherit` 或直接是文本节点,设置正文容器 `font-size` 即可级联生效;个别元素(如工具 I/O 文本)自带 `font:` 简写,则通过 token 覆盖处理。

## 标题选择器说明

- 绝大多数卡片由共享原语 `DisclosureRow` 渲染:其表头行带 `data-disclosure-row` 属性,行内第 1 个子元素是 leading 图标(可能为 `<button>` 或 `<span>`),第 2 个子元素恒为标题 `<span>`。因此 `> span:nth-child(2)` 能稳定命中标题。
- bash 卡片(`BashRow`)不走 `DisclosureRow`:其表头行是 `[data-sample]`,子元素依次为 leading、可选隐藏状态、标题、分隔符、摘要——标题恒为**从末尾数第 3 个 span**。
- 压缩标记(compaction)的标题位于表头 `<button>` 内,同样是**从末尾数第 3 个 span**(其后只有分隔符与摘要)。

## 加载说明

本插件以本地 npm 包形式经 Web Profile 的 `link:` 依赖挂载（详见工作区
`AGENTS.md`「挂载与激活」）。从插件目录执行：

```sh
dsh plugin --profile web add link:.
# 重启 App 生效
```

`dsh plugin` 是 pnpm 转发器：执行 `pnpm add` 后会自动核对
`dsh.profile.bundles` —— 声明了 `dsh.bundle` 的依赖自动并入 bundle 列表，
无需手动改 `~/.dsh/profiles/web/package.json`。

卸载：

```sh
dsh plugin --profile web remove dsh-code-card-fonts
```

> 加载属于用户操作：代理交付插件后不得自行执行 `dsh plugin add`、
> `pnpm install` 或重启 App（强制规范第 1 条）。

挂载后：

1. 包结构:`package.json`(`dsh.client.platform=web` + `dsh.bundle.patch`)、`index.ts`(空 Host 半部,TypeScript)、`src/client.ts` + `src/css.ts`(浏览器半部 TypeScript 真源)、`lib/client.js`(浏览器半部构建产物)、`cordis.patch.yml`(挂载行)。
2. 浏览器半部由 `dsh.client.platform: "web"` + `immediately: true` 注册进浏览器 roster，随 Web 一起加载。
3. 改动后需**重启 App** 生效(组成为常驻挂载,不做热重载)。

## 工程结构(TypeScript)

- 浏览器半部为 TypeScript:`src/client.ts`(入口,注入 `<style>`)+ `src/css.ts`(样式真源);
  `npm run build`(`scripts/build-client.mjs`,esbuild)把 `src/` 打包成经
  `window.__ModuleLoader__.load({...})` 包装的单文件 `lib/client.js`。
  `lib/client.js` 为**构建产物、禁止手改**,已入仓以便离线加载。
- 宿主半部为 `index.ts`(空宿主),由 Node 22+ Type Stripping 直接加载,无需编译。
- 开发循环:`npm install` 后,`npm run typecheck`(tsc --noEmit)校验宿主与浏览器
  半部,`npm run build` 重建 `lib/client.js`,`npm run check` 对产物与宿主做语法检查。
  改了 `src/` 没重建,是插件改动不生效的最常见原因。

## 调整字号

- 标题字号当前**写死为 15px**;摘要行与内容(卡片展开内容、代码块、内联代码)写死为 **14px**。
- 若要改标题:替换 `src/css.ts` 中「卡片标题」区块里的 `15px`。
- 若要改摘要或内容:替换 `src/css.ts` 中 `CSS` 里的 `14px`(摘要行、代码块、内联代码、卡片正文),以及工具/bash 卡片 token 的 `14px/…` 与 `--dsh-chat-flow-gap` 的 `14px * 0.5`。
- 改完执行 `npm run typecheck && npm run build`,重启 App 生效。
