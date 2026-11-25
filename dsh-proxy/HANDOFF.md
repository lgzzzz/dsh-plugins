# 交接：dsh-proxy

> 状态时间：2026-11-25。DSH `0.2.3-alpha.2`（profile `web`，`DSH_HOME=/Users/lz/.dsh`）。
> 设计文档在同目录 [DESIGN.md](DESIGN.md)；这份文件记录**实现到了哪、哪里没验证、下一步做什么**。

## 1. 这是什么

一个 DSH 插件，把「代理分流规则」做成结构化数据：模型用 `proxy_*` 工具读写、校验、仿真，
规则编译成上游 **XTLS/Xray-core** 的 `routing.rules[]`，由插件拉起 `xray` 进程执行。
数据面是上游二进制，控制面（规则模型、诊断、仿真、生命周期、回滚）全在插件里。

- 入口：`index.ts`（Host，Node 24 Type Stripping 直接加载）+ `src/client.tsx`（面板，tsdown → `lib/client.js`）
- 面板位置：侧栏「分流路由」图标 + 主面板；HTTP 走 `/proxy-api/*`
- 不下载任何二进制、不绑非回环地址、不改系统代理、不代理 DSH 自己的模型流量

## 2. 已验证 / 未验证

| 项 | 状态 | 证据 |
|---|---|---|
| `tsc --noEmit` | ✅ 通过 | `pnpm typecheck` 无输出 |
| 规则引擎单测 | ✅ 156 项断言 | `pnpm test` 的 ir / compile / explain / nodes 四个文件 |
| 客户端 bundle 构建 | ✅ 43 KB，`node --check` 通过 | `pnpm build`；无任何 `@deepseek-ai` 运行时导入 |
| Host 半部可加载 | ✅ | `node -e "import('./index.ts')"` 导出 `apply/inject/name` |
| 集成测试（替身 Context 走 `/proxy-api` 与工具） | ⚠️ 40 过 / 13 失败 | `test/host.test.mjs`，失败原因见 §6 |
| 装进 profile | ❌ 未装 | `install_bundle` 的权限升级被用户拒绝；不要绕开 |
| 真实页面 / 侧栏入口 / slot 注册 | ❌ 未验证 | 需装好后用 `cordis_inspect`（Client `Slots`）与页面确认 |
| `xray -test`、启动、端口探测、回滚 | ❌ 完全未实测 | 本机没装 xray（`brew info xray` 可装 26.11.9） |
| UX 走查（子代理评审） | ❌ 未做 | 见 `dsh-doc` 的 `references/verification.md` |

## 3. 怎么跑

```bash
cd ~/dsh-plugins
pnpm install                 # workspace 根安装；插件目录自身不落 node_modules（hoisted）
cd dsh-proxy
pnpm typecheck               # tsc --noEmit
pnpm test                    # node test/run-all.mjs
pnpm build                   # tsdown → lib/client.js（改客户端后必须重跑）
pnpm check                   # node --check lib/client.js && node --check index.ts
```

安装到当前 profile（需要用户批准）：

```text
plugin_manager action=install_bundle target=/Users/lz/dsh-plugins/dsh-proxy
```

或在 Web 的 **Plugins → Add plugin** 里指向这个目录。装完用
`curl -s -b <cookie> http://127.0.0.1:3080/proxy-api/state` 验证 Host 半部，
用 `cordis_inspect`（Client `Slots.listSubTree`，root `sidebar.panellist` / `main`）确认客户端注册。

> 沙箱提示：`~/dsh-plugins` 在会话工作区之外，任何写入都需要 `danger-full-access` 批准。
> 上一轮用户拒绝了 `plugin_manager` 的权限升级，**在拿到明确许可前不要再试安装**。

## 4. 代码地图

