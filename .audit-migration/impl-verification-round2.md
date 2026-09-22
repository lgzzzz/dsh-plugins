# 二次对抗式复核：`dsh-kbd-hotkeys` 修复版（fork 判据 + 缺摘要剔除）

复核人：`impl-verifier`（独立复核，非实现者）。任务板 `task-6`。
目标：**试图推翻 Lead 的两处修复**，重点是 (b) 过滤 `origin === 'subagent'` 的**过度过滤风险**。

## 结论摘要（供 Lead 直接引用）

| 复核项 | 结论 |
| --- | --- |
| (a) 差分 fuzz | 修复**成立**：§1.3 反例复跑已对齐上游（`["A","X","B"]`）；定向 fuzz（每例含无摘要成员 P + fork X→P）**0 / 5000** 不一致；全域 fuzz **0 / 50000**（另 20000 例含 phantom 成员的 fuzz 亦 0） |
| (b) 过度过滤反证 | **未推翻，未发现过度过滤**。`origin` 值域被上游多处**强制**为 `undefined \| 'subagent'`（`dsh-session/lib/index.js:935` 等）；真子代理的创建（`dsh-subagent` `childSessionMeta`）、resume、jsonl 持久化、线协议（`z.literal("subagent")`）全链路保留 `origin`。唯一丢 `origin` 的 header 生产者（`dsh-session-query-sqlite` 的 `rowHeader:1041-1052`）**不在 `sessions.list` 路径**，且只影响非 live 会话（本就不可取消） |
| (c) fork-cancel | fork 不再被取消（单层/隔代），真子代理仍被取消，投影目录项仍被取消；0.1.6 旧实现走 `subagentsByParent`（`kind==='child'` 目录），**fork 结构不可达** → 本次确属回归修复 |
| (d) 产物一致性 | `/tmp` 副本独立重建 sha256 = 工作区 = `15be27eb…`，91957 B，`diff` 逐字节相同 |
| (e) 变异检验 | 独立重做 4 组：去掉 origin 过滤 → **3 FAIL**（且仅 A④ fork 三例，子代理对照仍绿）；仅去掉 `recencyOrder` 剔除 → 2 FAIL；仅去掉 `reconcileOrder` rest 剔除 → 2 FAIL（含反例复现 `["A","B","X","P"]`）；两处全去掉 → 4 FAIL。新断言有牙齿 |
| (f) 回归 | `recencyOrder` 收紧对其余调用点是 **no-op**（`recent-sessions` 两个调用点已按 `byId[id] !== undefined` 预过滤；`workspace-switcher` 不用它）；`test-order` 53 / `test-services` 498 / `test-dispatch` 24 / `tsc` / `check` 全绿 |
| (g) 文档核对 | README 主体与代码一致；发现 **3 处需修**：`:76` 用「∩」表示并集（自相矛盾）、`:222` 称「切回 `show` 并在侧栏点行」可打开归档会话（上游 `guardedOpen` 在 `show` 下同样拒绝）、`:72` `session.recent` 行未提归档门闸。AGENTS.md `:163` 描述与代码一致 |

**未发现需要驳回的修复；两条修复都成立。** 残余观察仅 1 条不可达边界（§7.1）与 3 处文档瑕疵。

### 复核基线（冻结）

Lead 声明的基线全部核实一致，且复核期间（最后一次写入 `1790066879`，复核开始时已 ≥3 分钟无写入）无变化：

```
85e76685…  src/actions.ts        24069f83…  src/session-order.ts
3fe43805…  src/types.ts          170b189e…  test-order.mjs
15be27eb…  lib/client.js (91957 B) 74e08799… README.md
```

diff harness 位于 `/tmp/dsh-audit/impl-verify/`（round-1 建立的上游参考实现 `ref.mjs` 未改，逐行抄自
`dsh-client-ui-workspace/lib/client.js`），全部临时产物在 `/tmp`，工作区零写入。

---

## 1. (a) 差分 fuzz 复跑

| 用例 | round-1（修复前） | round-2（修复后） |
| --- | --- | --- |
| `counterexample.mjs`（§1.3 反例：A/X(parentId=P)/B + P 无摘要） | 上游 `["A","X","B"]` vs 插件 `["A","B","X"]` | 两端**均** `["A","X","B"]` |
| 定向 fuzz（每例必含无摘要成员 P + fork X→P） | 3349 / 5000 不一致 | **0 / 5000** |
| 全域 fuzz（成员集合 ⊆ 有摘要 id） | 0 / 50000 | **0 / 50000** |
| 全域 fuzz（允许 phantom 成员，20000 例） | 0 / 20000 | **0 / 20000** |

