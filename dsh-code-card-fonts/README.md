# dsh-code-card-fonts

本地持久化 Web UI 补丁:强制**所有代码块**以及**所有对话卡片**(工具卡片、思考卡片、命令/压缩/重试/错误/上下文等卡片)的字号为 **14px**。

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
| 其他对话卡片 | `[data-chat-flow-kind="..."]`(command/manual-compaction/compaction/model-retry/turn-error/turn-max-tokens/turn-process/context/system-prompt/tool-call/workflow-run) |

## 加载说明

按工作区 AGENTS.md 的本地 npm 包约定:

1. 包结构:`package.json`(`dsh.client.platform=web` + `dsh.bundle.patch`)、`lib/index.js`(空 Host 半部)、`lib/client.js`(浏览器半部,`window.__ModuleLoader__.load(...)` 注入 `<style>`)、`cordis.patch.yml`(挂载行)。
2. Web profile 挂载(已配置):在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中登记,`node_modules` 用 `link:` 指向本目录。
3. 改动后需**重启 App** 生效(组成为常驻挂载,不做热重载)。

## 调整字号

编辑 `lib/client.js` 中的 `CSS` 数组,把所有 `14px` 换成目标值,重启 App 即可。