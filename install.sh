#!/usr/bin/env sh
#
# dsh-plugins —— 类 Unix（macOS / Linux / WSL）安装脚本
#
# 本仓库不再作为「一个插件」整体安装（不再有根 cordis.patch.yml / meta bundle），
# 本脚本把仓库内每个插件目录逐个以 `link:` 依赖装入 DSH Profile，每个插件经自身
# 的 cordis.patch.yml 独立挂载。Windows 请运行同目录的 install.ps1（PowerShell）。
#
# 用法:
#   ./install.sh                            # 默认安装（web Profile 的 6 个默认插件）
#   ./install.sh --with-change-summary      # 额外安装 dsh-change-summary（需先构建）
#   ./install.sh --help
#
# 环境变量:
#   DSH_PROFILE=<name>                      # 装入非 web 的 Profile（默认 web）
#   DSH_INSTALL_CHANGE_SUMMARY=1            # 等价于 --with-change-summary
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
INSTALL_CHANGE_SUMMARY=0

usage() {
	cat <<'EOF'
dsh-plugins 安装脚本（类 Unix）
用法:
  ./install.sh                            默认安装（web Profile 的 6 个默认插件）
  ./install.sh --with-change-summary      额外安装 dsh-change-summary（需先构建）
  ./install.sh --help                     显示本帮助
环境变量:
  DSH_PROFILE=<name>                      装入指定 Profile（默认 web）
  DSH_INSTALL_CHANGE_SUMMARY=1            等价于 --with-change-summary
EOF
}

for arg in "$@"; do
	case "$arg" in
	--with-change-summary)
		INSTALL_CHANGE_SUMMARY=1
		;;
	--help | -h)
		usage
		exit 0
		;;
	*)
		echo "install: 忽略未知参数: $arg" >&2
		;;
	esac
done

# 默认安装的插件（与 install.ps1 中的列表保持一致；新增 / 移除插件须同步两处）
DEFAULT_PLUGINS="dsh-text-editor dsh-code-card-fonts dsh-git-guard dsh-fullwidth-chat dsh-new-session dsh-directory-picker-browse"

echo "==> 仓库根: $ROOT"
echo "==> 目标 Profile: $PROFILE"

# --- 前置检查 ----------------------------------------------------------------
command -v dsh >/dev/null 2>&1 || {
	echo "错误: 未找到 dsh 命令。请先安装 @deepseek-ai/dsh（npm i -g @deepseek-ai/dsh）并确保其在 PATH。" >&2
	exit 1
}
command -v pnpm >/dev/null 2>&1 || {
	echo "错误: 未找到 pnpm 命令（dsh plugin 依赖 pnpm 管理 Profile）。请先安装 pnpm 并确保其在 PATH。" >&2
	exit 1
}
for dir in $DEFAULT_PLUGINS; do
	[ -f "$ROOT/$dir/package.json" ] || {
		echo "错误: 缺少插件目录或 package.json: $ROOT/$dir" >&2
		exit 1
	}
done

# --- 迁移：卸载旧的仓库根集合依赖（若存在） -----------------------------------
MANIFEST="$HOME/.dsh/profiles/$PROFILE/package.json"
if [ -f "$MANIFEST" ] && grep -q '"dsh-plugins"' "$MANIFEST"; then
	echo "==> 检测到旧的仓库根集合依赖 dsh-plugins，先卸载（避免挂载行 id 重复）"
	dsh plugin --profile "$PROFILE" remove dsh-plugins
fi

# --- 逐个安装默认插件 ---------------------------------------------------------
for dir in $DEFAULT_PLUGINS; do
	echo "==> 安装 $dir ..."
	dsh plugin --profile "$PROFILE" add "link:$ROOT/$dir"
done

# --- 可选插件：dsh-change-summary ---------------------------------------------
if [ "$INSTALL_CHANGE_SUMMARY" = "1" ] || [ "${DSH_INSTALL_CHANGE_SUMMARY:-0}" = "1" ]; then
	missing=
	for f in lib/index.js lib/client.js; do
		[ -f "$ROOT/dsh-change-summary/$f" ] || missing="$missing $f"
	done
	if [ -n "$missing" ]; then
		echo "错误: dsh-change-summary 缺少构建产物:$missing" >&2
		echo "      请先在 dsh-change-summary 目录执行: npm install && npm run build，再重跑本脚本。" >&2
		exit 1
	fi
	echo "==> 安装 dsh-change-summary ..."
	dsh plugin --profile "$PROFILE" add "link:$ROOT/dsh-change-summary"
fi

# --- 汇总 --------------------------------------------------------------------
echo
echo "完成。已安装的插件:"
for dir in $DEFAULT_PLUGINS; do
	echo "  - $dir"
done
if [ "$INSTALL_CHANGE_SUMMARY" = "1" ] || [ "${DSH_INSTALL_CHANGE_SUMMARY:-0}" = "1" ]; then
	echo "  - dsh-change-summary"
fi
echo
echo "请重启 App（dsh web）使常驻挂载生效。"
echo "link: 依赖实时指向本仓库：之后修改插件代码无需重跑本脚本，"
echo "浏览器半部改动请在对应插件目录执行其 build 脚本，宿主半部改动直接重启 App。"
