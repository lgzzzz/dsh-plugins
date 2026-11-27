# 会话自动恢复

DSH 启动后，把「没跑完就被打断」的会话恢复过来并自动续跑。

## 它做什么

每次 DSH 启动后（默认等 3 秒让 profile 组合稳定），插件做四件事：

1. 读取会话列表，但**不激活任何会话**，按最近活动时间窗、归档、subagent、正在运行、已有 live Agent 过滤出候选；
2. 逐个读会话日志，只看**最后一轮**的 `turn/end.reason`；
3. 对符合口径的会话调用会话控制器恢复它的 Agent（与在 GUI 里打开该会话走同一条路径：按该会话自己的 agent preset 组合、按需补观察者）；
4. 追加一条续跑消息，并等待 `sessions.flush()` 确认已写盘。

恢复后的续跑消息走的是普通用户消息的准入路径，所以在会话记录里就是一条 `user` 消息，内容以「（DSH 自动恢复：…）」开头，一眼能看出是插件写的。

## 判定口径

| 最后一轮结局 | 是否恢复 | 原因 |
| --- | --- | --- |
| `interrupted` | 是 | 进程崩溃 / 被杀，轮次由读方事后补上 `interrupted` |
| 未闭合（有 `turn/start` 没有 `turn/end`） | 是 | 原始日志尾部就是“没跑完”；正常冷读会先配平成 `interrupted`，这里再兜一层 |
| `aborted` + `disposed` | 是 | DSH 退出时把正在跑的 Agent 销毁了 |
| `aborted` + `parent` | 是 | 被父 Agent 取消（顶层会话里少见） |
| `aborted` + `hook` | 默认是 | 被 hook 主动取消；这类取消可能每次都重演，可在配置里关掉 |
| `aborted` + `user` | 否 | 用户点了停止，按需求不自动启动 |
| `aborted` + `legacy` | 否 | 旧格式记录里没保存取消原因，无法证明不是用户停的 |
| `completed` | 否 | 正常结束 |
| `error` | 否 | 已经报错退出，重试可能再次失败；本插件不自动重跑 |
| `max-tokens` | 否 | 被输出上限截断，不是「没跑完就被打断」 |
| `blocked` | 否 | 被 `agent/pre-step` 拦下，没有进入步骤 |
| `forked` | 否 | 只出现在 fork 出来的种子历史里，与退出无关 |

判定逻辑集中在 `src/decide.ts`，不依赖 DSH 运行时，可以直接用假日志单测。

## 其他过滤条件

- **时间窗**：只看最近 `windowDays` 天（默认 7）内有活动（最后一条人类消息；缺失时回落到创建时间）的会话。
- **数量**：每次启动最多恢复 `maxResumes` 个（默认 10），按最近活动倒序；最多读 `scanLimit` 个候选日志（默认 300）。
- **跳过**：已归档的会话、subagent 子会话、`blank`（一轮都没有）的会话、没有记录 `cwd` 的会话、当前已有 live Agent 或正在运行的会话。
- **竞态**：从列表到真正恢复之间会话可能已被别人打开；恢复前后各检查一次 live Agent / 状态，已是非 idle 就跳过。

## 配置

改 profile 的 `cordis.patch.yml` 里这一行的 `config`（匹配 id 时整份替换，记得把要保留的字段一起写上）：

```yaml
- id: dsh-session-auto-resume
  config:
    windowDays: 7
    maxResumes: 10
    scanLimit: 300
    startupDelayMs: 3000
    includeHookCancelled: true
    dryRun: false
    continuationMessage: '（DSH 自动恢复：{reason}）上一轮没有正常结束。请先检查当前状态和工具结果，再从中断处继续未完成的工作；不要重复已经完成的步骤。'
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `windowDays` | `7` | 只处理最近这么多天内有活动的会话；`0` 表示不限时间 |
| `maxResumes` | `10` | 每次启动最多恢复几个；`0` 等于停用 |
| `scanLimit` | `300` | 每次启动最多读多少个候选的日志 |
| `startupDelayMs` | `3000` | 启动后等多久再扫描，让 profile 组合先稳定 |
| `includeHookCancelled` | `true` | hook 主动取消的轮次是否也恢复 |
| `dryRun` | `false` | 只记日志不恢复，用来先核对会动哪些会话 |
| `continuationMessage` | 见上 | 续跑文案；`{reason}` 替换成 `interrupted`、`aborted:disposed` 等标签 |

先核对会动哪些会话：把 `dryRun` 设为 `true` 重启一次，日志里会出现每个「会恢复」的会话 id 与原因，以及最后的汇总行 `扫描 N/M 个候选会话，恢复 X 个，跳过 Y 个（dry-run，未真正恢复）`。

## 已知边界

- **会消耗 token**：恢复不是免费的，最多一次启动恢复 `maxResumes` 个会话，每个都会真的跑模型。
- **审批可能不可用**：恢复的轮次如果在无人看管时用到需要审批的工具，审批请求没有应答者，会按规定 fail-closed 结算为 `unavailable`，模型看到的是工具失败。想让它顺利跑完，需要把审批策略调到自动，或在恢复后尽快打开页面。
- **hook 取消会重演**：hook 取消是属主的主动决定，恢复后同一 hook 可能再次取消；介意就把 `includeHookCancelled` 关掉。
- **不处理未领取的排队消息**：用户在退出前发出、但还没有被任何轮次领取的消息（只存在于 inbox 里）不会单独触发恢复；如果最后一轮本身符合口径，恢复后的续跑消息会唤醒驱动器，排在前面的旧消息会先被领取。
- **HMR 会重跑一次**：插件热重载会让启动扫描再跑一遍；已经恢复、正在跑的会话因为已有 live Agent 会被跳过，正常完成的也不会再动。
- **只支持 Web profile**：恢复依赖 `sessionController`，这个服务只在 Web profile 里提供；其他 profile 里这一行会停在等待依赖的状态。
- **多进程不协调**：同一份 DSH home 同时跑两个进程时，会话写所有权由持久化层仲裁，抢不到写句柄的恢复会以 `writer-held` 失败并跳过。
- **没有 principal 隔离**：会话记录里没有调用方身份，插件在 Host 侧看到的是整份会话语料；公共部署上装它，会把其他用户没跑完的会话也续跑。它适合本机 / 单用户的 Web profile。
- **默认续跑文案是中文**：`continuationMessage` 可配置，换成英文或带上项目自己的约定都行。

## 验证

- `node --check index.ts && node --check src/decide.ts`：语法。
- `pnpm typecheck`：类型。
- `node test/run-all.mjs`：纯判定与假宿主集成测试（覆盖所有结局、过滤条件、上限、dry-run、恢复失败继续往下走）。
- 真正生效需要重启一次 DSH；本插件只在启动时扫描。
