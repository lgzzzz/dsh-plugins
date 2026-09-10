/**
 * dsh-left-dock — 侧栏状态持久化（localStorage）。
 *
 * 存的是**用户意图**：当前选中哪个面板、是否展开、以及两个面板**各自的**轨道宽度
 * （“二者的宽度不共享”）。布局 store 本身不持久化（刷新后 sidebar 回到 280），因此
 * 挂载时用这里的值把 store 校准一次；store 只承载“当前生效的宽度”，两个模式的宽度
 * 记忆留在本插件。
 */
import { clampTrackWidth, SIDEBAR_MIN } from './layout-store.ts'

/** 左栏当前展示的面板。 */
export type DockMode = 'session' | 'files'

/** 持久化的侧栏状态。 */
export interface DockState {
  mode: DockMode
  /** 面板是否展开（false = 只留活动栏）。 */
  open: boolean
  /** 会话面板的轨道宽度。 */
  sessionWidth: number
  /** 文件面板的轨道宽度（与会话面板互不影响）。 */
  filesWidth: number
}

/** 默认状态：会话面板展开，两套宽度各自独立。 */
export const DEFAULT_STATE: DockState = {
  mode: 'session',
  open: true,
  sessionWidth: 300,
  filesWidth: 360,
}

/** localStorage 键名（带版本号，形状变化时换新键，旧值自然失效）。 */
const STORAGE_KEY = 'dsh.left-dock.v1'

/** 读一个合法宽度：非数字、超出下界（面板宽度恒 ≥ SIDEBAR_MIN）都回落默认。 */
function readWidth(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < SIDEBAR_MIN) return fallback
  return clampTrackWidth(raw)
}

/**
 * 读取持久化状态（任何异常/形状不符都回落默认值）。
 * @returns 侧栏状态。
 */
export function loadState(): DockState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      mode: parsed['mode'] === 'files' ? 'files' : 'session',
      open: parsed['open'] !== false,
      sessionWidth: readWidth(parsed['sessionWidth'], DEFAULT_STATE.sessionWidth),
      filesWidth: readWidth(parsed['filesWidth'], DEFAULT_STATE.filesWidth),
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/**
 * 写入持久化状态（存储不可用时静默忽略）。
 * @param state - 当前状态。
 */
export function saveState(state: DockState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 隐私模式/配额满：持久化失败不影响本次会话内的行为 */
  }
}
