# dsh-code-card-fonts

本地持久化 Web UI 补丁:强制**所有代码块**以及**所有对话卡片**(工具卡片、思考卡片、命令/压缩/重试/错误/上下文等卡片)的字号统一,并跟随 Web UI 的「字号大小」设置项取值。

- 字号**不写死**,而是引用 CSS 变量 `var(--dsh-content-font-size, 14px)`,与 Web UI「字号大小」设置项共用同一个变量。用户在设置面板调字号,代码块与卡片会同步变化。
- 保留 `!important`:作用是压过卡片内部子元素自带的显式 `font-size`(`.summary`、`.ioText`、`.ioCard` 等),保证"全部后代统一字号"的核心效果;它压的是**级联来源**,而非取值。最终字号值由设置项决定。

## 解决的问题

- 代码块(`pre`/`pre code`)由 Shiki 渲染,直接对文本所在元素设 font-size 即可生效。
- 卡片根元素设 font-size 无效:卡片内部的大多数文本元素(`.summary`、`.ioText`、`.ioCard` 等)自带显式 font-size,覆盖了继承值。因此每个卡片规则都覆盖**根 + 所有后代(`*`)**,用 `!important` 强制实际文本节点的字号。

## 选择器依据(稳定 data 属性,抗 CSS-module 哈希)

| 目标 | 选择器 |
| --- | --- |
| 代码块 | `pre`, `pre code` |
| 工具卡片(通用 ToolRow:read/edit/write/grep/glob/web/todo/ask) | `[data-tool]` |
| bash 工具卡片(独立 BashRow sample) | `[data-sample]` |
| 思考/推理卡片 | `[data-variant="think"]` |
| 其他对话卡片 | `[data-chat-flow-kind]`(存在性选择器,覆盖 command/manual-compaction/compaction/model-retry/turn-error/turn-max-tokens/turn-process/context/system-prompt/tool-call/workflow-run 及未来新增的 kind) |

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

1. 包结构:`package.json`(`dsh.client.platform=web` + `dsh.bundle.patch`)、`lib/index.js`(空 Host 半部)、`lib/client.js`(浏览器半部,`window.__ModuleLoader__.load(...)` 注入 `<style>`)、`cordis.patch.yml`(挂载行)。
2. 浏览器半部由 `dsh.client.platform: "web"` + `immediately: true` 注册进浏览器 roster，随 Web 一起加载。
3. 改动后需**重启 App** 生效(组成为常驻挂载,不做热重载)。

## 调整字号

字号已改为跟随 Web UI「字号大小」设置项,无需改代码:在设置面板调字号,代码块与卡片即同步变化(因 CSS 引用 `var(--dsh-content-font-size, 14px)`)。

若要脱离设置项、写死固定字号,把 `lib/client.js` 中 `CSS` 数组里的 `var(--dsh-content-font-size, 14px)` 换成目标值(如 `14px`),重启 App 即可。