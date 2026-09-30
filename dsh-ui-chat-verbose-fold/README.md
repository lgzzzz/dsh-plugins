# dsh-ui-chat-verbose-fold

不 fork 官方 `@deepseek-ai/dsh-client-ui-chat`，在运行时把 **Verbose 工作详情模式**改成"折叠已完成轮次"。

## 它解决的问题

需要的行为差异只有官方 `src/client/presentation-policy.ts` 里的一行（`POLICIES.verbose.foldCompletedTurns`，官方 `false`）。

那一行无法用配置覆盖，原因是它不在任何扩展面上：

| 可能的扩展面 | 现状 |
|---|---|
| Cordis 服务 | `ui-chat` 不提供策略服务；`POLICIES` 是模块私有 `const` |
| `transcriptView` 配置 | 只表达模式枚举（compact/standard/detailed/verbose），不含每个模式的策略表 |
| slot | 策略不是 slot，而是 `conversation.view#chat` 注册项**注入面**里的 `hooks.presentation` |

本插件不碰源码、不 disable/改名官方包，而是复用 slot 机制给出的**活对象**，把那一行在运行时补上。

## 工作原理

1. `slots.inject('conversation.view', …)` 在槽被声明时立刻扫描一次，并用 `slots.subscribe` 在之后每次注册变化时重扫——所以无论 ui-chat 在本插件之前还是之后 `apply`，补丁都能落地。
2. 扫描用 `slots.entries('conversation.view')` 找到 `options.id === 'chat'` 的注册项（`StoredEntry`），它是活的可变对象（同 `dsh-header-action-order` 改 `options.order` 的做法），只是这里改写的是 `entry.inject` 这个工厂函数。
3. ui-chat 的 `inject` 每次返回的注入面里带着同一个 `hooks.presentation` observable。包装后的 `inject` 会**原地**改写该 observable 的 `getSnapshot`：

   ```ts
   const original = source.getSnapshot.bind(source)
   source.getSnapshot = () => foldCompletedForVerbose(original())
   ```

4. 关键点：ui-renderer 的 `bindSnapshotSelector` 把 hook 绑成 `() => w.getSnapshot()`（**动态读取**，不是一次性捕获）。因此原地改写 `getSnapshot` 对**已经绑定**的 `usePresentation` 立即生效，不需要重挂载、不需要清缓存。渲染器的 `(entry, binding)` 注入面缓存也不会妨碍这一点。

`foldCompletedForVerbose` 只在 `mode === 'verbose' && foldCompletedTurns !== true` 时返回新对象（`{ ...policy, foldCompletedTurns: true }`）；其余情况**按身份透传**，所以别的模式的选择器引用稳定、不会多渲染。

## 失败模式

插件默认是"安全 no-op"，并各告警一次：

| 情况 | 行为 |
|---|---|
| 没有 `slots` 服务 / `ctx.get` 缺席 | 直接返回，不抛 |
| 槽已被声明但找不到 `chat` 注册项 | 延后一拍自检，仍为空则 `console.warn` 一次（含槽名） |
| 找到了注册项，但注入面没有 `hooks.presentation` | 告警一次，注入面原样返回（ui-chat 形状可能已变） |
| `slots.entries` 抛错 | 捕获并告警，不冒泡 |

告警前缀统一为 `[dsh-ui-chat-verbose-fold]`。

> 注意：它依赖 ui-chat 的内部形状（`conversation.view` 的 id `chat`、`hooks.presentation`、字段 `mode` / `foldCompletedTurns`），这不是稳定公共契约。这类脆弱性与本仓库既有的 CSS 选择器补丁、header 排序补丁同级。

## 构建与测试

```bash
cd dsh-ui-chat-verbose-fold
../node_modules/.bin/tsdown          # 或 pnpm build
node test-fold.mjs                   # 或 pnpm test
../node_modules/.bin/tsc --noEmit    # 或 pnpm typecheck
```

`test-fold.mjs` 覆盖：策略投影（含身份透传）、注入面形状判定、注册项定位、原地包装生效、幂等、晚到注册、目标缺席自检、形状变化告警、服务缺席/抛错 no-op，以及 `lib/client.js` 产物的模块 id/插件名/`inject` 声明与端到端装配。

## 启用

本插件对官方 `ui-chat` 的 `conversation.view` id `chat` 注册项生效，装上即生效：

```bash
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-ui-chat-verbose-fold
```

之后重启 / 刷新 GUI 验证：Verbose 模式下已完成的轮次应折叠。

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件。
