# 三次复核（定点）：README 三处文档修正

复核人：`impl-verifier`。任务板 `task-7`。范围：Lead 依 round-2 §7.1 对 `dsh-kbd-hotkeys/README.md` 的三处修正 + 工作区零变化确认。本轮**不重跑** fuzz / 测试（round-2 已做）。

## 结论摘要

| 项 | 结论 |
| --- | --- |
| ① `session.stop` 行（交集符号 + origin 条件） | **已修，且与代码一致** |
| ② `session.recent` 行（归档例外） | **已修，且与代码一致** |
| ③ 已知限制（取消归档路径 + 上游提示原文） | **已修，上游证据链逐条吻合** |
| ④ 工作区零变化 | **确认**：自 round-2 基线（epoch `1790066911`）以来，全仓（排除 `.git`/`node_modules`/`.audit-migration`）**唯一**被改的文件是 `dsh-kbd-hotkeys/README.md` |
| ⑤ round-2 §8 两条未确证是否升级必修 | **不建议升级**（理由见 §3） |

---

## 1. 三处修正逐条核对

### ① `README.md:76` `session.stop` 行

现文（节选）：`…由 sessions.list 快照的**两源并集**枚举（byId 里 origin === 'subagent' 的行 ∪
projectionsBySession[parent].values.subagentCatalog，0.1.7-alpha.1 起取代已删除的 subagentsByParent）；one-shot 跳过`

- **∩ → ∪ 已改**，且与「并集」措辞自洽。
- 括号现含 `origin === 'subagent'` 限定，与 `src/actions.ts:377-383`（byId 分支 `if (summary.origin !== 'subagent') continue`）一致；
  第二来源 `projectionsBySession[parent].values.subagentCatalog` 见 `src/actions.ts:384-394`；
  并集去重见 `src/actions.ts:368-376`（`push` 内 `known.includes(child)` 判重）。✅
- 两源语义（目录只含子代理、fork 不在其中）已由 round-2 §2/§3 取证。

### ② `README.md:72` `session.recent` 行

现文（节选）：`…**归档行是例外**：openRecentSession 先查归档集合，命中即 return false、不调 openSession
（与上游 guardedOpen 同款门闸；见「已知限制」）`

- 与代码一致：`src/recent-sessions.ts:109-110` 取 `readWorkspaceSnapshot(...)?.archivedSessionIds`，
  `:110` `if (archived.has(sessionId)) return false`（**先于** `:111-113` 的 `uiWorkspace` 取用与 `:114-120` 的 `openSession.call`）✅
- 与调用链一致：`src/client.ts:130-132` `selectRecentSession` 忽略返回值；`src/overlay.ts:459-460` 先 `close()` 再调用
  → 归档行表现为「浮窗关闭、不发生导航」，与「已知限制」条一致。✅

### ③ `README.md:222-224` 已知限制

现文（节选）：`**要先在侧栏对该会话「取消归档」才能打开**：上游的门闸只看归档集合、与 archivedFilter 无关，
show 下点行 / 搜索命中同样被拒（提示「已归档对话暂时无法查看，请取消归档后查看」）`

上游 `dsh-client-ui-workspace/lib/client.js` 逐条比对：

| README 断言 | 上游证据 | 判定 |
| --- | --- | --- |
| 门闸只看归档集合、与 `archivedFilter` 无关 | `:2813-2818` `guardedOpen`：`if (archivedSessionIds.includes(sessionId)) { notifyArchivedNotOpenable(); return; }`，判据只读 `archivedSessionIds` | ✅ |
| `show` 下点行同样被拒 | 侧栏两处打开入口都传 `guardedOpen`：`:3251`（FlatList `open: guardedOpen`）、`:3274`（SessionTree `open: guardedOpen`） | ✅ |
| 搜索命中同样被拒 | `:2942-2945` `openSearchResult`：同样的 `archivedSessionIds.includes(...)` → `notifyArchivedNotOpenable()` + `return` | ✅ |
| 提示原文「已归档对话暂时无法查看，请取消归档后查看」 | `:80` `"toast.archivedNotOpenable": "已归档对话暂时无法查看，请取消归档后查看"`；`notifyArchivedNotOpenable` 定义 `:3996-3997`（`notify({ kind: "archivedNotOpenable" })`），文案解析 `:3822` | ✅ |
| 「先在侧栏取消归档」是可达路径 | `:3061-3064` `onSessionUnarchive = (sessionId) => { unarchiveSession(sessionId).catch(...) }`；经 `:3235` `onUnarchive: onSessionUnarchive` 提供给侧栏 | ✅ |

