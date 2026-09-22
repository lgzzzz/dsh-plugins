# 对抗式复核：`dsh-kbd-hotkeys` 0.1.7-alpha.1 迁移实现

复核人：`impl-verifier`（独立复核，非实现者）。任务板 `task-5`。
目标：**推翻**该迁移实现，而非背书。

## 结论摘要（供 Lead 直接引用）

| 复核项 | 结论 |
| --- | --- |
| ① 上游语义逐分支 | 5 个复刻函数**分支结构基本等价**；但 `reconcileOrder` 保留「无摘要成员」与上游 `orderByRecency` 丢弃不一致，且该差异在 `sidebarOrderedSessionIds` 最终输出上 **可观察**（有反例，见 §1.3） |
| ② 子代理枚举 | 子代理行**必带** `parentId`；未发现 `parentId` 缺席的子代理行（`subagentCatalog` 并集对当前 producer 冗余但无害）；**发现真缺陷**：**fork 行（`origin` 缺席）也带 `parentId`**，`childIdsByParent` 把 fork 当子代理递归 → **Esc 会误取消运行中的 fork**（上游等价枚举 `runningDescendants` 明确排除 fork），见 §2 |
| ③ 产物一致性 | `/tmp` 副本独立重建，`lib/client.js` sha256 与工作区**完全一致**（`67cead2b…`） |
| ④ 变异检验 | 两处变异均**变红**（`childIdsByParent` → 空 `Map`：3 FAIL；`sectionMembers` → 直返入参：7 FAIL），测试有牙齿 |
| ⑤ 重跑 | `test-order` 42 ok / 0 FAIL；`test-services` 498 断言全 PASS；`test-dispatch` 24 全 ok；`tsc --noEmit` exit 0 |
| ⑥ 回归排查 | `sessionVisible` **全部**调用点已正确改签名、无漏改；浮窗在 `show`/`only` 下列出**不可打开且无视觉标记**的归档行（与上游 `guardedOpen` 语义一致，上游侧栏有 `archived` 标记）→ 列为已知限制；`RECENT_LIMIT` 强制纳入受 `visible(current)` 守卫、无可见性冲突；`workspace-switcher` 活跃度在 `only` 下按归档会话排序，逻辑自洽但口径变化 |

**两条需要 Lead 决策的分歧**：§1.3（缺摘要成员导致 fork 重定位，可观察，低概率瞬态）与 §2③（Esc 误取消 fork，稳定可复现，建议必修）。

### 复核基线（冻结）

工作区最后一次写入 `lib/client.js` = epoch `1790066498`；此后 ≥3 分钟无写入，本次所有产物比对/测试均针对该快照。

```
f137d589…  src/actions.ts            a865be91…  src/session-order.ts
76723564…  src/sidebar-order.ts      91323347…  src/types.ts
4208330a…  src/recent-sessions.ts    97555111…  src/workspace-switcher.ts
79d1908e…  src/overlay.ts (== HEAD)  42232341…  src/client.ts (== HEAD)
67cead2b…  lib/client.js             927235033… test-order.mjs
```

`git diff -- dsh-kbd-hotkeys/src/overlay.ts dsh-kbd-hotkeys/src/client.ts` 为空（Lead 所述回退已核实，见 §5.1）。

方法：自写上游参考实现 `/tmp/dsh-audit/impl-verify/ref.mjs`（从全局安装
`dsh-client-ui-workspace/lib/client.js` 逐行抄录 `orderByRecency`/`reconcileManualOrder`/`pinCurrentBlank`/
`sessionVisible`/`sectionMembers`/`orderedUngrouped`/`groupByWorkspace`/`deriveGroups`/`deriveFlat`/
`visibleSessionIds`，并按其 2810–2874、3243–3265 的接线组装），与插件 `sidebarOrderedSessionIds`
做**差分对比**（`diff.mjs`、`targeted-fuzz.mjs`、`fuzz-nophantom.mjs`），另有 `counterexample.mjs`、
`fork-cancel.mjs`、`float.mjs`。全部临时产物在 `/tmp/dsh-audit/impl-verify/`，工作区零写入。

