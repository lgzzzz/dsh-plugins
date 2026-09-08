# dsh-git-guard

拦截经由 shell 工具发起的 git 敏感操作，挂载在 `tools/pre-execute` 瀑布钩子上：

| 命令 | 决定 | 说明 |
| --- | --- | --- |
| `git commit` | `ask` | 交由用户审批，批准后才执行 |
| `git push`（非 force） | `ask` | 交由用户审批，批准后才执行 |
| `git push --force` / `-f` / `--force-with-lease` | `deny` | 强制推送改写远程历史，直接禁止 |
| `git rebase` | `deny` | 改写历史，禁止 |
| `git merge` | `deny` | 改写历史，禁止 |
| `git cherry-pick` | `deny` | 改写历史，禁止 |
| `git reset --hard` / `--merge` / `--keep` | `deny` | 破坏性重置可能丢失工作区改动，禁止 |
| `git revert` / `am` / `filter-branch` / `filter-repo` | `deny` | 危险 / 历史改写操作，禁止 |
| 其他 | 放行 | 交给后续监听器 / 默认允许 |

决定类型遵循 dsh-tools 的 `PreToolDecision`：`{kind:'allow'}` /
`{kind:'deny', reason}` / `{kind:'ask', reason?}`。

## 与模型的沟通

插件通过两条路径把「提交／推送都必须经用户许可、破坏性历史改写操作被禁止、
用户拒绝后不得重试」的约束传达给大模型：

1. **系统提示词注入（常驻、主动）**：启动时经 `ctx.systemPrompt.section()` 在
   `TEAM_POLICY` 槽位注册 `git-guard:push-policy` 区段，每次组装系统提示词都会
   带上。内容（中文）明确：`git commit` 与 `git push` 均须获得用户许可后才能执行；
   `git rebase` / `git merge` / `git cherry-pick` / `git reset --hard` /
   `git push --force` 等破坏性操作被禁止；若用户拒绝了某次提交或推送，不得再次
   尝试，也不得以命令替换、别名、脚本包装等间接形式绕过。
2. **拦截回传（即时、被动）**：一旦仍检测到敏感 git 调用，ask / deny 的 `reason`
   会作为工具结果原样回传给模型，再次给予同等指示。

若宿主未提供 `systemPrompt` 服务（极简组合），`ctx.inject` 不回调、无区段注入，
但拦截逻辑不受影响。

## 实现说明

- 纯 TypeScript 源码（`index.ts`），由 App 内置的 Node 22 Type Stripping
  直接加载，无编译步骤；`package.json` 必须保持 `"type": "module"`，
  且只能使用可擦除语法（无 enum / 命名空间 / 参数属性）。
  `tsconfig.json` 开启 `erasableSyntaxOnly` 强制该约束。
- `tools/pre-execute` 事件签名在 `index.ts` 内对 `@deepseek-ai/cordis`
  的 `Events` 做本地声明合并（DSH 插件惯用写法），因此无需依赖
  dsh-tools 包即可通过类型检查；`ctx.systemPrompt` 同样以本地结构切片
  接入，不依赖 `@deepseek-ai/dsh-system-prompt` 包。
- **入口门禁与工具名解耦**：不再以 `exec.name === 'bash'` 为条件，而是只要
  工具参数里出现非空字符串 `command`（bash / pwsh / cmd 及各 shell 工具的
  统一字段）即进入检测；非 shell 工具（无 `command` 字段）直接放行。因为只有
  在真正命中 git 敏感子命令时才产生决定，先宽后紧不会误拦截。
- **引号感知的词法分析**：不再是 `\s+` 切词与 `&&|\|\||[;|\n]` 正则拆分，而是
  一次引号感知的 tokenizer，把 `"a b"` / `'a b'` 视为单个 token，再逐段递归识别
  git 调用：
  - 语句段按引号外的 `;`、`&&`、`||`、`|`、换行切分；单个 `&`（PowerShell
    调用符 / bash 后台符）保留在段内。
  - 剥掉前导环境赋值（`VAR=x`，值可含引号空格）、包装词
    （`sudo` / `command` / `env` / `nohup` / `&` 等）与带值选项
    （如 `sudo -u user`）。
  - 识别 `bash -c '…'` / `cmd /c …` / `pwsh -Command …` 的负载并递归；
    也递归扫描 `$(git push)`、反引号等命令替换内容。
  - `git` 之后取第一个非选项 token 作为子命令，连同其后参数交给策略表；
    带值选项（`-C path`、`--git-dir=path`、`-c k=v` 等）连同值一起跳过。
- 同一命令中 deny 优先于 ask。

## 已知边界（非完整 shell / PowerShell 解析器）

- 控制流结构不会被追踪：`if … { git push }`、`for … do git commit; done`、
  `xargs git commit`、`awk`/`sed` 内嵌命令等间接形式不会被识别——
  除非作用于语句段首的命令位。
- `bash -c git push`（`-c` 负载未用引号包成单参数）按 shell 语义仅取紧随其后的
  单个参数 `git`，不会命中完整命令；实际提交请用引号包住负载。
- `eval "git push"`、函数/别名包裹不会被展开。这些属已知边界，已被系统提示词
  的「不得间接绕过」约束兜底。

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
并校验 deny/ask/放行 各分支，含工具名解耦与引号/包装/破坏性操作回归用例）：

```sh
node test.mjs
# 或用 App 自带运行时：
ELECTRON_RUN_AS_NODE=1 "/Applications/.../DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" test.mjs
```
