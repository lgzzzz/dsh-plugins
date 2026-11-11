# 本文件须保存为 UTF-8 with BOM:PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI(GBK)解码,中文会乱码并吞掉行尾引号。
# 把本仓库的插件从 web profile 卸下:按 profile 的 dependencies 里指向本仓库的 link:/file: 路径识别,
# 目录已删除后遗留的条目也能清理;不维护插件名单。
# 默认在 dsh 未运行时执行:先退出 dsh web,再跑本脚本,完成后重新启动 dsh web(运行中的实例不会读到 profile 的变更)。
# 只改 profile(pnpm 重算 dependencies 与 dsh.profile.bundles),不删除本仓库里的插件目录。
# 也不碰 .gitignore 里的 lib/ 构建产物:卸下不会让产物失效,再挂回去不必重新构建。
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

# pnpm / dsh 会把进度与警告写到 stderr。PS 5.1 在 $ErrorActionPreference = 'Stop' 下会把原生命令的
# stderr 当成终止错误抛出,所以原生调用统一走这里:临时放开 ErrorActionPreference,只按退出码判断。
function Invoke-Native {
  param([string]$Program, [string[]]$Arguments)
  $previous = $ErrorActionPreference
  $code = 1
  $ErrorActionPreference = 'Continue'
  try {
    & $Program @Arguments
    # 原生命令在哪个作用域跑,$LASTEXITCODE 就更新在哪个作用域;这里与 & 同一层,读到的才是本次的。
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return $code
}

# 运行中的实例会在它自己的配置刷新里读写 profile,再叠上本脚本的写入就是两个写者;
# 实际症状是 pnpm 报 EACCES: permission denied, open '.../package.json.lock'。
# 这里只提示、不阻断:同一台机器上可能有别的 profile 或别的 dsh home 在跑。
#
# 判定按 argv 词元而不是整个命令行子串 —— 后者会把「命令行里恰好带着这些字样的 shell」
# 也算成运行中的实例(比如包着本脚本的那层 powershell)。只认 `node <...\dsh> web` 与
# `node <...\dsh> --profile <name> web` 两种形态。
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $argv = @($_.CommandLine -split '\s+' | Where-Object { $_ -ne '' })
    if ($argv.Count -lt 3) { return $false }
    if ([IO.Path]::GetFileName($argv[1]) -notmatch '^dsh(\.js)?$') { return $false }
    $rest = @($argv[2..($argv.Count - 1)])
    return $rest[0] -eq 'web' -or ($rest[0] -eq '--profile' -and $rest.Count -ge 3 -and $rest[2] -eq 'web')
  } |
  ForEach-Object { $_.ProcessId })
if ($running.Count -gt 0) {
  Write-Host "警告: 检测到 dsh web 正在运行(pid $($running -join ', '))。"
  Write-Host '      先退出它再跑本脚本,否则写入 profile 可能失败(EACCES ... package.json.lock)。'
}

$failed = @()
foreach ($name in $names) {
  Write-Host "==> dsh plugin --profile $ProfileName remove $name"
  if ((Invoke-Native 'dsh' @('plugin', '--profile', $ProfileName, 'remove', $name)) -ne 0) { $failed += $name }
}

if ($failed.Count -gt 0) {
  Write-Host "失败: $($failed -join ', ')"
  exit 1
}
Write-Host '全部插件卸载完成;重新启动 dsh web 后生效。'
