# dsh-workspace-activity-sort

左侧栏里**最近有会话活动的工作区自动浮到最前**。宿主半部插件：没有 UI 补丁，没有客户端
代码，也不记账任何时间戳——谁该在最前由宿主自己的事件决定。

## 它做什么

- 在某个工作区里**发出一条用户消息**（新建会话后开始交互，或在已有会话里继续、steer），
  那个工作区立刻移到 Workspace 分组的最前。
- 只动「活跃的那一个」：其余工作区的相对顺序不变。这不是每次全量排序，而是上浮。
- **平时不动顺序**：手动拖拽、改名、新建 / 删除工作区都原样保留，直到下一次会话活动。
- 顺序写回注册表的持久显示顺序（`ctx.workspaceRegistry` 的 `workspaceIds`），所以它是
  权威事实：浏览器通过 workspace 控制器 `follow()` 的 `order` 增量跟随，重连的客户端、
  第二个 GUI、桌面端看到的是同一份顺序。

## 为什么这样实现

- **顺序的真源在宿主。** 侧边栏的 Workspace 分组顺序不是浏览器本地状态，而是 Workspace
  注册表的持久顺序（`dsh-client-ui-workspace` 的 README：会话顺序存在浏览器本地，
  Workspace 分组的拖拽顺序仍由 Host 持久化）。排序放在宿主侧一次就把所有消费方都对齐；
  改成客户端渲染期排序则要替换官方浏览器组件。
- **依据用事件，不记账。** 宿主只在用户消息提交时发 `api-session/activity`，而侧边栏会话行
  右侧显示的时间是同一事实（`max(会话 createdAt, 最后一条用户消息时间)`）。所以插件不冷读
  会话历史、不维护活动时间表、也没有重启后需要恢复的状态：事件本身就说清了「谁刚活跃」。
- **归属查询用注册表自己的账。** 会话属于哪个工作区，读注册表实体的 `sessionIds`（就是
  侧边栏分组用的那份账），不做 cwd 字符串匹配，也不猜。
- **只用公开 API。** `workspaceRegistry.insertBefore(id, beforeId)` 正是侧边栏拖拽自己走的
  入口，语义是 DOM insertBefore：移到锚点之前。「已经在最前」时它一次写盘都不做，插件也
  提前跳过，所以在一个工作区里连续聊天不会反复写盘。
- **自己的写入不会触发自己。** 重排只写全局顺序单例（`domain/changed` 的 `table` 为 `''`），
  而插件只听工作区表（`table === 'workspaces'`）。
- **事件只入队，收敛排到宏任务。** 监听器不做别的事，只入队 + 排一轮；这一轮延迟到下一个
  宏任务是必需的：工作区表的 `domain/changed` 在注册表实体快照换新之前就发出来了
  （持久写入 → 事件 → 实体换新），隔一个事件循环才读得到 attach 之后的归属。

## 触发时机

| 宿主事件 | 插件动作 |
| --- | --- |
| `api-session/activity`（用户消息提交） | 该会话所属的工作区上浮到最前 |
| `session/created`（新会话，非 subagent 且还没归属） | 登记，等它落位 |
| `domain/changed`（workspace 域、`workspaces` 表） | 让登记的新会话认领工作区，认领到就上浮一次 |
| `session/disposed` | 作废还没落位的登记 |
| 手动拖拽、改名、新建 / 删除工作区 | **什么都不做**（顺序保持原样） |

登记的新会话等 60 秒还没归属就放弃（它可能压根不属于任何工作区，比如按 `cwd` 创建、
没有登记为 workspace 的会话）。

## 什么不算「活跃」

- **打开 / 恢复（resume）一个旧会话**：`session/created` 也会为它发一次，但插件按「是否已经
  在某个工作区的账下」判定它不是新建，因此不会上浮。它右侧的时间也没变。
- **subagent 子会话**：侧边栏本来就隐藏它们，创建它们也不上浮（父会话的提示才是活动）。
- **被复用的空白会话**：同一个工作区里再点一次「新建会话」而复用了已有空白会话时，并没有
  新会话产生、行上的时间也没变，所以不上浮。
- **Ungrouped 会话**：不属于任何工作区，没有可上浮的分组。
- **工作区自身的变化**（改名、拖拽）：不是会话活动，不上浮。

## 挂载与启用

```powershell
# 仓库根：把新包记进 lockfile（需要 pnpm 的 store 访问）
pnpm install

# 挂进 web profile（与其它本地插件同一入口；脚本会把本插件加进去）
./add-plugins.ps1
```

本插件**只有宿主半部**：`index.ts` 与 `src/bump.ts` 由 Node Type Stripping 直接加载，没有
构建产物，也没有 `dsh.client` 声明，因此**不需要重建 Web 资源**；改动源码后重启 dsh 即可
生效。

没有配置项：策略只有「会话活跃即上浮」这一条，插件不导出 `Config`。

## 验证

```powershell
node node_modules/typescript/bin/tsc -p dsh-workspace-activity-sort/tsconfig.json   # 类型检查
cd dsh-workspace-activity-sort
node test/run-all.mjs                                                              # 三个测试文件
```

| 测试文件 | 覆盖 |
| --- | --- |
| `test/bump-plan.test.mjs` | 纯规划：归属查找、上浮所需的那一次移动、待落位新会话的认领与放弃（含 TTL 边界与定序） |
| `test/plugin-apply.test.mjs` | 假 ctx + 忠实复刻 `insertBefore` 语义的假注册表：活动即上浮、已在最前不写盘、Ungrouped / resume / subagent 都不上浮、新会话落位才上浮、手动拖拽保留到下一次活动、改名不重排、突发合并、注册表拒绝时降级、卸载停手 |
| `test/cordis-integration.test.mjs` | 真实 `@deepseek-ai/cordis` 上下文：`inject` 等待语义、真实事件总线上的活动 / 新会话落位 / 销毁、卸载后停手 |

> `test/run-all.mjs` 用 `spawnSync` 逐个跑测试文件；在受限沙箱里子进程捕获输出会被拒绝
> （EPERM），此时直接 `node test/<file>.test.mjs` 即可。

## 边界

- **只上浮，不做全量重排**：插件不会在挂载或重启时按历史活跃时间重排既有顺序。它继承
  注册表当前的持久顺序，之后由会话活动推动。若插件是在一段使用之后才挂上的，之前那些
  活动不会被追溯。
- **活跃由宿主事件决定，与是哪个客户端无关**：只有经过本宿主、被记为 `user/message`
  的提交才算活动。别的 dsh 实例（或本插件未挂载时）写下的活跃不会体现在顺序里。
- **不尊重「以后再说」**：想固定某个工作区的位置，目前只能停用插件（没有 `pinned` 之类的
  配置）。
- 只排序 Workspace 分组；每个工作区内部的 Session 顺序不受影响。
- 注册表不可用时插件整体不挂载（`inject: ['workspaceRegistry']`），不做任何降级。
- 同一毫秒登记的两个新会话，按会话 id 定序（确定性，但不保证与创建先后一致）。
