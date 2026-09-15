window.__ModuleLoader__.load({ id: 'dsh-new-session', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

/**
 * Browser half: on `command/executed` for `/new` call `uiWorkspace.startSession()`; register a null renderer at key `new` in `conversation.chat.commandview` to suppress the "new 已完成" lifecycle row, plus a style hiding the zero-height gap.
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
