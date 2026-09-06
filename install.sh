#!/usr/bin/env sh
#
# dsh-plugins —— 类 Unix（macOS / Linux / WSL）安装脚本
#
# 本仓库不再作为「一个插件」整体安装（不再有根 cordis.patch.yml / meta bundle），
# 本脚本把仓库内**全部**插件目录逐个以 `link:` 依赖装入 DSH Profile，每个插件经
# 自身的 cordis.patch.yml 独立挂载。Windows 请运行同目录的 install.ps1
# （PowerShell）。
#
# 用法:
#   ./install.sh                            # 安装仓库内全部插件（默认 web Profile）
#   ./install.sh --help
#
# 环境变量:
#   DSH_PROFILE=<name>                      # 装入非 web 的 Profile（默认 web）
#
# 脚本可重复执行：link: 依赖已存在时为幂等 no-op，且 link: 实时指向本仓库，
# 之后修改插件代码无需重跑（浏览器半部改动需重新 build，宿主改动需重启 App）。
# 若 Profile 仍装着旧的仓库根集合依赖 `dsh-plugins`，脚本会先卸载它，避免与
# 逐插件安装的挂载行 id 重复。
#
# 注意：安装属于用户操作（见 AGENTS.md 强制规范第 1 条），脚本只写 Profile；
# 结束后须重启 App 使常驻挂载生效。
set -eu

# --- 仓库根目录（本脚本所在目录） -------------------------------------------
ROOT=$(CDPATH= cd "$(dirname "$0")" && pwd)

# --- 选项 --------------------------------------------------------------------
PROFILE=${DSH_PROFILE:-web}

usage() {
	cat <<'EOF'
dsh-plugins 安装脚本（类 Unix）
用法:
  ./install.sh       安装仓库内全部插件（默认 web Profile）
  ./install.sh --help
环境变量:
  DSH_PROFILE=<name> 装入指定 Profile（默认 web）
EOF
}

for arg in "$@"; do
	case "$arg" in
	--help | -h)
		usage
		exit 0
		;;
	*)
		echo "install: 忽略未知参数: $arg" >&2
		;;
	esac
done

# 仓库内全部插件目录（与 install.ps1 中的列表保持一致；新增 / 移除插件须同步两处）
PLUGINS="dsh-text-editor dsh-code-card-fonts dsh-git-guard dsh-fullwidth-chat dsh-new-session dsh-directory-picker-browse dsh-change-summary dsh-kbd-hotkeys"
TOTAL=$(echo "$PLUGINS" | wc -w | tr -d ' ')

echo "==> 仓库根: $ROOT"
echo "==> 目标 Profile: $PROFILE"
echo "==> 将安装全部 $TOTAL 个插件"

# --- 前置检查 ----------------------------------------------------------------
command -v dsh >/dev/null 2>&1 || {
	echo "错误: 未找到 dsh 命令。请先安装 @deepseek-ai/dsh（npm i -g @deepseek-ai/dsh）并确保其在 PATH。" >&2
	exit 1
}
command -v pnpm >/dev/null 2>&1 || {
	echo "错误: 未找到 pnpm 命令（dsh plugin 依赖 pnpm 管理 Profile）。请先安装 pnpm 并确保其在 PATH。" >&2
	exit 1
}
for dir in $PLUGINS; do
	[ -f "$ROOT/$dir/package.json" ] || {
		echo "错误: 缺少插件目录或 package.json: $ROOT/$dir" >&2
		exit 1
	}
done

# dsh-change-summary 的 lib/ 是不入仓的构建产物；缺失时给出构建指引
if [ ! -f "$ROOT/dsh-change-summary/lib/index.js" ] || [ ! -f "$ROOT/dsh-change-summary/lib/client.js" ]; then
	echo "错误: dsh-change-summary 缺少构建产物 lib/（其 lib/ 不入仓，未随仓库提供）。" >&2
	echo "      请先在 dsh-change-summary 目录执行: npm install && npm run build，再重跑本脚本。" >&2
	exit 1
fi

# --- 迁移：卸载旧的仓库根集合依赖（若存在） -----------------------------------
MANIFEST="$HOME/.dsh/profiles/$PROFILE/package.json"
if [ -f "$MANIFEST" ] && grep -q '"dsh-plugins"' "$MANIFEST"; then
	echo "==> 检测到旧的仓库根集合依赖 dsh-plugins，先卸载（避免挂载行 id 重复）"
	dsh plugin --profile "$PROFILE" remove dsh-plugins
fi

# --- 逐个安装全部插件 ---------------------------------------------------------
i=0
for dir in $PLUGINS; do
	i=$((i + 1))
	echo "==> [$i/$TOTAL] 安装 $dir ..."
	dsh plugin --profile "$PROFILE" add "link:$ROOT/$dir"
done

# --- 汇总 --------------------------------------------------------------------
echo
echo "完成。已安装全部 $TOTAL 个插件:"
for dir in $PLUGINS; do
	echo "  - $dir"
done
echo
echo "请重启 App（dsh web）使常驻挂载生效。"
echo "link: 依赖实时指向本仓库：之后修改插件代码无需重跑本脚本，"
echo "浏览器半部改动请在对应插件目录执行其 build 脚本，宿主半部改动直接重启 App。"
