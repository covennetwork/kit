import { css } from 'lit'

// One stylesheet for every view. Colors, radius and font come from the --coven-* tokens that
// each element writes on its host from the kit theme, so a theme change restyles everything.
export const baseStyles = css`
  :host {
    --coven-ink-strong: var(--coven-fg);
    --coven-ink-muted: color-mix(in srgb, var(--coven-fg) 48%, transparent);
    --coven-ink-faint: color-mix(in srgb, var(--coven-fg) 22%, transparent);
    --coven-line: color-mix(in srgb, var(--coven-fg) 12%, transparent);
    --coven-hover: color-mix(in srgb, var(--coven-fg) 6%, transparent);
    display: block;
    box-sizing: border-box;
    color: var(--coven-fg);
    font-family: var(--coven-font);
    font-size: 16px;
    line-height: 1.35;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  button,
  input {
    font: inherit;
    color: inherit;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
  }
  .label {
    margin: 0;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--coven-ink-muted);
  }
  .title {
    margin: 6px 0 0;
    font-size: clamp(26px, 7vw, 34px);
    line-height: 1;
    font-weight: 500;
    letter-spacing: -0.04em;
    text-wrap: balance;
  }
  :host([compact]) .title {
    font-size: 24px;
  }
  .note {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    color: var(--coven-ink-muted);
  }
  .error {
    color: var(--coven-fg);
  }
  .stack {
    display: grid;
    gap: 14px;
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  .row > :last-child {
    text-align: right;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 28px;
  }
  .primary {
    display: block;
    width: 100%;
    padding: 15px 18px;
    border: 0;
    border-radius: calc(var(--coven-radius) * 0.7);
    background: var(--coven-accent);
    color: var(--coven-bg-contrast, var(--coven-surface));
    font-size: 17px;
    font-weight: 500;
    letter-spacing: -0.02em;
    transition: opacity 200ms ease, transform 200ms ease;
  }
  .primary:hover:not(:disabled) {
    opacity: 0.85;
  }
  .primary:active:not(:disabled) {
    transform: scale(0.99);
  }
  .primary:disabled {
    opacity: 0.3;
  }
  .ghost {
    padding: 0;
    border: 0;
    background: none;
    color: var(--coven-ink-muted);
    font-size: 15px;
    text-align: left;
    transition: color 200ms ease;
  }
  .ghost:hover:not(:disabled) {
    color: var(--coven-fg);
  }
  .ghost:disabled {
    color: var(--coven-ink-faint);
  }
  .icon-button {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--coven-ink-muted);
  }
  .icon-button:hover {
    background: var(--coven-hover);
    color: var(--coven-fg);
  }
  .slot {
    padding: 0;
    border: 0;
    background: none;
    text-decoration: underline;
    text-decoration-color: var(--coven-ink-faint);
    text-decoration-thickness: 2px;
    text-underline-offset: 0.16em;
  }
  .slot:hover {
    text-decoration-color: var(--coven-fg);
  }
  .list {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: calc(var(--coven-radius) * 0.6);
    background: none;
    text-align: left;
  }
  .item:hover,
  .item[aria-selected='true'] {
    background: var(--coven-hover);
  }
  .item .grow {
    flex: 1;
    min-width: 0;
  }
  .item .sub {
    display: block;
    font-size: 13px;
    color: var(--coven-ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .avatar {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    background: var(--coven-hover);
    color: var(--coven-ink-muted);
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .search {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid var(--coven-line);
    border-radius: calc(var(--coven-radius) * 0.6);
    background: transparent;
    outline: none;
  }
  .search:focus {
    border-color: var(--coven-ink-muted);
  }
  .scroll {
    max-height: min(52vh, 420px);
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0 -12px;
    padding: 0 12px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--coven-line);
    border-radius: 999px;
    background: none;
    font-size: 13px;
    color: var(--coven-ink-muted);
  }
  .chip:hover {
    color: var(--coven-fg);
    border-color: var(--coven-ink-muted);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: currentColor;
  }
  .ladder {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ladder li {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--coven-ink-faint);
    transition: color 300ms ease;
  }
  .ladder li[data-state='active'] {
    color: var(--coven-fg);
  }
  .ladder li[data-state='done'] {
    color: var(--coven-ink-muted);
  }
  .ladder li[data-state='failed'] {
    color: var(--coven-fg);
  }
  .ladder .mark {
    width: 16px;
    text-align: center;
  }
  .loading {
    display: inline-flex;
    gap: 5px;
  }
  .loading span {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite both;
  }
  .loading span:nth-child(2) {
    animation-delay: 0.16s;
  }
  .loading span:nth-child(3) {
    animation-delay: 0.32s;
  }
  @keyframes pulse {
    0%,
    80%,
    100% {
      opacity: 0.2;
      transform: scale(0.7);
    }
    40% {
      opacity: 1;
      transform: scale(1);
    }
  }
  .enter {
    animation: enter 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .enter,
    .loading span {
      animation: none;
    }
    .loading span {
      opacity: 0.6;
    }
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  :focus-visible {
    outline: 2px solid var(--coven-accent);
    outline-offset: 2px;
  }
  /* Spacing utilities come last so they win over component margins. */
  .gap-lg {
    margin-top: 28px;
  }
  .gap-md {
    margin-top: 18px;
  }
`
