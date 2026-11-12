/**
 * 纯逻辑：可见性矩阵、写入失败文案、异常收敛、注册契约常量。
 *
 * 运行：`node test/logic.test.mjs`（或 pnpm test 跑全部）。
 */
import { failureMessage, messageOf, shouldRender } from '../src/logic.ts'
import { HERO_OPTIONS_ID, HERO_OPTIONS_ORDER, HERO_OPTIONS_SLOT, heroRegisterOptions } from '../src/registration.ts'
import { check, finish } from './helpers.mjs'

console.log('--- A① 可见性：只对根会话 + 投影已加载 ---')
{
  check('根会话渲染', shouldRender({ addressedChild: false, listedChild: false, hasProjection: true }), true)
  check('血缘子代理隐藏', shouldRender({ addressedChild: true, listedChild: false, hasProjection: true }), false)
  check('目录子代理隐藏', shouldRender({ addressedChild: false, listedChild: true, hasProjection: true }), false)
  check('投影缺席隐藏', shouldRender({ addressedChild: false, listedChild: false, hasProjection: false }), false)
  check('全部缺席隐藏', shouldRender({ addressedChild: true, listedChild: true, hasProjection: false }), false)
}

console.log('--- A② 写入结果与异常收敛 ---')
{
  check('成功无失败文案', failureMessage({ ok: true, value: undefined }), null)
  check('失败取 error.message', failureMessage({ ok: false, error: { message: 'flush failed' } }), 'flush failed')
  check('Error 取 message', messageOf(new Error('boom')), 'boom')
  check('字符串原样', messageOf('boom'), 'boom')
  check('对象字符串化', messageOf({ code: 1 }), '[object Object]')
}

console.log('--- A③ 注册契约：键 / id / 排序 ---')
{
  check('槽键', HERO_OPTIONS_SLOT, 'conversation.hero.options')
  check('注册 id 不与菜单项冲突', HERO_OPTIONS_ID, 'agent-team.hero')
  check('排在工作树(order 0)右侧', HERO_OPTIONS_ORDER, 10)
  const options = heroRegisterOptions('ns', sessionId => ({ setEnabled: async () => ({ ok: true, value: undefined }) }))
  check('注册选项 name', options.name, HERO_OPTIONS_SLOT)
  check('注册选项 id', options.id, HERO_OPTIONS_ID)
  check('注册选项 order', options.order, HERO_OPTIONS_ORDER)
  check('注册选项 locale', options.locale, 'ns')
  check('注册选项带 inject', typeof options.inject, 'function')
  const face = options.inject('session-1')
  check('inject 交出 setEnabled', typeof face.setEnabled, 'function')
}

finish()
