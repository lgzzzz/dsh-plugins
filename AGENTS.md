# AGENTS.md — DSH 本地插件开发补充要点（技能未覆盖部分）

> 本工作区根目录的插件开发指导。通用流程、平台选择、生命周期与副作用、版本与批准、
> 常见失败排查等内容由两个技能完整覆盖：`cordis-plugin-development` 与
> `editing-cordis-compositions` —— 写码前请先加载并遵循它们，本文件不再重复。
>
> 本文件只记录技能**未提及**、且经本工作区实测/核实过的要点。

## 1. 持久化：落地为本地 npm 包（本工作区约定）

动态 Cordis 定义仅存于进程内存，重启即失效。需要长期保留 → 采用工作区内的本地 npm 包约定：

```
<workspace>/<package-name>/
├── package.json      # type=module、main、exports、dsh.client.platform=web、dsh.bundle.patch
├── lib/index.js      # Host 半部（ESM）：export const name + export function apply(ctx)
├── lib/client.js     # 浏览器半部（window.__ModuleLoader__.load(...)），仅 web 平台需要
├── cordis.patch.yml  # （可选）web 组成补丁：把 client.js 挂进浏览器 roster
└── README.md         # 该包用途 + 加载说明
```

加载方式（由用户自行进行）：
- Host：在 agent preset 的 `agent.cordis.yml` 加一行，`name` 用绝对路径（Windows 用正斜杠）：
  ```yaml
  - id: <your-row-id>
    name: C:/Users/<user>/.dsh/<package-name>/lib/index.js
  ```
- Client：应用 `cordis.patch.yml`（同 `dsh-fullwidth-chat` 的 `dsh.bundle.patch` 机制）。
- 改动后需重启 App 生效（组成为常驻挂载，不做热重载）。

现有本地包格式参照：`dsh-fullwidth-chat`（web 包）、`dsh-git-guard`（host 行）。
新增本地包时按惯例在 `.gitignore` 加 `!/<package-name>/` 以便纳入 git 管理。

## 2. 实测接口结论（可直接引用；写码前仍须用 Inspect 精确查询）

### 人类命令（Host Service `commands`）
- `CommandDefinition = { name(小写无斜杠), description, input?({hint}), recordInput?, handler(invocation) }`。
- `CommandInvocation = { commandId, agent, rawInput, signal }`。
- handler 返回 `CommandResult = {kind:'success', text?, sourceEventSeq?} | {kind:'error', text}`。
- 裸命令经 `commands.execute` 记录 `command/run` + `command/done`，渲染为对话流命令节点。
- 关键技巧：handler 返回 `{kind:'success'}` 不带 `text` 即不渲染多余提示文本。
- 客户端对应事件：`command/executed(sessionId, name, result)`（ui-commands 在本浏览器完成命令执行后 emit，用 `ctx.on` 监听）。

### 客户端会话/工作区（Client Service）
- `sessions`：`list.getSnapshot().current`（当前会话 id）、`binding(id).session`（业务 Session 面）。
- `session.getSnapshot()` → `{ running, subagent, queue, ... }`；`session.cancel()` 停止运行
  （普通会话走 `sessions.cancel`，可续子代理走 `subagents.interrupt`，one-shot 子代理不可取消）。
- `workspaces.startSession(workspaceId?)` = "新建会话"按钮的精确行为。
- 注意：`sessions.scope(id)` 返回 Context 会被动态 guard 拒绝；一律用 `sessions.binding(id).session`。

### 动态客户端执行环境
- 全局 `document` 可达，可直接 `addEventListener`；仅
  `setTimeout/setInterval/clearTimeout/clearInterval/fetch/require` 被 trap 并抛教学错误。

## 3. 参考实现（可直接借鉴）

- 命令实现：`@deepseek-ai/dsh-command-goal`、`@deepseek-ai/dsh-command-compact`。
- Client UI / Slot / 命令面：`@deepseek-ai/dsh-client-ui-*` 系列。
- 本地包格式：`dsh-fullwidth-chat`（web 包）、`dsh-git-guard`（host 行）。
- 完整 Hybrid 示例：`dsh-new-session-command`（Host 注册 `/new` 命令 + Client 响应跳转与 Esc 停止），
  细节见其 `README.md`。
