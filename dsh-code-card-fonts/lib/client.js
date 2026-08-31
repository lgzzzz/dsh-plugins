window.__ModuleLoader__.load({ id: 'dsh-code-card-fonts', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * Persistent Web UI font-size patch: 14px everywhere.
 *
 * Rendered code fences are `pre` (+ `pre code`). Conversation cards are
 * identified by stable data attributes that survive CSS-module hashing:
 *   - tool call cards: generic ToolRow root has `data-tool="<toolName>"`;
 *     the bash sample row uses `data-sample="bash"` instead;
 *   - thinking/reasoning rows: `data-variant="think"`;
 *   - other card nodes (command/compaction/retry/error/context/...):
 *     `data-chat-flow-kind="<kind>"` on the flow wrapper.
 *
 * Setting font-size on a card root alone does nothing for its text: most
 * inner elements (.summary, .ioText, .ioCard, ...) declare their own
 * font-size, which overrides the inherited value. So every card rule also
 * covers `*` (all descendants) to force the size on the actual text nodes.
 */
var CSS = [
  'pre,',
  'pre code { font-size: 14px !important; }',
  // Generic ToolRow covers read/edit/write/grep/glob/web/todo/ask cards.
  '[data-tool],',
  '[data-tool] *,',
  // Bash-specific sample row.
  '[data-sample],',
  '[data-sample] *,',
  // Thinking / reasoning rows.
  '[data-variant="think"],',
  '[data-variant="think"] *,',
  // Other conversation card nodes.
  '[data-chat-flow-kind="command"],',
  '[data-chat-flow-kind="command"] *,',
  '[data-chat-flow-kind="manual-compaction"],',
  '[data-chat-flow-kind="manual-compaction"] *,',
  '[data-chat-flow-kind="compaction"],',
  '[data-chat-flow-kind="compaction"] *,',
  '[data-chat-flow-kind="model-retry"],',
  '[data-chat-flow-kind="model-retry"] *,',
  '[data-chat-flow-kind="turn-error"],',
  '[data-chat-flow-kind="turn-error"] *,',
  '[data-chat-flow-kind="turn-max-tokens"],',
  '[data-chat-flow-kind="turn-max-tokens"] *,',
  '[data-chat-flow-kind="turn-process"],',
  '[data-chat-flow-kind="turn-process"] *,',
  '[data-chat-flow-kind="context"],',
  '[data-chat-flow-kind="context"] *,',
  '[data-chat-flow-kind="system-prompt"],',
  '[data-chat-flow-kind="system-prompt"] *,',
  '[data-chat-flow-kind="tool-call"],',
  '[data-chat-flow-kind="tool-call"] *,',
  '[data-chat-flow-kind="workflow-run"],',
  '[data-chat-flow-kind="workflow-run"] * { font-size: 14px !important; }',
].join('\n');

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