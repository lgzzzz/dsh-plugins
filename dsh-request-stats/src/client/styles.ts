/**
 * Global stylesheet of the dashboard page, injected with the page itself.
 *
 * @module dsh-request-stats/client/styles
 */

export const CSS = `
      .drs-page {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        height: 100%;
        min-height: 0;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 20px;
      }
      .drs-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 24px clamp(20px, 4vw, 40px) 12px;
      }
      .drs-heading { min-width: 0; }
      .drs-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
      .drs-sub { margin: 4px 0 0; max-width: 72ch; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      .drs-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .drs-seg {
        display: inline-flex;
        padding: 2px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 9px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .drs-seg-btn {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        padding: 4px 10px;
        border-radius: 7px;
        cursor: pointer;
        white-space: nowrap;
      }
      .drs-seg-btn:hover { color: var(--dsw-alias-label-primary); }
      .drs-seg-btn[aria-pressed='true'] {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .drs-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        padding: 5px 11px;
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
      }
      .drs-btn:hover { background: var(--dsw-alias-bg-layer-2); }
      .drs-btn:disabled { opacity: .55; cursor: default; }
      .drs-btn[data-tone='danger'] { color: var(--dsw-alias-state-error-primary); }
      .drs-btn[data-tone='danger']:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
      .drs-btn[data-busy='true'] svg { animation: drs-spin 0.9s linear infinite; }
      .drs-toggle[aria-pressed='true'] {
        background: var(--dsw-alias-bg-layer-2);
        border-color: var(--dsw-alias-border-l2);
      }
      @keyframes drs-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .drs-btn[data-busy='true'] svg { animation: none; }
      }
      .drs-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px clamp(20px, 4vw, 40px) 48px;
      }
      .drs-inner {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
        max-width: 1040px;
        margin: 0 auto;
      }
      .drs-live {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--dsw-alias-state-success-primary);
      }
      .drs-dot {
        width: 7px; height: 7px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
      }
      .drs-notice {
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .drs-notice[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, var(--dsw-alias-border-l1)); }
      .drs-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1)); }
      .drs-notice svg { flex: none; margin-top: 1px; }
      .drs-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 12px;
      }
      .drs-kpi {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 14px 16px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .drs-kpi-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .drs-kpi-value { font-size: 24px; font-weight: 500; line-height: 32px; font-variant-numeric: tabular-nums; }
      .drs-kpi-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
      .drs-card {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
        overflow: hidden;
      }
      .drs-card-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 4px 12px;
        padding: 14px 16px 10px;
      }
      .drs-card-title { margin: 0; font-size: 14px; font-weight: 500; }
      .drs-card-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .drs-table-wrap { overflow-x: auto; }
      .drs-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
      .drs-table th {
        padding: 7px 12px;
        text-align: left;
        font-weight: 500;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        white-space: nowrap;
      }
      .drs-table th,
      .drs-table td { vertical-align: middle; }
      .drs-table td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        white-space: nowrap;
      }
      .drs-table tbody tr:last-child td { border-bottom: 0; }
      .drs-table tbody tr:hover td { background: var(--dsw-alias-bg-layer-2); }
      .drs-table th.drs-align-right,
      .drs-table td.drs-align-right { text-align: right; }
      .drs-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
      .drs-strong { font-weight: 500; }
      .drs-muted { color: var(--dsw-alias-label-secondary); }
      .drs-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 16px;
        white-space: nowrap;
      }
      .drs-chip[data-tone='ok'] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, var(--dsw-alias-border-l1)); }
      .drs-chip[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, var(--dsw-alias-border-l1)); }
      .drs-chip[data-tone='error'] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, var(--dsw-alias-border-l1)); }
      .drs-server { display: inline-flex; align-items: center; gap: 8px; vertical-align: middle; }
      .drs-bar {
        display: inline-block;
        position: relative;
        vertical-align: middle;
        width: 84px;
        height: 6px;
        border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2);
        overflow: hidden;
      }
      .drs-bar > span {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: inherit;
        background: var(--dsw-alias-brand-primary);
        opacity: .75;
      }
      .drs-trends { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 4px 20px; padding: 0 16px 16px; }
      .drs-trend-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; padding-top: 6px; }
      .drs-trend-value { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
      .drs-trend svg { display: block; width: 100%; height: 84px; }
      .drs-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 56px 24px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
      }
      .drs-empty-title { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 500; }
      .drs-empty-hint { max-width: 46ch; font-size: 13px; line-height: 20px; }
      .drs-notes {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 72ch;
        overflow-wrap: anywhere;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .drs-share { display: flex; align-items: center; gap: 8px; min-width: 120px; }
      @media (prefers-reduced-motion: no-preference) {
        .drs-live .drs-dot { animation: drs-pulse 1.8s ease-in-out infinite; }
      }
      @keyframes drs-pulse {
        0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent); }
        50% { box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 8%, transparent); }
      }
    `
