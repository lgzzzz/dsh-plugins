# `dsh.client.inject` 字段完整说明

> **一句话**：`package.json` 里的 `dsh.client.inject` 是一串「包名」，它的全部作用是**在浏览器里、在加载声明这个字段的包自身之前，把列表里那些包的 bundle 也顺手取回来并注册好工厂**（预热 / 预取）。它**不参与排序、不做环检测、不校验目标是否存在、不提供任何 cordis 服务、也不决定 `apply()` 的激活顺序**。真正能保证「必须先加载谁 / 服务可等待」的是另外两套互不相干的机制：`dsh.client.external`（模块图硬依赖）和 cordis 的服务 `inject`（`export const inject` / `ctx.inject` / `ctx.get`）。

---

## 1. 它写在哪里、长什么样

`dsh.client.inject` 是 `package.json` 里 `dsh.client` 对象的一个可选字段。整个 `dsh.client` 对象（连同它的四个字段）在 DSH 的类型定义里的权威形状如下（来源：`@deepseek-ai/dsh-package-manifest` 的 `DshClientManifest`）：

```ts
interface DshClientManifest {
  platform: string        // 客户端平台标识；Web 端取 "web"
  inject?: string[]       // 信息性包名依赖（不是 Cordis 服务注入）
  immediately?: boolean   // 启动第一阶段注册屏障；缺省 = 共享的 application 批次
  external?: string[]     // 超出隐式基线的「精确模块表请求」，可含 <pkg>/client 子路径；缺省 = 只有基线外部依赖
}
```

一个真实例子（本仓库 `dsh-desktop-notify/package.json`）：

```jsonc
{
  "name": "dsh-desktop-notify",
  "exports": {
    ".": { "default": "./index.ts" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "immediately": true
      // 没有写 inject —— 缺省等价于 []
    },
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

带 `inject` 的例子（上游官方 `@deepseek-ai/dsh-client-ui-theme/package.json`）：

```jsonc
"dsh": {
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-api-remotes"
    ],
    "platform": "web",
    "immediately": true
  }
}
```

**校验规则**（来源：`dsh-client-modules` 里的 `parseDshClient`，宿主半部与浏览器半部共用同一个校验器）：

- `dsh.client` 缺失 → 等价于「不是客户端包」，跳过；
- `dsh.client` 不是对象 → 抛错 `… has a non-object dsh.client declaration`；
- `platform` 不是字符串 → 抛错（`dsh.client.platform must be a string`）；
- `inject` 存在但不是「字符串数组」→ 抛错（`dsh.client.inject must be a string array`）；
- `external` 存在但不是「字符串数组」→ 抛错（`dsh.client.external must be a string array`）；
- `immediately` 存在但不是布尔 → 抛错（`dsh.client.immediately must be a boolean`）。

> 结论先行：**`inject` 是可选字段**。缺了它等于空数组，包照常加载、照常 `apply()`，只是少了「连带预取」这一份优化（详见第 6 节）。

---

## 2. 三个都叫「inject」的东西，先分清

这是最容易绕晕的地方：在 DSH 里至少有三个互不相干、同名不同义的 `inject`。

| 出现位置 | 全称 | 语义 | 谁来读 |
|---|---|---|---|
| `package.json` 的 `dsh.client.inject` | 客户端包名软提示 | 「顺带加载哪些包」的预热提示 | 宿主半部扫描器 + 浏览器模块表 |
| 插件代码里 `export const inject = ['slots']` | Cordis 服务依赖声明 | 「这个插件要等哪些**服务**可用」 | Cordis 加载器（`Inject.resolve`） |
| 插件代码里 `ctx.inject([...], cb)` / `ctx.get('x')` | Cordis 服务注入 API | 「取一个服务 / 等一个服务就绪」 | Cordis 上下文 |

**本文只讲第一个**（`dsh.client.inject`）。第二、三个属于 Cordis 的**服务**世界：它们的键是「服务名」（如 `slots`、`theme`、`loader`），跟「包名」没有任何派生关系；服务的生命周期由 Cordis 的 `provide`/`get`/`inject` 管理，跟模块的加载/注册是完全不同的两套机器。

> 一个包可以**同时**有两个 `inject` 并且含义完全不同。例如本仓库 `dsh-header-action-order/src/client.ts` 里 `export const inject = ['slots']` 是「等我 `apply` 时 `slots` 服务必须已就绪」；而这个包如果哪天在 `package.json` 里写了 `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-conversation"]`，那表示「加载我这份 bundle 之前，顺手把 conversation 的 bundle 也注册好」。两者互不替代、互不影响。

