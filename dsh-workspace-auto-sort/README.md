# dsh-workspace-auto-sort

自动给左侧栏的 Workspace 分组排序：注册表每次持久变更之后，插件的宿主半部重算一次
期望顺序，并用注册表自己的 `insertBefore` 把偏差补上。没有 UI 补丁，没有客户端代码。

## 它做什么

- 挂载时立刻把现有 Workspace 排成配置的顺序（默认 `updated-desc`：最近改动的排最前）。
- 之后每次变更（新建、重命名、删除、手动拖拽排序）都重新收敛一次：手动拖拽会被
  立刻归位，新工作区落进它该在的位置，重命名会挪到新位置。
- 顺序写回注册表的持久显示顺序（`ctx.workspaceRegistry` 的 `workspaceIds`），
  因此它是权威事实：浏览器通过 workspace 控制器 `follow()` 的 `order` 增量跟随，
  重连的客户端、第二个 GUI 看到的是同一份顺序。

## 为什么这样实现

- **顺序的真源在宿主。** 侧边栏的 Workspace 分组顺序不是浏览器本地状态，而是
  Workspace 注册表的持久顺序（`dsh-client-ui-workspace` 的 README：会话顺序存在
  浏览器本地，Workspace 分组的拖拽顺序仍由 Host 持久化）。所以排序放在宿主侧
  一次就把所有消费方都搞定；改成客户端渲染期排序则要替换官方浏览器组件。
- **只用公开 API。** `workspaceRegistry.insertBefore(id, beforeId)` 就是侧边栏拖拽
  自己走的入口，语义是 DOM insertBefore：移到锚点之前，缺锚点则追加到末尾；
  「结果顺序没变」时它一次写盘都不做。插件把所有移动折算成一遍插入排序，移动次数
  不超过 n-1。
- **重入不会变成写盘风暴。** 插件自己的写入会同步发出 `domain/changed`，于是监听器
  会再请求一轮；因为顺序已经收敛，第二轮是空轮（0 次移动）。`busy`/`dirty` 把这类
  重入压成「当前这轮跑完再跑一轮」，另有 8 轮上限兜底。
- **按 `updatedAt` 排序是安全的。** 注册表重排只写全局顺序单例
  （`insertBefore` → `setState` → `global.set`），**从不触碰工作区记录**；`updatedAt`
  只由实体变更（创建、改名、会话归属变化、工作区内会话重排）经 `table.update` 推进。
  也就是说插件自己的写入永远不会改变自己的排序依据，不存在追逐与抖动。

## 配置

在 profile 的 `cordis.patch.yml` 里按插件 id 覆盖：

```yaml
- id: dsh-workspace-auto-sort
  name: dsh-workspace-auto-sort
  config:
    order: updated-desc   # updated-desc | updated-asc | title-asc | title-desc | path-asc | path-desc | created-asc | created-desc
    pinned:               # 置顶项：按显示标题或绝对路径匹配，数组顺序即置顶段内顺序
      - default-workspace
    caseSensitive: false  # 比较标题/路径时是否区分大小写（默认 false）
    locale: zh-CN         # 比较用的语言标签；省略用运行环境默认语言
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `order` | `updated-desc` | 排序依据；标题/路径用 `Intl.Collator`（数字序：`项目2` 在 `项目10` 前），时刻字段按 ISO 时间序 |
| `pinned` | `[]` | 置顶项，标题或绝对路径命中即置顶；先出现的置顶值赢 |
| `caseSensitive` | `false` | 比较时是否区分大小写 |
| `locale` | 运行环境默认 | 比较用的 BCP-47 语言标签；非法值退回默认语言，不让排序失效 |

同值时依次比路径、再比 id（兜底恒为升序，排序方向只反转主键），因此任何输入顺序都
得到同一结果——重排不会抖动。

`updatedAt` 由这些动作推进：**新建工作区、改名、新会话落到该工作区、调整该工作区内的
会话顺序**。继续在某个工作区里对话**不会**改变它——平台没有持久化「会话最后活动时间」
（`SessionHeader` 只有 `createdAt`），所以本插件的「最近更新」是工作区记录意义上的，
不是「最近用过」。

## 挂载与启用

```powershell
# 仓库根：把新包记进 lockfile（需要 pnpm 的 store 访问）
pnpm install

# 挂进 web profile（与其它本地插件同一入口）
./add-plugins.ps1
```

本插件只有宿主半部：`index.ts` 与 `src/order.ts` 由 Node Type Stripping 直接加载，
没有构建产物，也没有 `dsh.client` 声明，因此**不需要重建 Web 资源**；改动
`index.ts` 后重启 dsh 即可生效。

## 验证

```powershell
node node_modules/typescript/bin/tsc -p dsh-workspace-auto-sort/tsconfig.json   # 类型检查
cd dsh-workspace-auto-sort
node test/run-all.mjs                                                          # 三个测试文件
```

- `test/order-plan.test.mjs`：纯规划——比较规则（数字序、大小写、方向、置顶、稳定性）
  与「最小移动序列」。
- `test/plugin-apply.test.mjs`：假 ctx + 忠实实现 `insertBefore` 语义的假注册表——
  挂载即排序、已就位不写盘、拖拽归位、新工作区落位、置顶、卸载停手、重入不放大，
  以及 `updated-desc` 下「被改动的上浮」与「收敛后不再写盘」。
- `test/cordis-integration.test.mjs`：真实 `@deepseek-ai/cordis` 上下文——`inject` 等待
  语义、真实事件总线、`{}` 配置按 schema 展开默认值、非法配置在加载期被拒绝。

> `test/run-all.mjs` 用 `spawnSync` 逐个跑测试文件；在受限沙箱里子进程捕获输出会被
> 拒绝（EPERM），此时直接 `node test/<file>.test.mjs` 即可。

## 边界

- 插件不「尊重」手动拖拽：拖完立刻归位——这就是「自动排序」的语义。想临时改顺序就
  用 `pinned`，或停用本插件。
- 只排序 Workspace 分组；每个 Workspace 内部的 Session 顺序不受影响。
- 注册表不可用时插件整体不挂载（`inject: ['workspaceRegistry']`），不做任何降级。
- 「最近更新」是工作区记录意义上的（见「配置」一节），不等于「最近用过」；若需要
  「哪个工作区最近有对话活动」这种更强的维度，平台没有持久化的依据，只能是进程内
  近似（重启即丢），需要另做设计。
