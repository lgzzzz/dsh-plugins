# 本仓库约定与术语速查表

> 本文件是 [DSH 插件五种「名字」完整说明](../plugin-naming.md) 的第 4 册：本仓库的命名约定与术语速查表。

-----

## 7. 本仓库约定

1. 四个名字（包名 / patch `id` / patch `name` / 导出 `name`）保持一致；提供服务时服务名也同名。
   - 例：`dsh-git-guard` 的包名、patch `id`、patch `name`、`export const name` 都是 `dsh-git-guard`。
   - 例外：`dsh-directory-picker-browse` 这类「纯补丁 bundle」里 patch `id`（本地标识）与 patch `name`（要加载的官方包名）不同。
2. 宿主半部只用两种写法，**不要混用**：
   - `export function apply`（+ 可选 `export const name` / `export const inject` / `export const Config`）；需要 default 导出时写 `export default { name, apply }`（带服务依赖时连 `inject` 一起写）；
   - 或 `export default class X extends Service`。
   - 本仓库现状：`dsh-git-guard` 用 `export const name + export function apply + export default { name, apply }`；`dsh-workspace-activity-sort` 用 `export const name + export function apply + export default { name, inject, apply }`；其余宿主半部只导出 `export const name + export function apply`。
3. 客户端半部（`src/client.ts`）的 `export const name` 同样只是标签：浏览器模块 id 来自**包名**，构建脚本传给 `clientBundle(id)` 的第一个参数（`id`）必须等于包名。
4. 提供服务用 `static provide`（或 `super(ctx, 'x')`）显式声明；导出 `name` 不充当服务名。

-----

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