| 文件 | 职责 |
|---|---|
| `index.ts` | Host 装配：开存储域、注册工具 / `/proxy-api` / skill，disposer 里停内核再关域 |
| `src/ir.ts` | 规则模型：形状校验（JSON 路径诊断）、语义检查、按 id 打补丁、`matchCovers` |
| `src/compile.ts` | IR → xray `routing.rules[]`（含防环与 Apple Push 注入）、整份内核配置 |
| `src/explain.ts` | 仿真：四种结论 `match`/`no-match`/`opaque`/`missing`，`uncertain` + `certain` |
| `src/store.ts` | `ctx.storageDomain` 域 `dsh_proxy`：`global` 放规则与选中节点，表放节点与订阅 |
| `src/nodes.ts` | ss/vmess/vless/trojan 分享链接与 base64 订阅解析、outbound 生成、脱敏、TCP 延迟 |
| `src/core.ts` | 内核生命周期：`-test` → 写配置 → 启动 → 端口探测 → 崩溃记录 → 回滚 |
| `src/service.ts` | 应用逻辑：check/read/explain/write/subscription/latency/coreAction，工具与 HTTP 共用 |
| `src/http.ts` | `/proxy-api/{state,logs,check,explain,write,core,subscription,latency,select}` |
| `src/tools.ts` | 8 个 `proxy_*` 工具（手写 JSON Schema 参数；读与写分离） |
| `src/skill.ts` | `proxy-routing` 技能正文 + 参数描述复用的提示语 |
| `src/client.tsx` | 面板：状态条 + 规则 / 节点 / 模拟 / 日志四个 tab |
| `src/config.ts` / `src/log.ts` / `src/util.ts` | 配置与路径、环形日志、地址端口工具 |
| `test/*.test.mjs` | 直接用 Node Type Stripping import `.ts` 源文件 |

## 5. 已定决策（别再重新讨论，除非有反证）

1. **数据面用上游 xray**，不引 v2rayA fork、不下载二进制。
2. **规则是结构化 IR**，不是 RoutingA；诊断指向 `routing.rules[2].match.network[0]` 这类路径。
3. **同一字段的多个值是「或」，不同字段之间是「且」**；`geosite:`/`geoip:`/`ext:`/`domain:` 是 xray 的值约定，原样保留。
4. **规则整份放 storage domain 的 `global`**：顺序即语义，拆表会引入第二份真相。
5. **写入顺序**：形状 → 语义 → 落盘 → `core.apply`（内部再 `-test`）→ 失败回滚规则 + 内核。
   没有 xray 或没选节点时降级为「只保存 + 说明原因」，不阻塞。
6. **仿真必须诚实**：`geosite:` 没解析数据就报 `opaque`，缺输入报 `missing`，绝不假装命中。
7. **工具读写在时间维度分离**：`check` / `explain` 无副作用，只有 `write` 落盘。

## 6. 已知问题（按优先级）

### P0-1 集成测试 13 项失败（`test/host.test.mjs`）

两个根因：

1. **策略问题**：`checkSemantics` 把「用了 `geosite:` 但 geo 目录没有 `geosite.dat`」判为 **error**，
   于是 `valid:false`、`/write` 拒绝保存，后面读回 / 仿真 / 增量删除的断言全部连锁失败。
   要不要放宽是**产品决策**：放宽为 warning 后，写坏规则由 `xray -test` 兜底（失败即回滚）；
   保持 error 则用户必须先放好 geo 数据才能写 geosite 规则。当前实现是 error。
2. **测试期望写错**（两处）：`check()` 在形状有 error 时**短路**，不会再跑语义检查，
   所以「非法 id + 不存在出口」那次调用不会出现 `rule/exit-unknown`；
   `valid:true` 的那组 geosite 规则也会被上述策略拦住。

改法：先定 geo 策略（`src/ir.ts` 的 `checkGeoUse`），再改这两处期望。

### P0-2 内核整条链路零实测

`src/core.ts` 里的 `xray -test -config`、`xray -config`、`xray version` 参数取自官方命令文档，
但没在本机跑过。落地前：`brew install xray`（或把 `coreBinary` 指到绝对路径）→
用一份真实节点配置依次验证 `-test`、启动、`curl --socks5-hostname 127.0.0.1:10808 https://example.com`、
写坏规则后的回滚。

### P0-3 未安装、未看页面

侧栏图标 label、`main` 面板渲染、`/proxy-api` 真机可达、工具对模型可见，全部未验证。
装好后按 §3 的三步走，并用 `cordis_inspect` 查 Client `Slots` 的 `sidebar.panellist` / `main`。

### P1-1 `.gitignore`

仓库里各插件的 `lib/` 是单独列进 `.gitignore` 的（构建产物）。需要给
`~/dsh-plugins/.gitignore` 补一行 `dsh-proxy/lib/`，否则会把 bundle 提交进去。

### P1-2 面板编辑能力

现在「规则」tab 是**整份草稿 + replace 写入**：勾选启用、上下移、删除都在本地草稿里改，
`应用` 时一次性提交（`mode: "replace"`）。缺：行内编辑现有规则、应用前 diff 预览、
warning 二次确认。设计文档 §10 写的是行内编辑 + 拖拽。

### P2 其它

