# `dsh.client.inject` 字段说明

> **一句话**：`dsh.client.inject` 只是"顺带加载谁"的软提示（预热/预取元数据）——不校验、不排序、不提供服务；真正保证"先加载谁 / 服务可等待"的是 `dsh.client.external` 和 Cordis 的服务 `inject`。

## 是什么

`package.json` 里的 `dsh.client.inject` 声明"我这个 web 客户端插件在浏览器端还希望顺带加载哪些其它 Harness 客户端包"，值是一串 npm 包名。

```jsonc
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-client-locale", "..."],
    "platform": "web"
  }
}
```

## 定位：软提示，不是硬依赖

1. **信息性包名依赖（加载/预取元数据），不是 Cordis 服务注入**——与插件 `apply()` 里那套服务依赖是两层东西。
2. **不决定 `apply()` 激活顺序，也不提供任何可 `ctx.get()` 的服务**。
3. **缺失不影响运行**：可选字段，缺了等价于空数组，插件照常加载、照常 `apply()`，只少了"连带预加载"（见下文「优化/损失」）。

> 注意两处 `inject` 同名不同义：`dsh.client.inject`（package.json 字段）是**包加载提示**；插件代码里的 `export const inject = [...]` / `ctx.inject(...)` / `ctx.get(...)` 是 **Cordis 服务依赖**。本文只讲前者。

## 和相邻字段的区别

| 字段 | 作用 |
|---|---|
| `platform` | 平台标识（`web`） |
| `inject` | 信息性包名依赖，仅预取/共同加载提示，无排序、无服务语义 |
| `external` | 真实模块依赖：决定加载顺序、做环检测、缺供应商时构图报错 |
| `immediately` | 是否进入启动第一阶段批次 |

## 谁在用（加载机制）

- **Host 侧**：`dsh-client-modules` 扫描声明了 `dsh.client` 的包，把 `inject` 原样写进 `window.__DSH_BOOT__` 入口图的 `WebBootEntry.inject`；`orderByModuleGraph()` 只按 `external` 排序，`inject` 不参与。
- **浏览器侧**：`arriveGraphRow()` 在加载某插件行自身之前，先遍历 `row.inject`，把列表里能在入口图查到的包也走一遍 `arriveDependency()` → `arrive()`（取回 bundle + 注册 factory）；查不到就静默跳过。

## 有 `inject` 得到的优化 / 去掉后损失什么

`inject` 的全部价值是"连带预加载 / 预热"：`arriveGraphRow()` 在 `arrive(row)`（加载声明方自己）**之前**，先把 `inject` 列表里的包取回并注册 factory。

| 场景 | 结果 |
|---|---|
| **有 `inject`** | 加载 A 时顺带把 B、C 的 bundle 取回并注册 factory（且在 A 之前）；后续真要物化 B/C 时已无需再取回执行，省掉一次"用到时才加载"的触发往返与首次延迟。 |
| **去掉 `inject`** | A 本身照常加载、照常 `apply()`，可运行性不变；损失的只是这份预热——B、C 不再随 A 一起被取回注册，真用到时才按需加载。 |

> 边界：`inject` 只"预热"、不"保证"——不参与 `orderByModuleGraph()` 排序、不做环检测、不校验包是否存在（入口图查不到就静默跳过）。**需要"必须先加载谁 / 必须能同步 `require` 谁"用 `external`；只想"顺带取回、让后续更快命中"用 `inject`。**（DSH 作者模型里跨插件同步 `require` 被构建期纯度门禁止，见下文。）

## 关键结论汇总

### 术语速查

| 词 | 含义 |
|---|---|
| **factory 注册** | 脚本执行只登记 `window.__ModuleLoader__.load({ id, factory })`，把工厂函数放进 `factories` 表，**不执行**模块体代码。 |
| **materialize（物化）** | 首次真正调用 `factory(require)` 产出并缓存 `exports`（进 `loadCache`）；模块体副作用（含 CSS 注入）此刻才执行，同步且记忆化。 |
| **missed the module table** | 同步 `require(spec)` 在 seed（平台基线）→ loadCache（已物化）→ factories（已注册）三层都不命中时抛的错，报错原文即含此短语。 |

### 同步 `require` 的真实边界

- 每个 web 客户端 bundle 都是 CJS 工厂，tsdown 把 ESM `import` 编译成工厂顶部的同步 `require("...")`。
- 但这些 `require` 被**构建期纯度门**锁死在平台基线 `PLATFORM_MODULES` 内（`react`、`react-dom`、`react/jsx-runtime`、`@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-*` 静态库等）；产物里出现基线之外的 `require("...")` 会直接构建失败。
- 因此跨插件的运行时取值走 cordis 服务（`ctx.get(...)` / 服务 `inject` + `import type`），不走模块 `require`。`missed the module table` 是"构建期纯度门"的运行时镜像，正确构建的插件不会触发。

### 目标缺失时三种依赖的行为

| 依赖形式 | 目标缺失 / 被禁用时 | 后果 |
|---|---|---|
| `dsh.client.inject`（软提示） | Host 不校验；浏览器 `graphRows.get()` 为 `undefined` 就静默跳过 | 不报错，仅少一次连带预加载 |
| `dsh.client.external`（硬模块依赖） | Host `orderByModuleGraph()` 构图 `throw`（缺供应商/环/自依赖） | 客户端无法启动 / 该 entry 失败 |
| cordis 服务 `inject`（`ctx.get` / `inject` 数组） | 服务未提供 | `apply()` 等待或失败 |

### 历史案例：禁用被 `inject` 的官方插件仍正常

> 该 fork（`dsh-ui-chat`）已于 2026-09-30 从仓库移除；此处保留案例本身，因为"软 `inject` 落空不报错"的行为仍然成立。

官方 `@deepseek-ai/dsh-client-ui-chat` 被 7 个官方插件（attachment、deliverables、goal、plan、settings-account、subagent、workflow-run）写进各自的 `dsh.client.inject`。本地 fork 用 `cordis.patch.yml` 禁用官方 `ui-chat`、插入 `ui-chat-lgz`（包名同为 `ui-chat-lgz`，与官方不同名），并逐字拷贝官方 `apply.ts` 注册同一批 cordis 服务。结果：那些 `inject` 里的官方包名落空 → 静默跳过、不报错；fork 在服务层顶替 → 功能照常。二者叠加，就是"正常启动且一切正常"。
