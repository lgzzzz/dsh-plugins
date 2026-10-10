---
name: network-proxy-retry
description: 任何工具或 bash / PowerShell 命令报网络失败时使用——连接超时、DNS 解析失败、fetch failed、连接被重置，或 curl、wget、git、npm/pnpm、Invoke-WebRequest、Node 脚本的请求失败——先用本机代理 127.0.0.1:10809（HTTP）或 127.0.0.1:10808（SOCKS5）把这次调用重试一次，分清哪些失败其实是本机或权限问题；含可直接运行的取页脚本 scripts/proxy-fetch.mjs。
---

# 网络失败时用本机代理重试一次

## 这份技能解决什么

任何工具报网络失败时——包括你在 bash 或 PowerShell 里执行的、本身在做网络请求的命令——本技能先判断它到底是不是网络问题，是的话把**这一次**调用改成走本机代理并重试一次；仍然失败就停下，报告两次的结果，不反复碰运气。

本机实测：`web_fetch https://www.google.com` 返回 `Error: web fetch failed: TypeError: fetch failed`，同一目标经 `http://127.0.0.1:10809` 取回 200 和约 85 KB 正文；两个代理端口都在监听。本技能只解释怎么重试，不替用户改 dsh 的启动配置。

## 两个代理端点

| 端点 | 类型 | 谁能用 |
| --- | --- | --- |
| `127.0.0.1:10809` | HTTP 代理，http 与 https 目标都经 CONNECT 隧道 | 主机侧 fetch（写成 `http://`）、git、curl（http 目标）、Invoke-WebRequest、Node 自带 fetch、npm/pnpm、自带脚本 |
| `127.0.0.1:10808` | SOCKS5，域名交给代理解析 | git（`socks5h://`）、curl（http 目标）、Invoke-WebRequest、自带脚本；**不要**填进 Node 的 `HTTP_PROXY`/`HTTPS_PROXY` |

实测：`curl.exe -x http://127.0.0.1:10809 http://www.gstatic.com/generate_204` → 204，`-x socks5h://127.0.0.1:10808` → 204；`git -c http.proxy=…` 两种代理都返回同一个 HEAD；把 `-x` 与 `-c http.proxy` 的值换成 `127.0.0.1:9` 时两者都立即报连接失败，说明这些设置确实生效而不是被忽略。

## 先判断是不是网络问题

值得用代理重试的：

| 现象 | 说明 |
| --- | --- |
| `fetch failed`、`TypeError: fetch failed`、`socket hang up` | 主机侧 fetch 到不了目标（实测 web_fetch 对 `www.google.com`） |
| `ETIMEDOUT`、`ECONNRESET`、`EHOSTUNREACH`、连远端的 `ECONNREFUSED`、`EAI_AGAIN`、`ENOTFOUND`、`Could not resolve host` | 网络层失败 |
| `Connection timed out`、`Failed to connect to … port 443`、`TLS handshake timeout` | 网络层失败 |
| 来自中间层的 407、502、503、504 | 网络层失败 |

重试和代理都救不了的，直接按原样处理：

| 现象 | 说明 |
| --- | --- |
| 目标自己回的 401、403、404、422 | 这是响应，不是网络故障 |
| `SEC_E_NO_CREDENTIALS`、`The SSL connection could not be established` | 本机 schannel 取不到凭据。实测本沙箱里 `curl.exe` 与 `Invoke-WebRequest` 对**任何** https 目标都这样失败，连可达的 baidu 也一样——换自带 OpenSSL 的客户端（Node、git） |
| 权限或沙箱拒绝、参数错误、缺凭据 | 与网络无关。例如 `npm ERR! … error writing to the directory`、web_search 报没有 API key，以及 bash 起不来（见下节） |

## 在 bash / PowerShell 里重试一次

命令本身在做网络请求时（curl、wget、git、npm、pnpm、pip、Invoke-WebRequest、Node 脚本……），失败后就用同一个目标把**同一条命令**再跑一次：给这一次调用加上代理环境变量。

PowerShell，实测 `curl.exe` 认这两个变量（指向 `127.0.0.1:9` 时立刻连不上，指向 10809 时取到 204）：

```powershell
$env:HTTP_PROXY = 'http://127.0.0.1:10809'
$env:HTTPS_PROXY = 'http://127.0.0.1:10809'
<原命令>
```

只影响这个 pwsh 进程后续的命令；用完可以 `Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY` 收尾。读这两个变量的客户端直接受益（curl 就是），git 与 `Invoke-WebRequest` 不读，见下表。

bash，同一组变量的小写形式写在命令前面：

```bash
http_proxy=http://127.0.0.1:10809 https_proxy=http://127.0.0.1:10809 <原命令>
```

这一行在本机没能验证：两种 bash 都起不来（实测 `C:\WINDOWS\system32\bash.exe` 报 `E_ACCESSDENIED`，Git Bash 报 `couldn't create signal pipe, Win32 error 5`），那是沙箱对命名管道的限制，不是网络问题，也不要当成网络失败去重试。bash 在别处能跑时，变量名与语义跟 PowerShell 一致。

不认这两个变量的客户端，用它们自己的开关：