- 节点凭据（UUID / 密码）目前存在 storage domain 的记录里，只在输出处脱敏；
  DESIGN §9 的目标是 `ctx.credentials` 或 `$DSH_HOME/proxy/secrets.json`（0600）。
- geo `.dat` 未解析，`geosite:`/`geoip:` 的仿真只能给 `opaque`；阶段 4 才做精确判断。
- `/proxy-api/logs` 是轮询尾部，不是 SSE；面板 2 秒轮询一次。
- 订阅不会自动更新，也没有「用旧 URL 刷新」能力（URL 用完即弃，只存脱敏来源）。
- `proxy_status` 里没有内核 stderr 全文，只有最后一条错误 + 日志 tab。

## 7. 环境坑（踩过的）

- **zod 必须钉 `4.6.6`**：`@deepseek-ai/dsh-storage-domain` 依赖这个版本，4.6.7 会让
  `DomainGlobalSpec<G>` 的 `ZodType` 不兼容（曾直接报一堆 `never` 与深层实例化）。
- **存储域名必须匹配 `^[a-z][a-z0-9_]*$`**（`dsh-storage` 的 `UNIT_NAME_RE`）：所以是 `dsh_proxy`，不是 `dsh-proxy`。
- **`tsc` 需要更大堆**：`NODE_OPTIONS=--max-old-space-size=8192`。默认 2 GB 会 OOM（client + 一堆
  `@deepseek-ai/dsh-client-ui-*` 的 Context 合并）。
- **客户端服务类型靠子路径合并**：`import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'`
  （`ctx.slots`）、`.../dsh-client-locale/client`（`ctx.locale`）、
  `.../dsh-client-ui-layout/client`（`main` 槽）、`.../dsh-client-ui-sidebar/client`（`sidebar.panellist`）。
  少一个就是 `Property 'slots' does not exist on type 'Context'`。
- **`JsonSchemaNode` 不支持 `minItems`/`maxItems`**：数量上限只在 `src/ir.ts` 的代码里检查，别写回 schema。
  工具 `output.schema` 用 `{}`（annotation-only）表示自由 JSON。
- **Host 相对 import 必须带 `.ts`**，且不能用 `enum` / `namespace`（Node Type Stripping 限制）。
- 客户端 JSX 走 `react-jsx` 自动运行时，`react/jsx-runtime` 已在共享预设的外部表里。
- `pnpm` workspace 是 `hoisted`：**不要在插件目录里跑 `pnpm add`**，会造出第二份 node_modules；
  依赖加到 `dsh-proxy/package.json` 后在仓库根 `pnpm install`。

## 8. 建议的下一步顺序

1. 定 geo 策略 → 修 §6 P0-1 → `pnpm test` 全绿。
2. 申请安装（用户批准）→ 验证 `/proxy-api/state` + Client Slots + 工具列表。
3. `brew install xray` → 真机验证 `-test` / 启动 / 应用 / 回滚（这是唯一没被验证过的大块）。
4. `pnpm build` 后用 `dsh-doc` 的 UI 走查清单过一遍面板，按 `references/verification.md` 做一次子代理 UX 评审。
5. 补 `.gitignore` 的 `dsh-proxy/lib/`。
6. 有余力再做：行内编辑与 diff 预览、凭据外移、geo 解析。

## 9. 与 DESIGN.md 的偏差（以本文为准）

- DESIGN §6.5 的 `indeterminate` 字段已改为 `uncertain[]` + `certain`（四态结论）。文档未同步。
- DESIGN §5 的目录结构写的是 `index.js` / `lib/*.js`，实际是 TypeScript：`index.ts` + `src/*.ts(x)` + `lib/client.js`（构建产物）。
- DESIGN §9 说密钥走 `ctx.credentials`；当前落在 storage domain（见 §6 P2）。
- DESIGN §8 配置里的 `rulePort: 20172` 没实现：嗅探直接开在 `socks` 与 `http` 两个入站上。
- DESIGN §7.1 的工具表里没有 `proxy_latency_test` 之外的节点选择工具（面板负责选择）。

## 10. 旧副本

插件从会话工作区搬到了这里。**旧目录仍然存在**：
`/Users/lz/Documents/deepseek-harness/default-workspace/dsh-proxy-plugin/`
（与这里内容一致，但已废弃；沙箱拒绝了递归删除）。**不要在那份上改东西**。
需要清理时由用户批准后执行：

```bash
rm -rf /Users/lz/Documents/deepseek-harness/default-workspace/dsh-proxy-plugin
```