---

## 1. 上游语义比对表（逐分支）

上游 = `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（下称 `W`）。
实现 = `dsh-kbd-hotkeys/src/…`。

### 1.1 逐函数对照

| 函数 | 上游 | 实现 | 逐分支判定 |
| --- | --- | --- | --- |
| `orderByRecency` | `W:318-330` | `recencyOrder` `src/session-order.ts:55-63` + `compareRecency:47-52` | **分歧（已裁决）**：上游 `flatMap` 丢弃 `summaries[id] === undefined` 的 id（`W:320-321`）；实现保留并令其 `updatedAt` 取 `-Infinity`、排到最后。排序键与 id 决胜（`W:326-329` ↔ `:50-51`）等价 |
| `reconcileManualOrder` | `W:340-379` | `reconcileOrder` `:71-117` | 存档序去重（`W:344-349` ↔ `:80-85`）、置顶四条件（`W:350-357` ↔ `:87-94`）、`result` 拼接顺序（`W:362-367` ↔ `:105`）、`placeFork` 的 `pending`/自环/`result.includes(parentId)`/`ordinary.reverse()`（`W:368-377` ↔ `:106-116`）**逐条一致**；唯一差异即 `orderByRecency` 的缺摘要丢弃（`W:360` ↔ `:98-103`） |
| `pinCurrentBlank` | `W:386-389` | `:140-143` | **等价**（含缺席时复制数组） |
| `sessionVisible` | `W:396-406` | `sessionRowVisible` `:20-31` + `sessionVisible` `:34-44` | **等价**：子代理恒 false、非当前 blank 恒 false、`default/show/only` 三分支判定一致（`W:400-402` ↔ `:28-30`）。差异：① 上游用真值 `session.blank`（`W:398`），实现用 `=== true`（`:27`）——字段声明为 boolean，合法输入下不可观察；② 上游 `default:` 走 `assertNever` 抛错（`W:403-404`），实现由 `normalizeArchivedFilter`（`:12-14`）把非法值归一为 `default`（`sidebar-order.ts:56`、`readArchivedFilter:113-115`）。仅当 store 被写入闭集外的伪造值时才有差异，类型上不可达 |
| `sectionMembers` | `W:411-423` | `:123-137` | **等价**：三段（blank / 未归档且置顶 / 其余）判定与拼接顺序一致，`W:415-416` ↔ `:132-134`、`W:418-422` ↔ `:136` |

### 1.2 管线接线对照（分组 / flat / 无归属）

| 环节 | 上游 | 实现 | 判定 |
| --- | --- | --- | --- |
| 当前会话 | `mainSessionId(list)` = 首个 `retainedBy.mainView > 0`（`W:2821`） | `currentSessionId`：`uiSession.current.key`，缺席回退 `retainedBy.mainView`（`session-view.ts:8-27`） | 0.1.6 起的既有实现，**不在本次改动范围**；差分 harness 中令二者同值以避免干扰 |
| `currentBlank` | `byId[main]?.blank === true`（`W:2822`） | `sidebar-order.ts:63` | 等价 |
| 分组台面序 | `orderByRecency`/`reconcileManualOrder` + `pinCurrentBlank`（`W:2836-2842`） | `accountOrder` `sidebar-order.ts:66-72` | 等价（除 §1.3） |
| 无归属桶 | `ungroupedMemberIds = list.ids.filter(byId[id] !== undefined && !accounted)`（`W:2823-2826`）→ `orderedUngrouped` 以 `orderedUngroupedSessionIds` 为 `stored`、`rowState` 缺省（`W:2851-2852`→`448-455`→`478`） | `sidebar-order.ts:106-108`：同一成员集 + `accountOrder(…, UNGROUPED_KEY)`（manual 走 `reconcileOrder` 且**带** `rowState`） | 差分 fuzz（含 `stored` 与 `rowState` 随机）**未发现**输出差异；两阶段 `reconcile` 的净效果一致。备注见 §6.2 |
| flat 成员集 | `sessionMemberIds = visibleSessionIds(list, [], "show")`（`W:553-555`、`563-570`） | `sidebar-order.ts:87-90`（`new Set()` + `'show'`） | 等价 |
| 渲染过滤 | `groupByWorkspace` 逐组 `sessionVisible`（`W:462-474`）+ `deriveGroups: sectionMembers`（`W:532-543`）；flat `deriveFlat`（`W:580-588`） | `render` `sidebar-order.ts:74-83` | 等价（除 §1.3 对 `placeFork` 的间接影响） |
| `accounted` 记入时机 | 仅对 `byId[id] !== undefined` 的成员记入（`W:470-471`） | 对**全部** `workspace.sessionIds` 记入（`:102`） | 不可观察：两端最终都要求 `byId[id] !== undefined` 才能渲染；无摘要 id 记不记入都不影响无归属桶成员集（fuzz 覆盖） |

### 1.3 特别裁决：保留「无摘要成员」在最终输出上是否可观察

**裁决：可观察。** 反例（`/tmp/dsh-audit/impl-verify/counterexample.mjs` 实跑）：

输入（`orderBy=manual`、`groupBy=workspace`、无存档序、无置顶/归档）：

```js
list.byId = {
  A: { id:'A', updatedAt:100, retainedBy:{mainView:1} },
  X: { id:'X', updatedAt:50, parentId:'P' },   // X 是 P 的 fork（有摘要）
  B: { id:'B', updatedAt:10 },
  // P 是 workspace 成员但 sessions.list 快照里没有它（无摘要）
}
workspace.sessionIds = ['A','X','B','P']
```

| 实现 | `reconcileManualOrder` / `reconcileOrder` 结果 | 最终渲染 |
| --- | --- | --- |
| 上游 | `["A","X","B"]`（P 被丢弃 → `result.includes("P")` 为 false → **不移动 X**） | `["A","X","B"]` |
| 插件 | `["A","X","B","P"]`（P 保留在 ordinary 末尾 → `placeFork(X)` **成功**，X 被搬到 P 之前 → `["A","B","X","P"]`） | `["A","B","X"]` |

即：**不是因为多渲染出 P（`render` 会跳过无摘要 id），而是因为 P 的存在改变了 `placeFork` 的
`result.includes(parentId)` 判据，导致一个真实可见的 fork X 被重定位**。该路径绕过了「无摘要 id 在
render 被过滤 ⇒ 不可观察」的直觉。

- 对照组：把 P 补上摘要后，两端都执行 fork 重定位，结果同为 `["A","B","X","P"]`（`targeted-fuzz.mjs` 输出 `same`）。
- `orderBy=updated` 与 `groupBy=flat` 下不可观察：前者 `recencyOrder` 保留的 P 无 `placeFork` 参与；后者 `sessionMemberIds` 已先按 `byId[id] !== undefined` 过滤，P 根本不入成员集。
- 定向 fuzz（每例必含「无摘要成员 P + fork X→P」）：**3349 / 5000 例输出不一致**。
- 全域 fuzz（成员集合 ⊆ 有摘要 id，50000 例）：**0 例不一致** —— 说明这是本次实现相对上游的**唯一**差异类别。

影响面：`sidebarOrderedSessionIds` 仅被 `openNeighborSession`（⌘/Ctrl+Alt+↑↓，`src/actions.ts:432`）消费，
故表现为**瞬态**（`sessions.list` 未就绪/成员快照缺行期间）邻域跳转轴与侧栏渲染序错位一位。
触发条件：某 workspace 成员 `P` 存在于 `workspace.sessionIds` 但不在 `sessions.list.byId`，且存在可见的
fork `X`（`byId[X].parentId === P`）且 `P` 不在该账号的存档序里。

---

## 2. 子代理枚举取证

产物：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
（下称 `S = dsh-api-session-controller/lib/client.js`、`H = dsh-api-session-controller/lib/index.js`、
`G = dsh-subagent/lib/index.js`）。

### ① `byId` 的子代理行是否必带 `parentId`？——**是**

`projectList()` `S:3427-3506` 有三条写入 `byId` 的路径，全部带 `parentId`：

1. `items` 行：`...entry.parentSessionId !== void 0 ? { parentId: entry.parentSessionId } : {}`（`S:3444`）。`items` 由 `flattenLineage(this.summaries…)` 生成（`S:2869-2890`），`summaries` 来自宿主 `listFields`，后者在 `header.parentSession !== void 0` 时写 `parentSessionId`（`H:1935-1941`）。子代理创建时 `childSessionMeta` 必写 `parentSession: parentHeader.id, origin: "subagent"`（`G:470-481`），故子代理 `items` 行必带 `parentSessionId` → `byId.parentId`。
2. `subagentCatalog` 中**不在** `items` 的子：`byId[childId] = { …, parentId, origin: "subagent", … }`（`S:3455-3466`）——`parentId` 取自投影的 map key，恒有。
3. `scopes` 中未被前两者覆盖、且 `manager.subagentAddress(id)` 有值者：`byId[id] = { …, parentId: address.parentSessionId, origin: "subagent" }`（`S:3482-3498`，`parentId` 在 `:3491`）。

### ② 是否存在「有子代理但 `parentId` 缺席」的行？——**未发现**

- 唯一可能产生「子代理但无 `parentId`」的是 `S:3467-3471` 的合并分支：`{ ...summary, displayTitle, … }` 不补 `parentId`；若 `items` 行已有该 child 的摘要但该摘要无 `parentSessionId`，则 `byId` 行无 `parentId`。但子代理 `items` 行必带 `parentSessionId`（见 ①），故该状态与生产者矛盾。
- 因此实现里「`byId.parentId` 行 ∪ `projectionsBySession[parent].values.subagentCatalog`」的**并集对当前 producer 是冗余的**：`projectList` 在 `S:3500-3505` 把 `byId`（已含 `subagentCatalog` 子）与 `projectionsBySession` **同一快照**一起发布，插件读到的 `byId` 已覆盖投影能提供的子代理。并集目前**无害**（`push` 有 `includes` 去重，见 `src/actions.ts:368-376`），但也不是 `parentId` 缺席场景的修复来源。
- 附：`S:3123` `rootCtx.reflect.provide("sessions", this)`、`S:3097` `this.list = createSnapshotStore(...)`，确认插件 `services.sessions.list.getSnapshot()` 读的就是 `projectList` 发布的 `{ids, byId, phase, projectionsBySession}`。

### ③ 有无「`parentId === 自身`」或「非子代理行被误挂 `parentId`」？——**有后者，且导致错误递归**

- **`parentId === 自身`：未发现生产者**。父/子 id 均为新建（`agents.create` / `brandString("session-"+randomUUID())`）。且 `visit` 先 `seen.add(id)` 再递归（`src/actions.ts:351-356`），即便存在自环或环（A→B→A）也只访问一次，**不会死循环**（`fork-cancel.mjs` 已验证）。
- **非子代理行带 `parentId`：确定存在 —— fork**。fork 经 `agents.create` 写 `meta.parentSession`，但**不写 `origin`**：
  - `S` 的 fork：`meta: { …, parentSession: source.header.id, isSeeded: true, … }`（`H:711-728`，`H:719`）；
  - 会话层 fork：`meta: { …, parentSession: liveSource.id, isSeeded: true }`（`dsh-session/lib/index.js:1764-1772`）。
  上游注释与判据明确：`runningDescendants` 要求 `parentSession !== void 0 && origin === "subagent"`（`G:2435-2443`），文档写「A fork shares the lineage field without the origin and is an independent conversation, so it never holds its source」（`G:2428-2434`），并用于 `workspace/session-stop` 的取消（`G:2420-2426`）。
- **实现缺陷**：`childIdsByParent` 的 `byId` 分支只按 `summary.parentId` 建边（`src/actions.ts:377-383`），未要求 `origin === 'subagent'`。于是 `stopCurrentSessionTree` 会把 fork 当孩子递归，`cancelIfRunning` 只排除 one-shot（`:399-416`），fork 无 `subagent.address` → 被取消。实测（`fork-cancel.mjs`）：

```
case 2: rows={root, fork(parentId=root)} running=[root,fork]  → cancelled ["root","fork"]
case 3: root → sub(subagent) → fork(parentId=sub)             → cancelled ["root","sub","fork"]
```

- 对照 0.1.6 旧实现：`snapshot.subagentsByParent[id].entries` 且 `entry.kind !== 'child'` 跳过（git diff `src/actions.ts`），而 `subagentsByParent = Object.fromEntries(this.catalogs)`（0.1.6 `dsh-api-session-controller/lib/client.js:2807`）**只含子代理目录，不含 fork**，因此 fork 误取消是**本次迁移引入的行为回归**，也与该函数自述「递归直系子代理」（`src/actions.ts:340`）相矛盾。
- `src/types.ts:89` 的注释「直系父会话(0.1.7-alpha.1 起子代理行必带;顶层会话缺席)」正是该误判来源：fork 不是子代理却带 `parentId`。`SessionSummaryLike.origin?: string` 已在 `types.ts:88` 可用，改为 `summary.origin === 'subagent'` 过滤即可既保持同步可用、又与上游 `runningDescendants` 同判据。

---

## 3. 产物一致性（独立重建）

- 复制当前工作区到 `/tmp/dsh-audit/impl-verify/copy`（`tar` 复制，排除 `node_modules`）。
- 因插件 `node_modules` 已清理，借 `NODE_PATH=/Users/lz/dsh-plugins/dsh-code-card-fonts/node_modules` 让 `scripts/build-client.mjs:25-27` 的 `require.resolve('@esbuild/darwin-arm64/package.json')` 命中平台二进制；构建脚本按 `import.meta.url` 定位根目录，**未触碰工作区**。
- 结果：

```
workspace lib/client.js  67cead2bb9cc72ee17ebd47792658eb0d20285e84b613744342cb15db1560ade  91847 B
copy      lib/client.js  67cead2bb9cc72ee17ebd47792658eb0d20285e84b613744342cb15db1560ade  91847 B
diff → IDENTICAL
```

（构建日志自报的「90760 字节」是 `scripts/build-client.mjs:63` 打印的 `compiled.length`，即
**包装前** esbuild 产物的字符串长度；落盘成品两端均为 91847 B，`diff` 逐字节相同、sha256 相同。）
**结论：入仓产物与当前 `src/` 一致，未过期、未手改。**

---

## 4. 变异检验结果

在 `/tmp` 副本（`mut1`/`mut2`，各从工作区重新复制）做变异；工作区未改。

| 变异 | 改动 | `node test-order.mjs` | 变红？ |
| --- | --- | --- | --- |
| 基线 | 无 | `all order probes passed`，exit 0 | — |
| ① 退回旧「只停当前会话」 | `src/actions.ts:366` `childIdsByParent` 函数体首行插入 `return new Map();` | exit 1，**3 FAIL**：`取消集合 期望 ["s1","s2","s3"] 实得 ["s1"]`、`one-shot s2 不取消,隔代 s3 仍取消 实得 ["s1"]`、`并集:… 实得 ["s1"]` | ✅ |
| ② 去掉分区 | `src/session-order.ts:127` `sectionMembers` 函数体首行插入 `return [...members]` | exit 1，**7 FAIL**：`blank → 置顶 → 其余`、`default:归档隐藏,置顶 c 提到列首`、`show:归档一并可见`、`archivedFilter 缺席 → 按 default`、`manual:账号序保留`、`flat:成员含归档`、`flat + show:归档沉底` | ✅ |

两处变异都被现有断言捕获，**新测试有牙齿**。

覆盖缺口备注：现有 `test-order.mjs` 的 `tree()` 桩在 A①/A② 里用「无 `origin` 的 `parentId` 行」代表子代理
（`test-order.mjs:35-62`），因此**无法**区分真子代理与 fork，§2③ 的误取消不会被现有测试发现；
同理 §1.3 的缺摘要分歧也无断言（C①②③ 的成员全部有摘要）。

---

## 5. 重跑验证（工作区只读）

| 命令 | 结果 |
| --- | --- |
| `node test-order.mjs` | exit 0，42 断言全 `ok`，0 FAIL，`all order probes passed` |
| `node test-services.mjs` | exit 0，498 断言全 PASS，0 FAIL，`ALL PASS` |
| `node test-dispatch.mjs` | exit 0，24 断言全 ok，0 FAIL，`all dispatch probes passed` |
| `node <dsh-code-card-fonts>/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（cwd=插件目录） | exit 0 |

