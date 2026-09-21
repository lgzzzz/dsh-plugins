# dsh-plugins — DSH Web 本地插件仓库

本仓库包含 **9 个相互独立的 DSH（DeepSeek Harness）Web 本地持久化插件**：每个插件是
一个自包含的本地 npm 包，经 web Profile 的 `link:` 依赖挂载进正在运行的应用。

仓库根 **不作为「一个插件」整体安装**（没有集合包、也没有根 `cordis.patch.yml`，
不提供集合安装 / 卸载脚本）：每个插件作为 Profile 中独立的 `link:` 依赖逐个装入，
经其自身的 `cordis.patch.yml` 独立挂载。

## 插件清单

| 目录                            | 说明                                                                                                                                                                                                                               |
|---------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dsh-code-card-fonts`           | 卡片标题 / 摘要行 / 展开内容 / 代码块 / 内联代码 / Markdown 表格单元格统一 14px，卡片间距 7px；内容字号轴不受影响，设置里的「字号大小」仍可调                                                                                      |
| `dsh-desktop-notify`            | 桌面通知：会话标题栏铃铛按钮负责授权 + 开关；页面开着但不在前台时，顶层会话「回合结束」或「等你审批 / 回答 / 确认计划」弹系统通知（Windows / macOS；关掉页面不送达）                                                               |
| `dsh-directory-picker-browse`   | 纯补丁插件：停用上游 auto 目录选择器，挂载 browse 变体；不触碰上游 `ui-deliverables`                                                                                                                                               |
| `dsh-fullwidth-chat`            | 对话列全宽展示                                                                                                                                                                                                                     |
| `dsh-git-guard`                 | 敏感 git 操作（`git commit`、`git push`，以及 force push 与 rebase / merge / cherry-pick / reset --hard / revert / am / filter-branch / filter-repo 等）一律需用户授权，本插件不直接拒绝；完全权限（danger-full-access）下整体退出 |
| `dsh-kbd-hotkeys`               | 全局快捷键：审批 / 问答键盘化、左右栏开关、右栏标签切换 / 关闭 / 文件浏览器与终端定位、新建会话、活跃会话跳转、工作区 / 近期对话 / 模型浮窗、思考强度循环、聚焦输入框、⌘/ 速查表                                                   |
| `dsh-rightbar-fonts`            | 右栏文件 / 文本 / 代码 / Markdown 预览与右栏「变更审阅」diff 跟随字号轴（默认 14px）；上游这两处吃固定 11px 代码 token，内置「字号大小」对它们无效                                                                                  |
| `dsh-rightbar-tab-width`        | 右栏 tab 胶囊定宽 100px（= 上游地板值，分栏判定与上游默认一致）                                                                                                                                                                    |
| `dsh-sidebar-default-collapsed` | 左侧边栏默认关闭：每次加载页面时读活布局 store 后一次性收起（宽窗才写；窄窗上游本就收起），判定标记在 `window` 上，不重复插手用户的手动开关                                                                                        |

跨插件的工程规范（包结构、挂载机制、生效机制、构建与验证、共性注意事项）见
[`AGENTS.md`](AGENTS.md)；各插件的功能与已知限制见其目录内 `README.md`。

## 安装

前置：`dsh` 与 `pnpm` 已在 PATH（`dsh plugin` 是 pnpm 转发器）。对需要启用的每个插件
目录执行一次：

```sh
cd <仓库根>/<name> && dsh plugin --profile web add link:.   # 或在任意目录用绝对路径
# 重启 App 生效
```

`dsh plugin` 转发 `pnpm add` 后会自动核对 `dsh.profile.bundles`：声明了
`dsh.bundle.patch` 的依赖自动并入 bundle 列表，无需手改 Profile 清单。

挂载前确保插件产物就绪：`lib/*.js` 已入仓，可直接挂载；如需重新构建，进入插件目录执行
`npm install && npm run build`（浏览器半部产物变更由 client-hmr 在 500ms 内热推送，
无需重启）。

装入其它 Profile：把 `--profile web` 换成目标 Profile 名。

## 卸载

```sh
# 单个插件
dsh plugin --profile web remove <name>

# 全部本地插件（写成一行即可）
dsh plugin --profile web remove dsh-code-card-fonts dsh-desktop-notify dsh-directory-picker-browse dsh-fullwidth-chat dsh-git-guard dsh-kbd-hotkeys dsh-rightbar-fonts dsh-rightbar-tab-width dsh-sidebar-default-collapsed
# 重启 App 生效
```

`dsh plugin` 转发 `pnpm remove` 后会自动移除对应的 bundle 挂载行。未安装的插件自动跳过
（幂等）；只影响 Profile 清单，仓库内插件目录本体不受影响。

## 重复执行与代码变更

`link:` 依赖已存在时重复执行是幂等 no-op；`link:` 实时指向本仓库目录，之后修改插件代码 **无需重装**：

- 浏览器半部改动：在插件目录执行其 `build` 脚本，产物 mtime 变化后由 client-hmr 在
  500ms 内热推送（页面无需重启 / 刷新，只要页面打开）；
- 宿主半部（`index.ts` / `host/*`）或组合变更：重启 App。

## 新增 / 移除插件时

1. 按 `AGENTS.md` 强制规范完成插件包本体（TypeScript 源码 + `build` / `typecheck`
   脚本，`lib/*.js` 为构建产物）；
2. 同步更新 `AGENTS.md` 与本 README 的插件清单（各处目录列表保持一致）；
3. 需要验证时，构建后按上文「安装」执行一次 `dsh plugin --profile web add link:<目录>`。

## 验证

仓库级无独立校验命令，各插件按其目录内说明自检（构建与验证命令总表见
[`AGENTS.md`](AGENTS.md)「构建与验证」；挂载后的生效验证见同文档「变更生效机制」）。
