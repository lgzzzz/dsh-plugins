/**
 * 捕获层组合输入守卫：AltGraph、旧 IME 的 keyCode 229 与 isComposing 一样，必须让固定键
 * 捕获路径让位。否则 Windows/Linux 的 AltGr+字母会被当成 Ctrl+Alt+固定键并吞掉字符。
 *
 * 运行：`node test/capture-altgr.test.mjs`（或 pnpm test 跑全部）。
 */
import { check, finish } from './focus-helpers.mjs'
import { captureGesture, isComposingEvent } from '../src/capture.ts'

const base = {
  code: 'KeyN',
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
}

check('普通 Ctrl+Alt+N 不按组合输入处理', isComposingEvent(base), false)
check('普通 Ctrl+Alt+N 的手势 composing 为 false', captureGesture(base).composing, false)

check('isComposing 命中', isComposingEvent({ ...base, isComposing: true }), true)
check('keyCode 229 命中', isComposingEvent({ ...base, keyCode: 229, isComposing: false }), true)
check('AltGraph 命中', isComposingEvent({
  ...base,
  getModifierState: (state) => state === 'AltGraph',
}), true)
check('captureGesture 保留 AltGraph', captureGesture({
  ...base,
  getModifierState: (state) => state === 'AltGraph',
}).composing, true)
check('captureGesture 保留 keyCode 229', captureGesture({ ...base, keyCode: 229 }).composing, true)
check('getModifierState 不存在时不抛', isComposingEvent({ ...base, getModifierState: undefined }), false)

finish()
