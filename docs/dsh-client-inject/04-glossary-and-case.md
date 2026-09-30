# 术语速查表与历史案例

> 本文件是 [`dsh.client.inject` 完整说明](../dsh-client-inject.md) 的第 4 册：术语表，以及「禁用被 `inject` 的官方插件仍能正常启动」的历史案例。

---

## 8. 术语速查表

| 词 | 含义 |
|---|---|
| **`dsh.client`** | `package.json` 里的客户端声明对象，含 `platform`/`inject`/`external`/`immediately` |
| **`WebBootEntry` / 入口图行** | `window.__DSH_BOOT__.entries[]` 的一行，浏览器模块表据此取回 bundle |
| **`orderByModuleGraph()`** | 宿主半部按 `external` 做拓扑排序 + 环检测 + 自依赖检测（**不看 inject**） |
| **`arriveGraphRow()`** | 浏览器半部「先 external、再 inject、最后自己」的到达顺序 |
| **`arrive()`** | 取回并执行某行 bundle，使工厂注册进 `factories` |
| **factory 注册** | 脚本只登记 `window.__ModuleLoader__.load({ id, factory })`，**不执行模块体** |
| **materialize（物化）** | 首次真正调用 `factory(require)` 产出并缓存 `exports`；副作用（含 CSS 注入）此刻才执行，同步且记忆化 |
| **seed / staticModules** | 平台基线单例（react / cordis / dsh-client-* 种子），同步 `require` 的第一层命中 |
| **`missed the module table`** | 同步 `require(spec)` 在 seed → loadCache → factories 三层都不命中时抛的错 |
| **纯度门（purity gate）** | 构建期对 `@deepseek-ai/` 值导入的合法性检查，禁止跨插件第二份内联拷贝 |

---

## 9. 历史案例：禁用被 `inject` 的官方插件仍能正常启动

> 说明：这个案例里的 fork（`dsh-ui-chat`）已于 2026-09-30 从本仓库移除。这里保留案例本身，是因为「软 `inject` 落空不报错」的行为到今天仍然成立。

官方 `@deepseek-ai/dsh-client-ui-chat` 被 7 个官方插件（attachment、deliverables、goal、plan、settings-account、subagent、workflow-run）写进各自的 `dsh.client.inject`。本地 fork 用 `cordis.patch.yml` 禁用了官方 `ui-chat`、插入自己的 `ui-chat-lgz`（包名与官方不同），并逐字拷贝官方 `apply.ts` 注册同一批 cordis 服务。

结果：

- 那些 `inject` 里的官方包名（`@deepseek-ai/dsh-client-ui-chat`）在入口图里**落空** → 浏览器 `graphRows.get()` 返回 `undefined` → 静默跳过、不报错（这正是 [第 4.3 节](02-data-flow.md)「查不到就跳过」的体现）；
- fork 在**服务层**顶替了官方包（用不同包名注册了同一批 cordis 服务）；
- 两者叠加，就是「正常启动且一切正常」。

这个案例同时验证了两点：`inject` 是软提示（落空无害），而真正的功能顶替发生在 cordis **服务层**，与 `inject` 无关。
