# =============================================================
#  install.ps1 —— dsh-plugins Windows 安装脚本（PowerShell）
#
#  本仓库不再作为「一个插件」整体安装（不再有根 cordis.patch.yml /
#  meta bundle）；本脚本把仓库内每个插件目录逐个以 link: 依赖装入
#  DSH Profile，每个插件经自身的 cordis.patch.yml 独立挂载。
#  类 Unix（macOS / Linux / WSL）请运行同目录的 install.sh。
#
#  用法:
#    powershell -ExecutionPolicy Bypass -File .\install.ps1
#        默认把 6 个默认插件安装到 web Profile；结束后重启 App 生效。
#    .\install.ps1 -WithChangeSummary
#        额外安装 dsh-change-summary（需先在插件目录构建，见下）
#    .\install.ps1 -Help
#
#  参数 / 环境变量:
#    -ProfileName <名称>          装入指定 Profile（默认 web）
#    DSH_PROFILE=<名称>           同上（环境变量方式）
#    DSH_INSTALL_CHANGE_SUMMARY=1 等价于 -WithChangeSummary
#
#  本脚本可重复执行：link: 依赖已存在时为幂等 no-op，且 link: 实时指向
#  本仓库，之后修改插件代码无需重跑（浏览器半部改动需重新 build，宿主
#  改动需重启 App）。若 Profile 仍装着旧的仓库根集合依赖 dsh-plugins，
#  脚本会先卸载它，避免与逐插件安装的挂载行 id 重复。
#
#  注意：安装属于用户操作（见 AGENTS.md 强制规范第 1 条），脚本只写
#  Profile；结束后须重启 App，因为 bundle 层常驻挂载不支持热重载。
#
#  编码说明：本文件为 UTF-8（带 BOM），以保证 Windows PowerShell 5.1
#  也能正确解析其中的中文注释与提示。
# =============================================================

[CmdletBinding()]
param(
    [string]$ProfileName = '',
    [switch]$WithChangeSummary,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

# 让控制台按 UTF-8 输出，保证中文提示正常显示（在旧版控制台 / 重定向下也尽量可用）
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Show-Usage {
    Write-Host @'
dsh-plugins 安装脚本（Windows / PowerShell）
用法:
  powershell -ExecutionPolicy Bypass -File .\install.ps1
  .\install.ps1 -WithChangeSummary      额外安装 dsh-change-summary（需先构建）
  .\install.ps1 -Help                   显示本帮助
参数 / 环境变量:
  -ProfileName <名称>                       装入指定 Profile（默认 web）
  DSH_PROFILE=<名称>                        同上（环境变量方式）
  DSH_INSTALL_CHANGE_SUMMARY=1              等价于 -WithChangeSummary
'@
}

function Invoke-Dsh {
    # 透传参数调用 dsh（dsh.cmd / dsh.exe，见前置检查），失败即抛出
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & $script:DshCommand @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "dsh 命令执行失败（退出码 $LASTEXITCODE）：dsh $($Arguments -join ' ')"
    }
}

if ($Help) {
    Show-Usage
    exit 0
}

$script:Root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ProfileName)) {
    if ($env:DSH_PROFILE) { $ProfileName = $env:DSH_PROFILE } else { $ProfileName = 'web' }
}
$installChangeSummary = $WithChangeSummary -or ($env:DSH_INSTALL_CHANGE_SUMMARY -eq '1')

# 默认安装的插件（与 install.sh 中的列表保持一致；新增 / 移除插件须同步两处）
$defaultPlugins = @(
    'dsh-text-editor'
    'dsh-code-card-fonts'
    'dsh-git-guard'
    'dsh-fullwidth-chat'
    'dsh-new-session'
    'dsh-directory-picker-browse'
)

Write-Host "==> 仓库根: $script:Root"
Write-Host "==> 目标 Profile: $ProfileName"

