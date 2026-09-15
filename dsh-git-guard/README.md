# dsh-git-guard

拦截经由 shell 工具发起的 git 敏感操作，挂载在 `tools/pre-execute` 瀑布钩子上。
**所有敏感操作都需要向用户授权**（返回 `ask`），本插件**不直接拒绝**任何操作：

| 命令 | 决定 | 说明 |
| --- | --- | --- |
| `git commit` | `ask` | 交由用户审批，批准后才执行 |
| `git push`（非 force） | `ask` | 交由用户审批，批准后才执行 |
| `git push --force` / `-f` / `--force-with-lease` / `--force-if-includes` | `ask` | 强制推送改写远程历史，**仍需用户授权**，理由中标注风险 |
| `git rebase` | `ask` | 改写历史，仍需用户授权 |
| `git merge` | `ask` | 改写历史，仍需用户授权 |
| `git cherry-pick` | `ask` | 改写历史，仍需用户授权 |
| `git reset --hard` / `--merge` / `--keep` | `ask` | 破坏性重置可能丢失工作区改动，仍需用户授权 |
| `git revert` / `am` / `filter-branch` / `filter-repo` | `ask` | 危险 / 历史改写操作，仍需用户授权 |
| 其他 | 放行 | 交给后续监听器 / 默认允许 |

决定类型遵循 dsh-tools 的 `PreToolDecision`：`{kind:'allow'}` /
`{kind:'deny', reason}` / `{kind:'ask', reason?}`。`deny` 仅为与宿主签名同形而保留，
**策略层不再产生它**：早先「破坏性历史改写直接禁止」的语义已改为「一律向用户索取授权」，
批准与否完全由用户在审批卡片上裁决。

> 当前权限为**完全权限**时上表整体不生效——本插件完全退出，见下一节。

## 完全权限（danger-full-access）：本插件完全退出

当前权限是**完全权限**时，本插件对 git 操作**不做任何拦截，也不要求用户授权**：

- **`tools/pre-execute` 钩子**：命中 git 敏感子命令后先解析当前权限，若为完全权限
  则直接 `next()`——不产生任何决定，请求原样交给后续监听器 / 链尾；
- **系统提示词区段**：`git-guard:push-policy` 的文本按**当次组装所属会话**动态求值，
  完全权限下返回空串 ⇒ 该区段整体缺席，模型不再收到「须获得用户许可」的要求。

判定依据是宿主 `dsh-sandbox-policy` 服务的 `ctx.sandboxPolicy.resolve({ session })`
——按「会话覆盖 > 部署默认」解析出**本次调用实际生效的文件沙箱模式**（会话取自
`exec.agent.session`）。这与沙箱执行器在**同一个 `exec` 上**的取数逐字同源
（dsh-tool-bash：`sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })`），
因此「本插件是否介入」与「该命令实际在什么沙箱下执行」永远读到同一个裁决：

| 实际生效的模式 | 本插件行为 |
| --- | --- |
| `danger-full-access`（GUI 的「完全权限」预设） | 完全退出：不拦截、不索取授权、不注入约束区段 |
| `workspace-write` | 上表策略照常生效 |
| `read-only` | 上表策略照常生效 |

> 「完全权限」有两个入口，作用域不同：**对话内的权限选择器**（发出
> `/permission danger-full-access`）写的是**当前会话**的 `sandbox/mode`，本插件立刻退出；
> **设置里的权限模式**只改「**新建**会话的默认预设」（`defaultPreset`），当前会话的
> 生效模式不变、拦截照旧——符合上游「默认给新会话」的语义。

设计取舍：

- **只认沙箱模式，不认 approval 策略**。GUI 的「完全权限」预设同时写下
  `sandbox/mode: danger-full-access` 与 `approval/policy: never`，但上游把委派给
  子代理的 approval 一律钉为 `never`（dsh-subagent 的
  `captureDelegatedPolicyOverrides`，用于自动拒绝子代理一切需审批操作）；若把
  approval=never 也算作完全权限，子代理就会绕过本插件的全部护栏。另需注意完全权限下
  `ask` 本身已无意义：`approval.request` 在 `never` 下确定性拒绝。
- **`ask` 的落地效果取决于当前 approval 策略**：本插件只负责「提出授权请求」，
  是否真的弹出审批卡片由宿主按当前 approval 策略裁决。`approval=ask`（GUI 常规模式）
  下弹出审批卡片由用户批准 / 拒绝；`approval=never` 且沙箱模式**不是**
  `danger-full-access` 时（典型：子代理会话继承父会话的 `workspace-write` 而 approval
  被上游钉为 `never`）授权请求会被宿主确定性拒绝，效果等同不放行——这是上游的
  策略裁决，不是本插件产生的 deny。
