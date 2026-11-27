# dsh-session-auto-resume

DSH 启动后自动恢复「没跑完就被打断」的会话，并追加一条续跑消息。

- 只恢复最后一轮是 `interrupted`，或 `aborted` 且原因不是 `user` 的会话；
- 用户点了停止、正常完成、报错、超长截断、被 hook 拦下的会话都不动（hook 取消可用配置排除）；
- 时间窗默认 7 天、每次启动最多恢复 10 个，可配置；
- 支持 `dryRun`：只记日志，先核对会动哪些会话。

完整口径、配置字段、边界与验证方式见 [docs/DETAIL.md](docs/DETAIL.md)。

安装（在仓库根）：

```sh
dsh plugin --profile web add ./dsh-session-auto-resume
```

改动只在下次启动时生效：插件在 DSH 启动后扫描一次会话列表。
