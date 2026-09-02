window.__ModuleLoader__.load({ id: 'dsh-code-card-fonts', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * Force a uniform 14px font-size on code fences, inline code, and every
 * conversation card, overriding per-element explicit font-sizes. !important
 * is retained only to win over inner elements' own font-size declarations
 * (.summary/.ioText/.ioCard/...), so the 14px value is enforced uniformly.
 *
 * Selectors use stable data attributes (CSS-module-hash safe): each card
 * rule covers root + all descendants because inner elements declare their own
 * font-size, which would otherwise override inheritance.
 *
 * Additionally sets the message-card spacing to half the font height (14px ×
 * 0.5 = 7px): the chat column (dsh-client-ui-chat) spaces adjacent cards with
 * `margin-top: var(--dsh-chat-flow-gap, 16px)` on each card, and nothing
 * else defines that variable, so it is declared here on body. The compact
 * answer card's own element-level rule
 * `.flowItem[data-turn-process-answer]{--dsh-chat-flow-gap:8px}` still wins
 * over the inherited value (declaration on the element beats inheritance).
 */
var CSS = `
[data-chat-flow-kind], [data-chat-flow-kind] * {
  font-size: 14px !important;
}

[data-variant="think"], [data-variant="think"] * {
  font-size: 14px !important;
}

[data-tool], [data-tool] * {
  font-size: 14px !important;
}

[data-sample], [data-sample] * {
  font-size: 14px !important;
}

pre, pre code {
  font-size: 14px !important;
}

/* Inline code in Markdown is natively font-size: .875em !important
 * (class-scoped rule in the web app), which outranks the [data-*] * rules
 * above. Match its specificity (attribute + :not(pre) + code) and win by
 * document order, since this style is injected after the app stylesheet. */
[data-chat-flow-kind] :not(pre) > code,
[data-variant="think"] :not(pre) > code,
[data-tool] :not(pre) > code,
[data-sample] :not(pre) > code {
  font-size: 14px !important;
}

body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
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
