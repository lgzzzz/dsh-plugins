# dsh-plugins — DSH Web 本地插件仓库

本仓库含 **11 个相互独立的 DSH（DeepSeek Harness）Web 本地插件**：每个都是自包含的本地
npm 包，经 web Profile 的 `link:` 依赖挂载进正在运行的应用。仓库根**不作为「一个插件」
整体安装**（无集合包、无根 `cordis.patch.yml`、无集合脚本）：逐个装入，各自经其
`cordis.patch.yml` 独立挂载。

工程规范（包结构、挂载 / 生效机制、构建与验证、取数范式）见 [`AGENTS.md`](AGENTS.md)；
各插件功能与已知限制见其目录内 `README.md`。

## 插件清单

| 目录 | 说明 |
| --- | --- |
| `dsh-code-card-fonts` | 卡片标题 / 摘要行 / 展开内容 / 代码块 / 内联代码 / 表格单元格统一 14px，卡片间距 7px；不动内容字号轴 |
| `dsh-desktop-notify` | 桌面通知：设置 →「通用」开关授权；页面不在前台时，顶层会话「回合结束」或「等你处理」发系统通知（关掉页面不送达） |
| `dsh-directory-picker-browse` | 纯补丁：停用上游 auto 目录选择器，挂载 browse 变体；不触碰 `ui-deliverables` |
| `dsh-fullwidth-chat` | 对话列全宽展示 |
| `dsh-git-guard` | 敏感 git 操作一律需用户授权（不直接拒绝）；完全权限（`danger-full-access`）下整体退出 |
| `dsh-header-action-order` | 会话标题栏图标顺序：定时任务与后台作业挪到最后；顺序常量在 `src/order.ts` |
| `dsh-kbd-hotkeys` | 全局快捷键：审批 / 问答键盘化、左右栏与右栏标签、文件浏览器 / 终端定位、新建与跳转会话、工作区 / 近期对话 / 模型浮窗、思考强度、⌘/ 速查表 |
| `dsh-rightbar-diff-split` | 右栏「变更审阅」diff 的左右对比与右栏全屏**恒等**（持续回正，页头「左右对比」按钮退化为只读指示器）；另一职责：摘掉聊天区改动卡片文件行的悬停 diff 浮窗（一条 `display: none` 样式，不改触发行为） |
| `dsh-rightbar-fonts` | 右栏预览与「变更审阅」diff 跟随字号轴（默认 14px）；上游这两处吃固定 11px token，内置「字号大小」对其无效 |
| `dsh-rightbar-tab-width` | 右栏 tab 胶囊定宽 100px（= 上游地板值，分栏判定与上游默认一致） |
| `dsh-sidebar-default-collapsed` | 左栏默认关闭：每次加载页面读活布局 store 后收起一次（宽窗才写）；不覆盖用户手动开关 |

## 安装 / 卸载

前置：`dsh` 与 `pnpm` 在 PATH（`dsh plugin` 是 pnpm 转发器）。

```sh
# 安装（每个需启用的插件执行一次；装入其它 Profile 改 --profile 名）
cd <仓库根>/<name> && dsh plugin --profile web add link:.   # 或用绝对路径
# 重启 App 生效

# 卸载（自动移除对应 bundle 挂载行；未安装的自动跳过）
dsh plugin --profile web remove <name>
```

`dsh plugin` 转发 `pnpm add` 时会自动把声明了 `dsh.bundle.patch` 的依赖并入
`dsh.profile.bundles`，无需手改 Profile 清单。`lib/*.js` 产物已入仓，可直接挂载；需重建时
在插件目录执行 `npm install && npm run build`。

## 代码变更

`link:` 实时指向本仓库，改代码**无需重装**：

- 浏览器半部：执行插件 `build` 后由 client-hmr 在 500ms 内热推送，页面无需重启 / 刷新；
- 宿主半部（`index.ts` / `host/*`）或组合变更：重启 App。

## 新增 / 移除插件

1. 按 [`AGENTS.md`](AGENTS.md) 强制规范产出插件包（TypeScript + `build` / `typecheck`）；
2. 同步上表与 `AGENTS.md` 的插件清单；
3. 删除插件目录前先 `dsh plugin --profile web remove <name>`，否则残留 `link:` 会解析失败。

## 验证

仓库级无独立校验命令，各插件按目录内说明自检（构建与验证总表见 [`AGENTS.md`](AGENTS.md)
「构建与验证」）。
