# dsh-workspace-quick-switch

按 **`Ctrl+Alt+M`** 弹出一个浮层,里面列出**左侧栏当前的前 10 个工作区**(顺序就是左侧栏 Workspace 分组的顺序);用 `↑` / `↓` 选,按 `Enter` 或点击某一行,**在那个工作区里新建会话**并切过去。`Esc` 或点浮层外面关掉。

## 它做什么

- **候选 = 左侧栏那一份**:读 Workspace 控制器的 `list` 快照。宿主把工作区的持久显示顺序通过 `follow()` 的 `order` 增量送下来,所以手动拖拽、`dsh-workspace-activity-sort` 之类的上浮改的正是这一份;浮层只取前 10 个,不改顺序、不做自己的排序。
- **浮层开着的时候候选继续跟随**:工作区新增/删除/改序,列表立刻跟着变,选中行尽量停在原来那个工作区上。
- **当前工作区会被标出来**:读主视图会话的 `retainedBy.mainView`,再按工作区自己的 `sessionIds` 归属映射(`sessions` 服务缺席时就不标),打开时默认选中它。
- **`Enter` 与左侧栏那个按钮是同一个动作**:调 `uiWorkspace.startSession(workspaceId)` —— 复用该工作区已有的空白会话,没有才真创建一个。
- **没有工作区时**照常弹浮层,给出「先在左侧栏添加一个工作区」的提示,`Enter` 不做动作。
- **服务晚到也能补上**:`workspaces` / `sessions` 经 gateway + WebSocket 的远程链路提供,页面刚起来时还不存在;插件照常先占住快捷键与浮层,服务到位后再接上订阅,候选与「当前」标记随即补上(不需要刷新页面)。

## 实现要点

| 关注点 | 做法 |
| --- | --- |
| 快捷键 | 注册**固定行** `dsh-workspace-quick-switch.quick-switch`(group `application`,占据 `Ctrl+Alt+M`),经 `observeFixedInput` 的固定通道收取按键;带修饰键/重复/组合输入/已消费的输入一律放行 |
| 浮层 | 注册进 `shell.overlay`(加法式列表槽,`order: 60`),等 ui-layout 声明该槽后再注册;整层默认 click-through,只有遮罩吃指针事件,面板自己拿焦点 |
| 槽位契约 | 注册的第二个参数必须是**组件本体**(`PaletteOverlay`),业务 props 只由 `options.inject: () => ({ store })` 交出来 —— 渲染器对条目做的是 `jsx(entry.component, props)`;`slots.inject` / `slots.register` 还必须以**槽位服务对象本身**为接收者调用(上游用 `this.ctx`,Cordis 服务代理据此把 effect 记到本插件这个 scope 上),自己 `bind` 到别处会让上游连 `this.ctx` 都读不到 |
| 浮层内的按键 | 本插件在 `document` 捕获阶段接管 `Esc` / `Enter` / `↑` / `↓`(只在浮层开着时),所以先于页面上任何本地控件看到按键,并 `preventDefault` + `stopPropagation` |
| 样式 | 插件自己的 `<style>`(随 fiber 卸载移除),只用主题令牌 `--dsw-*` + 回退值,亮/暗主题自动跟随 |
| 依赖 | `inject: ['slots', 'shortcuts']` —— 只等这两个,所以 `Ctrl+Alt+M` 与浮层从启动起就在;`workspaces` / `sessions` 用**等待子 fiber**(`scope.inject`)接上:服务到位才跑、换实现时先卸载再重跑,缺席就只是空候选(不告警,那不是故障);`uiWorkspace` 缺席则固定行照旧在、按键不做动作 |

宿主半部是空实现(没有 `dsh.client` 之外的东西需要宿主做),所以**改客户端代码必须重建 `lib/client.js`**。

## 安装与启用

```powershell
# 1) 构建浏览器半部(产物是 lib/client.js)
cd dsh-workspace-quick-switch
pnpm install          # 首次:把 react / react-dom / @types/* 落进仓库根 node_modules
pnpm build            # 或 ../node_modules/.bin/tsdown

# 2) 挂进 web profile
dsh plugin --profile web add C:\Users\LGZ\dsh-plugins\dsh-workspace-quick-switch
```

挂载后**刷新浏览器**即可(`dsh.client.platform=web` + `immediately`,客户端 roster 会随页面加载)。

## 验证

```bash
cd dsh-workspace-quick-switch
pnpm typecheck                 # tsc --noEmit
node test/run-all.mjs          # 五个测试文件(spawn 被沙箱拒时逐个跑,见下)
```

| 测试文件 | 覆盖 |
| --- | --- |
| `test/palette.test.mjs` | 纯状态:候选投影(前 10 个、顺序照抄、当前标记)、下标收敛、环状步进、store 写入与批量通知 |
| `test/keys.test.mjs` | 按键解码:四个键归浮层,带修饰键/组合中/已消费/长按确认都放行 |
| `test/overlay.test.mjs` | 浮层渲染(真 React):候选行、路径、`aria-*`、「当前」角标、`installPaletteKeys` 的接管范围 |
| `test/install.test.mjs` | 装配:固定行注册、槽位注册、候选跟随快照、按键到 `startSession` 的端到端、上游缺席时的降级、**工作区/会话服务晚到后补上读数**、卸载清理 |
| `test/artifact-client.test.mjs` | 产物:`lib/client.js` 的模块 id / 插件名 / `inject`、只向模块表要 `react`、装配后端到端可用 |

`test/run-all.mjs` 用 `spawnSync` 逐个跑;受限沙箱里 spawn 会被拒(EPERM),此时直接:

```bash
node test/palette.test.mjs && node test/keys.test.mjs && node test/overlay.test.mjs \
  && node test/install.test.mjs && node test/artifact-client.test.mjs
```

## 边界

- **默认绑定是 Windows/macOS 浏览器允许的组合**:`Ctrl+Alt+M` 是「两个修饰键 + 普通键」,在 `web:windows` / `web:macos` 档案下合法(Linux 浏览器对两修饰组合有限制,那种设备上固定行注册会失败并只告警一次,插件其余部分照旧)。按键与其它命令的冲突由快捷键服务按固定行规则裁决(占用先到先得),快捷键目录里能看到这一行。
- **不做搜索过滤、不做拖拽排序、不切换工作区归属**:浮层只负责「选一个工作区,在那里新建会话」。
- **前 10 个**:顺序里第 11 个之后的工作区不出现(需要在更多工作区里建会话时,用左侧栏本身)。
- **鼠标划过不改选中行**:悬停只给高亮,`Enter` 永远落在键盘/点击选中的那一行;点击某一行直接就是 `Enter` 的效果。
