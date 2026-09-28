# DSH 插件：五种"名字"速查

| 名字 | 写在哪 | 谁用它 | 它管什么 |
|---|---|---|---|
| **包名** | `package.json` 的 `name` | Node 包解析、浏览器模块 id | **就是这个包的身份** |
| **patch `id`** | `cordis.patch.yml` 行 | 补丁定位、`remove`/`update` | **是哪一行** |
| **patch `name`** | 同一行 | 被当成模块说明符交给 ESM `import()` | **要加载哪个模块** |
| **导出 `name`** | `export const name` | cordis 的日志/诊断（`fiber.name`） | **日志里叫什么** |
| **服务名** | `super(ctx,'x')` / `static provide` / `ctx.provide()` | `ctx.x`、`inject`、`ctx.get` | **注入用的键** |

**一句话：包名是包的身份（引用它就能加载该包），`id` 定位行，patch `name` 指定要加载哪个模块，导出 `name` 只是日志名，服务名是注入键。它们互不派生，DSH 里只是习惯写成同一个字符串。**

## 最小示例

```jsonc
// package.json
{ "name": "dsh-git-guard",              // ← 包名
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-git-guard                 # ← 哪一行（可省略，省略则随机 hex）
      name: dsh-git-guard               # ← 要加载哪个模块（也可写 ./local.ts 或 cordis:group）
```

```ts
// index.ts
export const name = 'dsh-git-guard'     // ← 日志名，可选
export function apply(ctx: Context) {}
```

```ts
// 只有"提供服务"的插件才会再多一个名字：服务名
class MetricsService extends Service {
  static provide = 'metrics'            // ← 服务名 → ctx.metrics / inject: ['metrics']
}
```

## 三个容易迷惑的点

1. **patch `id` ≠ patch `name`。** 补丁只能靠 `id` 找到行；patch `name` 只是**引用**，写裸包名就加载那个包，写 `./x.ts` 或 `cordis:group` 就与包无关了。patch `id` 可选且省略时是随机值——所以别随便改已发布的 `id`。
   包名是**身份**（`node_modules/<包名>` → 该包 `exports`/`main`）：包名写错、包没安装、或 `exports` 没暴露入口，这一行 `import` 就失败、loader 报一条 error、该行不会加载。

2. **导出 `name` 只在无 default 导出时生效。** `export const name` + `export function apply` → 生效；一旦有 `export default class X`，loader 取 default，名字变成类名 `x`，`export const name` 成了死代码。它的影响面只有日志前缀、`ctx.fiber.name`、错误/effect 栈，**不参与任何功能逻辑**。

3. **服务名和插件名毫无关系。** 服务名决定 `ctx.metrics` 能不能取到、`inject` 写什么；插件名只出现在日志里。注意同一个 `.name` 属性在两类对象上含义不同：`service.name` 是服务名，`fiber.name` 是插件名。二者唯一碰面处是重复注册的报错文本：`service "x" has been registered at <fiber.name>`。

## 本仓库约定

1. 四个名字（包名 / patch `id` / patch `name` / 导出 `name`）保持一致；提供服务时服务名也同名。
2. 宿主半部只用两种写法，**不要混用**：
   - `export function apply` (+ 可选 `inject`/`Config`)
   - 或 `export default class X extends Service`
3. 客户端半部（`src/client.ts`）的 `export const name` 同样只是标签：浏览器模块 id 来自**包名**，而构建脚本里的 `loaderId` 必须等于包名。
4. 提供服务用 `static provide`（或 `super(ctx, 'x')`）显式声明，别指望导出 `name` 能起到这个作用。
