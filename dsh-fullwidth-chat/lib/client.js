window.__ModuleLoader__.load({ id: 'dsh-fullwidth-chat', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * Full-width conversation column: set `--dsh-chat-content-width: 100%` on `[data-slot="main.conversation"] [data-phase]` (wrapper is display:contents, so the attribute is what matters); two attribute selectors (0,2,0) outrank upstream `.wSkVaW_root` (0,1,0); composer card follows via calc(+32px) `--dsh-composer-card-max-width`; `[data-width-handle]` handles collapse.
 */
let CSS = "[data-slot='main.conversation'] [data-phase] { --dsh-chat-content-width: 100%; }";
module.exports = {
  name: 'fullwidth-chat',
  apply: function (ctx) {
    let tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-fullwidth-chat';
    tag.textContent = CSS;
    document.head.appendChild(tag);
    // Loader also reclaims data-plugin-tagged styles on unload; disposer covers stop/unload.
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () { return function () { tag.remove(); }; });
    }
  },
};
return module.exports; } });
