# 完整数据流:从 package.json 到浏览器模块表

> 本文件是 [`dsh.client.inject` 完整说明](../dsh-client-inject.md) 的第 2 册:宿主半部 → 线上传输 → 浏览器半部,以及 `inject` 实际「得到什么 / 失去什么」。

-----

## 4. 完整数据流

下面按「宿主半部 → 线上传输 → 浏览器半部」三段说明 `inject` 一路上被谁读、被谁忽略。

### 4.1 宿主半部(Node 侧):扫描并构图 `window.__DSH_BOOT__`

宿主半部的代码是 `@deepseek-ai/dsh-client-modules` 的 `lib/index.js`(服务类 `ClientModuleRegistry`),它做这几件事:

1. **订阅 loader 的 entry 变化**,对每个已挂载的插件 entry 扫描其 `package.json`:
   - `resolveMeta()` 用 `parseDshClient` 校验 `dsh.client`;
   - 只保留 `platform === "web"` 的包;
   - 从 `exports["./client"]` 拿到客户端 bundle 的相对路径(没有这个导出会抛「declares dsh.client but exports no "./client" bundle」);
   - 缓存 `inject` / `external` / `immediately`。
2. **`graphRow()` 组装入口图的每一行**(`WebBootEntry`),这几个字段的写法是:

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

   所以 `inject` 会被**原样写进**入口图行的 `inject` 字段,随 `window.__DSH_BOOT__` 一起下发到浏览器。

3. **`orderByModuleGraph(entries)` 只按 `external` 排序**。排序函数遍历每个 entry 的 `external`,用 DFS 拓扑排序,保证「被 `external` 请求的包」排在「请求它的包」之前。**`inject` 完全不参与这个排序**。

   ```js
   function orderByModuleGraph(entries) {
     // … 构建 rowsById …
     const visit = (entry) => {
       // … 环检测(open 栈)、去重(placed)…
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

   排序只在 `external` 上产生环检测、自依赖检测和先后顺序;`inject` 在这里被完全无视。

4. **`compose()` 生成最终图**:`{ rev, entries(已排序), batches }`;每个 batch 的 `phase` 只有 `bootstrap` / `application` 两种,同一 phase 因 combo URL 有 3 KB 上限可拆成多条描述符。
5. **`bootInjections(graph)` 把图写进 HTML 注入表**,产出四类注入:内联的注册队列脚本、application 批次预取、bootstrap 批次脚本、以及 `window.__DSH_BOOT__ = graph` 这个全局。

宿主半部对 `inject` 的处理到此为止:只把它搬运进 `__DSH_BOOT__`,不排序、不环检测、不校验目标是否存在(`graphRow` 原样带上,`orderByModuleGraph` 根本不看它)。

### 4.2 线上传输:`window.__DSH_BOOT__` 的形状

下发到浏览器的入口图(`WebBootGraph`,类型定义在 `dsh-client-modules/lib/types/client/manifest.d.ts`):

```ts
interface WebBootEntry {
  id: string            // entry 名 == 包名(浏览器模块 id)
  url: string           // 单资源 combo URL(文档相对路径,HMR 用它做缓存失效)
  rev: string           // 不透明的产物修订号(宿主按文件系统元数据推导,HMR 用它做缓存失效)
  inject?: string[]     // 包名依赖边(用于「工厂到达」与「插件组合」)
  immediately?: boolean // 第一阶段预取标记
  external?: string[]   // 本行请求的非基线模块 specifier
}

