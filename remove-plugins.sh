#!/usr/bin/env bash
# 插件清单与 add-plugins.sh / add-plugins.ps1 / remove-plugins.ps1 各存一份,增删插件时四个文件都要改。
# 默认在 dsh 未运行时执行:先退出 dsh web,再跑本脚本,完成后重新启动 dsh web(运行中的实例不会读到 profile 的变更)。
# 只把插件从 web profile 卸下(pnpm 重算 package.json 的 dependencies 与 dsh.profile.bundles),不删除本仓库里的插件目录。
# 已卸下的插件打印"跳过(未安装)"并继续,不计失败:本脚本可以重复执行。
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
PLUGINS=(
  dsh-changes-hover-off
  dsh-desktop-notify
  dsh-directory-picker-browse
  dsh-focus-free-shortcuts
  dsh-git-guard
  dsh-header-action-order
  dsh-jobs-optimize
  dsh-skill-technical-doc-writing
  dsh-ui-css-patches
  dsh-workspace-activity-sort
  dsh-workspace-quick-switch
)

# 已挂载 = profile 的 package.json 在 dependencies 里写了这个包:挂载传的是目录,pnpm 记的键是包名。
is_installed() {
  [ -f "$MANIFEST" ] || return 1
  grep -Eq "^[[:space:]]*\"$1\"[[:space:]]*:" "$MANIFEST"
}

if [ ! -f "$MANIFEST" ]; then
  echo "未找到 profile 清单,按全部未安装处理: $MANIFEST"
fi

failed=()
for name in "${PLUGINS[@]}"; do
  # 包名以插件自己的 package.json 为准(挂载时 pnpm 读的就是它),清单项只是沿用目录名。
  package_name="$name"
  package_file="$BASE/$name/package.json"
  if [ -f "$package_file" ]; then
    declared="$(sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$package_file" | head -n 1)"
    if [ -n "$declared" ]; then
      package_name="$declared"
    else
      echo "读取包名失败,按清单项处理: $package_file"
    fi
  fi
  if ! is_installed "$package_name"; then
    echo "跳过(未安装): $package_name"
    continue
  fi
  echo "==> dsh plugin --profile $PROFILE remove $package_name"
  if ! dsh plugin --profile "$PROFILE" remove "$package_name"; then
    failed+=("$package_name")
  fi
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "失败: ${failed[*]}"
  exit 1
fi
echo "全部插件卸载完成;重新启动 dsh web 后生效。"
