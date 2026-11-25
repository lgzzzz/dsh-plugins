# 挂载与卸载

> 本文件是 [插件挂载、卸载与生效](../plugin-mounting.md) 的第 1 册：三条装卸路径、它们的共同结果，以及关闭与移除的区别。

-----

## 1. 先分清四个词

| 词 | 含义 |
|---|---|
| **挂载** | 把插件包写进 profile 的 `dependencies`、选进 `dsh.profile.bundles`，并让它 patch 里的行启动 |
| **关闭** | 停掉行，或取消组合包选择；插件包仍留在 profile 里，随时可以再打开 |
| **移除** | 从 profile 卸载插件包（`pnpm remove`），停掉它的行并删掉依赖；再挂回来要重新安装 |
| **重组合** | HMR 重新读取 profile 的包清单、bundle 层与 patch，停掉不再列出的行、启动新增或变化的行 |

「卸载」在本文里指让插件停止运行的**关闭**或**移除**，具体是哪种由上下文说明。

-----

## 2. 前提

- 目标是 `web` profile（`$DSH_HOME/profiles/web`），行为以 DSH 0.2.3-alpha.2 为准。web profile 默认启用 HMR；未启用 HMR 的 profile 上，装载与代码变更留到下一次启动生效，见[第 2 册](02-activation-and-reload.md)。
- 插件包必须声明 `dsh.bundle`（本仓库的 `dsh-*` 目录都声明了）并在 `exports` 里写明客户端产物。缺 `lib/client.js` 时客户端模块的激活会失败，并给出一条构建说明及缺失的包与路径——不是「挂上了但页面空壳」。所以挂载前先构建：

```bash
pnpm --filter <包名> build     # 或到达目录后 pnpm build
```

仓库根的 `add-plugins` 脚本会在产物缺失时替你做这一步；`dsh plugin add` 不会。

-----

## 3. 路径 A：设置 → 插件（宿主运行中，立即生效）

侧栏的**插件**页（`ui-plugin-manager`，也可从**设置 → 插件管理**打开）与 `plugin_manager` 工具操作的是同一个 `pluginManager` 服务。这是运行中装卸的推荐路径。

### 挂载新包

1. 先构建客户端产物（见上）。
2. 打开**设置 → 插件 → 添加插件**，从菜单选**安装第三方插件**；输入插件目录的**绝对路径**（也可以输入包名、Git 地址或压缩包地址），安装完成后点**立即启用**，或之后在列表里打开它的开关。
3. 用 `plugin_manager` 工具执行同一件事时，每个操作都要求 `danger-full-access`，或为这一次调用单独批准。

安装走 `installBundle`；宿主会把新包写进 profile、选择它的组合包，再重组合启动它的行。结果里的 `application` 是判据：

| `application` | 含义 |
|---|---|
| `applied` | 已生效，不需要重启 |
| `restart-required` | 已保存但当前进程不会应用；`restartReason` / `nextStep` 说明原因 |
| `overridden` | 已保存，但被更高优先级的层（如 Agent 预设）盖住，改变不了运行中的行 |
| `failed` | 安装或激活失败；`error` 说明原因，profile 文件可能已回滚 |
| `cancelled` | 安装被取消，profile 已恢复 |

`already-installed` 出现在 spec 能指明、且该包已安装时（包名、同版本或已记录的 Git / 压缩包来源）。要换版本就先**卸载**再安装；只改代码不必重装。

### 关闭与移除

- **行开关**：停掉一条 Loader 条目。依赖它的插件会随服务撤回一起级联重载；再次打开会重新加载这一行。
- **组合包开关**：取消或恢复整个 bundle 层。关闭只取消选择并停插件，**保留已安装的依赖**，再打开很快。
- **卸载**：插件页的卸载需要确认；只对标为可移除的组合包开放。别的层仍有行在用这个包时会被拒绝（`bundle-in-use`），要先把那些行停掉。随安装提供的可选组合包固定不可卸载。
- 卸载时宿主先停行，再跑 `pnpm remove`，最后重组合并逐出被删除映射的模块；因此不会留下仍在运行的旧插件。
- 安装失败或被取消时，profile 清单与锁文件会恢复；已经下载的文件可能留下，这不影响 profile 状态。安装成功而激活失败时，已保存的依赖与选择可能保留，操作返回 `failed`，修好后再重试。

-----

## 4. 路径 B：仓库脚本（宿主停机时）

两个脚本都不维护插件名单，按目录与 profile 现状现算：

```bash
./add-plugins.sh        # PowerShell: ./add-plugins.ps1；.cmd 只是包装
./remove-plugins.sh
```

- `add-plugins` 发现仓库根下所有 `dsh-*` 目录，只挂载 `package.json` 里带 `dsh.bundle` 的；`add-plugins` 在缺少客户端产物时先跑 `pnpm --filter <name> build`，构建失败就不挂该插件。`example/` 与非插件的共享工具包不会被挂载。
- `remove-plugins` 按 profile 的 `dependencies` 里指向本仓库的 `link:` / `file:` 目标识别要卸下的包，因此插件目录删除后遗留的条目也能清掉。它不删除仓库里的插件目录，也不碰 `lib/` 产物；再挂回去不必重新构建。
- 两个脚本都按**宿主停机**设计：先退出 `dsh web`，跑完再启动。运行中的宿主也会感知 profile 变更并重组合（HMR 监视包清单与 patch），但脚本与宿主同时写 profile 会争用 pnpm 的 `package.json` 锁；运行中装卸请走路径 A。
- 脚本启动时会探测运行中的 `dsh web`（按 argv 词元判定），命中时只警告、不阻断。
- DSH 的终端策略拦截未签名的本地 `.ps1` 时，用同目录的 `.cmd`，或手动带 `-ExecutionPolicy Bypass` 运行。

-----

## 5. 路径 C：`dsh plugin`（直接写 profile）

```bash
dsh plugin --profile web add /Users/lz/dsh-plugins/<插件目录>
dsh plugin --profile web remove <包名>
```

它与插件页操作同一套 profile 文件，但运行在另一个进程里：

- 直接改 `package.json` / `pnpm-lock.yaml`，不经过插件的安装界面，也没有 `application` 结果可看。
- 运行中的宿主会通过 HMR 的 profile 监视看到这些文件变化并重组合；插件页的列表不会收到管理器的变更通知，要在下一次读取（切回页面、刷新列表）时才更新。仓库脚本仍按停机流程执行，避免与宿主并发写 profile。
- 仓库的 `add-plugins` / `remove-plugins` 内部就是调用这条命令，并补上了目录发现、产物构建与停机提示。

-----

## 6. 挂载后看到什么

1. profile 的 `dependencies` 多一条（`link:` 指向本仓库时的路径），`dsh.profile.bundles` 里多一个名字。
2. 插件的 patch 行成为 Loader 条目并启动；宿主半部的工具、服务、事件监听随后可用。
3. 带 `dsh.client` 的包在客户端图里多一行；已打开的页面会收到图更新并加载它，**不用刷新**（机制见[第 2 册](02-activation-and-reload.md)）。
4. 插件页 / `plugin_manager list_plugins` 里能看到存活条目；页面的 `window.__DSH_BOOT__.entries` 里能看到它的客户端行。
5. 卸载后上述条目与行消失，页面回收它的样式和不再使用的模块。

各插件的专用验证方法（DOM 锚点、投影字段、快捷键）见对应插件文档的「验证 / 怎么确认它真的生效」一节。
