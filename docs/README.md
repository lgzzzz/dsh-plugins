# dsh-plugins 文档

本地 DSH Web 插件的开发 workspace:每个 `dsh-*` 目录是一个可挂进 profile 的插件包,用
`dsh plugin --profile web add <目录>` 挂载;各插件的 devDependencies 统一提升到仓库根
`node_modules`。

仓库的全部文档都收在本目录,分两类,都是「`<主题>.md` 索引 + `<主题>/NN-*.md` 分册」:

- **主题文档**:跨插件的通用机制,见[主题文档](#主题文档);
- **插件文档**:单个插件的实现与运维,入口见[插件](#插件)表里的「文档」列。

## 插件

| 目录 | 作用 | 文档 |
| --- | --- | --- |
| `dsh-workspace-quick-switch` | `⌘⌥M`（macOS）/ `Ctrl+Alt+M`（Windows） 弹出浮层,按左侧栏顺序列出前 10 个工作区,`↑/↓` 选、`Enter` 在该工作区新建会话（焦点在终端里时同样生效） | [说明](dsh-workspace-quick-switch.md) |
| `dsh-workspace-activity-sort` | 宿主半部:最近有会话活动的工作区自动浮到最前 | [说明](dsh-workspace-activity-sort.md) |
| `dsh-focus-free-shortcuts` | 未聚焦目标区域也能触发的内置快捷键桥接（`⌘⌥J` / `⌘⌥N` 等在终端 `.xterm` 内同样生效），外加 `⌘⌥K` / `Ctrl+Alt+K` 聚焦右栏当前显示的页面（通常是终端；Web 上有意占用内置会话搜索的键位） | [说明](dsh-focus-free-shortcuts.md) |
| `dsh-header-action-order` | 会话标题栏动作图标的固定顺序 | — |
| `dsh-ui-chat-verbose-fold` | Verbose 模式下折叠已完成的轮次 | [说明](dsh-ui-chat-verbose-fold.md) |
| `dsh-ui-css-patches` | Web UI 的 CSS 补丁 | — |
| `dsh-changes-hover-off` | 关掉改动文件卡片 500ms 悬停弹出的单列 diff 浮层 | [说明](dsh-changes-hover-off.md) |
| `dsh-desktop-notify` | 桌面通知 | — |
| `dsh-directory-picker-browse` | 应用内目录浏览选择器 | — |
| `dsh-git-guard` | git 操作保护 | — |

## 主题文档

| 主题 | 内容 |
| --- | --- |
| [DSH 组件 CSS 架构](dsh-css-architecture.md) | 上游的 CSS Modules / CSS 变量 / `data-*` 三种机制与静态 `<link>`、运行时 `<style>` 两条注册路径;构建期三个虚拟模块;三类作用域与设计令牌的 8 个全局 sheet;与插件 `dsh-ui-css-patches` 的关系;已验证的关键锚点与术语表(共 5 册) |
| [`dsh.client.inject` 完整说明](dsh-client-inject.md) | 字段形状与语义(三个同名 `inject` 的区别)、宿主半部 → 线上传输 → 浏览器半部的完整数据流、同步 `require` 的边界与三种依赖缺失时的表现、术语表(共 4 册) |
| [DSH 插件五种「名字」](plugin-naming.md) | 包名 / patch `id` / patch `name` / 导出 `name` / 服务名五者的速查表与逐个展开、从 patch 文件到名字落地的数据流与三个易混点、本仓库的命名约定、术语表(共 4 册) |

## 上游契约校验

依赖上游 CSS 选择器 / 槽位 / DOM 锚点的插件，在 `build` 里跟一段**构建后静态校验**：把清单
逐条对 DSH 安装产物 grep 一遍，上游改名 / 删 token 时构建失败，而不是让补丁在页面上静默
失效（选择器落空不报错）。校验器是各插件目录下的 `check-css.mjs`（与它的清单同目录）；
`dsh-changes-hover-off` 复用 `dsh-ui-css-patches/check-css.mjs`，用 `--manifest contract.json`
指向自己的清单。`--dsh-root` / `$DSH_ROOT` 可指定 DSH 根。

| 插件 | 清单 | 校验的契约 |
| --- | --- | --- |
| `dsh-ui-css-patches` | [`css-contract.json`](../dsh-ui-css-patches/css-contract.json) | `data-*` 属性 + CSS 变量 + 槽位键 |
| `dsh-focus-free-shortcuts` | [`css-contract.json`](../dsh-focus-free-shortcuts/css-contract.json) | DOM 锚点 + 内联样式规则 |
| `dsh-changes-hover-off` | [`contract.json`](../dsh-changes-hover-off/contract.json) | 改动文件卡片锚点 + 悬停延迟（复用 `../dsh-ui-css-patches/check-css.mjs`） |
| `dsh-desktop-notify` | [`css-contract.json`](../dsh-desktop-notify/css-contract.json) | `settings.general.item` 槽 + `--dsw-alias-*` 设计令牌 |
| `dsh-workspace-quick-switch` | [`css-contract.json`](../dsh-workspace-quick-switch/css-contract.json) | `shell.overlay` 槽 + `--dsw-*` / `--dsh-*` 主题令牌 |

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
