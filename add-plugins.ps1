# 本文件须保存为 UTF-8 with BOM:PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI(GBK)解码,中文会乱码并吞掉行尾引号。
# 自动发现仓库根下所有 dsh-* 插件目录并逐个挂进 web profile;增删插件只需增删目录,不维护名单。
# example/ 等非 dsh-* 目录不参与整仓挂载。
$ErrorActionPreference = 'Stop'

$Base = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Plugins = @(
  Get-ChildItem -LiteralPath $Base -Directory |
    Where-Object { $_.Name -like 'dsh-*' } |
    Sort-Object Name
)
if ($Plugins.Count -eq 0) {
  Write-Host "未找到插件目录: $(Join-Path $Base 'dsh-*')"
  exit 1
}

$failed = @()
foreach ($plugin in $Plugins) {
  $name = $plugin.Name
  $dir = $plugin.FullName
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) {
    Write-Host "跳过(缺少 package.json): $dir"
    $failed += $name
    continue
  }
  Write-Host "==> dsh plugin --profile web add $dir"
  dsh plugin --profile web add $dir
  if ($LASTEXITCODE -ne 0) { $failed += $name }
}

# 浏览器控制插件：dsh-browser-view 的 cordis.patch.yml 里挂着
# @deepseek-ai/dsh-browser-use 与 @deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp 两行。
# 它们是普通插件(没有 dsh.bundle)，patch 行按裸包名解析，只能由 profile 的 dependencies 提供；
# 而本脚本对插件目录用的是 link: 安装，pnpm 不安装 link: 目标的依赖，所以它们必须单独装一次。
# 版本跟随运行中的 dsh：这两个包把 cordis / dsh-agent / dsh-tools / dsh-system-prompt 等
# 钉在同版本 dsh 提供的 peer 上，版本漂移会让 patch 行解析失败(选项卡静默显示空状态)。
$BrowserControlVersionFallback = '0.2.2-rc.1'
if (Test-Path -LiteralPath (Join-Path $Base 'dsh-browser-view/package.json')) {
  $browserControlVersion = (dsh --version 2>$null | Select-Object -First 1)
  if ($browserControlVersion) { $browserControlVersion = $browserControlVersion.Trim() }
  if (-not $browserControlVersion) {
    $browserControlVersion = $BrowserControlVersionFallback
    Write-Host "未取到 dsh 版本,浏览器控制插件回退到 $browserControlVersion"
  }
  Write-Host "==> dsh plugin --profile web add 浏览器控制插件@$browserControlVersion"
  dsh plugin --profile web add `
    "@deepseek-ai/dsh-browser-use@$browserControlVersion" `
    "@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@$browserControlVersion"
  if ($LASTEXITCODE -ne 0) { $failed += '浏览器控制插件' }
}

if ($failed.Count -gt 0) {
  Write-Host "失败: $($failed -join ', ')"
  exit 1
}
Write-Host '全部插件挂载完成。'
