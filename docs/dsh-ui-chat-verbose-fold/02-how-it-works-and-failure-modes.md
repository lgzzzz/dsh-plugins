# 工作原理与失败模式

> 本文件是 [dsh-ui-chat-verbose-fold 说明](../dsh-ui-chat-verbose-fold.md) 的第 2 册:补丁怎么落地,以及失败时的安全 no-op 行为。

-----

## 工作原理

1. `slots.inject('conversation.view', …)` 在槽被声明时立刻扫描一次,并用 `slots.subscribe` 在之后每次注册变化时重扫——所以无论 ui-chat 在本插件之前还是之后 `apply`,补丁都能落地。
2. ui-chat 的客户端包依赖一长串服务(`uiWorkspace` / `uiConversation` / `sidebarRight` / `configForms` …),它注册 `conversation.view` 的时刻常常比本插件看到槽声明晚好几个任务(本插件只注入 `slots`,激活得早)。所以「槽已声明、账本里却还没有 chat 注册项」在启动期是常态:插件据此启动一个有界自检窗口(每 `MISSING_PROBE_MS` = 50ms 重扫一次,共 `MISSING_PROBE_ATTEMPTS` = 20 次 ≈ 1 秒),窗口内一发现注册项就停止探测,走满窗口仍为空才判定真缺席并告警一次。
3. 扫描用 `slots.entries('conversation.view')` 找到 `options.id === 'chat'` 的注册项(`StoredEntry`),它是活的可变对象;这里改写的是 `entry.inject` 这个工厂函数。
4. ui-chat 的 `inject` 每次返回的注入面里带着同一个 `hooks.presentation` observable。包装后的 `inject` 会**原地**改写该 observable 的 `getSnapshot`:

   ```ts
   const original = source.getSnapshot.bind(source)
   source.getSnapshot = () => foldCompletedForVerbose(original())
   ```

5. ui-renderer 的 `bindSnapshotSelector` 把 hook 绑成 `() => w.getSnapshot()`(**动态读取**,不是一次性捕获),因此原地改写 `getSnapshot` 对**已经绑定**的 `usePresentation` 立即生效,不需要重挂载、不需要清缓存。渲染器的 `(entry, binding)` 注入面缓存也不妨碍这一点。

`foldCompletedForVerbose` 只在 `mode === 'verbose' && foldCompletedTurns !== true` 时返回新对象(`{ ...policy, foldCompletedTurns: true }`);其余情况**按身份透传**,所以别的模式的选择器引用稳定、不会多渲染。

## 失败模式

插件默认是「安全 no-op」,并各告警一次:

| 情况 | 行为 |
|---|---|
| 没有 `slots` 服务 / `ctx.get` 缺席 | 直接返回,不抛 |
| 槽已被声明但账本里还没有 `chat` 注册项 | 在有界窗口内继续重扫(50ms × 20 ≈ 1 秒);窗口内一发现就停止探测,走满窗口仍为空才 `console.warn` 一次(含槽名)。ui-chat 的包晚于槽声明激活是启动期的常态,所以**不能**只看第一拍 |
| 找到了注册项,但注入面没有 `hooks.presentation` | 告警一次,注入面原样返回;这种情形不再重复报「未找到」 |
| `slots.entries` 抛错 | 捕获并告警,不冒泡 |

四种失败情况的结果都是官方行为不变:Verbose 模式照旧展开已完成的轮次,页面上不出现报错。

告警前缀统一为 `[dsh-ui-chat-verbose-fold]`。

它依赖 ui-chat 的内部形状(`conversation.view` 的 id `chat`、`hooks.presentation`、字段 `mode` / `foldCompletedTurns`),这不是稳定公共契约。