### 5.1 附带核实：`overlay.ts` / `client.ts` 回退

`git diff -- dsh-kbd-hotkeys/src/overlay.ts dsh-kbd-hotkeys/src/client.ts` 输出为空；二者 sha256 与本次复核开始时一致
（`79d1908e…` / `42232341…`）。Lead 所述的 UX 改动已完整回退，未进入本次基线。

---

## 6. 回归排查

### 6.1 `sessionVisible` 新签名（`(summary, current, archived, archivedFilter, keepBlank)`）调用点

仓库内全部引用（`grep -rn "sessionVisible(\|sessionRowVisible("`）：

| 位置 | 调用 | 判定 |
| --- | --- | --- |
| `src/session-order.ts:41` | `sessionRowVisible(summary, current, archived, archivedFilter)`（`sessionVisible` 内部） | 正确（4 参） |
| `src/sidebar-order.ts:79` | `sessionRowVisible(summary, current, archived, archivedFilter)`（`render`） | 正确 |
| `src/sidebar-order.ts:89` | `sessionRowVisible(summary, current, new Set(), 'show')`（flat 成员集） | 正确，与上游 `sessionMemberIds` 同参 |
| `src/recent-sessions.ts:44` | `sessionVisible(summary, current, archived, archivedFilter, false)` | 正确（archive 筛选透传 + 浮窗裁掉空白） |
| `src/workspace-switcher.ts:82` | `sessionVisible(summary, current, archived, archivedFilter, false)` | 正确 |
| `test-order.mjs:138-146` | 4 参 / 5 参用法 | 正确 |

