# dsh-plugins — DSH Web 本地插件仓库

本仓库包含多个相互独立的 DSH（DeepSeek Harness）Web 本地持久化插件，每个插件是
一个自包含的本地 npm 包，位于自己的目录中（动态 Cordis 定义只存在于进程内存、
重启即失效，故固化为仓库内的本地包）。

仓库根**不作为「一个插件」整体安装**（没有集合包 / 根 `cordis.patch.yml`），也**不提供
集合安装 / 卸载脚本**：每个插件作为 Profile 中独立的 `link:` 依赖逐个装入，经其自身的
`cordis.patch.yml` 独立挂载（见下文「安装」）。

各插件的功能说明见其目录内 `README.md`（`dsh-fullwidth-chat`、`dsh-text-editor` 暂无
README，功能见其 `package.json` 的 `description` 与 `AGENTS.md` 插件清单）；跨插件
工程规范见 `AGENTS.md`。

## 插件清单

「当前已挂载」按本机 `~/.dsh/profiles/web/package.json` 的实际状态。

| 目录 | 说明 | 当前已挂载 |
| --- | --- | --- |
| `dsh-code-card-fonts` | 卡片标题/摘要行/展开内容与代码块字号补丁 | ✅ |
| `dsh-directory-picker-browse` | 目录选择器固定 browse 模式的覆盖层 | ✅ |
| `dsh-fork-inbox-guard` | 分叉子会话不继承源会话「已入队未认领」的输入 | ✅ |
| `dsh-fullwidth-chat` | 对话列全宽展示 | ✅ |
| `dsh-git-guard` | 拦截 `git push`（deny）/ `git commit`（ask） | ✅ |
| `dsh-kbd-hotkeys` | 全局快捷键（审批/问答键盘化、会话切换、侧栏开关、⌘/ 速查表等） | ✅ |
| `dsh-new-session` | `/new` 新建会话命令 | ✅ |
| `dsh-no-right-sidebar` | 关闭右侧边栏：停用右栏三行插件的加载，并提供 `sidebarRight` 桩保住 ui-chat | ✅ |
| `dsh-text-editor` | 应用内 Monaco 文本编辑器能力（`openFile` 文件 tab / `showDiff` 差异 tab + 宿主读写路由） | — |

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

`dsh plugin` 转发 `pnpm add` 后会自动核对 `dsh.profile.bundles`：声明了
`dsh.bundle.patch` 的依赖自动并入 bundle 列表，无需手动改 Profile 清单。

挂载前先确保插件产物就绪：

- `dsh-text-editor`：`lib/client.js` 已入仓；若需重新构建，先 `npm install`
  （`monaco-editor` 依赖会在构建时复制到不入仓的 `vendor/monaco/`）；
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
- 宿主半部改动：重启 App。

## 从旧的「集合安装」迁移

若本机曾把仓库根当作一个插件安装（Profile 的 `dependencies` 含 `dsh-plugins`），先卸载
再按上文「安装」逐个装入：

```sh
dsh plugin --profile web remove dsh-plugins
# 重启 App 生效
```

## 卸载

```sh
# 单个插件
dsh plugin --profile web remove <name>

# 全部本地插件（按需删减；写成一行即可）
dsh plugin --profile web remove dsh-code-card-fonts dsh-directory-picker-browse dsh-fork-inbox-guard dsh-fullwidth-chat dsh-git-guard dsh-kbd-hotkeys dsh-new-session dsh-no-right-sidebar dsh-text-editor
# 重启 App 生效
```

`dsh plugin` 转发 `pnpm remove` 后会自动核对 `dsh.profile.bundles`，把不再安装的 bundle
挂载行一并移除，无需手工改 Profile 清单。Profile 未安装的插件自动跳过（幂等）；只移除
Profile 中的 `link:` 依赖与挂载行，仓库内插件目录本体不受影响。

## 新增 / 移除插件时

1. 按各插件 README 完成插件包本体（新插件须遵循 `AGENTS.md` 强制规范第 2 条）；
2. 同步更新 `AGENTS.md` 的插件清单与「构建与验证」表，以及本 README 的插件清单
   （三处目录列表保持一致）；
3. 需要验证时，构建后按上文「安装」执行一次
   `dsh plugin --profile web add link:<目录>`。

## 验证

仓库级无独立校验命令。各插件按其目录内说明自检（例如 `dsh-git-guard`、
`dsh-fork-inbox-guard` 的 `node test.mjs`），构建与验证命令总表见
`AGENTS.md`「构建与验证」。
