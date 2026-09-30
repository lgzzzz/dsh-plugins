# DSH 插件：五种「名字」完整说明

> **一句话**：一个 DSH 插件身上最多会出现五个互不派生、只是习惯写成同一个字符串的名字——**包名**（包的身份）、**patch `id`**（定位是哪一行）、**patch `name`**（要 import 哪个模块）、**导出 `name`**（日志里的显示名）、**服务名**（注入用的键）。它们各归各的机器管，改了其中一个，其余四个不会跟着变。

---

## 1. 五种名字速查表

| 名字 | 写在哪 | 谁用它 | 它管什么 |
|---|---|---|---|
| **包名** | `package.json` 的 `name` | Node 包解析、浏览器模块 id | **就是这个包的身份**（`node_modules/<包名>` → 该包的 `exports`/`main`） |
| **patch `id`** | `cordis.patch.yml` 行的 `id` | 补丁定位、`remove` / `update` / `disabled` | **是哪一行**（entry 树里的稳定标识） |
| **patch `name`** | 同一行的 `name` | 被当成模块说明符交给 import | **要加载哪个模块**（裸包名 / `./x.ts` / `cordis:group`） |
| **导出 `name`** | 插件模块的 `export const name` / 类名 | Cordis 的日志 / 诊断（`fiber.name`） | **日志里叫什么** |
| **服务名** | `static provide` / `super(ctx, 'x')` / `ctx.provide('x', …)` | `ctx.x`、`inject` 数组、`ctx.get('x')` | **注入用的键** |

> 核心区别：**包名是「引用它就能加载该包」的身份；patch `id` 定位「入口树里是哪一行」；patch `name` 指定「这一行 import 哪个模块」；导出 `name` 只是日志标签；服务名是「依赖注入的键」。五者互不派生**，DSH 里只是约定把它们写成同一个字符串（见第 7 节）。

---

## 2. 最小示例（完整版）

```jsonc
// package.json
{ "name": "dsh-git-guard",               // ← 包名（身份）
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-git-guard                  # ← 哪一行（可省略，省略则随机 8 位 hex）
      name: dsh-git-guard                # ← 要加载哪个模块（也可写 ./local.ts / cordis:group / 完整包名）
```

```ts
// index.ts（宿主半部，Node Type Stripping 直载）
export const name = 'dsh-git-guard'      // ← 日志名，可选
export function apply(ctx: Context) {}
```

```ts
// 只有「提供服务」的插件才会再多一个名字：服务名
class MetricsService extends Service {
  static provide = 'metrics'             // ← 服务名 → ctx.metrics / inject: ['metrics']
}
```

一个「id 与 name 不同」的真实例子（本仓库 `dsh-directory-picker-browse/cordis.patch.yml`）：

