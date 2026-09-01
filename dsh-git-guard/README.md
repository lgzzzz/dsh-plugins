# dsh-git-guard

拦截经由 `bash` 工具发起的 git 敏感操作，挂载在 `tools/pre-execute` 瀑布钩子上：

| 命令 | 决定 | 说明 |
| --- | --- | --- |
| `git push` | `deny` | 直接阻断；请通过 GUI 或其他渠道推送 |
| `git commit` | `ask` | 交由用户审批，批准后才会执行 |
| 其他 | 放行 | 交给后续监听器 / 默认允许 |

决定类型遵循 dsh-tools 的 `PreToolDecision`：`{kind:'allow'}` /
`{kind:'deny', reason}` / `{kind:'ask', reason?}`。

## 与模型的沟通

插件通过两条路径把「推送必须由用户手动执行」的约束传达给大模型：

1. **系统提示词注入（常驻、主动）**：启动时经 `ctx.systemPrompt.section()` 在
   `TEAM_POLICY` 槽位注册 `git-guard:push-policy` 区段，每次组装系统提示词都会
   带上。内容明确：禁止任何形式的 `git push`（含 `--force`、`git -C`、环境变量、
   `sh -c` 包装等间接形式）；被拦截后不得重试或绕过（命令替换／别名／脚本包装等）；
   推送由用户手动执行（GUI 或终端）。这样模型在发起推送之前就能看到该约束。
2. **拦截回传（即时、被动）**：一旦仍检测到 `git push`，deny 的 `reason` 会作为
   工具错误结果（`Error: <reason>`）原样回传给模型，再次给予同等指示。`commit`
   的 ask 提示不受影响。

若宿主未提供 `systemPrompt` 服务（极简组合），`ctx.inject` 不回调、无区段注入，
但拦截逻辑不受影响。

## 实现说明

- 纯 TypeScript 源码（`index.ts`），由 App 内置的 Node 22 Type Stripping
  直接加载，无编译步骤；`package.json` 必须保持 `"type": "module"`，
  且只能使用可擦除语法（无 enum / 命名空间 / 参数属性）。
  `tsconfig.json` 开启 `erasableSyntaxOnly` 强制该约束。
- 这是一个标准 TS 项目：`devDependencies`（typescript、@types/node、
  @deepseek-ai/cordis）只服务于语言服务器与类型检查，运行时不参与
  （cordis 由宿主提供，`import type` 在 Type Stripping 下被擦除）。
- `tools/pre-execute` 事件签名在 `index.ts` 内对 `@deepseek-ai/cordis`
  的 `Events` 做本地声明合并（DSH 插件惯用写法），因此无需依赖
  dsh-tools 包即可通过类型检查；`ctx.systemPrompt` 同样以本地结构切片
  （`SystemPromptService` + `Context` 声明合并）接入，不依赖
  `@deepseek-ai/dsh-system-prompt` 包。
- 命令按 `&&`、`||`、`;`、管道与换行切段逐段审查，因此
  `git add . && git commit` 等组合命令也会被拦截。
- 识别时跳过前导环境变量赋值（含带引号的值，如
  `GIT_SSH_COMMAND="ssh -i k" git push`）、`sudo`，以及 `git -C <path>`、
  `-c key=value` 等带值选项；`sh -c '...'` / `bash -c "..."` 一层包装
  会解包后递归审查（深度上限 3）。
- 同一命令中 deny 优先于 ask。

## 已知边界（非完整 shell 解析）

- `eval`、命令替换（`echo $(git push)`）、别名（`g push`）、多行脚本
  `bash script.sh` 等间接形式不会被识别。
- `sudo -u user git push` 等带选项的 sudo 不会被识别。

## 加载配置

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
dsh plugin --profile web remove dsh-git-guard
```

> 加载属于用户操作：代理交付插件后不得自行执行 `dsh plugin add`、
> `pnpm install` 或重启 App（强制规范第 1 条）。

修改 `index.ts` 后需重启 App 生效（bundle 层为常驻挂载，不做热重载）。

## 本地验证

先安装开发依赖（typescript / @types/node / @deepseek-ai/cordis，仅供
语言服务器与类型检查使用）：

```sh
npm install
```

类型检查（与语言服务器使用同一份 `tsconfig.json`）：

```sh
npm run typecheck
```

用支持 Type Stripping 的运行时直接跑行为测试（`test.mjs` 会加载 `index.ts`
并校验 deny/ask/放行 各分支）：

```sh
node test.mjs
# 或用 App 自带运行时：
ELECTRON_RUN_AS_NODE=1 "/Applications/.../DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" test.mjs
```
