# dsh-plugins

本地 DSH Web 插件的开发 workspace:每个 `dsh-*` 目录是一个可挂进 profile 的插件包,用
`dsh plugin --profile web add <目录>` 挂载;各插件的 devDependencies 统一提升到仓库根
`node_modules`。

## 插件

| 目录 | 作用 |
| --- | --- |
| `dsh-workspace-quick-switch` | `⌘⌥M`（macOS）/ `Ctrl+Alt+M`（Windows） 弹出浮层,按左侧栏顺序列出前 10 个工作区,`↑/↓` 选、`Enter` 在该工作区新建会话 |
| `dsh-workspace-activity-sort` | 宿主半部:最近有会话活动的工作区自动浮到最前 |
| `dsh-focus-free-shortcuts` | 未聚焦目标区域也能触发的内置快捷键桥接 |
| `dsh-header-action-order` | 会话标题栏动作图标的固定顺序 |
| `dsh-ui-chat-verbose-fold` | Verbose 模式下折叠已完成的轮次 |
| `dsh-ui-css-patches` | Web UI 的 CSS 补丁 |
| `dsh-changes-hover-off` | 关掉改动文件卡片 500ms 悬停弹出的单列 diff 浮层 |
| `dsh-desktop-notify` | 桌面通知 |
| `dsh-directory-picker-browse` | 应用内目录浏览选择器 |
| `dsh-git-guard` | git 操作保护 |

## 常用命令

```powershell
pnpm install                 # 把各插件的 devDependencies 提到根 node_modules
pnpm -r build                # 构建所有插件的产物
pnpm -r typecheck            # 类型检查

./add-plugins.ps1            # 把所有本地插件挂进 web profile(PowerShell 版)
./add-plugins.sh             # 同上(bash)
```

新插件挂载后刷新浏览器即可生效;客户端半部(`lib/client.js`)改动后必须重新构建。
