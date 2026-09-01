window.__ModuleLoader__.load({ id: 'dsh-code-card-fonts', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * Force a uniform font-size on code fences and every conversation card,
 * overriding per-element explicit font-sizes. The size follows the Web UI
 * "字号大小" setting via --dsh-content-font-size (not hardcoded); !important
 * is retained only to win over inner elements' own font-size declarations
 * (.summary/.ioText/.ioCard/...), so the *value* is delegated to the setting.
 *
 * Selectors use stable data attributes (CSS-module-hash safe): each card
 * rule covers root + all descendants because inner elements declare their own
 * font-size, which would otherwise override inheritance.
 */
var CSS = `
pre, pre code,
[data-tool], [data-tool] *,
[data-sample], [data-sample] *,
[data-variant="think"], [data-variant="think"] *,
[data-chat-flow-kind], [data-chat-flow-kind] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}
`;

module.exports = {
  name: 'code-card-fonts',
  apply: function (ctx) {
    var tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-code-card-fonts';
    tag.textContent = CSS;
    document.head.appendChild(tag);
    // The module loader also reclaims data-plugin-tagged styles on unload;
    // keep a disposer anyway so stop/unload is covered by both paths.
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () { return function () { tag.remove(); }; });
    }
  },
};
return module.exports; } });
