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
 *
 * Additionally sets the message-card spacing to 1/2 of the content font
 * height: the chat column (dsh-client-ui-chat) spaces adjacent cards with
 * `margin-top: var(--dsh-chat-flow-gap, 16px)` on each card, and nothing
 * else defines that variable. --dsh-content-font-size is set as an inline
 * style on <body> by the theme plugin, and a custom property resolves its
 * inner var() at the element where it is declared — so the override must
 * live on body (not :root) to resolve against the actual setting value.
 * The compact answer card's own element-level rule
 * `.flowItem[data-turn-process-answer]{--dsh-chat-flow-gap:8px}` still wins
 * over the inherited value (declaration on the element beats inheritance).
 */
var CSS = `
pre, pre code,
[data-tool], [data-tool] *,
[data-sample], [data-sample] *,
[data-variant="think"], [data-variant="think"] *,
[data-chat-flow-kind], [data-chat-flow-kind] * {
  font-size: var(--dsh-content-font-size, 14px) !important;
}

body {
  --dsh-chat-flow-gap: calc(var(--dsh-content-font-size, 14px) * 0.5);
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