三处修正**无新的不实陈述**；round-2 §7.1 的三处问题已全部消除。

---

## 2. 工作区零变化确认

判据一：与 round-2 记录的 sha256 逐项比对（本轮实测）——

| 文件 | round-2 sha256 | 本轮 sha256 | 变化 |
| --- | --- | --- | --- |
| `src/actions.ts` | `85e76685…` | `85e76685…` | 无 |
| `src/session-order.ts` | `24069f83…` | `24069f83…` | 无 |
| `src/sidebar-order.ts` | `76723564…` | `76723564…` | 无 |
| `src/types.ts` | `3fe43805…` | `3fe43805…` | 无 |
| `src/recent-sessions.ts` | `4208330a…` | `4208330a…` | 无 |
| `src/workspace-switcher.ts` | `97555111…` | `97555111…` | 无 |
| `src/overlay.ts` | `79d1908e…` | `79d1908e…` | 无 |
| `src/client.ts` | `42232341…` | `42232341…` | 无 |
| `lib/client.js` | `15be27eb…` | `15be27eb…` | 无 |
| `test-order.mjs` | `170b189e…` | `170b189e…` | 无 |
| `test-services.mjs` | `fac9162a…` | `fac9162a…` | 无 |
| `test-dispatch.mjs` | `b16b5d7d…` | `b16b5d7d…` | 无 |
| `README.md` | `74e08799…` | `0c14c69e…` | **有（本轮唯一改动）** |

判据二：mtime 扫描（`%m > 1790066911` = round-2 基线开始时刻），全仓排除 `.git`/`node_modules`/`.audit-migration`：

```
1790067120 ./dsh-kbd-hotkeys/README.md      ← 唯一
```

- `AGENTS.md` mtime = `1790066881`（**早于** round-2 基线），且 `:163` 文本与 round-2 读取时逐字相同
  （`…校验 0.1.7 子代理枚举（origin === 'subagent' 判据，fork 不递归取消）与侧栏顺序复刻（含缺摘要成员剔除）`），
  故自 round-2 基线以来未变。
- 其余 `src/*.ts`、`index.ts`、`cordis.patch.yml`、`package.json`、三个诊断脚本 mtime 均 ≤ `1790066855`，早于基线。
- **未发现任何计划外文件被改动。**

---

## 3. round-2 §8 两条未确证是否升级为必修

**不建议升级，两条维持「未确证/不可达」**：

1. **`updatedAt === undefined` 时 `recencyOrder` 与上游 `orderByRecency` 顺序不同**：
   不升级。线协议 `SessionSummary.updatedAt` 为**必填 number**（`dsh-api-session-controller/lib/typert.host.js:2065`），
   宿主两条产出路径恒给数值（`dsh-api-session-controller/lib/index.js:1762-1810` 的 `summaryFor`/`summarizeCold`
   均经 `updatedAt(header, metadata) = Math.max(header.createdAt, …)`），`projectList` 的子代理补行恒给 `0`
   （`dsh-api-session-controller/lib/client.js:3462,3486`），`buildListSnapshot` 恒 `Math.max(...)`（`:2878`）。
   `NaN` 情形两端顺序一致（round-2 差分 0/20000）。属防御性类型宽松带来的理论边界，无实现改动价值。
2. **「冷中间子代理 + live 孙代」**：不升级。未构造出该状态；live 子树内每个节点都在 `sessions` 注册表中且
   header 带 `origin`（`dsh-session-query/lib/index.js:126-133` `load` 优先 live），且本过滤与上游
   `runningDescendants`（`dsh-subagent/lib/index.js:2435-2443`）同判据——即便该状态存在，漏取消也与上游一致，
   不构成本插件引入的回归。运行期取证受「不加载/不重启插件」约束，保留为未确证。

---

## 4. 裁决

- 三处文档修正**全部正确**，与插件代码及上游证据链一致；无新增不实陈述。
- 自 round-2 基线以来**只有 `README.md` 变化**，`src/*.ts`、`lib/client.js`、三个诊断脚本、`AGENTS.md` 零变化。
- 无新增必修项。