interface WebBootGraph {
  rev: string
  entries: WebBootEntry[]   // 已按模块图顺序排好
  batches: WebBootBatch[]   // 初始 combo 脚本描述(phase 为 bootstrap / application;同一 phase 可有多条)
}
```

浏览器侧拿到这个 raw 值后,`parseBootManifest()` 把它投影成**两个视图**:

- `modules`(模块表视角):每行 `{ id, url, initialUrl, rev, inject, external }` —— 供模块表做「取回 bundle」用;
- `plugins`(Cordis 插件视角):每行 `{ id, inject, immediately }` —— 供启动序列做「预取分层 + 建 Cordis entry」用。

`plugins` 视图里**也**带了 `inject` 字段,但 Web 外壳启动序列只读它的 `id` 和 `immediately`(`plugins.filter(e => e.immediately).map(e => prefetch(e.id))`、`plugins.map(f => f.id)`),没有把 `plugins[].inject` 拿去给 Cordis 排序。也就是说,`inject` 的实际效果只落在 `modules` 视图里 `arriveGraphRow` 的「连带到达」这一条路径上。

### 4.3 浏览器半部:模块表的「到达 / 注册 / 物化」

浏览器半部是 `dsh-client-modules` 的 `lib/client.js`(类 `ClientModuleSystem`)。三个术语:

| 词 | 含义 |
|---|---|
| **注册(register)** | 执行 bundle 脚本,只调用 `window.__ModuleLoader__.load({ id, factory })` 把工厂函数登记进 `factories` 表。**不执行模块体代码**(含 CSS 注入在内的副作用都还没发生)。 |
| **物化(materialize)** | 首次真正调用 `factory(require)` 产出并缓存 `exports`(进 `loadCache`)。模块体副作用(含 CSS 注入)**此刻**才执行,同步且记忆化(同一模块只物化一次)。 |
| **到达(arrive)** | 把某行对应的 bundle 脚本取回并执行,使它的工厂进入 `factories` 表(即「注册」),**不物化**。 |

核心方法是 `arriveGraphRow()`(`lib/client.js`):

```js
async arriveGraphRow(row, open = [], visited = new Set()) {
  // 0) open 栈上已有这一行 = 环;visited 里已有这一行 = 直接跳过
  const cycleStart = open.indexOf(row.id)
  if (cycleStart !== -1) throw new Error(`client-modules: module arrival cycle … (the host must reject this graph before serving it)`)
  if (visited.has(row.id)) return
  visited.add(row.id)
  // 1) external 依赖:带环检测、带传递
  const next = [...open, row.id]
  for (const request of row.external) {
    const id = stripClientSuffix(request)
    if (this.seed.has(request) || this.loadCache.has(id)) continue
    const dependency = this.graphRows.get(id)
    if (dependency !== void 0) await this.arriveDependency(row.id, dependency, next, visited)
  }
  // 2) inject 依赖:不带环检测,但仍在「加载自己」之前
  for (const packageName of row.inject) {
    const dependency = this.graphRows.get(packageName)
    if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited)
  }
  // 3) 最后才加载自己
  await this.arrive(row)
}
```

`inject` 在这里的行为:

- **在 `arrive(row)`(加载自己)之前执行**,先取回并注册被注入的包,再加载声明方自己。
- **`graphRows.get(packageName)` 查不到 → 静默跳过**(`if (dependency !== void 0)`),所以 `inject` 指向一个不存在 / 被禁用的包不会报错。
- **传入空的 `open` 栈**(第二个参数是 `[]`):`arriveGraphRow` 入口会用 `open.indexOf(row.id)` 查环,而空栈里永远不含被注入包,所以 `inject` 边**不参与环检测**(环只能靠共享的 `visited` 短路);`external` 边传的是含自身的 `next`,会做环检测。
- **共享 `visited`**,同一个被注入包不会被重复到达两次。
- `arriveDependency()` 只是给错误信息加上「consumer → dependency」的因果链,实际就是递归 `arriveGraphRow`。

`arrive(row)` 里再往下就是「取回 bundle 脚本」(批次 combo URL,失败时回退到单资源 URL)、执行脚本(脚本顶部 `window.__ModuleLoader__.load({ id, factory })` 完成注册)。`materialize(id)` 在真正 `import` 时同步执行 `factory(require)` 并记忆化。

-----

## 5. `inject` 到底「得到什么 / 失去什么」

| 场景 | 结果 |
|---|---|
| **有 `inject: ["B", "C"]` 的包 A** | 浏览器在「加载 A」之前,先把 B、C 的 bundle 取回并注册工厂(且在 A 之前)。之后若真要用到 B/C,它们的工厂已经在 `factories` 表里,`materialize` 直接同步执行,省掉一次「用到时才取回」的往返和首屏延迟。 |
| **去掉 `inject`** | A 本身照常加载、照常 `apply()`,可运行性**不变**。损失的只是这份预热:B、C 不随 A 一起被取回注册,而是在真正被 import 时才按需加载。 |

`inject` 只「预热」,不「保证」。需要「必须先加载谁 / 必须能同步 `require` 谁」,用 `external`;只想「顺带取回、让后续更快命中」,用 `inject`。
