# 术语速查表

> 本文件是 [`dsh.client.inject` 完整说明](../dsh-client-inject.md) 的第 4 册:术语表。

-----

## 8. 术语速查表

| 词 | 含义 |
|---|---|
| **`dsh.client`** | `package.json` 里的客户端声明对象,含 `platform`/`inject`/`external`/`immediately` |
| **`WebBootEntry` / 入口图行** | `window.__DSH_BOOT__.entries[]` 的一行,浏览器模块表据此取回 bundle |
| **`orderByModuleGraph()`** | 宿主半部按 `external` 做拓扑排序 + 环检测 + 自依赖检测(**不看 inject**) |
| **`arriveGraphRow()`** | 浏览器半部「先 external、再 inject、最后自己」的到达顺序 |
| **`arrive()`** | 取回并执行某行 bundle,使工厂注册进 `factories` |
| **factory 注册** | 脚本只登记 `window.__ModuleLoader__.load({ id, factory })`,**不执行模块体** |
| **materialize(物化)** | 首次真正调用 `factory(require)` 产出并缓存 `exports`;副作用(含 CSS 注入)此刻才执行,同步且记忆化 |
| **seed / staticModules** | 平台基线单例(react / cordis / dsh-client-* 种子),同步 `require` 的第一层命中 |
| **`missed the module table`** | 同步 `require(spec)` 在 seed → loadCache → factories 三层都不命中时抛的错 |
| **纯度门(purity gate)** | 构建期对 `@deepseek-ai/` 值导入的合法性检查,禁止跨插件第二份内联拷贝 |
