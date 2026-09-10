window.__ModuleLoader__.load({ id: 'dsh-fullwidth-chat', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * Persistent full-width conversation column.
 *
 * Anchor: the conversation root (the element carrying `data-phase`) is rendered
 * by `renderSlot("main.conversation")` inside the conversation panel that
 * occupies the `main` keyed slot, so its slot outlet wrapper is addressable as
 * `[data-slot="main.conversation"]` (the wrapper itself is display:contents,
 * so only the attribute matters). There is no slot named plain `conversation`.
 *
 * Axis: upstream defines the width on that root as
 *   --dsh-chat-content-width: var(--dsh-chat-user-width, clamp(680px, column*64%, 920px))
 * Overriding the derived property to 100% tiles the transcript, the stats line
 * and the takeover panels (approval / user-questions) across the whole center
 * column. The composer card follows via `--dsh-composer-card-max-width`
 * (calc(+32px)) while keeping its 16px-per-side clearance, so no other rule has
 * to change.
 *
 * The descendant form is deliberate: the rule must outrank upstream's own
 * `.wSkVaW_root` declaration (class = 0,1,0) of the same property, hence two
 * attribute selectors (0,2,0) rather than a bare `[data-phase]` (which ties and
 * would also hit the composer editor, whose own `data-phase` sits deeper).
 *
 * Side effect: at 100% the built-in resize handles `[data-width-handle]`
 * (ui-conversation, positioned outside the content edges with
 * `width: min(40px, calc((100% - var(--dsh-chat-content-width)) / 2 - 48px))`)
 * collapse to zero width, and `--dsh-chat-user-width` is no longer referenced —
 * so the dragged / localStorage width preference stops having any effect.
 * Full width and a draggable width are mutually exclusive on this axis by
 * design; remove this rule to get the draggable width back.
 */
let CSS = "[data-slot='main.conversation'] [data-phase] { --dsh-chat-content-width: 100%; }";
module.exports = {
  name: 'fullwidth-chat',
  apply: function (ctx) {
    let tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-fullwidth-chat';
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
