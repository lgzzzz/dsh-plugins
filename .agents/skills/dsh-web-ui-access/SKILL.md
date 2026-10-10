---
name: dsh-web-ui-access
description: 需要访问本机正在运行的 dsh web UI（默认 http://127.0.0.1:3080，取自 DSH_WEB_URL）时使用——`GET /` 或 `/api` 返回 401、提示 `dsh web authentication required`，或要用脚本、curl、Invoke-WebRequest 请求该地址。技能给出浏览器会话 cookie 的签名密钥在 `$DSH_HOME/.credentials.yaml` 中的位置、cookie 名与值的算法，以及自带脚本 `scripts/dsh-web-cookie.mjs` 的生成与请求命令；不覆盖浏览器交互和 HTTPS 监听。
---

# 带 cookie 访问 dsh web UI

## 这份技能解决什么

dsh web 的 HTTP 监听要求浏览器会话认证：`GET /` 或 `/api` 通道缺少有效 cookie 时返回 401 和一行 `dsh web authentication required; reopen the URL printed by dsh web.`。可长期复用的不是 cookie 本身，而是它的签名密钥——密钥存在 `$DSH_HOME/.credentials.yaml`。把密钥读出来，按固定算法生成 cookie，就能访问同一个 dsh home 下的这个监听。

读完能做到：从本机 dsh home 取出密钥、生成当前有效的 cookie、用它请求索引页或 `/api`，并在拿到 401/403 时判断原因。

本文的命令都在本机（Windows、`http://127.0.0.1:3080`）实测过：**不带 cookie 请求 → 401；带上按本文算法生成的 cookie 请求 → 200**（`GET /` 返回 index.html，`POST /api/skills/list` 返回 200）。

## 密钥在哪里

- 文件：`$DSH_HOME/.credentials.yaml`（`DSH_HOME` 环境变量，本机为 `C:\Users\LGZ\.dsh`）。注意不是 `$DSH_PROFILE_DIR`。
- 位置：`records` → `client-connection/browser-session` → `payload` → `secret`。
- `secret` 是 32 字节的 base64url。dsh web 首次启动时生成它，之后长期复用：同一个 dsh home 的监听共用同一个密钥，重启进程不改变它。

文件形如：

```yaml
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: <32 字节 base64url>
```

这个密钥只用于生成本机请求的 cookie。不要修改、拷贝或把它写进日志和回复。

## cookie 怎么算

以请求实际使用的 Host 作为 authority（HTTP 不带协议），默认是 `127.0.0.1:3080`，也就是 `DSH_WEB_URL` 的 host 部分：

```
name  = "dsh-auth-" + base64url(sha256(authority))
body  = base64url(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }))
value = "v1." + body + "." + base64url(HMAC-SHA256(secret, body))
请求头 = "Cookie: name=value"
```

监听端的校验约束：

- `issuedAt ≤ 现在 < expiresAt`，且 `expiresAt - issuedAt` 不超过配置的 `cookieMaxAgeDays`。取 1 小时最稳。
- `authority` 必须与实际发出的 Host 逐字符相同：`127.0.0.1:3080` 和 `localhost:3080` 得到不同的 cookie 名与签名，互相不认（实测：用 `127.0.0.1` 生成的 cookie 请求 `http://localhost:3080/` → 401）。
- cookie 名与 authority 绑定，换端口或换主机名必须重新生成。

## 生成 cookie

技能自带脚本 `scripts/dsh-web-cookie.mjs`（Node，无依赖）。它读 `DSH_HOME` 与 `DSH_WEB_URL`，只输出 cookie，不打印密钥。相对路径按本技能的基础目录解析：

```powershell
$skill = "<本技能的基础目录>"   # 技能目录，例如 <workspace>\.agents\skills\dsh-web-ui-access
node "$skill\scripts\dsh-web-cookie.mjs"            # name=value（默认）
node "$skill\scripts\dsh-web-cookie.mjs" --header   # Cookie: name=value
node "$skill\scripts\dsh-web-cookie.mjs" --json     # {name,value,authority,issuedAt,expiresAt}
node "$skill\scripts\dsh-web-cookie.mjs" --name     # 只要 cookie 名
```

其他选项：`--url <webUrl>` 覆盖监听地址，`--home <path>` 覆盖 dsh home，`--hours <n>` 覆盖有效期（默认 1）。

脚本在任何一步失败时以非零码退出并在 stderr 说明原因，例如密钥记录不存在、secret 不是 32 字节、凭据文件读不到。

## 带着 cookie 请求

PowerShell（实测 200）：

```powershell
$cookie = node "$skill\scripts\dsh-web-cookie.mjs"
(Invoke-WebRequest -Uri $env:DSH_WEB_URL -Headers @{ Cookie = $cookie } -SkipHttpErrorCheck).StatusCode
```

curl：

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -H "Cookie: $cookie" $env:DSH_WEB_URL
```

`web_fetch` 不能自定义请求头，所以这类请求要用 pwsh 发。

## 校验与排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 401 | cookie 的 authority 与实际 Host 不一致（例如按 `localhost` 生成、却请求 `127.0.0.1`） | 按实际请求的 authority 重新生成 |
| 401 | cookie 已过期 | 重新生成 |
| 401 | 用了另一个 dsh home 的 secret | 用 `--home` 指向正确的 dsh home |
| 403 | 请求的 Host 或 Origin 不在监听端的信任列表内 | 直接请求本机监听地址，不要用外部域名或伪造 Origin |
| 脚本报没有 `browser-session` 记录 | 这个 dsh home 从未以带浏览器鉴权的方式启动过 web | 启动一次 `dsh web`，它会创建该记录 |
| 脚本报 secret 不是 32 字节 | 凭据文件被改动过 | 删除该记录后启动一次 `dsh web` 重新生成；不要手改 |
| 读不到 `$DSH_HOME/.credentials.yaml` | 文件沙箱不允许读工作区之外的路径 | 向用户申请读取该路径的权限 |

`dsh web` 打印的启动 URL 里带有 `?token=`，`GET /?token=…` 也能换到 cookie（303 加 `Set-Cookie`）。但那个 token 由每个进程随机生成、只存在进程内存里、不落盘，进程重启即失效，所以脚本不依赖它，而是按密钥生成。

## 边界

- 只覆盖 HTTP 监听；HTTPS 监听签发的 cookie 带 `Secure` 属性，本地明文请求不适用。
- cookie 等价于该监听的浏览器会话凭证，只在本机请求里使用，不要写入文件、提交或贴进回复。
