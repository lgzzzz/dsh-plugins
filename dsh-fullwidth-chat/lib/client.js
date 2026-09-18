window.__ModuleLoader__.load({ id: 'dsh-fullwidth-chat', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/** 全宽对话列:`[data-slot="main.conversation"] [data-phase]`(wrapper 为 display:contents,须打在属性节点)设
 * `--dsh-chat-content-width: 100%`;两个属性选择器 (0,2,0) 压过上游 `.wSkVaW_root` (0,1,0);
 * composer 卡片宽经 calc(卡片宽 + 2×--dsh-composer-side-clearance(16px)) 跟随,`[data-width-handle]` 负责收起。 */
let CSS = "[data-slot='main.conversation'] [data-phase] { --dsh-chat-content-width: 100%; }";
module.exports = {
  name: 'fullwidth-chat',
  apply: function (ctx) {
    let tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-fullwidth-chat';
    tag.textContent = CSS;
    document.head.appendChild(tag);
    // Loader 卸载时也会回收 data-plugin 标记的样式;disposer 覆盖 stop/unload。
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () { return function () { tag.remove(); }; });
    }
  },
};
return module.exports; } });
