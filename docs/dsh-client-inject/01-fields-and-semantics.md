# 字段形状与语义

> 本文件是 [`dsh.client.inject` 完整说明](../dsh-client-inject.md) 的第 1 册:字段定义、三个同名 `inject` 的区别、`dsh.client` 四个字段各自的作用。

---

## 1. 它写在哪里、长什么样

`dsh.client.inject` 是 `package.json` 里 `dsh.client` 对象的一个可选字段。`dsh.client` 的权威形状定义在 `@deepseek-ai/dsh-package-manifest` 的 `DshClientManifest`:

```ts
interface DshClientManifest {
  platform: string        // 客户端平台标识;Web 端取 "web"
  inject?: string[]       // 信息性包名依赖(不是 Cordis 服务注入)
  immediately?: boolean   // 启动第一阶段注册屏障;缺省 = 共享的 application 批次
  external?: string[]     // 超出隐式基线的「精确模块表请求」,可含 <pkg>/client 子路径;缺省 = 只有基线外部依赖
}
```

一个真实例子(本仓库 `dsh-desktop-notify/package.json`):

```jsonc
{
  "name": "dsh-desktop-notify",
  "exports": {
    ".": { "default": "./index.ts" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",
      "immediately": true
      // 没有写 inject —— 缺省等价于 []
    },
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

带 `inject` 的例子(`@deepseek-ai/dsh-client-ui-theme/package.json`):

```jsonc
"dsh": {
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-api-remotes"
    ],
    "platform": "web",
    "immediately": true
  }
}
```

**校验规则**(`dsh-client-modules` 的 `parseDshClient`,宿主半部与浏览器半部共用同一个校验器):

- `dsh.client` 缺失 → 等价于「不是客户端包」,跳过;
- `dsh.client` 不是对象 → 抛错 `… has a non-object dsh.client declaration`;
- `platform` 不是字符串 → 抛错(`dsh.client.platform must be a string`);
- `inject` 存在但不是「字符串数组」→ 抛错(`dsh.client.inject must be a string array`);
- `external` 存在但不是「字符串数组」→ 抛错(`dsh.client.external must be a string array`);
- `immediately` 存在但不是布尔 → 抛错(`dsh.client.immediately must be a boolean`)。

`inject` 是可选字段:缺了它等于空数组,包照常加载、照常 `apply()`,只是少了「连带预取」这一份优化(见 [第 3 册](03-require-and-failure-modes.md))。

---

## 2. 三个都叫「inject」的东西

DSH 里有三个互不相干、同名不同义的 `inject`:

| 出现位置 | 全称 | 语义 | 谁来读 |
|---|---|---|---|
| `package.json` 的 `dsh.client.inject` | 客户端包名软提示 | 「顺带加载哪些包」的预热提示 | 宿主半部扫描器 + 浏览器模块表 |
| 插件代码里 `export const inject = ['slots']` | Cordis 服务依赖声明 | 「这个插件要等哪些**服务**可用」 | Cordis 加载器(`Inject.resolve`) |
| 插件代码里 `ctx.inject([...], cb)` / `ctx.get('x')` | Cordis 服务注入 API | 「取一个服务 / 等一个服务就绪」 | Cordis 上下文 |

本文只讲第一个。第二、三个属于 Cordis 的**服务**世界:它们的键是「服务名」(如 `slots`、`theme`、`loader`),跟「包名」没有任何派生关系;服务的生命周期由 Cordis 的 `provide`/`get`/`inject` 管理,跟模块的加载/注册是两套机器。

一个包可以**同时**有两个 `inject` 并且含义完全不同。例如 `dsh-header-action-order/src/client.ts` 里 `export const inject = ['slots']` 表示「等我 `apply` 时 `slots` 服务必须已就绪」;而这个包如果在 `package.json` 里写了 `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-conversation"]`,那表示「加载我这份 bundle 之前,先把 conversation 的 bundle 也注册好」。两者互不替代、互不影响。

---

## 3. `dsh.client` 的四个字段各自干什么

### 3.1 `platform`(必填)

- 语义:客户端平台标识字符串。Web 端写 `"web"`。
- 谁读:宿主半部扫描器 `resolveMeta` 只挑 `platform === "web"` 的包进浏览器入口图;其它平台值一律忽略。
- 缺失时:`dsh.client` 里 `platform` 缺失会直接抛错(不是静默忽略),因为它是必填字段。

### 3.2 `inject`(可选,软提示)

- 语义:一串 npm 包名,「加载我这份 bundle 之前,先把这些包也注册好工厂」。
- 谁读:浏览器半部 `arriveGraphRow`(见 [第 2 册](02-data-flow.md))。
- 特性:**不排序、不环检测、不校验存在性、不提供服务**。

### 3.3 `external`(可选,硬依赖)

- 语义:这个包在浏览器 bundle 里**用值导入**(`import` 而非 `import type`)了哪些「非基线」的模块,必须把这些 specifier 交给模块表在运行时解析。
- 谁读:
  1. **构建期**:tsdown 预设 `tsdown.client.mjs` 里 `requestedClientExternals()` 读它,把这些 specifier 加入「外部化」名单,于是它们以 `require("...")` 的形式留在产物里,而不是被打包内联;
  2. **构建期纯度门**:`purityGatePlugin` 据此判断一个 `@deepseek-ai/` 的值导入是否合法(在名单里→合法,否则→构建失败,见 [第 3 册](03-require-and-failure-modes.md));
  3. **宿主半部**:`orderByModuleGraph()` 按它构图排序、做环检测、做自依赖检测;
  4. **浏览器半部**:`arriveGraphRow()` 按它在加载自身之前递归取回依赖(带环检测)。
- 特性:**参与排序、做环检测、做自依赖检测、目标缺失时宿主构图直接 `throw`**(客户端无法启动)。

### 3.4 `immediately`(可选,布尔)

- 语义:是否进入「启动第一阶段」——Web 外壳在启动 Cordis 之前,先把所有 `immediately: true` 的包的 bundle 预取并注册(`prefetchImmediateTier()`)。
- 谁读:Web 外壳启动序列(`this.manifest.plugins.filter(e => e.immediately).map(e => this.modules.prefetch(e.id))`)。
- 缺省:`false` / 缺失 → 走共享的 application 批次(按需加载)。

`immediately` 和 `inject` 是两个正交的轴:`immediately` 控制「**什么时候**把**它自己**预取」;`inject` 控制「加载**它自己**的时候,顺带预取**别人**」。本仓库的 web 插件大多写 `immediately: true`,但 `inject` 都留空。
