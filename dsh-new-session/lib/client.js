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
  inject: ['slots', 'uiWorkspace', 'sessions'],
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
      ctx.effect(function () {
          var cancelIfRunning = function (id, sessions) {
              var binding = sessions.binding(id)
              if (binding === undefined) return
              var snapshot = binding.session.getSnapshot()
              if (snapshot.running !== true) return
              var address = snapshot.subagent === null ? undefined : snapshot.subagent.address
              if (address !== undefined && address.mode === 'one-shot') return
              binding.session.cancel().catch(function () {})
          }
          var stopTree = function (id, sessions, list, seen) {
              if (id === undefined || seen.has(id)) return
              seen.add(id)
              cancelIfRunning(id, sessions)
              var catalog = list.subagentsByParent === undefined ? undefined : list.subagentsByParent[id]
              if (catalog === undefined || !Array.isArray(catalog.entries)) return
              for (var i = 0; i < catalog.entries.length; i++) {
                  var entry = catalog.entries[i]
                  if (entry.kind !== 'child') continue
                  stopTree(entry.id, sessions, list, seen)
              }
          }
          var onKeyDown = function (event) {
              if (event.key !== 'Escape' || event.repeat) return
              var sessions = ctx.get('sessions')
              if (sessions === undefined) return
              var list = sessions.list.getSnapshot()
              stopTree(list.current, sessions, list, new Set())
          }
          document.addEventListener('keydown', onKeyDown)
          return function () {
              document.removeEventListener('keydown', onKeyDown)
          }
      })
  },
};

return module.exports; } });
