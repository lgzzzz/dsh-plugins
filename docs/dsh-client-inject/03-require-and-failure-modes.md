# 同步 `require` 的边界与失败表现

> 本文件是 [`dsh.client.inject` 完整说明](../dsh-client-inject.md) 的第 3 册：构建期纯度门与同步 `require` 的真实边界，以及三种依赖在目标缺失时的表现。

---

## 6. 同步 `require` 的真实边界（为什么跨插件不能随便 import）

每个 web 客户端 bundle 都是一个 CJS 工厂（`tsdown.client.mjs` 的 `clientBundle()` 用 `format: 'cjs'` + banner `window.__ModuleLoader__.load({ id, factory: (require) => { … } })` 打包）。tsdown 会把 ESM `import` 编译成工厂顶部的同步 `require("...")`。

但这些 `require` 被**构建期纯度门**锁死在平台基线内。本仓库的纯度门在 `tsdown.client.mjs` 里：

- **平台基线**（`PLATFORM_EXTERNALS`，构建期外部化名单，与运行时 `staticModules` 种子对应）：
  ```
  react, react/jsx-runtime, react/jsx-dev-runtime, react-dom, react-dom/client,
  @deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
  @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
  @deepseek-ai/dsh-client-ui-dockkit
  ```
- **`dsh.client.external`**：额外允许外部化的 specifier（运行时走模块表解析）。
- **`purityGatePlugin`**：任何 `@deepseek-ai/` 的**值导入**（非 `import type`）：
  - 在外部化名单里 → 放行（外部化，运行时解析）；
  - 是 vendored library（`@deepseek-ai/cosmokit`、`@deepseek-ai/schemastery`）→ 内联；
  - 是 inline-safe wire 层或 generated `/remote` 贡献 → 内联；
  - **否则 → 构建直接失败**，报错 `client bundle purity: "<spec>" is not in the platform externals or <id>'s dsh.client.external … cross-plugin value imports are forbidden; declare a module request or collaborate through cordis services`。

因此：

- 产物里**基线之外**的 `require("...")` 只可能来自 `dsh.client.external` 里声明的 specifier（它们对应入口图里真实的另一行，运行时由模块表解析）。
- 跨插件取值走 **cordis 服务**（`ctx.get(...)` / 服务 `inject` + `import type`），不走模块 `require`。
- 运行时如果出现「同步 `require` 三层都不命中」（seed → loadCache → factories），`makeRequire` 会抛：
  ```
  client-modules: require("<spec>") missed the module table — not a platform seed word,
  not a materialized module, and no registered package factory
  (a build-time externals drift, or a dynamic dependency that did not arrive)
  ```
  `missed the module table` 是「构建期纯度门」的运行时镜像——正确构建的插件不会触发（因为产物里不会出现基线之外的裸 `require`）。

---

## 7. 目标缺失 / 被禁用时，三种依赖各自的表现

| 依赖形式 | 目标缺失 / 被禁用时 | 后果 |
|---|---|---|
| `dsh.client.inject`（软提示） | 宿主不校验；浏览器 `graphRows.get()` 为 `undefined` → 静默跳过 | **不报错**，仅少一次连带预取 |
| `dsh.client.external`（硬模块依赖） | 宿主 `orderByModuleGraph()` 构图 `throw`（缺供应商 / 环 / 自依赖） | 客户端无法启动 / 该 entry 失败 |
| cordis 服务 `inject`（`export const inject` / `ctx.inject` / `ctx.get`） | 服务未提供 | `apply()` 等待（PENDING）或失败 |

> 判别口诀：
> - 想「**保证**某包先到、或我能在模块表里同步 `require` 到它」→ 写 `dsh.client.external`；
> - 想「**顺带**把某包预热、后续更快命中」→ 写 `dsh.client.inject`；
> - 想「**等服务**（如 `slots`/`theme`）就绪再跑我的 `apply`」→ 用 cordis 的 `export const inject` / `ctx.inject` / `ctx.get`，跟上面两个完全是两回事。