| 客户端 | 重试方式 |
| --- | --- |
| git | `git -c http.proxy=http://127.0.0.1:10809 <原命令>`，或 `-c http.proxy=socks5h://127.0.0.1:10808`。git 不认 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`（实测：把它们指向 `127.0.0.1:9` 仍取到同一 HEAD），必须显式写这个开关 |
| curl，http 目标 | 环境变量即可，或 `-x http://127.0.0.1:10809`；https 目标不要用 curl |
| Invoke-WebRequest，http 目标 | 不认 `HTTP_PROXY`（实测：指向 `127.0.0.1:9` 仍然成功），必须写 `-Proxy http://127.0.0.1:10809`；它也接受 `-Proxy socks5://127.0.0.1:10808`（实测 204）；https 目标一律失败 |
| pnpm / npm | 同一条命令前设 `$env:HTTPS_PROXY='http://127.0.0.1:10809'`。实测 pnpm 11 与 npm 9.8.1 都会真正走代理；npm 命中元数据缓存时不再联网，用干净 `--cache` 目录才测得准 |
| Node 程序（自带 fetch） | 设 `$env:HTTP_PROXY`、`$env:HTTPS_PROXY`，再加 `$env:NODE_USE_ENV_PROXY='1'`，然后新起进程。实测同一目标直接 fetch 失败、这样设后返回 200 |
| `web_fetch` / `web_search` | 不接受每次调用的代理设置：先原样重试一次；仍失败就用自带脚本经代理取回内容，再读文件 |
| 其它主机侧插件、MCP server | 同上网关：只用启动时的环境，本技能不改 |

主机侧 fetch 的代理只在 dsh 启动时解析一次，来源是启动环境或 `$DSH_HOME/.env`（只认该文件，且只接受 `http(s)://` 形式的代理 URL，SOCKS 会被拒绝并在该协议上直连；loopback 始终绕过）。要长期生效得写该文件并重启 dsh——那是用户的决定，先问，别自行改。机制详见 `dsh-http-proxy` 包的 README。

## 自带脚本 `scripts/proxy-fetch.mjs`

主机侧到不了的目标，用它经代理取回正文再读文件：

```powershell
$skill = "<本技能的基础目录>"   # 例如 <workspace>\.agents\skills\network-proxy-retry
node "$skill\scripts\proxy-fetch.mjs" https://www.google.com --out "$env:TEMP\page.html"
node "$skill\scripts\proxy-fetch.mjs" https://www.google.com --proxy socks5://127.0.0.1:10808
```

| 选项 | 默认 | 含义 |
| --- | --- | --- |
| `--proxy` | `http://127.0.0.1:10809` | `http://` 或 `socks5://`（`socks5h` 同义，域名交给代理解析） |
| `--out` | 无 | 正文写该文件；省略则写 stdout |
| `--timeout` | `30000` | 无数据等待上限（毫秒） |
| `--max-bytes` | `5000000` | 正文上限，达到即关闭连接并在 stderr 标注可能不完整 |

只发 GET，最多跟随 3 次重定向，请求带 `Accept-Encoding: identity` 以避免压缩。状态行、最终 URL、字节数写 stderr；正文写 `--out` 或 stdout。退出码：取到响应（含 4xx/5xx）为 0，代理/SOCKS5/TLS/超时失败为 1，用法错误为 2。

实测经两个代理取 `https://www.google.com` 时，TLS 1.3 会以 `ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC` 失败，脚本遇此自动用 TLS 1.2 再试一次并打印一行说明（TLS 1.2 取回 200 与约 85 KB 正文）；只有 TLS 记录层失败才降级，其它错误不降级。

## 不要做

- 同一次调用最多重试一次；两次都失败就报结果并停。
- 不把代理写进仓库配置、不提交代理设置、不改进程级或用户级环境变量（只对本次命令临时设置）。
- 不绕过真正的失败：4xx、权限拒绝、缺凭据、bash 起不来，都按原样报告。
- 不把 SOCKS 地址填进 Node 的 `HTTP_PROXY`/`HTTPS_PROXY`。实测这样加 `NODE_USE_ENV_PROXY=1` 会让 node 在启动时以 `Invalid URL protocol` 退出，连程序都跑不起来。
- 不用 `curl.exe` 或 `Invoke-WebRequest` 做 https。
- 不把带凭据的 URL、cookie 或请求头交给代理；代理只用来重试同一个目标。
- 不改 `$DSH_HOME/.env`、不重启 dsh，除非用户明确同意。

## 边界

- 结论都在本机 Windows 沙箱、`workspace-write` 模式下实测；https 需要自带 OpenSSL 的客户端（Node、git），系统 schannel 客户端在此沙箱内一律失败；bash 在此沙箱内无法启动。
- 代理不可达时客户端会直接报连接失败，那不是目标故障，也不要改用它去「验证」网络。
- 主机侧工具（`web_fetch`、`web_search`）的代理只在 dsh 启动时解析，本技能无法给已经运行的进程加代理。
- 目标返回的 4xx/5xx 会被原样取回并以退出码 0 结束，需要照常判断。
- 报告时说明用了哪个代理、两次各得到什么，别只说「失败了」。
