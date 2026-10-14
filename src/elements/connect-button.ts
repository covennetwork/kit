import { css, html } from 'lit'
import { shortAddress } from '../core/format.js'
import { KitElement } from './base.js'
import { baseStyles } from './styles.js'

/** "Connect wallet" when disconnected; the address and network when connected. */
export class CovenConnectButton extends KitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }
      button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: 0;
        border-radius: 999px;
        background: var(--coven-accent);
        color: var(--coven-surface);
        font-size: 15px;
        font-weight: 500;
        letter-spacing: -0.01em;
        white-space: nowrap;
        transition: opacity 200ms ease;
      }
      button:hover {
        opacity: 0.85;
      }
      .connected {
        background: transparent;
        color: var(--coven-fg);
        box-shadow: inset 0 0 0 1px var(--coven-line);
      }
      .chain {
        color: var(--coven-ink-muted);
      }
      img {
        width: 18px;
        height: 18px;
        border-radius: 999px;
      }
    `,
  ]

  override render() {
    const kit = this.activeKit
    const state = this.state
    if (!kit || !state) return html`<button disabled>Connect wallet</button>`
    if (state.status === 'connected' && state.address) {
      const chain = kit.chains.find((c) => c.id === state.chainId)
      return html`<button class="connected" part="button" @click=${() => kit.open({ view: 'account' })}>
        ${state.connector?.icon ? html`<img src=${state.connector.icon} alt="" />` : ''}
        <span>${shortAddress(state.address)}</span>
        <span class="chain">${chain?.name ?? 'Unsupported network'}</span>
      </button>`
    }
    const busy = state.status === 'connecting' || state.status === 'reconnecting'
    return html`<button part="button" ?disabled=${busy} @click=${() => kit.requestConnect()}>${busy ? 'Connecting…' : 'Connect wallet'}</button>`
  }
}