---

## 3. `dsh.client` 的四个字段各自干什么

在展开 `inject` 之前，先把同一对象里的四个字段一次性说清，避免只懂 `inject` 不懂邻居。

### 3.1 `platform`（必填）

- 语义：客户端平台标识字符串。Web 端写 `"web"`。
- 谁读：宿主半部扫描器 `resolveMeta` 只挑 `platform === "web"` 的包进浏览器入口图；其它平台值一律忽略（视为「不是 web 客户端包」）。
- 没有它：`dsh.client` 里 `platform` 缺失会**直接抛错**（不是静默忽略）——因为它是必填字段。

### 3.2 `inject`（可选，软提示）—— 本文主角

- 语义：一串 npm 包名，「加载我这份 bundle 之前，先把这些包也注册好工厂」。
- 谁读：浏览器半部 `arriveGraphRow`（见第 5 节）。
- 特性：**不排序、不环检测、不校验存在性、不提供服务**。

### 3.3 `external`（可选，硬依赖）

- 语义：这个包在浏览器 bundle 里**用值导入**（`import` 而非 `import type`）了哪些「非基线」的模块，必须把这些 specifier 交给模块表在运行时解析。
- 谁读：
  1. **构建期**：本仓库的 tsdown 预设 `tsdown.client.mjs` 里 `requestedClientExternals()` 读它，把这些 specifier 加入「外部化」名单，于是它们以 `require("...")` 的形式留在产物里，而不是被打包内联；
  2. **构建期纯度门**：`purityGatePlugin` 据此判断一个 `@deepseek-ai/` 的值导入是否合法（在名单里→合法，否则→构建失败，见第 7 节）；
  3. **宿主半部**：`orderByModuleGraph()` 按它构图排序、做环检测、做自依赖检测；
  4. **浏览器半部**：`arriveGraphRow()` 按它在加载自身之前递归取回依赖（带环检测）。
- 特性：**参与排序、做环检测、做自依赖检测、目标缺失时宿主构图直接 `throw`**（客户端无法启动）。

### 3.4 `immediately`（可选，布尔）

- 语义：是否进入「启动第一阶段」——Web 外壳在启动 Cordis 之前，先把所有 `immediately: true` 的包的 bundle 预取并注册（`prefetchImmediateTier()`）。
- 谁读：Web 外壳启动序列（`dsh-web-frontend` 的 boot 代码里 `this.manifest.plugins.filter(e => e.immediately).map(e => this.modules.prefetch(e.id))`）。
- 缺省：`false` / 缺失 → 走共享的 application 批次（按需加载）。

> 注意：`immediately` 和 `inject` 是两个正交的轴。`immediately` 控制「**什么时候**把**它自己**预取」；`inject` 控制「加载**它自己**的时候，顺带预取**别人**」。本仓库的 web 插件大多写 `immediately: true`，但 `inject` 都留空（它们没有需要连带预取的包）。

---

## 4. 完整数据流：从 package.json 到浏览器模块表

要准确理解 `inject` 的作用，需要知道它一路上被谁读、被谁忽略。下面按「宿主半部 → 线上传输 → 浏览器半部」三段展开。

### 4.1 宿主半部（Node 侧）：扫描并构图 `window.__DSH_BOOT__`

宿主半部的代码是 `@deepseek-ai/dsh-client-modules` 的 `lib/index.js`（服务类 `ClientModuleRegistry`）。它做这几件事：

1. **订阅 loader 的 entry 变化**，对每个已挂载的插件 entry 扫描其 `package.json`：
   - `resolveMeta()` 用 `parseDshClient` 校验 `dsh.client`；
   - 只保留 `platform === "web"` 的包；
   - 从 `exports["./client"]` 拿到客户端 bundle 的相对路径（没有这个导出会抛「declares dsh.client but exports no "./client" bundle」）；
   - 缓存 `inject` / `external` / `immediately`。
