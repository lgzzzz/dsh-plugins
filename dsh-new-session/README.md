# dsh-new-session

本地 npm 包形式的持久化插件：新增 `/new` 斜杠命令，创建并跳转到一个新的空白会话，
行为等同点击"新建会话"按钮，无多余提示；同时按 `Esc` 可停止当前会话的整棵运行中
交互树。

| 功能 | 行为 |
| --- | --- |
| `/new` | 创建并跳转到一个新的空白会话（等同"新建会话"按钮），无多余提示 |
| 命令行抑制 | 隐藏 `/new` 的 "new 已完成" 生命周期行（命令仍持久记录，只是不渲染 UI 文本） |
| `Esc` | 停止当前会话的所有互动：自身运行（普通会话或可续式子代理）+ 所有运行中的子代理后代；跳过不可取消的一次性（one-shot）子代理；空闲时按 `Esc` 无副作用 |

## 结构

```
dsh-new-session/
├── package.json      # npm 包声明：type=module、dsh.client.platform=web、dsh.bundle.patch
├── lib/index.js      # Host 半部：注册 /new 命令（commands.register）
├── lib/client.js     # 浏览器半部：/new → uiWorkspace.startSession()；Esc → session.cancel()
├── cordis.patch.yml  # 网页组成补丁：把 lib/client.js 挂进浏览器 roster
└── README.md
```

## 加载方式（由用户自行进行）

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
dsh plugin --profile web remove dsh-new-session
```

> 加载属于用户操作：代理交付插件后不得自行执行 `dsh plugin add`、
> `pnpm install` 或重启 App（强制规范第 1 条）。

挂载后：

- Host 半部（`lib/index.js`）经 bundle 行解析 `exports["."]` 注册 `/new` 命令。
- 浏览器半部（`lib/client.js`）由包内 `dsh.client.platform: "web"` + `immediately: true`
  注册进浏览器 roster，随 Web 一起加载。

## 关键接口

- 新建会话按钮的精确行为是 **`uiWorkspace.startSession(workspaceId?)`**（客户端服务
  `uiWorkspace`，由 `dsh-client-ui-workspace` 提供）——注意不是 `workspaces` 服务
  （那是纯 Workspace Controller，没有 `startSession`）。
- 客户端会话服务为 `sessions`：`sessions.list.getSnapshot().current`、
  `sessions.binding(id).session`、`session.getSnapshot()` / `session.cancel()`。

## 修改说明

改动 `lib/*` 后需重启 App 生效（组成为常驻挂载，不做热重载）。