**无漏改、无 4 参旧式误用、无位置参数错位**；`archivedFilter` 两处透传均经
`readArchivedFilter`（`sidebar-order.ts:113-115`，读不到 → `default`）。

### 6.2 浮窗跟随 `archivedFilter` 的自洽性（`recent-sessions.ts`）

实测（`float.mjs`，当前会话 `a` 非归档）：

| `archivedFilter` | 行 | `openRecentSession` |
| --- | --- | --- |
| `default` | `["a","b","w2a"]`，initialIndex 0 | 全部 `true` |
| `show` | `["a","b","arch","w2a"]`，initialIndex 0 | `a/b/w2a` → true，**`arch` → false** |
| `only` | `["arch"]`，initialIndex 0 | **`arch` → false**（整榜不可打开） |
| `only` 且当前会话本身已归档 | `["arch"]`，initialIndex 0 | `false` |

- **可见性冲突：无**。强制纳入当前会话的代码被 `visible(current)` 守卫（`recent-sessions.ts:74-83`），不可能把不可见 id 塞进榜；`RECENT_LIMIT` 的 `kept.size === RECENT_LIMIT` / `order[RECENT_LIMIT-1]` 前提成立（不足 10 行时不再顶替），无越界、无空榜异常（无归档时 `only` 走 `emptyView()` 提示）。
- **但存在可用性/一致性问题**：`show`/`only` 下会列出**不可打开**的归档行。归档行在
  `RecentSessionRowLike`（`types.ts:119-128`）里**没有 `archived` 字段**，浮窗不区分显示；
  `overlay.ts:456-461` 是「先 `close()` 再 `deps.selectRecentSession(...)`」，`client.ts:130-132`
  忽略返回值 → 用户按 Enter 表现为「浮窗关闭、什么都不发生」，无反馈。