2. **`graphRow()` 组装入口图的每一行**（`WebBootEntry`）。注意它怎么写这几个字段：

   ```js
   function graphRow(id, rev, fields) {
     return {
       id,
       url: comboReference([id], rev),
       rev,
       ...fields.inject !== void 0 ? { inject: fields.inject } : {},      // inject 原样带进 wire
       ...fields.immediately ? { immediately: true } : {},                // immediately 只在为 true 时带上
       ...fields.external.length > 0 ? { external: fields.external } : {} // external 只在非空时带上
     }
   }
   ```

   所以 `inject` 会被**原样写进**入口图行的 `inject` 字段，随 `window.__DSH_BOOT__` 一起下发到浏览器。

3. **`orderByModuleGraph(entries)` 只按 `external` 排序**。这是关键：排序函数遍历每个 entry 的 `external`，用 DFS 拓扑排序，保证「被 `external` 请求的包」排在「请求它的包」之前。**`inject` 完全不参与这个排序**。

   ```js
   function orderByModuleGraph(entries) {
     // … 构建 rowsById …
     const visit = (entry) => {
       // … 环检测（open 栈）、去重（placed）…
       for (const name of entry.external ?? []) {   // ← 只读 external
         const dependency = rowsById.get(name) ?? rowsById.get(stripClientSuffix(name))
         if (dependency === entry) throw … // 自依赖
         if (dependency !== void 0) visit(dependency)
       }
       ordered.push(entry)
     }
     // …
   }
   ```

   排序只在 `external` 上产生环检测、自依赖检测和先后顺序；`inject` 在这里被**完全无视**。

4. **`compose()` 生成最终图**：`{ rev, entries（已排序）, batches（bootstrap/application 两个批次） }`。
5. **`bootInjections(graph)` 把图写进 HTML 注入表**，最终产出四类注入：内联的注册队列脚本、application 批次预取、bootstrap 批次脚本、以及 `window.__DSH_BOOT__ = graph` 这个全局。

> 一句话总结宿主半部：`inject` 只被「搬运」进 `__DSH_BOOT__`，宿主侧对它的处理到此为止——不排序、不环检测、不校验目标是否存在（`graphRow` 只负责原样带上，`orderByModuleGraph` 根本不看它）。

### 4.2 线上传输：`window.__DSH_BOOT__` 的形状

下发到浏览器的入口图（`WebBootGraph`）长这样（类型定义在 `dsh-client-modules/lib/types/client/manifest.d.ts`）：

```ts
interface WebBootEntry {
  id: string            // entry 名 == 包名（浏览器模块 id）
  url: string           // 单资源 combo URL（文档相对路径，HMR 用它做缓存失效）
  rev: string           // 内容寻址修订号
  inject?: string[]     // 包名依赖边（用于「工厂到达」与「插件组合」）
  immediately?: boolean // 第一阶段预取标记
  external?: string[]   // 本行请求的非基线模块 specifier
}

interface WebBootGraph {
  rev: string
  entries: WebBootEntry[]   // 已按模块图顺序排好
  batches: WebBootBatch[]   // 初始 combo 脚本描述（bootstrap / application）
}
```

浏览器侧拿到这个 raw 值后，`parseBootManifest()` 会把它投影成**两个视图**：

- `modules`（模块表视角）：每行 `{ id, url, initialUrl, rev, inject, external }` —— 供模块表做「取回 bundle」用；
- `plugins`（Cordis 插件视角）：每行 `{ id, inject, immediately }` —— 供启动序列做「预取分层 + 建 Cordis entry」用。

> 这里有个值得知道的细节：`plugins` 视图里**也**带了 `inject` 字段，但当前 Web 外壳启动序列只读它的 `id` 和 `immediately`（`plugins.filter(e => e.immediately).map(e => prefetch(e.id))`、`plugins.map(f => f.id)`），并没有把 `plugins[].inject` 拿去给 Cordis 排序。也就是说，`inject` 的「服务排序/激活顺序」语义在当前实现里没有第二条消费路径——它的实际效果只落在 `modules` 视图里 `arriveGraphRow` 的「连带到达」这一条路径上。

### 4.3 浏览器半部：模块表的「到达 / 注册 / 物化」

