# 完整数据流与三个易混点

> 本文件是 [DSH 插件五种「名字」完整说明](../plugin-naming.md) 的第 3 册：从 patch 文件到名字落地的数据流、三个易混点、客户端半部的名字。

---

## 4. 完整数据流：从 patch 文件到「名字」落地

每个名字在哪个环节被消费：

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

## 5. 三个易混点

### 5.1 patch `id` ≠ patch `name`

- 补丁**只能靠 `id` 找到行**；`name` 只是「要 import 哪个模块」的**引用**。
- 写裸包名就加载那个包；写 `./x.ts` 或 `cordis:group` 就与包名完全无关了。
- `id` 可选且省略时是随机 8 位 hex；改掉已发布的 `id` 会定位不到原行。
- 包名是**身份**（`node_modules/<包名>` → 该包 `exports`/`main`）：包名写错、包没装、或 `exports` 没暴露入口，这一行 `import` 失败、loader 报 error、该行不加载。

### 5.2 导出 `name` 只在「无 default 导出」时按 `export const name` 生效

- `export const name + export function apply` → 生效；
- `export default { name, apply }` → 也生效（取 default 对象上的 `name`）；
- **一旦 `export default class X extends Service`**，loader 取 `default`，`plugin.name` 变成类名 `X`，同模块的 `export const name` 成了**死代码**（default 优先，命名空间的 `name` 永远读不到）。
- 它的影响面只有日志前缀、`ctx.fiber.name`、错误 / effect 栈，**不参与任何功能逻辑**。

### 5.3 服务名和插件名毫无关系

- 服务名决定 `ctx.metrics` 能不能取到、`inject` 数组写什么；插件名只出现在日志里。
- **同一个 `.name` 属性在两类对象上含义不同**：
  - `service.name`（`Service` 实例属性）是**服务名**；
  - `fiber.name`（`Fiber` getter）是**插件名**（`runtime.name`）。
- 二者唯一碰面处是重复注册的报错文本：`service "x" has been registered at <fiber.name>`（`reflect.ts` 的 `provide()`，`<…>` 里填的是**插件名**）。

---

## 6. 客户端半部的名字

客户端模块表见 `dsh-client-inject.md`；与「名字」相关的规则：

- **浏览器模块 id 来自「包名」**，不是来自 `src/client.ts` 里的 `export const name`。
- 本仓库 `tsdown.client.mjs` 的 `clientBundle(id, …)` 里，`id` 就是包名；bundle 的 banner 是 `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { … } })`，构建配置名是 `<包名>/client`。
- 所以 `src/client.ts` 顶部的 `export const name = '…'` **同样只是日志标签**，跟「这个客户端包在浏览器里叫什么 id」无关。构建脚本里传给 `clientBundle` 的第一个参数必须等于 `package.json.name`，否则浏览器模块表按包名找 graph row 时会找不到。