# ---- 前置检查 ------------------------------------------------------------
# 注意：npm 全局安装的 dsh 会同时生成 dsh.ps1 与 dsh.cmd 两个 shim。这里
# 显式调用 dsh.cmd / dsh.exe，而不是裸写 dsh —— 裸 dsh 会被 PowerShell
# 解析为 dsh.ps1，而该 shim 以 exit 结尾，会把本安装脚本所在进程一并退出。
$script:DshCommand = $null
foreach ($name in @('dsh.cmd', 'dsh.exe')) {
    $found = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $script:DshCommand = $found.Source; break }
}
if (-not $script:DshCommand) {
    Write-Host '错误: 未找到 dsh.cmd / dsh.exe。请先安装 @deepseek-ai/dsh（npm i -g @deepseek-ai/dsh）并确保其在 PATH。' -ForegroundColor Red
    exit 1
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host '错误: 未找到 pnpm 命令（dsh plugin 依赖 pnpm 管理 Profile）。请先安装 pnpm 并确保其在 PATH。' -ForegroundColor Red
    exit 1
}
foreach ($dir in $defaultPlugins) {
    if (-not (Test-Path -LiteralPath (Join-Path $script:Root "$dir\package.json"))) {
        Write-Host "错误: 缺少插件目录或 package.json: $(Join-Path $script:Root $dir)" -ForegroundColor Red
        exit 1
    }
}

# ---- 迁移：卸载旧的仓库根集合依赖（若存在）-------------------------------
$manifest = Join-Path $HOME ".dsh\profiles\$ProfileName\package.json"
if (Test-Path -LiteralPath $manifest) {
    $manifestText = Get-Content -LiteralPath $manifest -Raw
    if ($manifestText -match '"dsh-plugins"') {
        Write-Host '==> 检测到旧的仓库根集合依赖 dsh-plugins，先卸载（避免挂载行 id 重复）'
        Invoke-Dsh plugin --profile $ProfileName remove dsh-plugins
    }
}

# ---- 逐个安装默认插件 ----------------------------------------------------
$total = $defaultPlugins.Count
for ($i = 0; $i -lt $total; $i++) {
    $dir = $defaultPlugins[$i]
    $link = 'link:' + (Join-Path $script:Root $dir).Replace('\', '/')
    Write-Host ("==> [{0}/{1}] 安装 {2} ..." -f ($i + 1), $total, $dir)
    Invoke-Dsh plugin --profile $ProfileName add $link
}

# ---- 可选插件：dsh-change-summary ----------------------------------------
if ($installChangeSummary) {
    foreach ($rel in @('lib\index.js', 'lib\client.js')) {
        $entry = Join-Path $script:Root "dsh-change-summary\$rel"
        if (-not (Test-Path -LiteralPath $entry)) {
            Write-Host "错误: dsh-change-summary 缺少构建产物 $rel。" -ForegroundColor Red
            Write-Host '请先在 dsh-change-summary 目录执行:' -ForegroundColor Red
            Write-Host '   npm install' -ForegroundColor Red
            Write-Host '   npm run build' -ForegroundColor Red
            Write-Host '然后重跑本脚本。' -ForegroundColor Red
            exit 1
        }
    }
    Write-Host '==> 安装 dsh-change-summary ...'
    $link = 'link:' + (Join-Path $script:Root 'dsh-change-summary').Replace('\', '/')
    Invoke-Dsh plugin --profile $ProfileName add $link
}

# ---- 汇总 ------------------------------------------------------------------
Write-Host ''
Write-Host '完成。已安装的插件:'
foreach ($dir in $defaultPlugins) { Write-Host "  - $dir" }
if ($installChangeSummary) { Write-Host '  - dsh-change-summary' }
Write-Host ''
Write-Host '请重启 App（dsh web）使常驻挂载生效。'
Write-Host 'link: 依赖实时指向本仓库：之后修改插件代码无需重跑本脚本，'
Write-Host '浏览器半部改动请在对应插件目录执行其 build 脚本，宿主半部改动直接重启 App。'
exit 0
