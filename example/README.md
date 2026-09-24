# example — DSH 插件示例

两个可复制的最小示例，都只走 Node 宿主半部（Node 22 Type Stripping 直载 `index.ts`，无浏览器半部 / 构建产物）：

| 目录 | 内容 |
| --- | --- |
| `normal-plugin/` | 函数式插件：`inject = ['tools']` 注册 `greet` 工具；`ctx.get('metrics')` 读可选依赖；`ctx.on(...)` 监听事件 |
| `service-plugin/` | cordis `Service` 插件：注册 `metrics` 服务，并用声明合并扩展 `Context`（`normal-plugin` 的可选依赖正来自它） |

## 依赖约定

`@deepseek-ai/*` 由 DSH 宿主提供，**不能按 registry 的 `latest` 取**：

| 包 | 宿主内置 bundle | registry |
| --- | --- | --- |
| `@deepseek-ai/cordis` | 4.0.4 | `latest` 4.0.4 |
| `@deepseek-ai/dsh-tools` | 0.1.7-rc.1 | `latest` **0.0.1-rc.1（过时）**，`next` 0.1.7-rc.1 |

因此两个示例都这样声明：

- **`peerDependencies`**：表明这两个包由宿主提供。DSH 的运行时解析器（`dsh-app-boot` 的
  `routeLinked` / `readPeerNames`）只要在插件的 `package.json` `peerDependencies` 里看到包名，
  就把该 import 路由到宿主自己的实例，而不是插件目录下的副本；
- **`devDependencies`** 重复列出同一批包：仅为本地 `npm install` 后 `npm run typecheck` 与
  IDE 能解析类型。版本必须与全局 dsh 内置 bundle 一致
  （`<npm root -g>/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/package.json`）。

> 本目录此前"依赖问题"的根因：`dsh-tools` 的 npm `latest` 停在过时的 `0.0.1-rc.1`，
> 直接 `npm install @deepseek-ai/dsh-tools` 会装到没有 `defineTool` / `tools/*` 事件声明的旧版；
> 而完全不声明则 typecheck 与 IDE 都找不到类型。按上表锁定版本即可。

## 构建与验证

```sh
cd example/normal-plugin  && npm install --no-package-lock && npm run typecheck
cd example/service-plugin && npm install --no-package-lock && npm run typecheck
```

`--no-package-lock` 是因为仓库不提交 lockfile（依赖装在插件自身 `node_modules/`，已被根
`.gitignore` 忽略）。两个示例的 `tsconfig.json` 与仓库其它插件一致（`erasableSyntaxOnly` +
`verbatimModuleSyntax` + `strict`）。
