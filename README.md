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

## 上游契约校验

依赖上游 CSS 选择器 / 槽位 / DOM 锚点的插件，`build` 里都跟一段**构建后静态校验**：把清单
逐条对 DSH 安装产物 grep 一遍，上游改名 / 删 token 时构建失败，而不是让补丁在页面上静默
失效（选择器落空不报错）。校验器为 `check-css.mjs`（与本插件的 `css-contract.json` 同目录），
`--dsh-root` / `$DSH_ROOT` 可指定 DSH 根。

| 插件 | 清单 | 校验的契约 |
| --- | --- | --- |
| `dsh-ui-css-patches` | [`css-contract.json`](dsh-ui-css-patches/css-contract.json) | `data-*` 属性 + CSS 变量 + 槽位键 |
| `dsh-focus-free-shortcuts` | [`css-contract.json`](dsh-focus-free-shortcuts/css-contract.json) | DOM 锚点 + 内联样式规则 |
| `dsh-changes-hover-off` | [`contract.json`](dsh-changes-hover-off/contract.json) | 改动文件卡片锚点 + 悬停延迟（复用 `../dsh-ui-css-patches/check-css.mjs`） |
| `dsh-desktop-notify` | [`css-contract.json`](dsh-desktop-notify/css-contract.json) | `settings.general.item` 槽 + `--dsw-alias-*` 设计令牌 |
| `dsh-workspace-quick-switch` | [`css-contract.json`](dsh-workspace-quick-switch/css-contract.json) | `shell.overlay` 槽 + `--dsw-*` / `--dsh-*` 主题令牌 |

根目录 `pnpm check` 一次跑完两件事：`pnpm -r check`（各插件产物的 lib 语法检查）与
`pnpm -r check:css`（上面 5 份契约清单）。单个插件内也可 `pnpm check:css` 只跑契约。

## 常用命令

```powershell
pnpm install                 # 把各插件的 devDependencies 提到根 node_modules
pnpm -r build                # 构建所有插件的产物
pnpm -r typecheck            # 类型检查
pnpm check                   # lib 语法检查 + 上游 CSS 契约校验

./add-plugins.ps1            # 把所有本地插件挂进 web profile(PowerShell 版)
./add-plugins.sh             # 同上(bash)
```

新插件挂载后刷新浏览器即可生效;客户端半部(`lib/client.js`)改动后必须重新构建。
