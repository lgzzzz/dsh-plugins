# 注意: 本文件必须保存为 UTF-8 with BOM。
# Windows PowerShell 5.1 对无 BOM 的 .ps1 会按 ANSI 代码页(GBK)解码,中文会变成乱码并吞掉行尾引号,导致 ParserError。
$ErrorActionPreference = 'Stop'

$Base = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Plugins = @(
  'dsh-desktop-notify'
  'dsh-directory-picker-browse'
  'dsh-focus-free-shortcuts'
  'dsh-git-guard'
  'dsh-header-action-order'
  'dsh-ui-chat-verbose-fold'
  'dsh-ui-css-patches'
  'dsh-workspace-activity-sort'
  'dsh-workspace-auto-sort'
)

$failed = @()
foreach ($name in $Plugins) {
  $dir = Join-Path $Base $name
  if (-not (Test-Path -LiteralPath $dir)) {
    Write-Host "跳过(目录不存在): $dir"
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