`reconcileOrder` 的 `rest` 与 `recencyOrder` 现与上游 `orderByRecency` 同集（丢弃 `byId[id] === undefined`），
`placeFork` 的 `pending`/`result.includes(parentId)` 判据随之与上游逐例一致（fuzz 覆盖 workspace|flat ×
`default|show|only` × `updated|manual` × 随机 pins/archives/savedOrder/phantom 成员）。
**未找到任何新的不一致。**

---

## 2. (b) 重点：`origin === 'subagent'` 是否过度过滤

### 2.1 `origin` 取值域 = `undefined | 'subagent'`（上游强制）

| 证据 | 内容 |
| --- | --- |
| `dsh-session/lib/index.js:935` | 运行时校验：`if (record.origin !== void 0 && record.origin !== "subagent") throw new Error("session header origin must be \"subagent\"")` |
| `dsh-session/lib/types/types.d.ts:81`、`:119` | `readonly origin?: 'subagent'`（字面量联合，无第二个值） |
| `dsh-api-session-controller/lib/typert.host.js:208`、`:383` | 线协议 schema：`'origin': z.literal("subagent").readonly().optional()` |
| `dsh-api-session-controller/lib/typert.host.js:2065` | 线协议 `SessionSummary` 声明：`readonly origin?: 'subagent'` |
| `dsh-session-format-v0-to-v1/lib/index.js:1488,1713`、`v1-to-v2:77,204`、`v3-to-v4:972` | 各格式迁移逐版校验「origin 若有值必为 `"subagent"`」并原样搬运 |
| `dsh-session-persistence-jsonl/lib/index.js:840` | 持久化 header 校验：`(value.origin === void 0 \|\| value.origin === "subagent")` |

结论：**不存在第二种 `origin` 值**，故过滤不会因「别的 origin 值」漏掉真子代理。

### 2.2 所有写 `parentSession` 的路径逐一分类

`grep -rn "parentSession:" $G/*/lib/*.js` 的完整命中（`$G` = 全局 `@deepseek-ai` scope）：

| 文件:行 | 是会话创建吗 | 带 `origin` 吗 | 判定 |
| --- | --- | --- | --- |
| `dsh-subagent/lib/index.js:476`（`childSessionMeta`） | 是（`:1725` 供 `agents.create`，`:1082-1091` 执行） | **是**，`:478` `origin: "subagent"` | 真子代理，过滤保留 ✅ |
| `dsh-api-session-controller/lib/index.js:719` | 是（session fork，`:713-728` `agents.create`） | **否**（只有 `parentSession` + `isSeeded`） | fork，`origin` 缺席 → 过滤剔除（正确） |
| `dsh-session/lib/index.js:1769`（`SessionStore.fork`） | 是（`:1764-1772` `create` meta） | **否** | fork，剔除（正确） |
| `dsh-subagent/lib/index.js:1096` | **否** —— 这是 `SubagentRuntime` 内 `activation` 记账对象的字段，不是会话 header 写入 | 不适用 | 不产生会话行 |
| 格式迁移 / 日志导出 / jsonl 持久化 / sqlite 重建（`v0-to-v1:1719`、`v1-to-v2:210,289`、`session-log-*`、`persistence-jsonl:829,3103`、`query-sqlite:1047`） | 否，均搬运既有 header 字段 | 见 §2.3 | 仅影响恢复 |

**唯一创建真子代理的 `meta` 生产者**：`dsh-subagent/lib/index.js:1725` `meta: childSessionMeta(parent, childDepth, prepared.seed !== void 0)`；
`childSessionMeta`（`:470-481`）无条件写 `parentSession: parentHeader.id`（`:476`）与 `origin: "subagent"`（`:478`）。
header 由此构建：`dsh-session/lib/index.js:1577` `...meta?.origin === void 0 ? {} : { origin: meta.origin }`。

### 2.3 恢复 / resume / 冷列表 是否丢 `origin`（这是唯一可能的漏洞）

