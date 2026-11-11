/**
 * 宿主半部：声明「可选模型列表」这条即时配置，并把它的设置页交给本插件自己渲染。
 *
 * 列表只有一份真源 —— 本插件 Config 里的 `models` 字段。它标了 `volatile()`：
 *
 *   - `dsh-settings` 的 `describe()` 只投影带 volatile 字段的插件配置，于是设置文档里能读到、
 *     也能按路径写回（不需要重挂插件）；
 *   - 浏览器半部经 `ctx.configForms.get('dsh-model-quick-switch')` 读同一个命名空间，浮层候选与
 *     设置页里的增删都落在这一份上；
 *   - 没有这条字段时 `describe()` 里根本不会出现本插件，设置页与浮层都会是空的。
 *
 * `apply` 只做一件事：告诉 `dsh-settings` 本插件自带页面（`auto: false`），别再为它生成一张
 * 按 schema 自动排布的通用表单页 —— 真正编辑这个列表的是客户端注册进 `settings.section` 的
 * 「模型快速切换」页。
 *
 * 键位、启用方式与已知边界见 docs/dsh-model-quick-switch.md。
 */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'

export const name = 'dsh-model-quick-switch'

/** 一条可选模型：提供方路由 + 提供方持有的模型 id（可选推理强度）。 */
export interface ModelChoiceConfig {
  /** 已注册的提供方路由（模型目录里的 `groups[].id`）。 */
  provider: string
  /** 提供方持有的模型 id（模型目录里的 `models[].id`）。 */
  model: string
  /** 适配器公布的推理强度 id；缺席时由 Host / 适配器按默认值解析。 */
  reasoningEffort?: string
}

/** 本插件的即时配置。 */
export interface Config {
  /** 浮层里列出的模型，顺序即浮层顺序。 */
  models: ModelChoiceConfig[]
}

/**
 * 即时配置 schema。
 *
 * `models` 默认空数组：第一次启用时浮层没有候选，设置页会提示去添加。数组整体标
 * `volatile()`，`dsh-settings` 才把这条命名空间投影给浏览器；写回走 `mutate` 的
 * `set path: ['models']`，整份列表原子替换。
 */
export const Config = z.object({
  models: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  })).default([]).volatile(),
})

export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      `${name}: settings page policy`,
    )
  })
}
