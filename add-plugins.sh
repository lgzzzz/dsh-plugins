#!/usr/bin/env bash
# 自动发现仓库根下所有 dsh-* 插件目录并逐个挂进 web profile;增删插件只需增删目录,不维护名单。
# example/ 等非 dsh-* 目录不参与整仓挂载。
set -u

if [ -n "$0" ] && [ -d "$(dirname "$0")" ]; then
  BASE="$(cd "$(dirname "$0")" && pwd)"
else
  BASE="$PWD"
fi
[ -n "$BASE" ] || BASE="$PWD"

shopt -s nullglob
dirs=("$BASE"/dsh-*/)
shopt -u nullglob

if [ ${#dirs[@]} -eq 0 ]; then
  echo "未找到插件目录: $BASE/dsh-*"
  exit 1
fi

failed=()
for dir in "${dirs[@]}"; do
  dir="${dir%/}"
  name="${dir##*/}"
  if [ ! -f "$dir/package.json" ]; then
    echo "跳过(缺少 package.json): $dir"
    failed+=("$name")
    continue
  fi
  echo "==> dsh plugin --profile web add $dir"
  if ! dsh plugin --profile web add "$dir"; then
    failed+=("$name")
  fi
done

# 浏览器控制插件：dsh-browser-view 的 cordis.patch.yml 里挂着
# @deepseek-ai/dsh-browser-use 与 @deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp 两行。
# 它们是普通插件(没有 dsh.bundle)，patch 行按裸包名解析，只能由 profile 的 dependencies 提供；
# 而本脚本对插件目录用的是 link: 安装，pnpm 不安装 link: 目标的依赖，所以它们必须单独装一次。
# 版本跟随运行中的 dsh：这两个包把 cordis / dsh-agent / dsh-tools / dsh-system-prompt 等
# 钉在同版本 dsh 提供的 peer 上，版本漂移会让 patch 行解析失败(选项卡静默显示空状态)。
BROWSER_CONTROL_VERSION_FALLBACK="0.2.2-rc.1"
if [ -f "$BASE/dsh-browser-view/package.json" ]; then
  browser_control_version="$(dsh --version 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$browser_control_version" ]; then
    browser_control_version="$BROWSER_CONTROL_VERSION_FALLBACK"
    echo "未取到 dsh 版本,浏览器控制插件回退到 $browser_control_version"
  fi
  echo "==> dsh plugin --profile web add 浏览器控制插件@$browser_control_version"
  if ! dsh plugin --profile web add \
    "@deepseek-ai/dsh-browser-use@$browser_control_version" \
    "@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@$browser_control_version"; then
    failed+=("浏览器控制插件")
  fi
fi

if [ ${#failed[@]} -gt 0 ]; then
  echo "失败: ${failed[*]}"
  exit 1
fi
echo "全部插件挂载完成。"
