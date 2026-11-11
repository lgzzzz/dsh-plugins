#!/usr/bin/env bash
# 把本仓库的插件从 web profile 卸下:按 profile 的 dependencies 里指向本仓库的 link:/file: 路径识别,
# 目录已删除后遗留的条目也能清理;不维护插件名单。
# 默认在 dsh 未运行时执行:先退出 dsh web,再跑本脚本,完成后重新启动 dsh web(运行中的实例不会读到 profile 的变更)。
# 只改 profile(pnpm 重算 dependencies 与 dsh.profile.bundles),不删除本仓库里的插件目录。
# 也不碰 .gitignore 里的 lib/ 构建产物:卸下不会让产物失效,再挂回去不必重新构建。
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

# 运行中的实例会在它自己的配置刷新里读写 profile,再叠上本脚本的写入就是两个写者;
# 实际症状是 pnpm 报 EACCES: permission denied, open '.../package.json.lock'。
# 这里只提示、不阻断:同一台机器上可能有别的 profile 或别的 dsh home 在跑。
#
# 判定按 argv 词元而不是整个命令行子串 —— 后者会把「命令行里恰好带着这些字样的 shell」
# 也算成运行中的实例(比如包着本脚本的那层 bash)。只看 node 进程,且参数是
# `web` 或 `[--profile <name>] web`。
web_pids="$(
  ps -eo pid=,args= 2>/dev/null | node -e '
    let input = ""
    process.stdin.on("data", chunk => (input += chunk))
    process.stdin.on("end", () => {
      const base = name => name.slice(name.lastIndexOf("/") + 1)
      for (const line of input.split("\n")) {
        const trimmed = line.trim()
        if (trimmed === "") continue
        const [pid, ...argv] = trimmed.split(/\s+/)
        // 只认 node 跑 dsh 入口的进程:`node <.../bin/dsh> web --no-open`。
        if (argv.length < 2 || !/^node(?:js)?$/.test(base(argv[0]))) continue
        const [script, ...rest] = argv.slice(1)
        if (!/^dsh(?:\.js)?$/.test(base(script))) continue
        const isWeb = rest[0] === "web" || (rest[0] === "--profile" && rest[2] === "web")
        if (isWeb) console.log(pid)
      }
    })
  '
)" || web_pids=""

if [ -n "$web_pids" ]; then
  echo "警告: 检测到 dsh web 正在运行(pid $(echo $web_pids))。"
  echo "      先退出它再跑本脚本,否则写入 profile 可能失败(EACCES ... package.json.lock)。"
fi

failed=()
while IFS= read -r package_name; do
  [ -n "$package_name" ] || continue
  echo "==> dsh plugin --profile $PROFILE remove $package_name"
  if ! dsh plugin --profile "$PROFILE" remove "$package_name"; then
    failed+=("$package_name")
  fi
done <<< "$local_plugins"

if [ ${#failed[@]} -gt 0 ]; then
  echo "失败: ${failed[*]}"
  exit 1
fi
echo "全部插件卸载完成;重新启动 dsh web 后生效。"
