/**
 * 诊断脚本入口(非插件产物):最小 DOM 桩 + `__ModuleLoader__` 桩载入 lib/client.js,
 * 按被测功能拆分的用例在 test/ 下逐个 import 执行,最后汇总 PASS/FAIL 与退出码。
 *
 * 桩件、夹具与断言工具见 test/harness.mjs;各用例文件也可单独直跑(`node test/<name>.mjs`,
 * 自己打印汇总)。覆盖清单见 README.md「构建与验证」。
 */
import { report } from './test/harness.mjs'

const suites = [
  ['./test/questions.mjs', '卡片:审批 / 计划评审 / 通用问答(服务级路径 + pendingSnapshot 回退)'],
  ['./test/sidebar.mjs', '左右栏开关(⌘/Ctrl+B / ⌘/Ctrl+O)'],
  ['./test/session-new.mjs', '新建会话(⌘/Ctrl+N)'],
  ['./test/composer.mjs', '聚焦输入框(⌘/Ctrl+J)'],
  ['./test/rightbar-tabs.mjs', '右栏标签切换(⌘/Ctrl+Alt+← / →)'],
  ['./test/rightbar-close-tab.mjs', '右栏关闭当前标签(⌘/Ctrl+,)'],
  ['./test/rightbar-fullscreen.mjs', '右栏全屏开关(⌘/Ctrl+S)'],
  ['./test/rightbar-files.mjs', '右栏文件浏览器定位并置顶(⌘/Ctrl+\\)'],
  ['./test/rightbar-terminal.mjs', '右栏定位终端(⌘/Ctrl+L)'],
  ['./test/rightbar-view.mjs', '右栏自动换行(⌘/Ctrl+D);diff 分栏默认未绑定'],
  ['./test/picker-workspace.mjs', '工作区浮窗(⌘/Ctrl+K)'],
  ['./test/picker-model.mjs', '模型浮窗 + 思考强度循环(⌘/Ctrl+M / ⇧Tab)'],
  ['./test/picker-recent.mjs', '近期对话浮窗(⌘/Ctrl+I)'],
]

for (const [file, title] of suites) {
  console.log(`\n===== ${file} — ${title} =====`)
  await import(file)
}

report()
