/**
 * 面板自有的基础控件。
 *
 * 按 Harness 的插件规范，插件不 import `dsh-client-ui-primitives`（它随版本变动，且不要
 * 通过模块表去取）；这里照着宿主控件的样子自己写一份，只消费 `--dsw-alias-*` 令牌，
 * 状态用 `data-*` 表达，类名走 CSS Modules 加哈希 —— 详见 docs/dsh-css-architecture/03-scope-and-tokens.md。
 */

import type {
  ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes,
} from 'react'
import ctl from './Controls.module.css'

/**
 * 按钮的四种形态：默认、主操作、危险、纯图标的行内小按钮。
 *
 * 四者配色一致（黑底白字，见 `Controls.module.css`），形态只表达语义与尺寸差异。
 */
export type ButtonVariant = 'default' | 'primary' | 'danger' | 'icon'

/** {@link Button} 的入参：原生按钮属性上加一个形态选择。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉与语义形态，默认 `default`。 */
  variant?: ButtonVariant
}

/**
 * 面板按钮（始终 `type="button"`，除非调用方显式覆盖）。
 * @param props - 原生按钮属性 + 形态。
 * @returns 按钮元素。
 */
export function Button({ variant = 'default', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={className === undefined ? ctl['button'] : `${ctl['button'] ?? ''} ${className}`}
      data-variant={variant}
      {...rest}
    />
  )
}

/**
 * 一个成组的表单格：细描边 + 分层背景，内部横向排布字段。
 * @param props.children - 字段与动作行。
 * @returns 表单容器。
 */
export function Form({ children }: { children: ReactNode }) {
  return <div className={ctl['form']}>{children}</div>
}

/** {@link Actions} 的入参。 */
export interface ActionsProps {
  /**
   * 位置档位：默认独占一行（与 {@link Form} 同一套间距，也可独立用在列表下方）；
   * `lead` 放在表单行首、与字段同处第一行，按钮按输入框下沿对齐。
   */
  place?: 'lead'
  /** 按钮与状态说明。 */
  children: ReactNode
}

/**
 * 动作行。
 * @param props - 位置档位与按钮。
 * @returns 动作容器。
 */
export function Actions({ place, children }: ActionsProps) {
  return (
    <div className={ctl['actions']} data-place={place}>
      {children}
    </div>
  )
}

/** {@link Field} 的入参。 */
export interface FieldProps {
  /** 字段上方的说明文字。 */
  label: string
  /** 在表单里的宽度档位：默认弹性、`wide` 占两列。 */
  span?: 'wide'
  /**
   * 标签与控件的排布：默认上下堆叠；`inline` 让标签和控件同一行、宽度跟内容走，
   * 用于动作行里的小选择器（否则标签会把选择框顶到按钮下方一行）。
   */
  layout?: 'stacked' | 'inline'
  /** 真正的输入控件。 */
  children: ReactNode
}

/**
 * 带标签的表单字段。
 * @param props - 标签、宽度档位、排布与控件。
 * @returns 标签包着的字段。
 */
export function Field({ label, span, layout = 'stacked', children }: FieldProps) {
  return (
    <label className={ctl['field']} data-span={span} data-layout={layout}>
      {label}
      {children}
    </label>
  )
}

/**
 * 单行文本输入。
 * @param props - 原生输入框属性。
 * @returns 输入框元素。
 */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={className === undefined ? ctl['input'] : `${ctl['input'] ?? ''} ${className}`}
      {...rest}
    />
  )
}

/**
 * 下拉选择。
 * @param props - 原生 select 属性（选项由调用方给出）。
 * @returns select 元素。
 */
export function SelectInput({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={className === undefined ? ctl['input'] : `${ctl['input'] ?? ''} ${className}`}
      {...rest}
    />
  )
}

/**
 * 表示「出口」这类短标识的胶囊标签。
 * @param props.children - 标签文字。
 * @param props.title - 悬停提示，通常是标签背后的稳定标识（出口名）。
 * @returns 标签元素。
 */
export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return <span className={ctl['tag']} title={title}>{children}</span>
}

/**
 * 表示次要状态的胶囊标签（已选中、有未应用改动等）。
 * @param props.children - 标签文字。
 * @returns 标签元素。
 */
export function Chip({ children }: { children: ReactNode }) {
  return <span className={ctl['chip']}>{children}</span>
}

/**
 * 说明文字。
 * @param props.children - 文案。
 * @param props.space - 上边距档位：默认贴在下文之上、`none` 清零、`spaced` 加大。
 * @returns 段落元素。
 */
export function Hint({ children, space }: { children: ReactNode; space?: 'none' | 'spaced' }) {
  return (
    <p className={ctl['hint']} data-space={space}>
      {children}
    </p>
  )
}

/**
 * 空态提示。
 * @param props.children - 文案。
 * @returns 居中的空态块。
 */
export function Empty({ children }: { children: ReactNode }) {
  return <div className={ctl['empty']}>{children}</div>
}