- **与上游关系**：拒绝打开与上游一致（`guardedOpen` `W:2813-2816`；`uiWorkspace.openSession` 本身无门闸 `W:863-865`），故补门闸本身正确；差异在于上游侧栏行带 `archived` 标记（`sessionNode` `W:493-508`，`:505`），而插件的浮窗行没有——建议记为**已知限制**（Lead 已确认按此记录），可选改进是为行加 `archived` 标记或在选行时给出 no-op 反馈。

### 6.3 `workspace-switcher` 活跃度排序（`show`/`only`）

- `workspaceActivity` 用同一 `sessionVisible(..., archivedFilter, false)` 取「组内可见会话的最新 `updatedAt`」（`workspace-switcher.ts:70-88`）：`default` 下归档不计活跃、`show` 下计入、`only` 下**只有归档会话计活跃**，无归档的工作区 `-Infinity` 沉底并按宿主顺序决胜（`:43`）。
- 逻辑自洽、无越界/空榜（`kept` 最多 10，不足 10 时全保留；当前会话所属工作区掉榜时顶替第 10 名，`:46-53`）。**口径变化**：`only` 下 ⌘K 的工作区排序随「归档活跃度」而变——符合「跟随侧栏筛选」的设计，但属 0.1.6 不存在的新语义，建议在 README 已知限制中一句带过。
- 次要：`sessionCount` 仍取 `item.sessionIds.length`（宿主全量，`workspace-switcher.ts:59`），不随筛选收缩，与浮窗可见行数可能不一致（纯展示字段，不影响排序与切换）。

