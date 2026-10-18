# 本文件须保存为 UTF-8 with BOM:PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI(GBK)解码,中文会乱码并吞掉行尾引号。
# 插件清单与 add-plugins.ps1 / add-plugins.sh / remove-plugins.sh 各存一份,增删插件时四个文件都要改。
# 默认在 dsh 未运行时执行:先退出 dsh web,再跑本脚本,完成后重新启动 dsh web(运行中的实例不会读到 profile 的变更)。
# 只把插件从 web profile 卸下(pnpm 重算 package.json 的 dependencies 与 dsh.profile.bundles),不删除本仓库里的插件目录。
# 已卸下的插件打印"跳过(未安装)"并继续,不计失败:本脚本可以重复执行。
$ErrorActionPreference = 'Stop'

$Base = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$ProfileName = 'web'
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$Manifest = Join-Path (Join-Path (Join-Path $DshHome 'profiles') $ProfileName) 'package.json'
$Plugins = @(
  'dsh-changes-hover-off'
  'dsh-desktop-notify'
  'dsh-directory-picker-browse'
  'dsh-git-guard'
  'dsh-header-action-order'
  'dsh-jobs-optimize'
  'dsh-keyboard-shortcuts'
  'dsh-skill-technical-doc-writing'
  'dsh-ui-css-patches'
  'dsh-workspace-activity-sort'
  'dsh-workspace-quick-switch'
)

# 已挂载 = profile 的 package.json 在 dependencies 里写了这个包:挂载传的是目录,pnpm 记的键是包名。
$installed = @{}
if (Test-Path -LiteralPath $Manifest) {
  $doc = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($doc.dependencies) {
    foreach ($dep in $doc.dependencies.PSObject.Properties) { $installed[$dep.Name] = $true }
  }
} else {
  Write-Host "未找到 profile 清单,按全部未安装处理: $Manifest"
}

$failed = @()
foreach ($name in $Plugins) {
  # 包名以插件自己的 package.json 为准(挂载时 pnpm 读的就是它),清单项只是沿用目录名。
  $packageName = $name
  $packageFile = Join-Path (Join-Path $Base $name) 'package.json'
  if (Test-Path -LiteralPath $packageFile) {
    try {
      $declared = (Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json).name
      if ($declared) { $packageName = [string]$declared }
    } catch {
      Write-Host "读取包名失败,按清单项处理: $packageFile"
    }
  }
  if (-not $installed.ContainsKey($packageName)) {
    Write-Host "跳过(未安装): $packageName"
    continue
  }
  Write-Host "==> dsh plugin --profile $ProfileName remove $packageName"
  dsh plugin --profile $ProfileName remove $packageName
  if ($LASTEXITCODE -ne 0) { $failed += $packageName }
}

if ($failed.Count -gt 0) {
  Write-Host "失败: $($failed -join ', ')"
  exit 1
}
Write-Host '全部插件卸载完成;重新启动 dsh web 后生效。'
