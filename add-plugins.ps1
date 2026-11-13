# 本文件须保存为 UTF-8 with BOM:PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI(GBK)解码,中文会乱码并吞掉行尾引号。
# 自动发现仓库根下所有 dsh-* 插件目录并逐个挂进 web profile;增删插件只需增删目录,不维护名单。
# example/ 等非 dsh-* 目录不参与整仓挂载。
#
# 挂载前先把客户端半部的产物补齐:profile 以 link: 指向本目录,DSH 直接读 package.json 里
# exports 写明的 lib/*.js(这些产物在 .gitignore 里)。缺产物时插件照样挂得上,只是浏览器里
# 是个空壳,启动日志里只有一行 ENOENT —— 所以在挂载前构建,失败就不挂。
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

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host '未找到 pnpm:构建与挂载插件都需要它。'
  exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '未找到 node:无法读取插件清单。'
  exit 1
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

# 判断某个目录是不是可挂载插件:只认 package.json 里的 dsh.bundle。共享工具包
# (如 dsh-shortcut-utils)没有 bundle 清单,不参与整仓挂载。
function Test-IsPlugin {
  param([string]$Dir)
  $manifest = Get-Content -LiteralPath (Join-Path $Dir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  return [bool]($manifest.dsh -and $manifest.dsh.bundle)
}

# 判断某个插件是否需要先构建:只认 package.json 里 exports 写明的 .js 产物,
# 不按 lib/ 目录硬编码。宿主半部(src/*.ts 由 Node 直接加载、没有产物)或本来就没有
# build 脚本的插件一律返回 $false,不会被误构建。
function Test-NeedsBuild {
  param([string]$Dir)
  $manifest = Get-Content -LiteralPath (Join-Path $Dir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $manifest.scripts -or -not $manifest.scripts.build) { return $false }
  if (-not $manifest.exports) { return $false }
  $targets = @()
  foreach ($export in $manifest.exports.PSObject.Properties) {
    $value = $export.Value
    if ($value -is [string]) {
      $target = $value
    } elseif ($value -and $value.PSObject.Properties.Name -contains 'default') {
      $target = [string]$value.default
    } else {
      continue
    }
    if ($target -like '*.js') { $targets += $target }
  }
  foreach ($target in $targets) {
    $relative = $target -replace '^\./', '' -replace '^\.\\', ''
    $path = Join-Path $Dir $relative
    if (-not (Test-Path -LiteralPath $path)) { return $true }
  }
  return $false
}

# 各插件共用的 tsdown / typescript 提升在仓库根 node_modules;全新 clone 后先装一次。
if (-not (Test-Path -LiteralPath (Join-Path $Base 'node_modules/.bin/tsdown') -PathType Leaf)) {
  Write-Host '==> pnpm install(补仓库根 node_modules)'
  Push-Location -LiteralPath $Base
  try {
    $installExit = Invoke-Native 'pnpm' @('install')
  } finally {
    Pop-Location
  }
  if ($installExit -ne 0) {
    Write-Host '仓库根依赖安装失败;客户端插件会缺产物,中止。'
    exit 1
  }
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
  if (-not (Test-IsPlugin -Dir $dir)) {
    Write-Host "跳过(不是插件,没有 dsh.bundle): $name"
    continue
  }
  if (Test-NeedsBuild -Dir $dir) {
    Write-Host "==> pnpm --filter $name build(补齐 lib 产物)"
    Push-Location -LiteralPath $Base
    try {
      $buildExit = Invoke-Native 'pnpm' @('--filter', $name, 'build')
    } finally {
      Pop-Location
    }
    if ($buildExit -ne 0) {
      Write-Host "构建失败,未挂载: $name"
      $failed += $name
      continue
    }
  }
  Write-Host "==> dsh plugin --profile web add $dir"
  if ((Invoke-Native 'dsh' @('plugin', '--profile', 'web', 'add', $dir)) -ne 0) { $failed += $name }
}

if ($failed.Count -gt 0) {
  Write-Host "失败: $($failed -join ', ')"
  exit 1
}
Write-Host '全部插件挂载完成;重新启动 dsh web 后生效。'
