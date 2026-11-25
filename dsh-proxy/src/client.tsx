/**
 * 浏览器半部：「分流路由」面板。
 *
 * 两个注册点：侧栏图标（`sidebar.panellist`，id `proxy`）与主面板（`main`，key `proxy`）。
 * 取数全部走 `/proxy-api/*`（同源 cookie），状态每 2 秒轮询一次，页面隐藏时暂停。
 *
 * 代码分层见 `src/ui/`：
 *
 * - `Panel.tsx` 面板骨架与状态条，`RulesTab` / `NodesTab` / `SimulateTab` / `LogsTab` 四个页签；
 * - `use-proxy-panel.ts` 数据与副作用（轮询、草稿、写操作），页面组件只做渲染；
 * - `Controls.tsx` + `Controls.module.css` 面板自有控件，`Panel.module.css` 骨架与列表布局；
 * - `locale.ts` 中英词条，`locale-context.tsx` 把 `ctx.locale` 接成 React 上下文。
 *
 * 样式走 CSS Modules：构建期换成哈希类名并在物化时自注入 `<style data-plugin>`，
 * 因此本文件不再手工创建 `<style>` 标签。
 */

import type { Context } from '@deepseek-ai/cordis'
// 仅类型：把 `ctx.slots` / `ctx.locale` 与 `main` / `sidebar.panellist` 的槽契约带进程序。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ProxyPanel } from './ui/Panel.tsx'
import { PanelIcon } from './ui/PanelIcon.tsx'
import { dictionaries } from './ui/locale.ts'
import { LocaleProvider, createLocaleFace } from './ui/locale-context.tsx'

/** 侧栏 id 与主面板 key，两者必须一致：侧栏按钮按该 id 选中主栏面板。 */
const PANEL_ID = 'proxy'

/** 面板词条的命名空间。 */
const LOCALE_NS = 'proxy.panel'

export const inject = ['slots', 'locale']

/**
 * 客户端半部：注册词条、侧栏入口与主面板。
 * @param ctx - 客户端 Context，携带 `slots` 与 `locale`。
 */
export function apply(ctx: Context): void {
  const face = createLocaleFace(ctx, LOCALE_NS)
  const dicts = dictionaries()

  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', dicts.zh), 'dsh-proxy: zh dictionary')
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', dicts.en), 'dsh-proxy: en dictionary')

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            label: () => face.translate('panel'),
          },
          PanelIcon,
        ),
      ),
    'dsh-proxy: sidebar entry',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          () => (
            <LocaleProvider face={face}>
              <ProxyPanel />
            </LocaleProvider>
          ),
        ),
      ),
    'dsh-proxy: main panel',
  )
}
