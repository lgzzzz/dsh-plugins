window.__ModuleLoader__.load({ id: 'dsh-code-card-fonts', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * Conversation card font patch:
 *   - card titles           -> 15px
 *   - expanded card content -> 14px (code fences / inline code stay 14px)
 *   - card spacing          -> half the content font height (14px x 0.5 = 7px)
 *
 * Selectors use stable data attributes (CSS-module-hash safe):
 *   - [data-chat-flow-kind] is stamped on every chat flow item.
 *   - [data-tool] / [data-sample] / [data-variant="think"] mark card roots.
 *   - The shared collapsible-card primitive (DisclosureRow) stamps
 *     `data-disclosure-row` on its header row; its title <span> is always the
 *     header's 2nd child, and the expanded body is a sibling of that row, so
 *     the generic "* 14px" content rules cover the body while a
 *     higher-specificity rule lifts only the title to 15px.
 *
 * !important is retained only to win over inner elements' own font-size
 * declarations (.summary/.ioText/.ioCard/...), so the values are enforced.
 *
 * Additionally sets the message-card spacing to half the content font height
 * (14px x 0.5 = 7px): the chat column (dsh-client-ui-chat) spaces adjacent
 * cards with `margin-top: var(--dsh-chat-flow-gap, 16px)` on each card, and
 * nothing else defines that variable, so it is declared here on body. The
 * compact answer card's own element-level rule
 * `.flowItem[data-turn-process-answer]{--dsh-chat-flow-gap:8px}` still wins
 * over the inherited value (declaration on the element beats inheritance).
 */
var CSS = `
[data-chat-flow-kind], [data-chat-flow-kind] * {
  font-size: 15px !important;
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

/* ---- Card titles: 15px ---- */
/* Shared DisclosureRow cards (tool / think / command / context /
 * system-prompt / workflow-run / cordis_*): the title is always the 2nd
 * child <span> of the header row carrying data-disclosure-row. Higher
 * specificity than the [data-*] * rules above, so it wins. */
[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2) {
  font-size: 15px !important;
}

/* Bash sample card (independent BashRow, [data-sample]): its header is not a
 * DisclosureRow; the title span is the 3rd span from the end — only the
 * separator and the summary follow it (a hidden status span, when present,
 * sits before the title). */
[data-sample] > span:nth-last-child(3) {
  font-size: 15px !important;
}

/* Compaction marker: title lives in its <button> header, again the 3rd span
 * from the end (separator + summary follow it). */
[data-chat-flow-kind="compaction"] button > span:nth-last-child(3),
[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3) {
  font-size: 15px !important;
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
