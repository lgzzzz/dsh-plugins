# 五种名字速查表与最小示例

> 本文件是 [DSH 插件五种「名字」完整说明](../plugin-naming.md) 的第 1 册：速查表与一个完整的最小示例。

---

## 1. 五种名字速查表

| 名字 | 写在哪 | 谁用它 | 它管什么 |
|---|---|---|---|
| **包名** | `package.json` 的 `name` | Node 包解析、浏览器模块 id | **就是这个包的身份**（`node_modules/<包名>` → 该包的 `exports`/`main`） |
| **patch `id`** | `cordis.patch.yml` 行的 `id` | 补丁定位、`remove` / `update` / `disabled` | **是哪一行**（entry 树里的稳定标识） |
| **patch `name`** | 同一行的 `name` | 被当成模块说明符交给 import | **要加载哪个模块**（裸包名 / `./x.ts` / `cordis:group`） |
| **导出 `name`** | 插件模块的 `export const name` / 类名 | Cordis 的日志 / 诊断（`fiber.name`） | **日志里叫什么** |
| **服务名** | `static provide` / `super(ctx, 'x')` / `ctx.provide('x', …)` | `ctx.x`、`inject` 数组、`ctx.get('x')` | **注入用的键** |

> 五者互不派生：包名是「引用它就能加载该包」的身份，patch `id` 定位「入口树里是哪一行」，patch `name` 指定「这一行 import 哪个模块」，导出 `name` 只是日志标签，服务名是「依赖注入的键」。DSH 里只是约定把它们写成同一个字符串（见 [第 7 节](04-conventions-and-glossary.md)）。

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

一个「id 与 name 不同」的例子（本仓库 `dsh-directory-picker-browse/cordis.patch.yml`）：

```yaml
- id: directory-picker                   # 定位官方那行，禁用它
  disabled: true

- insert:
    - id: directory-picker-browse        # 这一行的本地标识（可以是任意稳定字符串）
      name: '@deepseek-ai/dsh-host-directory-picker-browse'   # import 的却是完整包名

    - id: directory-picker-browse-ui     # 另一个本地标识
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

这里 `id` 是本地标识、与「加载哪个包」无关，`name` 才是被 import 的完整包名。
