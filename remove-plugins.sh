#!/usr/bin/env bash
# 把本仓库的插件从 web profile 卸下:按 profile 的 dependencies 里指向本仓库的 link:/file: 路径识别,
# 目录已删除后遗留的条目也能清理;不维护插件名单。
# 本次卸下 dsh-browser-view 时,顺带卸掉它安装期引入的浏览器控制包(它们不在本仓库,故不被上面的规则命中)。
# 默认在 dsh 未运行时执行:先退出 dsh web,再跑本脚本,完成后重新启动 dsh web(运行中的实例不会读到 profile 的变更)。
# 只改 profile(pnpm 重算 dependencies 与 dsh.profile.bundles),不删除本仓库里的插件目录。
# 本脚本可以重复执行:没有可卸载的条目时直接结束。
set -u

if [ -n "$0" ] && [ -d "$(dirname "$0")" ]; then
  BASE="$(cd "$(dirname "$0")" && pwd)"
else
  BASE="$PWD"
fi
[ -n "$BASE" ] || BASE="$PWD"
PROFILE="web"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
MANIFEST="$DSH_HOME_DIR/profiles/$PROFILE/package.json"

if [ ! -f "$MANIFEST" ]; then
  echo "未找到 profile 清单,按全部未安装处理: $MANIFEST"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node,无法解析 profile 清单: $MANIFEST"
  exit 1
fi

# 每行输出一个本仓库的插件包名:依赖 spec 的 link:/file: 目标落在 BASE 下。
local_plugins="$(
  node - "$MANIFEST" "$BASE" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const [manifestPath, basePath] = process.argv.slice(2)
const profileDir = path.dirname(manifestPath)
const base = path.resolve(basePath)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const dependencies = manifest.dependencies ?? {}

for (const name of Object.keys(dependencies).sort()) {
  const spec = dependencies[name]
  if (typeof spec !== 'string') continue
  const match = /^(?:link|file):(.+)$/.exec(spec)
  if (!match) continue
  const target = path.resolve(profileDir, match[1])
  if (path.dirname(target) === base) {
    console.log(name)
  }
}
NODE
)" || {
  echo "解析 profile 清单失败: $MANIFEST"
  exit 1
}

if [ -z "$local_plugins" ]; then
  echo "未找到本仓库的插件;无需卸载。"
  exit 0
fi

failed=()
removed_browser_view=0
while IFS= read -r package_name; do
  [ -n "$package_name" ] || continue
  [ "$package_name" = "dsh-browser-view" ] && removed_browser_view=1
  echo "==> dsh plugin --profile $PROFILE remove $package_name"
  if ! dsh plugin --profile "$PROFILE" remove "$package_name"; then
    failed+=("$package_name")
  fi
done <<< "$local_plugins"

# 浏览器控制插件是 dsh-browser-view 的安装期副产物(见 add-plugins.sh):它的 cordis.patch.yml 按
# 裸包名挂载这两个 registry 包,而上面按 link:/file: 识别只能命中本仓库的插件,所以必须在这里对称卸下。
# 只在本次确实卸下了 dsh-browser-view 时执行 —— 独立安装过这两个包的用户不受影响。
# 清单在上一轮 remove 里已被 pnpm 重写,所以这里重新读一次,只卸仍然装着的那几个。
BROWSER_CONTROL_PACKAGES=(
  "@deepseek-ai/dsh-browser-use"
  "@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp"
)

if [ "$removed_browser_view" -eq 1 ] && [ -f "$MANIFEST" ]; then
  browser_control_installed="$(
    node - "$MANIFEST" "${BROWSER_CONTROL_PACKAGES[@]}" <<'NODE'
const fs = require('node:fs')

const [manifestPath, ...candidates] = process.argv.slice(2)
const dependencies = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).dependencies ?? {}
for (const name of candidates) if (Object.hasOwn(dependencies, name)) console.log(name)
NODE
  )" || browser_control_installed=""

  while IFS= read -r package_name; do
    [ -n "$package_name" ] || continue
    echo "==> dsh plugin --profile $PROFILE remove $package_name(浏览器控制插件,dsh-browser-view 的安装期副产物)"
    if ! dsh plugin --profile "$PROFILE" remove "$package_name"; then
      failed+=("$package_name")
    fi
  done <<< "$browser_control_installed"
fi

if [ ${#failed[@]} -gt 0 ]; then
  echo "失败: ${failed[*]}"
  exit 1
fi
echo "全部插件卸载完成;重新启动 dsh web 后生效。"
