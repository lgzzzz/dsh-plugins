# dsh-git-guard

拦截经由 shell 工具发起的 git 敏感操作（挂在 `tools/pre-execute` 瀑布钩子上）：
**所有敏感操作都返回 `ask`、交由用户审批**，本插件**不产生 `deny`**。

| 命令 | 决定 |
| --- | --- |
| `git commit`、`git push`（非 force） | `ask` |
| `git push --force` / `-f` / `--force-with-lease` / `--force-if-includes` | `ask`（理由标注风险） |
| `git rebase` / `merge` / `cherry-pick` / `revert` / `am` / `filter-branch` / `filter-repo` | `ask` |
| `git reset --hard` / `--merge` / `--keep` | `ask`（理由标注可能丢失工作区改动） |
| 其他 | 放行（交给后续监听器 / 默认允许） |

决定类型遵循 dsh-tools 的 `PreToolDecision`（`{kind:'allow'}` / `{kind:'deny', reason}` /
`{kind:'ask', reason?}`）；`deny` 仅为与宿主签名同形而保留。

## 完全权限（danger-full-access）下整体退出

当前权限为完全权限时，本插件对 git 操作不做任何拦截、不索取授权：

- `tools/pre-execute` 钩子命中后直接 `next()`，不产生任何决定；
- 系统提示词区段 `git-guard:push-policy` 文本为空串 ⇒ 区段整体缺席，模型不再收到授权要求。

判定依据：`ctx.sandboxPolicy.resolve({ session })`（会话取自 `exec.agent.session`），与沙箱
执行器在同一个 `exec` 上的取数同源。`danger-full-access` → 退出；`workspace-write` /
`read-only` → 策略照常生效。

- **只认沙箱模式，不认 approval 策略**：上游把委派给子代理的 approval 钉为 `never`，若把
  `approval=never` 也算完全权限，子代理会绕过全部护栏；且完全权限下 `ask` 本身已被
  `approval.request` 确定性拒绝。
- **`ask` 的落地效果取决于 approval 策略**：`approval=ask` 弹审批卡片由用户裁决；
  `approval=never` 且沙箱非完全权限（典型：子代理会话）时授权请求被宿主拒绝，效果等同
  不放行——那是宿主裁决，不是本插件的 deny。
- 「完全权限」有两个入口：对话内权限选择器写**当前会话**模式（本插件立刻退出）；设置里的
  权限模式只改**新建**会话的默认预设（当前会话拦截照旧）。
- 服务经 `ctx.get('sandboxPolicy')` **机会式取用**（不写进挂载行 `inject`）：服务缺席时
  插件照常拦截。**失败关闭**：服务缺席、无 `resolve`、`resolve` 抛错，一律按非完全权限处理。

## 与模型的沟通

1. **系统提示词注入（常驻）**：经 `ctx.systemPrompt.section()` 在 `TEAM_POLICY` 槽位注册
   `git-guard:push-policy` 区段，每次组装时按该次组装所属会话动态求值：`git commit` /
   `git push` 与 rebase / merge / cherry-pick / revert / reset --hard / force push 等破坏性
   操作均须先获得用户许可；用户拒绝后不得重试、不得以命令替换 / 别名 / 脚本包装绕过。
   完全权限下文本为空串，空区段被组装流程丢弃。宿主无 `systemPrompt` 服务时不回调、无区段，
   拦截逻辑不受影响。
2. **拦截回传（即时）**：`ask` 的 `reason` 作为工具结果原样回传给模型。

## 实现要点

- 纯 TypeScript（`index.ts`），Node 22 Type Stripping 直载，无编译步骤；`"type": "module"`
  且仅可擦除语法（`erasableSyntaxOnly`）。`tools/pre-execute` 事件签名在文件内对
  `@deepseek-ai/cordis` 的 `Events` 做本地声明合并；`ctx.systemPrompt` / `ctx.sandboxPolicy`
  以本地结构切片接入。
- **入口与工具名解耦**：不以 `exec.name === 'bash'` 为条件，只要参数里出现非空字符串
  `command` 即进入检测；非 shell 工具直接放行。只有真正命中敏感子命令才产生决定，且
  **只在将要介入时**才向 `sandboxPolicy` 问一次权限。
- **引号感知的词法分析**：按引号外的 `;` / `&&` / `||` / `|` / 换行切分语句段（单个 `&`
  保留在段内）；剥掉前导环境赋值、包装词（`sudo` / `command` / `env` / `nohup` / `&`）与
  带值选项；递归识别 `bash -c '…'` / `cmd /c …` / `pwsh -Command …` 负载与 `$(…)` /
  反引号命令替换；取 `git` 后第一个非选项 token 为子命令。
- **逐段审查、破坏性措辞优先**：同一条命令行多处命中时只产生**一个** `ask`，措辞取破坏性
  最强的一处；库内用带 `destructive` 标记的内部对象排序，出口剥掉该标记。

## 已知边界（非完整 shell / PowerShell 解析器）

- 不追踪控制流：`if … { git push }`、`for … do git commit; done`、`xargs git commit`、
  `awk`/`sed` 内嵌命令等间接形式不会被识别。
- `bash -c git push`（负载未用引号包成单参数）按 shell 语义只取到 `git`，不命中完整命令；
  请用引号包住负载。
- `eval "git push"`、函数 / 别名包裹不会被展开。这些由系统提示词的「不得间接绕过」兜底。

## 本地验证

```sh
npm install          # typescript / @types/node / @deepseek-ai/cordis，仅供类型检查与 LSP
npm run typecheck
node test.mjs        # 以 Type Stripping 直载 index.ts，验证 ask / 放行各分支
```

`test.mjs` 覆盖：commit / push / force push / rebase / merge / cherry-pick / reset --hard /
revert / am / filter-branch / filter-repo 全部为 `ask`、不产生 `deny`、同一命令行多命中时
破坏性措辞优先且只产生一个决定、交出的决定只含 `kind` / `reason`，以及工具名解耦、引号与
包装词、完全权限放行、权限逐会话生效、只取用 `sandboxPolicy`、服务缺席 / 抛错的失败关闭、
提示词区段的动态求值。

> `node_modules` 被清理后 `npm install` 可能因 npm reify 写穿 `node_modules/@deepseek-ai`
> junction 而失败（`EPERM`）；此时直接用全局 `tsc --noEmit -p tsconfig.json`，行为测试只需
> Node 运行时。

## 加载（用户操作）

```sh
cd <仓库根>/dsh-git-guard
dsh plugin --profile web add link:.
# 重启 App 生效（宿主半部，bundle 层不支持热重载）
```

卸载：`dsh plugin --profile web remove dsh-git-guard`。