---

## 7. 未确证 / 分歧

1. **未确证**：`workspace.sessionIds` 中出现「不在 `sessions.list.byId`」的成员（§1.3 触发条件）在真实运行时的出现频率与时长。上游注释承认该瞬态存在（`W:315`「members without a summary are omitted until it arrives」），但本机没有可复现的运行期快照（不加载/不重启插件的约束下无法取得）。因此 §1.3 判为**可观察但低频瞬态**，而非稳定复现缺陷。
2. **未确证**：`projectionsBySession` 并集（§2②）是否存在「当前 producer 之外的未来/外部快照」场景使其成为必需；就 0.1.7-alpha.1 全局树的 `projectList()` 而言，未找到需要它的路径。并集本身无害，不作为缺陷，但**它不能**作为「`byId.parentId` 行需要放宽到全部行」的理由。
3. **与实现的分歧（建议必修）**：`childIdsByParent` 未按 `origin === 'subagent'` 过滤，导致 Esc 误取消 fork（§2③，稳定可复现，与 0.1.6 行为及上游 `runningDescendants` 判据均不符）。
4. **与实现的分歧（建议修正或显式接受）**：`reconcileOrder` 保留无摘要成员，在 §1.3 条件下产生与上游可观察的顺序差异；最小改法是让 `reconcileOrder` 与上游 `orderByRecency` 一致地剔除 `byId[id] === undefined` 的成员（`src/session-order.ts:98-103`），可同时消除该分歧且不改变其他 50000 例的输出。
5. **非缺陷但应记录的既有差异**（非本次改动）：`currentSessionId` 先取 `uiSession.current.key`、上游 `mainSessionId` 先取 `retainedBy.mainView`（`session-view.ts:8-27` vs `W:2821`）。本次差分 harness 中强制同值；两者在真实运行中若不一致会影响 `currentBlank` 与「当前会话强制纳入」，不在本次迁移范围内，未展开取证。
6. **`normalizeArchivedFilter` 归一对伪造值的行为**（§1.1 表）：上游 `assertNever` 抛错、实现降级 `default`。类型闭集下不可达，仅登记为差异，不判缺陷。
