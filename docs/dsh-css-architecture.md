# DSH 组件 CSS 架构：注册位置、作用域与令牌体系

> **一句话**：DSH 上游控制组件样式靠 **CSS Modules（哈希类名，组件局部） + CSS 变量（`:root`/`body`，全局令牌） + `data-*`（状态开关 / JS 锚点）** 三种机制。CSS 有两条注册路径——静态 `<link>`（应用外壳自己的构建产物）和运行时 `<style>` 注入（插件 bundle 物化时）。插件 `dsh-ui-css-patches` 用 `[data-dockkit-tab][role="tab"]` 复合属性选择器做跨构建稳定的覆盖锚点。

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 上游机制与两条注册路径](dsh-css-architecture/01-mechanisms-and-registration.md) | CSS Modules / CSS 变量 / `data-*` 各自定位；静态 `<link>` 与运行时 `<style>` 注入 |
| [2. 构建期 CSS 处理：三个虚拟模块](dsh-css-architecture/02-build-time-css-pipeline.md) | `\0dsh-css:` / `\0dsh-global-css:` / `\0dsh-inline-css:` 的触发条件、产物与注入方式 |
| [3. 全局生效还是组件局部生效](dsh-css-architecture/03-scope-and-tokens.md) | 三类 CSS 的作用域；设计令牌的 8 个全局 sheet；`<style>` 的回收机制 |
| [4. 与插件 `dsh-ui-css-patches` 的关系](dsh-css-architecture/04-css-patches-relationship.md) | 复合属性选择器覆盖上游的条件；`css-contract.json` 构建后校验 |
| [5. 已验证的关键锚点与术语速查表](dsh-css-architecture/05-anchors-and-glossary.md) | 代码位置清单；术语表 |
