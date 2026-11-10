# 本文件须保存为 UTF-8 with BOM:PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI(GBK)解码,中文会乱码并吞掉行尾引号。
# 把本仓库的插件从 web profile 卸下:按 profile 的 dependencies 里指向本仓库的 link:/file: 路径识别,
# 目录已删除后遗留的条目也能清理;不维护插件名单。
# 本次卸下 dsh-browser-view 时,顺带卸掉它安装期引入的浏览器控制包(它们不在本仓库,故不被上面的规则命中)。
# 默认在 dsh 未运行时执行:先退出 dsh web,再跑本脚本,完成后重新启动 dsh web(运行中的实例不会读到 profile 的变更)。
# 只改 profile(pnpm 重算 dependencies 与 dsh.profile.bundles),不删除本仓库里的插件目录。
# 本脚本可以重复执行:没有可卸载的条目时直接结束。
$ErrorActionPreference = 'Stop'

$Base = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Base = [IO.Path]::GetFullPath($Base)
$ProfileName = 'web'
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$Manifest = Join-Path (Join-Path (Join-Path $DshHome 'profiles') $ProfileName) 'package.json'

$names = @()
if (Test-Path -LiteralPath $Manifest) {
  $doc = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $profileDir = Split-Path -Parent $Manifest
  $trimChars = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $prefix = $Base.TrimEnd($trimChars) + [IO.Path]::DirectorySeparatorChar
  if ($doc.dependencies) {
    foreach ($dep in $doc.dependencies.PSObject.Properties) {
      $value = [string]$dep.Value
      if ($value -notmatch '^(?:link|file):(.+)$') { continue }
      $relative = $Matches[1]
      $target = if ([IO.Path]::IsPathRooted($relative)) {
        [IO.Path]::GetFullPath($relative)
      } else {
        [IO.Path]::GetFullPath((Join-Path $profileDir $relative))
      }
      if ($target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
          $target.Substring($prefix.Length) -notmatch '[\\/]') {
        $names += [string]$dep.Name
      }
    }
  }
} else {
  Write-Host "未找到 profile 清单,按全部未安装处理: $Manifest"
  exit 0
}

$names = @($names | Sort-Object -Unique)
if ($names.Count -eq 0) {
  Write-Host '未找到本仓库的插件;无需卸载。'
  exit 0
}

$failed = @()
$removedBrowserView = $false
foreach ($name in $names) {
  if ($name -eq 'dsh-browser-view') { $removedBrowserView = $true }
  Write-Host "==> dsh plugin --profile $ProfileName remove $name"
  dsh plugin --profile $ProfileName remove $name
  if ($LASTEXITCODE -ne 0) { $failed += $name }
}

# 浏览器控制插件是 dsh-browser-view 的安装期副产物(见 add-plugins.ps1):它的 cordis.patch.yml 按
# 裸包名挂载这两个 registry 包,而上面按 link:/file: 识别只能命中本仓库的插件,所以必须在这里对称卸下。
# 只在本次确实卸下了 dsh-browser-view 时执行 —— 独立安装过这两个包的用户不受影响。
# 清单在上一轮 remove 里已被 pnpm 重写,所以这里重新读一次,只卸仍然装着的那几个。
$BrowserControlPackages = @(
  '@deepseek-ai/dsh-browser-use',
  '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp'
)

if ($removedBrowserView -and (Test-Path -LiteralPath $Manifest)) {
  $current = (Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json).dependencies
  foreach ($name in $BrowserControlPackages) {
    if (-not $current -or -not ($current.PSObject.Properties.Name -contains $name)) { continue }
    Write-Host "==> dsh plugin --profile $ProfileName remove $name(浏览器控制插件,dsh-browser-view 的安装期副产物)"
    dsh plugin --profile $ProfileName remove $name
    if ($LASTEXITCODE -ne 0) { $failed += $name }
  }
}

if ($failed.Count -gt 0) {
  Write-Host "失败: $($failed -join ', ')"
  exit 1
}
Write-Host '全部插件卸载完成;重新启动 dsh web 后生效。'
