window.__ModuleLoader__.load({ id: 'dsh-new-session', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/**
 * dsh-new-session — browser half.
 *
 * Two jobs:
 * 1. Listen for the browser-local `command/executed` acknowledgment (fired after
 *    this client admitted one Host command execution) and, for `/new`, run the
 *    exact New Session button path: `uiWorkspace.startSession()` resolves the
 *    target workspace (explicit -> current session's -> recent), reuses or
 *    creates its blank session, and opens it. No popup, no confirmation, no
 *    model message — the user just lands in the new blank session.
 * 2. Suppress the shell's generic "new 已完成" lifecycle row that the Host
 *    executor always logs (`command/run` + `command/done`) for `/new`. The
 *    conversation view dispatches per-command rows through the keyed
 *    `conversation.chat.commandview` slot by command name; registering key
 *    `new` with a null renderer removes the row from the original session.
 *    A companion style hides the resulting zero-height flow item so no gap
 *    remains. The lifecycle events stay in the session log (the command is
 *    still durably recorded); only the UI text is gone.
 */
module.exports = {
  name: 'dsh-new-session',
  inject: ['slots', 'uiWorkspace'],
  apply: function (ctx) {
    if (!ctx || typeof ctx.on !== 'function') return;
    ctx.on('command/executed', function (sessionId, name, result) {
      if (name !== 'new') return;
      var uiWorkspace = ctx.get('uiWorkspace');
      if (!uiWorkspace || typeof uiWorkspace.startSession !== 'function') return;
      uiWorkspace.startSession();
    });
    if (ctx.slots && typeof ctx.slots.inject === 'function' && typeof ctx.slots.register === 'function') {
      ctx.slots.inject('conversation.chat.commandview', function () {
        return ctx.slots.register(
          { name: 'conversation.chat.commandview', key: 'new' },
          function () { return null; }
        );
      });
    }
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-new-session/suppress"]') === null) {
      var style = document.createElement('style');
      style.dataset.plugin = 'dsh-new-session';
      style.dataset.pluginCss = 'dsh-new-session/suppress';
      style.textContent = '[data-chat-flow-kind="command"]:has([data-slot="conversation.chat.commandview"]:empty) { display: none; }';
      document.head.appendChild(style);
    }
  },
};

return module.exports; } });