```yaml
- id: directory-picker                   # 定位官方那行，禁用它
  disabled: true

- insert:
    - id: directory-picker-browse        # 这一行的本地标识（可以是任意稳定字符串）
      name: '@deepseek-ai/dsh-host-directory-picker-browse'   # import 的却是完整包名

    - id: directory-picker-browse-ui     # 另一个本地标识
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

这里 `id` 是 `directory-picker-browse`，而 `name` 是 `@deepseek-ai/dsh-host-directory-picker-browse`——两者明显不同，且 `id` 跟「加载哪个包」毫无关系。

---

## 3. 每个名字逐个展开

### 3.1 包名（`package.json.name`）

- **写在哪**：`package.json` 顶层 `name`。
- **语义**：这是包在 npm / Node 解析里的**唯一身份**。`node_modules/<包名>/package.json` → 读它的 `exports`（或 `main`）找到入口。
- **谁用**：
  - **宿主侧**：loader 的 patch `name` 若是裸包名，`EntryTree.import(name)` 会 `import(name)`，Node 按包名解析到 `node_modules/<包名>`；
  - **客户端侧**：浏览器模块 id **就是包名**（`graphRow` 的 `id`、bundle 工厂注册的 `id` 都是它；`<包名>/client` 子路径会被 `stripClientSuffix` 归一成裸包名）。
- **后果**：包名写错、包没安装、或 `exports` 没暴露对应入口 → 这一行 `import` 失败，loader 记一条 error，该行不会加载。
- **注意**：包名是「身份」而非「展示名」。它必须满足 npm 包名规则（小写、可含 `-` / scope `@scope/name`），跟后面的「导出 name」没有任何自动同步。

### 3.2 patch `id`（`cordis.patch.yml` 行的 `id`）

- **写在哪**：`cordis.patch.yml` 每一行的 `id`（在 `insert` 子项里，或在非 insert 补丁的顶层）。
- **语义**：入口树（`EntryTree`）里这一行的**稳定键**。`EntryTree.store` 是一个 `{ id: Entry }` 的映射，所有「找到并操作某一行」的操作都靠它。
- **谁用**：
  - `remove(id)`：按 id 找到并删除该行；
  - `update(id, options)`：按 id 找到并更新该行；
  - 非 insert 补丁的定位（如 `- id: directory-picker, disabled: true`）：按 id 找到目标行再应用覆盖；
  - 嵌套 id 用 `:` 分隔（`EntryTree.sep = ':'`）。
- **可省略**：`EntryGroup.create()` 会调用 `EntryTree.ensureId()`，缺失时自动生成 `Math.random().toString(16).slice(2, 10)`（8 位随机 hex）。
- **注意**：**别随便改已发布的 `id`**。因为「定位行」全靠 id，改了 id 等于把它当成另一个新行，`remove`/`update`/`disabled` 会定位不到原行（补丁会 warn「entry %C not found」并被跳过）。

### 3.3 patch `name`（`cordis.patch.yml` 行的 `name`）

- **写在哪**：`cordis.patch.yml` 每一行的 `name`。
- **语义**：这一行要 **import 哪个模块**。它被 `EntryTree.import(name)` 当作「模块说明符」处理。
- **谁用 / 解析规则**（`cordis-plugin-loader` 的 `tree.ts`）：

  ```js
  import(name, getOuterStack) {
    if (name.startsWith('cordis:')) {
      return this.ctx.loader.builtins[name.slice(7)]      // ① cordis: 内建
    }
    // …
    if (this.ctx.loader.internal) {
      return await this.ctx.loader.internal.import(name, this.ctx.baseUrl!, {})
    } else if (name.startsWith('.')) {
      return await import(new URL(name, this.ctx.baseUrl).href)   // ② 相对路径 → 按 baseUrl 解析成文件
    } else {
      return await import(name)                                  // ③ 裸说明符 → 按包名解析
    }
  }
  ```

  所以 `name` 可以是三种东西：
  - **裸包名**（如 `dsh-git-guard`、`@deepseek-ai/dsh-host-directory-picker-browse`）→ 加载那个包；
  - **相对路径**（如 `./local.ts`）→ 相对 `baseUrl` 加载本地文件；
  - **`cordis:` 内建**（如 `cordis:group`）→ 取 loader 注册的内建对象（不是包）。

- **在非 insert 补丁里，`name` 是可选的安全校验**：`applyEntryPatches` 里若补丁带了 `name` 且与目标行的 `name` 不一致，会 warn「name mismatch」并跳过该补丁（防止定位错行时误改）。

### 3.4 导出 `name`（`export const name` / 类名）

- **写在哪**：插件模块顶层 `export const name = '…'`（或 `export default class X` 时的类名 `X`）。
- **语义**：这只是**日志 / 诊断里的显示名**，不参与任何功能逻辑。
- **谁用**：
  - Cordis 的 `Fiber.name` getter（`fiber.ts`）——日志前缀、错误 / effect 栈里的名字；
  - 重复注册报错文本里的 `<fiber.name>`。
- **关键规则（决定它是否生效）**：loader 拿到模块导出后先 `unwrapExports()`，再交给 `registry.plugin()`，后者取 `plugin.name` 作为 `runtime.name`：

  ```js
  // cordis-plugin-loader/src/index.ts
  unwrapExports(exports) {
    if (isNullable(exports)) return exports
    exports = exports.default ?? exports          // 优先 default
    if (!exports.__esModule) return exports
    return exports.default ?? exports             // esbuild 的 default 互操作
  }

  // cordis/src/registry.ts
  plugin(plugin, config) {
    const callback = this.resolve(plugin)         // function → 自身；{ apply } → plugin.apply
    // …
    let name = plugin.name
    if (name === 'apply') name = undefined        // 裸函数名 apply 不算数
    runtime = { name, callback, fibers, Config: plugin.Config }
  }
  ```

  由此推出四种写法的实际 `runtime.name`：

  | 插件写法 | `unwrapExports` 后 `plugin` 是谁 | `plugin.name` | 结论 |
  |---|---|---|---|
  | `export function apply` | 模块命名空间 `{ apply }` | `undefined` | 无显示名，`fiber.name` 回退到祖先 / `'root'` |
  | `export const name = 'x'` + `export function apply` | 命名空间 `{ name: 'x', apply }` | `'x'` | **生效** |
  | `export const name = 'x'` + `export function apply` + `export default { name, apply }` | 取 `default` → `{ name: 'x', apply }` | `'x'` | 生效（本仓库 `dsh-git-guard` 就是这种） |
  | `export default class X extends Service` | 取 `default` → 类 `X` | `'X'`（类名） | 名字变成类名；同模块的 `export const name` 成**死代码** |

- **影响面**：只有日志前缀、`ctx.fiber.name`、错误 / effect 栈、以及重复注册报错里的 `<fiber.name>`。**它不提供任何服务、不决定加载顺序、不参与模块解析**。

### 3.5 服务名（`static provide` / `super(ctx, 'x')` / `ctx.provide('x')`）

- **写在哪**：三种等价方式之一：
  - `class X extends Service { static provide = 'metrics' }`（构造时 `name ??= this.constructor['provide']`）；
  - `class X extends Service { constructor(ctx) { super(ctx, 'metrics') } }`（显式传名）；
  - 不用 `Service` 基类时直接 `ctx.provide('metrics', value)`。
- **语义**：这是 **Cordis 依赖注入的键**。`ctx.metrics`、`export const inject = ['metrics']`、`ctx.get('metrics')` 都靠它。
- **谁用**：Cordis 的 `ReflectService.provide/get`、`Fiber._checkImpl/_refresh`（服务可用性等待）。
- **机制要点**（`cordis/src/service.ts`、`reflect.ts`）：
  - `Service` 构造器 `name ??= this.constructor['provide']`，然后 `ctx.reflect.provide(name, self, …)` 注册；
  - `ctx.provide(name, value)` 若同名已注册，会抛：`service "x" has been registered at <fiber.name>`（注意这里的 `<fiber.name>` 是**插件名**，不是服务名——两个 `.name` 在此处唯一碰面，见第 5.3 节）；
  - 一个插件只有「对外提供服务」时才需要服务名；普通插件（只有 `apply`、不 `provide`）没有这个名字。

---

## 4. 完整数据流：从 patch 文件到「名字」落地

把上面的散点串成一条链（用于理解每个名字在哪个环节被消费）：

```
cordis.patch.yml
   │  applyEntryPatches(data, patches)          ← dsh-app-boot：按 id 定位行、按 name 校验、insert 追加
   ▼
