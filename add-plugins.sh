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

if [ ${#failed[@]} -gt 0 ]; then
  echo "失败: ${failed[*]}"
  exit 1
fi
echo "全部插件挂载完成。"
