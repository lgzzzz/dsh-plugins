# dsh-ui-chat

官方 `@deepseek-ai/dsh-client-ui-chat`（0.2.1-alpha.4）的**源码 fork**：`src/` 与官方一致，只改一处行为，并按本仓库的插件形态构建（包名 `dsh-client-ui-chat-lgz`、`private`、`dsh.bundle.patch`）。挂进 web profile 后，`cordis.patch.yml` 停用 `dsh-web-app` 里 id 为 `ui-chat` 的官方行，改挂本 fork。

-----

## 与官方的行为差异

只有一处，在 `src/client/presentation-policy.ts` 的 `POLICIES.verbose.foldCompletedTurns`：官方是 `false`，本 fork 是 `true`，即 Verbose（完全展开）模式下折叠已完成的轮次。

这个差异原先由独立插件 `dsh-ui-chat-verbose-fold` 在运行时改写 `conversation.view#chat` 注入面的 `hooks.presentation` 快照实现。改成 fork 后差异直接落在策略表里，那个插件及其运行时补丁已删除。

## 与官方不同的工程部分

| 位置 | 改动 |
| --- | --- |
| `package.json` | 换成插件形态：包名 `dsh-client-ui-chat-lgz`、`private`、`dsh.bundle.patch`、`build` / `typecheck` / `test` / `check` 脚本，依赖由 `workspace:*` 改为 `^0.2.1-alpha.4`；`dsh.client.inject` 与 `platform` 与官方一致 |
| `tsconfig.json` | 上游 monorepo 的 project references 与 `lib/types/**` 构建面在本仓库没有对应物，换成自足配置（理由见文件内注释） |
| `tsdown.config.mjs` | 用仓库根 `tsdown.client.mjs` 的共享预设，另加一个把 `running-whale@2x.png` 内联成 data URI 的插件：`ChatView.module.css` 的 `url('./running-whale@2x.png')` 被编译进 JS 里的样式字符串，相对 url 会 404（`src/index.ts` 是宿主半部，`src/client/index.ts` 是浏览器半部） |
| `lint` / `docs` 等上游专用配置 | 未引入 |

## 构建、检查与挂载

```bash
cd dsh-ui-chat
pnpm build       # tsdown → lib/index.js + lib/client.js
pnpm typecheck   # tsc --noEmit
pnpm check       # 产物语法检查
```

```bash
dsh plugin --profile web add <本仓库路径>/dsh-ui-chat
```

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件。客户端半部改动后必须重新构建；Host 在合成那一刻就把产物字节读进快照，所以只刷新页面可能仍拿到旧字节，还要重启 `dsh web`（同 [docs/README.md](README.md) 的说明）。

## 尚未移植：官方测试

官方 `tests/`（59 个 vitest 用例）引用上游 monorepo 的源码路径（`../../ui-conversation/src/…`、`@deepseek-ai/dsh-client-locale/src/locales/zh.ts` 等），本仓库没有对应文件，未随 fork 引入；`test/` 目录预留给移植后的用例。

所以 `package.json` 的 `test` 脚本暂时是 `vitest run --passWithNoTests`，让仓库级 `pnpm -r test` 在移植前保持通过。移植 `tests/` 后应去掉 `--passWithNoTests`。