Entry { options: { id, name, config, disabled, inject } }
   │  Entry._init() → parent.tree.import(options.name)   ← patch name 在这里被当模块说明符 import
   │  → 得到模块导出 exports
   │  → loader.unwrapExports(exports)           ← 取 default（类 / {name,apply}）
   │  → registry.plugin(plugin, config)
   ▼
Plugin.Runtime { name: plugin.name, callback, fibers, Config }   ← 导出 name / 类名 在这里变成 runtime.name
   │  Fiber.name getter → runtime.name（向祖先回退）           ← 日志里显示
   ▼
Service（若提供服务）
   │  super(ctx, name) / static provide / ctx.provide('x')
   ▼
ReflectService.store[x] = { name: 'x', value, fiber, … }        ← 服务名在这里变成注入键
```

---

## 5. 三个最容易迷惑的点（展开版）

### 5.1 patch `id` ≠ patch `name`

- 补丁**只能靠 `id` 找到行**；`name` 只是「要 import 哪个模块」的**引用**。
- 写裸包名就加载那个包；写 `./x.ts` 或 `cordis:group` 就与包名完全无关了。
- `id` 可选且省略时是随机 8 位 hex——所以别随便改已发布的 `id`（改了定位不到原行）。
- 包名是**身份**（`node_modules/<包名>` → 该包 `exports`/`main`）：包名写错、包没装、或 `exports` 没暴露入口，这一行 `import` 失败、loader 报 error、该行不加载。

### 5.2 导出 `name` 只在「无 default 导出」时按 `export const name` 生效

- `export const name + export function apply` → 生效；
- `export default { name, apply }` → 也生效（取 default 对象上的 `name`）；
- **一旦 `export default class X extends Service`**，loader 取 `default`，`plugin.name` 变成类名 `X`，同模块的 `export const name` 成了**死代码**（因为 default 优先，命名空间的 `name` 永远读不到）。
- 它的影响面只有日志前缀、`ctx.fiber.name`、错误 / effect 栈，**不参与任何功能逻辑**。

### 5.3 服务名和插件名毫无关系

- 服务名决定 `ctx.metrics` 能不能取到、`inject` 数组写什么；插件名只出现在日志里。
- 注意**同一个 `.name` 属性在两类对象上含义不同**：
  - `service.name`（`Service` 实例属性）是**服务名**；
  - `fiber.name`（`Fiber` getter）是**插件名**（`runtime.name`）。
- 二者唯一碰面处是重复注册的报错文本：`service "x" has been registered at <fiber.name>`（`reflect.ts` 的 `provide()`，`<…>` 里填的是**插件名**）。

---

## 6. 客户端半部的名字（额外一条）

`dsh-client-inject.md` 已经讲过客户端模块表，这里只补「名字」相关的一条：

- **浏览器模块 id 来自「包名」**，不是来自 `src/client.ts` 里的 `export const name`。
- 本仓库 `tsdown.client.mjs` 的 `clientBundle(id, …)` 里，`id` 就是包名；bundle 的 banner 是 `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { … } })`，构建配置名是 `<包名>/client`。
- 所以 `src/client.ts` 顶部的 `export const name = '…'` **同样只是日志标签**，跟「这个客户端包在浏览器里叫什么 id」无关。构建脚本里传给 `clientBundle` 的第一个参数必须等于 `package.json.name`，否则浏览器模块表按包名找 graph row 时会找不到。

---

## 7. 本仓库约定

1. 四个名字（包名 / patch `id` / patch `name` / 导出 `name`）保持一致；提供服务时服务名也同名。
   - 例：`dsh-git-guard` 的包名、patch `id`、patch `name`、`export const name` 都是 `dsh-git-guard`。
   - 例外：`dsh-directory-picker-browse` 这类「纯补丁 bundle」里 patch `id`（本地标识）与 patch `name`（要加载的官方包名）**故意不同**，因为它的职责就是「挂载别人」。
2. 宿主半部只用两种写法，**不要混用**：
   - `export function apply`（+ 可选 `export const name` / `export const inject` / `export const Config`）；
   - 或 `export default class X extends Service`。
   - 本仓库现状：`dsh-git-guard` 用了 `export const name + export function apply + export default { name, apply }`；其余宿主半部都是 `export const name + export function apply`（空 `apply`，把功能都放在客户端半部）。
3. 客户端半部（`src/client.ts`）的 `export const name` 同样只是标签：浏览器模块 id 来自**包名**，构建脚本里的 `loaderId`（`clientBundle(id)` 的第一个参数）必须等于包名。
4. 提供服务用 `static provide`（或 `super(ctx, 'x')`）显式声明，别指望导出 `name` 能起到服务名的作用。

---

## 8. 术语速查表

| 词 | 含义 | 归属机器 |
|---|---|---|
| 包名 | `package.json.name`，Node 解析 + 浏览器模块 id 的身份 | npm / Node / 模块表 |
| patch `id` | `cordis.patch.yml` 行的稳定键，定位「是哪一行」 | `EntryTree`（`dsh-app-boot.applyEntryPatches`） |
| patch `name` | 该行要 import 的模块说明符（包名 / 路径 / `cordis:` 内建） | `EntryTree.import` |
| 导出 `name` / 类名 | `Plugin.Runtime.name`，日志显示名 | Cordis `registry.plugin` + `Fiber.name` |
| 服务名 | `static provide` / `super(ctx,'x')` / `ctx.provide('x')` 的键 | Cordis `ReflectService` |
| `unwrapExports` | 取 `default`（或 esbuild 互操作）的导出归一化 | `cordis-plugin-loader` |
| `runtime.name` | 插件运行期的显示名（= `plugin.name`，`'apply'` 除外） | Cordis `RegistryService` |
| `fiber.name` | 插件的显示名（向祖先回退，兜底 `'root'`） | Cordis `Fiber` |
| `service.name` | 服务实例的注册名（= 服务名） | Cordis `Service` |
