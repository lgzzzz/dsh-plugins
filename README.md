# dsh-plugins — DSH Web 本地插件仓库

本仓库包含多个相互独立的 DSH（DeepSeek Harness）Web 本地持久化插件，每个插件是
一个自包含的本地 npm 包，位于自己的目录中（动态 Cordis 定义只存在于进程内存、
重启即失效，故固化为仓库内的本地包）。

仓库根**不再作为「一个插件」整体安装**（没有集合包 / 根 `cordis.patch.yml`），
而是随附两个安装脚本，把仓库内的插件**逐个**装入 DSH Web Profile，每个插件成为
Profile 中独立的 `link:` 依赖，经其自身的 `cordis.patch.yml` 独立挂载：

| 脚本 | 适用系统 |
| --- | --- |
| `install.sh` | 类 Unix（macOS / Linux / WSL） |
| `install.ps1` | Windows（PowerShell） |

各插件的功能说明见其目录内 `README.md`；跨插件工程规范见 `AGENTS.md`。

## 插件清单

| 目录 | 说明 | 默认安装 |
| --- | --- | --- |
| `dsh-text-editor` | Monaco 应用内编辑器；提供 `openFile`/`showDiff` 能力 | ✅ |
| `dsh-code-card-fonts` | 卡片标题/摘要行/展开内容与代码块字号补丁 | ✅ |
| `dsh-git-guard` | 拦截 `git push`（deny）/ `git commit`（ask） | ✅ |
| `dsh-fullwidth-chat` | 对话列全宽展示 | ✅ |
| `dsh-new-session` | `/new` 新建会话命令 | ✅ |
| `dsh-directory-picker-browse` | 目录选择器固定 browse 模式的覆盖层 | ✅ |
| `dsh-change-summary` | 回合结束汇总改动文件与 git 差异（`lib/` 不入仓，装前须先构建，见下） | ✅ |
| `dsh-kbd-hotkeys` | 全局快捷键（审批/问答键盘化、会话切换、滚动、复制、⌘K 面板等） | ✅ |

> 两个安装脚本**默认安装仓库内全部 8 个插件**（不再有“可选插件”概念）。

## 安装（脚本，推荐）

前置要求：`dsh` 与 `pnpm` 已在 PATH（`dsh plugin` 是 pnpm 转发器）。

### 类 Unix（macOS / Linux / WSL）

```sh
cd <仓库根>
./install.sh          # 默认安装全部 8 个插件到 web Profile
# 重启 App 生效
```

若无执行权限先 `chmod +x install.sh`。

### Windows（PowerShell）

```
cd <仓库根>
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

（PowerShell 7+ 或本机执行策略允许脚本时，可直接运行 `.\install.ps1`，无需
`-ExecutionPolicy Bypass`。）脚本为 UTF-8（带 BOM）编码，中文提示在任意区域设置的
Windows PowerShell 5.1 上均可正常解析显示。结束后重启 App。

### 脚本做了什么

1. 前置检查：`dsh`、`pnpm` 是否在 PATH，全部插件目录是否齐全；
2. 若 Profile 仍装有旧的根集合依赖 `dsh-plugins`，先执行
   `dsh plugin --profile web remove dsh-plugins` 卸载（避免挂载行 id 重复）；
3. 对每个插件目录执行一次 `dsh plugin --profile web add link:<绝对路径>`；
4. 打印已安装清单并提示重启。

浏览器半部无需单独注册：client-modules 服务按每个插件的挂载行解析到插件包目录、
读取包内 `dsh.client` 声明自动注册。

### dsh-change-summary 的构建要求

`dsh-change-summary` 是默认安装的一部分，但其 `lib/` 为不入仓的构建产物，全新
克隆的仓库里并不存在。脚本检测到 `lib/index.js` / `lib/client.js` 缺失时会给出
中文提示并退出，此时先构建再重跑脚本：

```sh
cd dsh-change-summary
npm install
npm run build
cd ..
./install.sh   # 或 powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### 装入其它 Profile

默认装入 `web`。可用环境变量指定：

```sh
DSH_PROFILE=<name> ./install.sh        # 类 Unix
# Windows（PowerShell）：先 $env:DSH_PROFILE='<name>'，再运行 install.ps1
```

### 重复执行与代码变更

安装脚本可重复执行：`link:` 依赖已存在时为幂等 no-op。由于 `link:` 实时指向本
仓库目录，之后修改插件代码时**无需重跑安装脚本**：

- 浏览器半部改动：在该插件目录执行其 `build` 脚本（见各插件 README /
  AGENTS.md「构建与验证」），再重启 App；
- 宿主半部改动：直接重启 App。

（仅当**新增或移除插件目录**时，才需要改脚本并重跑，见下文。）

## 手动安装单个插件（调试 / 与脚本等价）

```sh
# 方式一：从仓库内插件目录执行（相对 link: 由 dsh 锚定到当前目录）
cd <仓库根>/<name> && dsh plugin --profile web add link:.
# 方式二：从任意目录用绝对路径
dsh plugin --profile web add link:<仓库根>/<name>
# 重启 App 生效
```

## 从旧的「集合安装」迁移

若本机曾把仓库根当作一个插件安装（Profile 的 `dependencies` 含 `dsh-plugins`），
直接运行一次上面的安装脚本即可——脚本会先卸载 `dsh-plugins`，再逐个装入各插件，
重启 App 后效果等价。也可手动卸载：

```sh
dsh plugin --profile web remove dsh-plugins
```

## 卸载

移除单个插件：

```sh
dsh plugin --profile web remove <name>
```

移除全部插件（换行拼接为一条命令即可）：

```sh
dsh plugin --profile web remove dsh-text-editor dsh-code-card-fonts dsh-git-guard dsh-fullwidth-chat dsh-new-session dsh-directory-picker-browse dsh-change-summary dsh-kbd-hotkeys
```

卸载后重启 App 生效。

## 新增 / 移除插件时

1. 按各插件 README 完成插件包本体（新插件须遵循 `AGENTS.md` 强制规范第 2 条）；
2. 同步更新 `install.sh` 与 `install.ps1` 中的插件目录列表——**两处必须保持
   一致**（两个脚本均默认安装清单中的全部插件）；
3. 需要手动单装验证时，构建后按上文「手动安装单个插件」执行。

## 验证

仓库级无独立校验命令。各插件按其目录内说明自检（例如 `dsh-git-guard` 的
`node test.mjs`、`dsh-change-summary` 的 `npm run verify`），构建与验证命令总表见
`AGENTS.md`「构建与验证」。
