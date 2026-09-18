window.__ModuleLoader__.load({ id: 'dsh-fullwidth-chat', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/** 全宽对话列:在会话内容节点 `[data-slot="main.conversation"] [data-conversation-content]`(上游 `.wSkVaW_body`)
 * 置 `--dsh-chat-content-width: 100%`。上游在该节点自身声明此变量,祖先上的同名声明会被它覆盖,故锚点必须
 * 落在同一元素 (0,2,0 压过 `.wSkVaW_body` 0,1,0);composer 卡片经同元素重算的
 * `--dsh-composer-card-max-width` 跟随,`[data-width-handle]` 随内容边缘归零。 */
let CSS = "[data-slot='main.conversation'] [data-conversation-content] { --dsh-chat-content-width: 100%; }";
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
