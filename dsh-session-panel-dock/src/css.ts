/**
 * `dsh-session-panel-dock` 的全部样式。
 *
 * 目标只有一个:会话面板（`dsh-client-ui-session-panel`，会话标题栏最左侧那个开关）无论
 * Chat 视图有多少空间,都以 `docked` 形态出现,不再退化成 `overlay` 浮层。
 *
 * 上游判定只有一条（`dsh-client-ui-session-panel/src/client/visibility.ts`）:
 *
 *   fits（该面板的停靠探针 >= 1px） && pinned  -> docked
 *   fits && !pinned                             -> hidden
 *   !fits && overlay === 本会话                -> overlay
 *   其余                                        -> hidden
 *
 * 探针是 `<span data-session-panel-probe>`，宽度由面板样式表算:
 *
 *   max(gutter − 40px(间距) − 8px(边距) − 300px(面板最小宽) + 1px, reserve-room)
 *
 * gutter 是正文列到 Chat 外框末端边缘的留白。空间不足时探针为 0，所以按开关只能开浮层。
 *
 * 本插件做两件事:
 *
 * 1. 把**主对话**里的探针恒定为 1px。`fits` 永远成立，`presentationOf` 的 overlay 分支
 *    不可达；面板仍由标题栏开关的 `pinned` 偏好控制:关掉时 hidden，打开时 docked。
 *    用 `!important` 是因为这条规则只按稳定的 `data-*` 属性命中，必须压过上游任何
 *    未来的特异性调整；探针本身零高、不可见、不接指针，恒为 1px 不产生布局副作用。
 *
 * 2. 面板 pin 住时，给主对话的正文宽度设一个上限:
 *    `min(上游自适应宽度 / 用户拖拽宽度, max(480px, 列宽 − 400px))`。
 *    上游的 Conversation 主体只有在 `--dsh-chat-end-reserve-max >= 348px` 时才会真的
 *    把正文和输入框向起始边让位；这个最大值 = 滚动口宽 − 正文列宽 − 32px。正文比
 *    「列宽 − 400px」宽时（窄外框的 680–880px 自适应宽度、用户拖宽、或其它把正文钉宽的
 *    补丁），主体让不出 348px，面板只能压住正文。把上限压到「列宽 − 400px」后:
 *
 *      400px = 348px（40 间距 + 300 面板 + 8 边距）
 *            + 32px（主体让位后正文前至少保留的起始留白）
 *            + 约 20px（滚动口比列宽少的边距 / 滚动条预留）
 *
 *    主体让位后 gutter 恰为 348px，面板宽 300px，和正文之间正好 40px。
 *
 *    这里用 `min()` 而不是直接赋值:Chat 外框约 >= 1110px 时，自然宽度小于这个上限，面板
 *    打开时正文保持原宽、只由主体的末端预留向左移动；只有上限真正低于自然宽度时才会
 *    收窄。用户拖窄的偏好同样保留；拖宽超过上限时面板显示期间被上限截住，隐藏后恢复。
 *    同时覆盖 `--dsh-chat-content-width-resolved`（reserve 计算的输入）和
 *    `--dsh-chat-content-width`（正文、气泡、卡片、输入框的消费变量）；面板隐藏时
 *    两条规则都不命中，正文恢复上游宽度。
 *
 * 作用域只到 `[data-slot='main.conversation']`:
 *   - 嵌入的侧边对话（embedded Conversation）本来就不让位（上游把它的
 *     `--dsh-chat-end-reserve-max` 定为 0px），强行收窄只会白占正文宽度，
 *     所以让它的探针与宽度保持上游行为；
 *   - 主对话只有一块，规则不会误伤右栏里的会话，也不会影响其它视图。
 *
 * 已知边界:
 *   - Chat 外框窄于约 870px 时，正文宽度已经停在下限 480px，主体无法再让出 348px；
 *     探针仍恒为 1px，面板仍是 docked 形态，但会覆盖正文右缘（不会退回浮层）。
 *     这是「无论空间是否足够都保持停靠」的直接代价。
 *   - Chat 外框约 >= 1110px 时正文保持上游自适应宽度；约 870–1110px 或用户拖宽超过
 *     上限时才收窄。
 *   - 宽度拖拽手柄仍然可用。面板显示期间，把手拖到超过上限不会改变显示宽度；拖窄
 *     仍然生效，并在面板隐藏后保留为上游的宽度偏好。
 *   - 把 `--dsh-session-panel-content-min` 调高（例如 640px）会更早进入覆盖区间，但正文
 *     更接近上游的最小正文宽度；调低（例如 400px）能把这段区间继续收窄，代价是正文更窄。
 *   - 面板的显示/隐藏仍由标题栏开关控制；本插件不写 `dsh.sessionPanel.pinned`，
 *     用户关掉面板后不会被重新打开。
 */
export const CSS = `
/* 1. 主对话的停靠探针恒为 1px:fits 永远成立,浮层分支不可达。 */
[data-slot='main.conversation'] [data-session-panel-probe] {
  width: 1px !important;
}

/* 2. 面板 pin 住时给正文让出 348px:上限 = min(自然宽度, max(480px, 列宽 − 400px)),
   使 Conversation 主体的 end-reserve-max 足以触发让位。不放大正文,用户拖窄的偏好保留。 */
[data-slot='main.conversation'] [data-conversation-content]:has([data-session-panel-probe][data-session-panel-reserve]) {
  --dsh-chat-content-width-resolved: min(
    var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width, 920px) * 0.64), 880px)),
    max(
      var(--dsh-session-panel-content-min, 480px),
      calc(var(--dsh-conversation-column-width, 920px) - 400px)
    )
  );
  --dsh-chat-content-width: var(--dsh-chat-content-width-resolved);
}
`

/** 本插件注入的 `<style>` 上的 `data-plugin-css` 标记,便于排查与去重。 */
export const STYLE_TAG_ID = 'dsh-session-panel-dock/session-panel-dock.css'
