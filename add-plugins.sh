#!/usr/bin/env bash
# 下面的插件清单与 add-plugins.ps1 各存一份,增删插件时两个文件都要改。
set -u

if [ -n "$0" ] && [ -d "$(dirname "$0")" ]; then
  BASE="$(cd "$(dirname "$0")" && pwd)"
else
  BASE="$PWD"
fi
[ -n "$BASE" ] || BASE="$PWD"
PLUGINS=(
  dsh-changes-hover-off
  dsh-desktop-notify
  dsh-directory-picker-browse
  dsh-focus-free-shortcuts
  dsh-git-guard
  dsh-header-action-order
  dsh-ui-chat-verbose-fold
  dsh-ui-css-patches
  dsh-workspace-activity-sort
  dsh-workspace-quick-switch
)

failed=()
for name in "${PLUGINS[@]}"; do
  dir="$BASE/$name"
  if [ ! -d "$dir" ]; then
    echo "跳过(目录不存在): $dir"
    failed+=("$name")
    continue
  fi
  echo "==> dsh plugin --profile web add $dir"
  if ! dsh plugin --profile web add "$dir"; then
    failed+=("$name")
  fi
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "失败: ${failed[*]}"
  exit 1
fi
echo "全部插件挂载完成。"
