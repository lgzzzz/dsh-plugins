/**
 * 浏览器半部：挂上「打开命令详情就把它露出来」的行为。
 *
 * 不注册槽位、不注入服务：行为只依赖页面上游已经渲染出来的会话面板与后台任务行，所以
 * `dsh.client.immediately` 让它在页面装载时就挂上，早于任何会话面板挂载（面板随会话切换
 * 重挂也不会丢监听——监听挂在 window 上）。
 *
 * `ctx.effect` 负责卸载：插件被关掉或替换时撤监听、停观察、还原面板上自己写过的 `max-height`。
 */

import type { Context } from '@deepseek-ai/cordis'
import { installJobDetailReveal } from './reveal.ts'

export const name = 'dsh-jobs-detail-reveal'

/**
 * 挂行为。
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    // 只有浏览器页面有会话面板；测试 / SSR 里没有 window 时安静跳过。
    if (typeof window === 'undefined') return () => {}
    return installJobDetailReveal(window)
  }, `${name}: reveal job detail`)
}
