#!/usr/bin/env bash
# 自动发现仓库根下所有 dsh-* 插件目录并逐个挂进 web profile;增删插件只需增删目录,不维护名单。
# example/ 等非 dsh-* 目录不参与整仓挂载。
#
# 挂载前先把客户端半部的产物补齐:profile 以 link: 指向本目录,DSH 直接读 package.json 里
# exports 写明的 lib/*.js(这些产物在 .gitignore 里)。缺产物时插件照样挂得上,只是浏览器里
# 是个空壳,启动日志里只有一行 ENOENT —— 所以在挂载前构建,失败就不挂。
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

if ! command -v pnpm >/dev/null 2>&1; then
  echo "未找到 pnpm:构建与挂载插件都需要它。"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node:无法读取插件清单。"
  exit 1
fi

# 判断某个插件是否需要先构建:只认 package.json 里 exports 写明的 .js 产物,
# 不按 lib/ 目录硬编码。宿主半部(src/*.ts 由 Node 直接加载、没有产物)或本来就没有
# build 脚本的插件一律返回非零,不会被误构建。
needs_build() {
  node - "$1" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const dir = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
if (manifest.scripts?.build === undefined) process.exit(1)
const targets = Object.values(manifest.exports ?? {})
  .map(entry => (typeof entry === 'string' ? entry : entry?.default))
  .filter(target => typeof target === 'string' && target.endsWith('.js'))
process.exit(targets.some(target => !fs.existsSync(path.join(dir, target))) ? 0 : 1)
NODE
}

# 各插件共用的 tsdown / typescript 提升在仓库根 node_modules;全新 clone 后先装一次。
if [ ! -e "$BASE/node_modules/.bin/tsdown" ]; then
  echo "==> pnpm install(补仓库根 node_modules)"
  if ! (cd "$BASE" && pnpm install); then
    echo "仓库根依赖安装失败;客户端插件会缺产物,中止。"
    exit 1
  fi
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
  if needs_build "$dir"; then
    echo "==> pnpm --filter $name build(补齐 lib 产物)"
    if ! (cd "$BASE" && pnpm --filter "$name" build); then
      echo "构建失败,未挂载: $name"
      failed+=("$name")
      continue
    fi
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
echo "全部插件挂载完成;重新启动 dsh web 后生效。"
