# 每个名字逐个展开

> 本文件是 [DSH 插件五种「名字」完整说明](../plugin-naming.md) 的第 2 册：包名、patch `id`、patch `name`、导出 `name`、服务名分别展开。

---

## 3. 每个名字逐个展开

### 3.1 包名（`package.json.name`）

- **写在哪**：`package.json` 顶层 `name`。
- **语义**：这是包在 npm / Node 解析里的**唯一身份**。`node_modules/<包名>/package.json` → 读它的 `exports`（或 `main`）找到入口。
- **谁用**：
  - **宿主侧**：loader 的 patch `name` 若是裸包名，`EntryTree.import(name)` 会 `import(name)`，Node 按包名解析到 `node_modules/<包名>`；
  - **客户端侧**：浏览器模块 id **就是包名**（`graphRow` 的 `id`、bundle 工厂注册的 `id` 都是它；`<包名>/client` 子路径会被 `stripClientSuffix` 归一成裸包名）。
- **失败表现**：包名写错、包没安装、或 `exports` 没暴露对应入口 → 这一行 `import` 失败，loader 记一条 error，该行不会加载。
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
- **注意**：定位行全靠 `id`；把已发布的 `id` 改掉等于多出一个新行——`remove`/`update`/`disabled` 定位不到原行，补丁会 warn「entry %C not found」并被跳过。

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

- **在非 insert 补丁里，`name` 是可选的安全校验**：`applyEntryPatches` 里若补丁带了 `name` 且与目标行的 `name` 不一致，会 warn「name mismatch」并跳过该补丁。

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
  - `ctx.provide(name, value)` 若同名已注册，会抛：`service "x" has been registered at <fiber.name>`（注意这里的 `<fiber.name>` 是**插件名**，不是服务名——两个 `.name` 在此处唯一碰面，见 [第 5.3 节](03-data-flow-and-pitfalls.md)）；
  - 一个插件只有「对外提供服务」时才需要服务名；普通插件（只有 `apply`、不 `provide`）没有这个名字。