浏览器半部是 `dsh-client-modules` 的 `lib/client.js`（类 `ClientModuleSystem`）。先建立三个术语：

| 词 | 含义 |
|---|---|
| **注册（register）** | 执行 bundle 脚本，只调用 `window.__ModuleLoader__.load({ id, factory })` 把工厂函数登记进 `factories` 表。**不执行模块体代码**（含 CSS 注入在内的副作用都还没发生）。 |
| **物化（materialize）** | 首次真正调用 `factory(require)` 产出并缓存 `exports`（进 `loadCache`）。模块体副作用（含 CSS 注入）**此刻**才执行，同步且记忆化（同一模块只物化一次）。 |
| **到达（arrive）** | 把某行对应的 bundle 脚本取回并执行，使它的工厂进入 `factories` 表（即「注册」），**不物化**。 |

核心方法是 `arriveGraphRow()`，它是理解 `inject` 语义的唯一关键。完整逻辑如下（`lib/client.js`）：

```js
async arriveGraphRow(row, open = [], visited = new Set()) {
  // 1) external 依赖：带环检测、带传递
  const next = [...open, row.id]
  for (const request of row.external) {
    const id = stripClientSuffix(request)
    if (this.seed.has(request) || this.loadCache.has(id)) continue
    const dependency = this.graphRows.get(id)
    if (dependency !== void 0) await this.arriveDependency(row.id, dependency, next, visited)
  }
  // 2) inject 依赖：不带环检测，但仍在「加载自己」之前
  for (const packageName of row.inject) {
    const dependency = this.graphRows.get(packageName)
    if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited)
  }
  // 3) 最后才加载自己
  await this.arrive(row)
}
```

逐条拆解 `inject` 在这里的行为：

- **在 `arrive(row)`（加载自己）之前执行**。这就是 `inject` 的全部价值：先取回并注册被注入的包，再加载声明方自己。
- **`graphRows.get(packageName)` 查不到 → 静默跳过**（`if (dependency !== void 0)`）。所以 `inject` 指向一个不存在 / 被禁用的包不会报错。
- **传入空的 `open` 栈**（第二个参数是 `[]`），所以 `inject` 边**不参与环检测**（对比：`external` 传的是 `next`，会做环检测）。
- **共享 `visited`**，所以同一个被注入包不会被重复到达两次。
- `arriveDependency()` 只是给错误信息加上「consumer → dependency」的因果链，实际就是递归 `arriveGraphRow`。

`arrive(row)` 里再往下就是「取回 bundle 脚本」（批次 combo URL，失败时回退到单资源 URL）、执行脚本（脚本顶部 `window.__ModuleLoader__.load({ id, factory })` 完成注册）。`materialize(id)` 在真正 `import` 时同步执行 `factory(require)` 并记忆化。

---

## 5. `inject` 到底「得到什么 / 失去什么」

把上面的机制翻译成可操作的结论：

| 场景 | 结果 |
|---|---|
| **有 `inject: ["B", "C"]` 的包 A** | 浏览器在「加载 A」之前，先把 B、C 的 bundle 取回并注册工厂（且在 A 之前）。之后若真要用到 B/C，它们的工厂已经在 `factories` 表里，`materialize` 直接同步执行，省掉一次「用到时才取回」的往返和首屏延迟。 |
| **去掉 `inject`** | A 本身照常加载、照常 `apply()`，可运行性**不变**。损失的只是这份预热：B、C 不再随 A 一起被取回注册，而是在真正被 import 时才按需加载。 |

一句话：`inject` 只「预热」，不「保证」。需要「必须先加载谁 / 必须能同步 `require` 谁」，用 `external`；只想「顺带取回、让后续更快命中」，用 `inject`。

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

- 那些 `inject` 里的官方包名（`@deepseek-ai/dsh-client-ui-chat`）在入口图里**落空** → 浏览器 `graphRows.get()` 返回 `undefined` → 静默跳过、不报错（这正是第 4.3 节「查不到就跳过」的体现）；
- fork 在**服务层**顶替了官方包（用不同包名注册了同一批 cordis 服务）；
- 两者叠加，就是「正常启动且一切正常」。

这个案例同时验证了两点：`inject` 是软提示（落空无害），而真正的功能顶替发生在 cordis **服务层**，与 `inject` 无关。