| 环节 | 证据 | 是否保留 origin |
| --- | --- | --- |
| 子代理 continuation / resume | `dsh-subagent/lib/index.js:1076` `agents.resume({ resumeSessionId: childId, … })`；恢复走持久化 header | ✅ |
| jsonl 持久化读 | `dsh-session-persistence-jsonl/lib/index.js:822-836` `fromHeaderLine` 与 `:3095-3107` `currentHeader` 均 `...origin === void 0 ? {} : { origin }` | ✅ |
| 冷会话列表（`sessions.list` 的来源） | `dsh-session-query/lib/index.js:95-116` `SessionCorpus.listSessions` = `persistence.list()`（`:283-290 listPersisted` → `sessionPersistence`，即 jsonl）∪ live `sessions.list()` header；`:126-155` `load` 同样优先 live、回退 `listPersisted` | ✅ |
| 线协议 / 客户端 | `typert.host.js:208` 声明 origin；宿主 `listFields`（`dsh-api-session-controller/lib/index.js:1935-1941`）在 `header.origin !== void 0` 时写 `origin`；客户端 `applyMutation`（`client.js:2920-2921`）与 `projectList`（`client.js:3445`）原样透传 | ✅ |

### 2.4 唯一丢 `origin` 的生产者及其不可达性

`dsh-session-query-sqlite/lib/index.js:1041-1052` 的 `rowHeader` 从 SQLite 行重建 header，**不含 `origin`**
（schema `:97,99,126,128,775,792` 也无 origin 列）。但：

1. 它的消费者是**搜索/观察面**（`:857-886` `_targetObservation` / `_sessionHit`），**不是** `sessions.list`：
   `sessions.list` 走 `dsh-session-query` 的 corpus（§2.3），冷列表用 `sessionPersistence`（jsonl）。
2. 即便某冷子代理的 header 真缺 `origin`：它是 **非 live** 会话（`dsh-api-session-controller/lib/index.js:1799-1810`
   `summarizeCold` 恒 `running: false`、`agentAvailable: false`），而 `cancelIfRunning`（`src/actions.ts:399-416`）
   要求 `sessions.binding(id)?.session.getSnapshot().running === true`；非 live 会话本就**不可取消**，
   被过滤不会产生行为差。
3. 唯一理论缺口：冷中间节点（子代理）带一个 live 的运行中孙代。需同时满足「该中间子代理已脱离 live 但孙代仍 live 且 running」——
   未找到支持该状态的代码路径（子代理运行期其 header 在 `sessions` 注册表内，`SessionCorpus.load:128-133` 优先 live，
   故 live 子树的每个节点都带 origin）；本机不加载插件无法运行期取证，列为未确证（§7.2）。

**过度过滤裁决：不成立。** 过滤条件与上游自身的取消枚举（`dsh-subagent/lib/index.js:2435-2443`
`runningDescendants`：`parentSession !== void 0 && origin === "subagent"`，用于 `:2420-2426`
`workspace/session-stop`）完全同判据 —— 任何「漏」都同时是上游的漏，而非本插件引入。

---

## 3. (c) fork-cancel 类用例复跑

`/tmp/dsh-audit/impl-verify/fork-cancel.mjs`（桩区分 `origin === 'subagent'` 的地址与无地址的 fork）：

| 用例 | round-1（修复前） | round-2（修复后） |
| --- | --- | --- |
| 真子代理 `root → child(origin=subagent)` | `["root","child"]` | `["root","child"]` ✅ |
| 单层 fork `root → fork(parentId, 无 origin)` | `["root","fork"]`（误取消） | `["root"]` ✅ |
| 隔代 `root → sub(子代理) → fork(parentId=sub, 无 origin)` | `["root","sub","fork"]`（误取消） | `["root","sub"]` ✅ |

0.1.6 不可达性核实：旧实现取 `snapshot.subagentsByParent?.[id]?.entries` 且跳过 `entry.kind !== 'child'`
（`git diff src/actions.ts` 中被删代码），而 0.1.6 的 `subagentsByParent = Object.fromEntries(this.catalogs)`
（`/tmp/dsh-audit/old-extract/dsh-api-session-controller/lib/client.js:2807`）来自 `remote.subagents.list`
的子代理目录；目录项由 `dsh-subagent/lib/index.js:1537-1551` 的 `establishCatalogChild` 写出的
`subagent/catalog` 事件物化（`:1498-1512`），fork 两条路径（`dsh-api-session-controller/lib/index.js:713-728`、
`dsh-session/lib/index.js:1764-1772`）都不写该事件 → **fork 在旧路径不可达**。本次修复确为回归修复。

---

## 4. (d) 产物一致性

```
workspace lib/client.js  15be27ebf98289e93f2c3ad6736799def6293351cd9b8e367ecea5bdf4d1b96f  91957 B
copy      lib/client.js  15be27ebf98289e93f2c3ad6736799def6293351cd9b8e367ecea5bdf4d1b96f  91957 B
diff → IDENTICAL
```

