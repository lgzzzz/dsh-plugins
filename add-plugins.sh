#!/usr/bin/env bash
set -u

if [ -n "$0" ] && [ -d "$(dirname "$0")" ]; then
  BASE="$(cd "$(dirname "$0")" && pwd)"
else
  BASE="$PWD"
fi
[ -n "$BASE" ] || BASE="$PWD"
PLUGINS=(
  dsh-desktop-notify
  dsh-directory-picker-browse
  dsh-git-guard
  dsh-header-action-order
  dsh-ui-css-patches
  # verbose 折叠由 dsh-ui-chat-verbose-fold 在运行时给官方 ui-chat 的
  # conversation.view#chat 注入面打补丁完成。
  dsh-ui-chat-verbose-fold
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
