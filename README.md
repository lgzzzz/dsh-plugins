# dsh-plugins — DSH Web 本地插件仓库

本仓库包含 **9 个相互独立的 DSH（DeepSeek Harness）Web 本地持久化插件**。每个插件是
一个自包含的本地 npm 包，位于自己的目录中：动态 Cordis 定义只存在于进程内存、重启即
失效，需要长期保留的行为因此固化为仓库内的本地包，经 web Profile 的 `link:` 依赖挂载
进正在运行的应用。

仓库根**不作为「一个插件」整体安装**（没有集合包、也没有根 `cordis.patch.yml`），
也**不提供集合安装 / 卸载脚本**：每个插件作为 Profile 中独立的 `link:` 依赖逐个装入，
经其自身的 `cordis.patch.yml` 独立挂载（见下文「安装」）。

- 各插件的功能、实现依据与已知限制：见其目录内 `README.md`
  （`dsh-fullwidth-chat` 暂无 README，功能见其 `package.json` 的 `description` 与本文档
  插件清单）。
- 跨插件工程规范（包结构、挂载机制、生效机制、构建与验证、共性坑）：见 `AGENTS.md`。

## 插件清单

本机 web Profile 当前挂载**全部 9 个插件**，与仓库目录一一对应、无多余项。

| 目录 | 说明 |
| --- | --- |
| `dsh-code-card-fonts` | 卡片标题 / 摘要行 / 展开内容 / 代码块 / 内联代码 / Markdown 表格单元格统一 14px，卡片间距 7px；不覆盖内容字号轴，设置里的「字号大小」仍可调 |
| `dsh-directory-picker-browse` | 纯补丁插件：停用上游 auto 目录选择器与产物行，挂载 browse 变体 |
| `dsh-fork-inbox-guard` | 分叉子会话丢弃继承自源会话、仍 pending 的输入（子代理显式跳过） |
| `dsh-fullwidth-chat` | 对话列全宽展示 |
| `dsh-git-guard` | 所有敏感 git 操作（`git commit`、`git push`，以及 force push 与 rebase / merge / cherry-pick / reset --hard / revert / am / filter-branch / filter-repo 等破坏性历史改写）一律需用户授权，本插件不直接拒绝；约束同时注入系统提示词 |
| `dsh-kbd-hotkeys` | 全局快捷键：审批 / 问答键盘化、左右栏开关、右栏标签切换、右栏文件浏览器定位并置顶、新建会话（⌘/Ctrl+N，等同 `/new`）、活跃会话跳转、工作区浮窗、模型浮窗、思考强度循环、聚焦对话输入框、⌘/ 速查表 |
| `dsh-new-session` | `/new` 新建并跳转空白会话 |
| `dsh-rightbar-tab-width` | 右栏 tab 胶囊定宽 100px（取值等于上游地板与分栏判定兜底常量，分栏判定与上游默认一致） |

挂载状态可自行核对（9 条 `link:` 依赖 + 11 项 bundle + 9 条有效 Junction）：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\web\package.json"     # dependencies / dsh.profile.bundles
Get-ChildItem "$env:USERPROFILE\.dsh\profiles\web\node_modules" |
  Select-Object Name, LinkType, Target                            # 链接是否存在、指向是否有效
```

## 安装

前置要求：`dsh` 与 `pnpm` 已在 PATH（`dsh plugin` 是 pnpm 转发器）。

对需要启用的每个插件目录执行一次：

```sh
# 方式一：从仓库内插件目录执行（相对 link: 由 pnpm 锚定到当前目录）
cd <仓库根>/<name> && dsh plugin --profile web add link:.
# 方式二：从任意目录用绝对路径
dsh plugin --profile web add link:<仓库根>/<name>
# 重启 App 生效
```

`dsh plugin` 转发 `pnpm add` 后会**自动核对 `dsh.profile.bundles`**：声明了
`dsh.bundle.patch` 的依赖自动并入 bundle 列表，无需手动改 Profile 清单。

挂载前先确保插件产物就绪：

- 其余插件：`lib/*.js` 已入仓，可直接挂载；重新构建见各插件 README /
  `AGENTS.md`「构建与验证」。

浏览器半部无需单独注册：client-modules 服务按每个插件的挂载行解析到插件包目录、
读取包内 `dsh.client` 声明自动注册。

### 装入其它 Profile

默认装入 `web`，把 `--profile web` 换成目标 Profile 名即可：

```sh
dsh plugin --profile <name> add link:<仓库根>/<name>
```

### 重复执行与代码变更

`link:` 依赖已存在时重复执行是幂等 no-op；由于 `link:` 实时指向本仓库目录，之后修改
插件代码**无需重装**：

- 浏览器半部改动：在该插件目录执行其 `build` 脚本，产物 mtime 变化后由 client-hmr
  在 500ms 内热推送（页面无需重启 / 刷新，只要页面打开）；
- 宿主半部（`index.ts` / `host/*`）或组合变更：重启 App。

## 卸载

```sh
# 单个插件
dsh plugin --profile web remove <name>

# 全部本地插件（按需删减；写成一行即可）
dsh plugin --profile web remove dsh-code-card-fonts dsh-directory-picker-browse dsh-fork-inbox-guard dsh-fullwidth-chat dsh-git-guard dsh-kbd-hotkeys dsh-new-session dsh-rightbar-tab-width
# 重启 App 生效
```

`dsh plugin` 转发 `pnpm remove` 后会自动核对 `dsh.profile.bundles`，把不再安装的 bundle
挂载行一并移除，无需手工改 Profile 清单。Profile 未安装的插件自动跳过（幂等）；只移除
Profile 中的 `link:` 依赖与挂载行，仓库内插件目录本体不受影响。

## 新增 / 移除插件时

1. 按各插件 README 完成插件包本体（新插件须遵循 `AGENTS.md` 强制规范第 2 条：TypeScript
   源码 + `build` / `typecheck` 脚本，`lib/*.js` 为构建产物）；
2. 同步更新 `AGENTS.md` 的插件清单与「构建与验证」表，以及本 README 的插件清单
   （各处目录列表保持一致）；
3. 需要验证时，构建后按上文「安装」执行一次
   `dsh plugin --profile web add link:<目录>`。

## 验证

仓库级无独立校验命令。各插件按其目录内说明自检（例如 `dsh-git-guard` 的
`node test.mjs`），构建与验证命令总表见 `AGENTS.md`「构建与验证」。挂载后的生效验证
（读取宿主当前公告的插件图与产物字节）见 `AGENTS.md`「变更生效机制」。

## 文档

| 路径 | 内容 |
| --- | --- |
| `AGENTS.md` | 仓库工程规范总纲：插件清单、包结构与挂载、变更生效机制、构建与验证、取数范式与注意事项 |
| 各插件 `README.md` | 该插件的功能说明、实现依据、已知限制与加载 / 构建说明 |