副本位于 `/tmp/dsh-audit/impl-verify/copy2`，`NODE_PATH=…/dsh-code-card-fonts/node_modules npm run build`
（借 esbuild 平台二进制）；构建日志自报的「90870 字节」是 `scripts/build-client.mjs:63` 的
`compiled.length`（包装前），落盘成品两端均 91957 B。

---

## 5. (e) 变异检验（独立重做）

每例从当前工作区重新复制到 `/tmp`，只改副本：

| 变异 | 改动点 | `test-order.mjs` |
| --- | --- | --- |
| m1 去掉 origin 过滤 | `src/actions.ts` 删除 `if (summary.origin !== 'subagent') continue` | exit 1，**3 FAIL**：`只取消 s1,fork 不动`（实得 `["s1","fork"]`）、`隔代:取消 s1/sub`（实得 `["s1","sub","fork"]`）、`对照:同父下子代理取消、fork 不取消`（实得 `["s1","sub","fork"]`）；`投影目录项仍被递归取消` **仍 ok** → 证明过滤不是把整条子代理路径关掉 |
| m2 去掉 `recencyOrder` 剔除 | 删 `.filter((id) => byId[id] !== undefined)` | exit 1，**2 FAIL**：`recencyOrder 剔除缺摘要 id`、`recencyOrder 全缺摘要 → 空` |
| m3 去掉 `reconcileOrder` rest 剔除 | `!included.has(id) && byId[id] !== undefined` → `!included.has(id)` | exit 1，**2 FAIL**：`reconcileOrder rest 剔除缺摘要 id`、`P 无摘要 → 不重定位 fork X(对齐上游 ["A","X","B"])`（实得 `["A","B","X","P"]`，即 round-1 反例被断言复现） |
| m4 两处全去掉 | m2 + m3 | exit 1，**4 FAIL**（上两组并集） |

基线与 m1–m4 的 `ok` 计数：53 / 50 / 51 / 51 / 49。**新断言有牙齿，且覆盖粒度正确**（m1 只红 fork 三例、
m2/m3 各自只红对应剔除断言）。

---

## 6. (f) 回归：`recencyOrder` 收紧的影响

`recencyOrder` 的调用点（`grep -rn recencyOrder src/`）：

| 调用点 | 入参是否可能含缺摘要 id | 收紧影响 |
| --- | --- | --- |
| `src/sidebar-order.ts:69`（`orderBy=updated` 的账号序，成员来自 `workspace.sessionIds`） | **可能**（成员可含 phantom） | 由「保留并排最后」变为「剔除」→ **向上去游对齐**（本次修复目的） |
| `src/recent-sessions.ts:71` `recencyOrder(all, byId)` | **不会**：`all` 只收 `visible(id)` 为真的 id，而 `visible` 已要求 `summary !== undefined`（`:42-45`） | no-op |
| `src/recent-sessions.ts:89` `recencyOrder(members, byId)` | **不会**：`members` ⊆ `all` | no-op |
| `src/workspace-switcher.ts` | 不使用 `recencyOrder`（活跃度取 `Math.max(updatedAt)`） | 不受影响 |
| `test-order.mjs:233-234` | 断言目标 | 新增 B④ |

`recent-sessions` 的 `RECENT_LIMIT` 裁剪与 `kept` 计算均基于 `all`（全有摘要），收紧后行为不变；
`test-services` 498 / `test-dispatch` 24 复跑全绿（exit 0）。

**残余差异（未确证可达）**：见 §7.1 —— 当某条**存在**的 `byId` 行的 `updatedAt` 为 `undefined`（而非 NaN）时，
插件的 `compareRecency`（`src/session-order.ts:47-52`，`?? -Infinity`）与上游 `orderByRecency`
（`W:326-329`，`b.rank - a.rank` → NaN 视作 0）会给出不同顺序（差分实测 5054 / 20000；
`updatedAt: NaN` 时 0 / 20000 不一致）。

---

## 7. (g) 文档核对（README / AGENTS）

### 7.1 README 中**不实 / 需修**的三处

| 位置 | 现文 | 问题 |
| --- | --- | --- |
| `README.md:76` | 「…由 `sessions.list` 快照的**两源并集**枚举（`byId` 行的 `parentId` **∩** `projectionsBySession[parent].values.subagentCatalog`…）」 | 同句先说「并集」又用交集符号 **∩**；代码是并集去重（`src/actions.ts:366-396`，`push` 带 `includes` 判重）。应改 **∪**。另该括号只写 `parentId`，未写 `origin === 'subagent'`（同句前文已限定，属不精确） |
| `README.md:222` | 「需要打开归档会话请先切回 `default` / `show` 并在侧栏点行。」 | **不可行**：上游侧栏 `guardedOpen`（`W:2813-2818`）与搜索打开（`W:2942-2945`）在 `show` 下同样拒绝打开归档会话（只提示 `notifyArchivedNotOpenable`）。正确路径是**先在侧栏取消归档**（上游有 `onSessionUnarchive`，`W:3235`），再打开。 |
| `README.md:72` | `session.recent` 行「`Enter`/点击调 `uiWorkspace.openSession(sessionId)`」 | 归档行下 `openRecentSession` 直接 `return false`、**不调用** `openSession`（`src/recent-sessions.ts:107-121`）。该行未提门闸，与 `:218-222` 新增限制自相矛盾（低严重度，建议补注） |

