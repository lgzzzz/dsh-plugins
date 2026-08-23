/**
 * dsh-te-verify — 动态验证插件（客户端半部 body）。
 *
 * 用法：把本文件的全部内容粘贴进会话中 `cordis_define` 工具的 `code.client`，
 * 然后 `cordis_run` 运行（需要你在审批弹窗里批准）。无需改 profile、无需重启。
 *
 * 运行后它会依次调用 dsh-text-editor 的两个能力：
 *   1. openFile  → 打开 C:/Users/LGZ/.dsh/dsh-text-editor/package.json 到「文件」tab
 *   2. showDiff  → 在「差异」tab 顺序展示两个文件的 before/after diff
 *
 * 注意：动态插件的浏览器半部是「async 函数体」，必须 `return` 一个插件
 * （函数或 { name, inject, apply }）。纯 JavaScript（无 JSX / 无 TS）。
 */
const sample = {
  label: '示例一 demo.txt',
  path: 'demo.txt',
  before: 'line1\nline2\nline3\n',
  after: 'line1\nline2 (changed)\nline3\nline4 (added)\n',
}

return {
  name: 'dsh-te-verify',
  inject: ['slots', 'dsh-text-editor'],
  apply(ctx) {
    ctx.effect(() => {
      const te = ctx.get('dsh-text-editor')
      if (te === null || te === undefined || typeof te.openFile !== 'function' || typeof te.showDiff !== 'function') {
        console.log('[dsh-te-verify] dsh-text-editor 服务不可用（未提供 openFile/showDiff）')
        return () => {}
      }
      // 能力 1：打开一个真实存在的文件（可编辑、可保存）
      te.openFile({
        path: 'C:/Users/LGZ/.dsh/dsh-text-editor/package.json',
        cwd: undefined,
        sessionId: undefined,
      })
      // 能力 2：顺序展示两个文件的 diff（顶部 上一个/下一个 手动推进）；
      // initialIndex: 1 → 初始直接展示第二个文件（0 起，越界自动 clamp，缺省 0 = 第一个）。
      te.showDiff({
        files: [
          sample,
          {
            label: '示例二 app.ts',
            path: 'app.ts',
            before: 'const a = 1\nconsole.log("hello")\n',
            after: 'const a = 2\nconsole.log("hello, world")\nconsole.log(a)\n',
          },
        ],
        initialIndex: 1,
      })
      return () => {}
    })
  },
}
