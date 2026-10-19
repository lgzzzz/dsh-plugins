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

if ($failed.Count -gt 0) {
  Write-Host "失败: $($failed -join ', ')"
  exit 1
}
Write-Host '全部插件挂载完成。'