### 7.2 README 中**已核实为实**的部分

| 位置 | 声明 | 核实 |
| --- | --- | --- |
| `:131-141` | 两源并集、`origin` 判据不可省、fork 只写 `parentSession`+`isSeeded`、0.1.6 fork 不可达、与 `runningDescendants` 同判据 | 全部与 §2、§3 证据一致 |
| `:142-151` | 侧栏渲染序管线、`pinnedSessionIds`/`archivedSessionIds` 来自 `workspaces.list`、`archivedFilter` 来自视图 store、缺摘要不参与定序、存档序保留、`placeFork` 误判机制 | 与 `src/sidebar-order.ts:44-110`、`src/session-order.ts:73-121` 一致 |
| `:148` | 视图 store 持久键 `dsh.workspace.view.v5` | `W:709` `persist: "dsh.workspace.view.v5"` ✅ |
| `:152-156` | 0.1.7 另删 `subagentsByParent`/`jobsBySession`/`setSubagentCatalogOpen()`/`refreshSubagents()`，改由 `projectionsBySession`/`refreshProjections()` 承载 | 0.1.7 全局树中前四者命中数 0（0.1.6 分别为 5/5/6/6），`refreshProjections` 0.1.6=0、0.1.7=6（`client.js:2474,3182`）✅ |
| `:218-222` | 归档行可列出不可打开、无归档标记、`only` 整榜不可打开、与 `guardedOpen` 同款 | 与 round-1 `float.mjs` 实测及 `types.ts:119-128`、`overlay.ts:456-461`、`client.ts:130-132` 一致 ✅ |
| `:223-225` | `only` 下活跃度只由归档会话决定、`sessionCount` 仍是宿主全量 | `src/workspace-switcher.ts:39,70-88`（筛选）+ `:59` `sessionCount: item.sessionIds?.length` ✅ |
| `:115-116`（既有） | 「行上的 `N 个会话` 是该工作区登记的会话总数（含被可见性裁掉的）」 | 同上 ✅ |

`AGENTS.md:163` 对 `test-order.mjs` 的描述（「校验 0.1.7 子代理枚举（`origin === 'subagent'` 判据，
fork 不递归取消）与侧栏顺序复刻（含缺摘要成员剔除）」）与代码及 53 条断言一致 ✅。

---

## 8. 未确证 / 分歧

1. **不可达边界（已用差分与代码取证，但未在运行期观察）**：`byId` 行的 `updatedAt` 为 `undefined` 时
   `recencyOrder` 与上游 `orderByRecency` 顺序不同。证据链指向**不可达**：线协议 `SessionSummary.updatedAt: number`
   为必填（`typert.host.js:2065`）；宿主 `summaryFor`/`summarizeCold`（`dsh-api-session-controller/lib/index.js:1762-1810`）
   恒给数值；`buildListSnapshot`（`client.js:2878`）恒 `Math.max(...)`；子代理目录/scopes 补行恒给 `0`
   （`client.js:3462,3486`）。`NaN` 情形两端一致（0/20000）。列为**观察项**，不建议改代码。
2. **冷中间子代理 + live 孙代**（§2.4 第 3 点）：无法在「不加载/不重启插件」的约束下取得运行期状态，
   未能构造出该状态；代码证据显示 live 子树内每个节点都在 `sessions` 注册表中、其 header 带 `origin`，
   故倾向不可达，但**未确证**。
3. **本报告未发现的其它过度过滤**：已穷举 `$G/*/lib/*.js` 中所有 `parentSession:` 写入与所有
   `origin` 校验点；若存在跨包/远端 gateway 另行构造 `SessionSummary` 的路径（例如第三方 remote
   provider 直接伪造 `items`），可能绕过 `origin` 字面量约束，但本机全局树内未见该路径，**未确证**。
4. 文档三处瑕疵（§7.1）属实现者文字问题，非行为缺陷，交由 Lead 决定是否修。