- **服务经 `ctx.get('sandboxPolicy')` 机会式取用**，不写进挂载行 `inject`：宿主没有
  该服务（极简组合）时插件照常拦截，不会整块失效。子代理会话经上游的
  `sandbox/mode`（`source: delegation`）继承父会话的显式模式，因此父会话为完全权限时
  子代理一并退出。
- **失败关闭**：服务缺席、服务没有 `resolve`、`resolve` 抛错，都按「非完全权限」处理
  ——权限判不明时继续索取授权，绝不猜测放行。
- 权限只决定**是否介入**：完全权限下命令照样经过后续监听器与沙箱执行器，本插件既不
  放行也不加码。

## 与模型的沟通

插件通过两条路径把「提交／推送、以及一切破坏性历史改写都必须先获得用户许可、
用户拒绝后不得重试」的约束传达给大模型：

1. **系统提示词注入（常驻、主动）**：启动时经 `ctx.systemPrompt.section()` 在
   `TEAM_POLICY` 槽位注册 `git-guard:push-policy` 区段，每次组装系统提示词时求值一次。
   内容（中文）明确：`git commit` 与 `git push` 均须获得用户许可后才能执行；
   `git rebase` / `git merge` / `git cherry-pick` / `git revert` / `git reset --hard` /
   `git push --force` 等破坏性操作**同样须先获得用户许可**、会以授权请求的形式征求
   同意；若用户拒绝了某次提交或推送，不得再次尝试，也不得以命令替换、别名、脚本包装
   等间接形式绕过。**区段文本是动态的**：
   组装上下文带回该次组装的 agent（`AssembleContext.agent`，dsh-agent 的
   `assembleContextFor` 与 `scope` 一起填入），插件据此解析该会话的权限——完全权限下
   文本为空串，空区段被组装流程直接丢弃，于是模型看不到任何授权要求。
2. **拦截回传（即时、被动）**：一旦仍检测到敏感 git 调用，`ask` 的 `reason`
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
  dsh-tools 包即可通过类型检查；`ctx.systemPrompt` 与 `ctx.sandboxPolicy`
  同样以本地结构切片接入，不依赖 `@deepseek-ai/dsh-system-prompt` /
  `@deepseek-ai/dsh-sandbox-policy` 包（`Context` 上的 `sandboxPolicy` 声明只为
  `ctx.get('sandboxPolicy')` 提供类型，**不**表示它是必需服务）。
- **入口门禁与工具名解耦**：不以 `exec.name === 'bash'` 为条件，而是只要
  工具参数里出现非空字符串 `command`（bash / pwsh / cmd 及各 shell 工具的
  统一字段）即进入检测；非 shell 工具（无 `command` 字段）直接放行。因为只有
  在真正命中 git 敏感子命令时才产生决定，先宽后紧不会误拦截。
- **权限判定在最内层、且只在将要介入时进行**：钩子先算出决定，只有决定非空
  （即将提出授权请求）才向 `sandboxPolicy` 问一次当前权限；`git status`、`ls`
  这类命令零解析开销。
- **引号感知的词法分析**：用一次引号感知的 tokenizer（而不是 `\s+` 切词 +
  `&&|\|\||[;|\n]` 正则拆分），把 `"a b"` / `'a b'` 视为单个 token，再逐段递归识别
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
- **逐段审查、破坏性措辞优先**：先扫命令替换内容，再按语句段顺序扫描；同一条命令行内
  多处命中时只产生**一个** `ask`，措辞取其中破坏性最强的一处（force push / reset --hard /
  rebase 等优先于普通 commit / push），让用户在审批卡片上先看到风险提示；库内用带
  `destructive` 标记的内部决定对象排序，出口处剥掉该标记，只把 `{kind:'ask', reason}`
  交回宿主。

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
并校验 `ask`/放行 各分支——含 commit / push / force push / rebase / merge /
cherry-pick / reset --hard / revert / am / filter-branch / filter-repo 全部为 `ask`
的回归，断言不再产生 `deny`、同一条命令内多命中时破坏性措辞优先且只产生一个决定、
交出的决定只含 `kind` / `reason`；以及工具名解耦、引号 / 包装词、完全权限放行、
逐会话生效、只问 sandboxPolicy、失败关闭与提示词区段的动态求值）：

```sh
node test.mjs
# 或用 App 自带运行时（把路径换成本机实际的可执行文件）：
ELECTRON_RUN_AS_NODE=1 "<App 可执行文件>" test.mjs
```

> `node_modules` 被清理后，`npm install` 可能失败：`node_modules/@deepseek-ai`
> 是指向全局 dsh 内置 scope 的 junction，npm 的 reify 会试图写穿它（落到工作区之外，
> 被沙箱拒绝 → `EPERM`）。此时类型检查可直接用全局 TypeScript：
> `tsc --noEmit -p tsconfig.json`（`@deepseek-ai/*` 类型由该 junction 提供）；
> 行为测试只需 Node 运行时，不依赖 `node_modules`。
