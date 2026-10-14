import { html, nothing } from 'lit'
import { renderSVG } from 'uqr'
import type { ConnectorInfo, Kit } from '../../core/kit.js'
import { errorMessage } from '../../core/format.js'
import { KitElement, avatar, backIcon, copyIcon, loading } from '../base.js'
import { baseStyles } from '../styles.js'
import { css } from 'lit'

type Screen = { kind: 'list' } | { kind: 'connecting'; connector: ConnectorInfo; error?: string } | { kind: 'qr'; connector: ConnectorInfo; uri: string }

const CONNECT_TIMEOUT_MS = 60_000

const isTouch = () => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches

/** Wallet list, WalletConnect QR, and the connecting/error states. */
export class CovenConnectView extends KitElement {
  static override styles = [
    baseStyles,
    css`
      .qr {
        display: grid;
        place-items: center;
        padding: 14px;
        border-radius: calc(var(--coven-radius) * 0.7);
        background: #efece4;
        color: #000;
      }
      .qr svg {
        width: 100%;
        max-width: 280px;
        height: auto;
      }
    `,
  ]

  static override properties = {
    ...KitElement.properties,
    screen: { state: true },
    copied: { state: true },
  }

  declare screen: Screen
  declare copied: boolean
  private attempt = 0

  constructor() {
    super()
    this.screen = { kind: 'list' }
    this.copied = false
  }

  private async connect(kit: Kit, connector: ConnectorInfo) {
    const attempt = ++this.attempt
    const current = () => this.attempt === attempt && this.isConnected
    this.screen = { kind: 'connecting', connector }
    const live = kit.getConnector(connector.uid)
    const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
      if (type !== 'display_uri' || typeof data !== 'string' || !current()) return
      // On phones the wallet app is on the same device: hand the URI straight to it.
      if (isTouch()) window.location.href = data
      else this.screen = { kind: 'qr', connector, uri: data }
    }
    if (live?.type === 'walletConnect') live.emitter.on('message', onMessage)
    const timer = setTimeout(() => {
      if (current() && this.screen.kind === 'connecting')
        this.screen = { kind: 'connecting', connector, error: 'Your wallet did not respond. It may have been closed. Try again.' }
    }, CONNECT_TIMEOUT_MS)
    try {
      await kit.connect(connector.uid)
      if (!current()) return
      this.screen = { kind: 'list' }
      this.dispatchEvent(new CustomEvent('coven-connected', { bubbles: true, composed: true }))
    } catch (error) {
      if (current()) this.screen = { kind: 'connecting', connector, error: errorMessage(error) }
    } finally {
      clearTimeout(timer)
      if (live?.type === 'walletConnect') live.emitter.off('message', onMessage)
    }
  }

  private back() {
    this.attempt++
    this.screen = { kind: 'list' }
  }

  private async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      this.copied = true
      setTimeout(() => (this.copied = false), 1600)
    } catch {
      // Clipboard can be blocked in iframes; the QR is still there.
    }
  }

  override render() {
    const kit = this.activeKit
    if (!kit || !this.state) return this.noKit()

    if (kit.mode === 'provider') {
      return html`
        <p class="label">Wallet</p>
        <h2 class="title">Connect your wallet.</h2>
        <div class="gap-lg"><button class="primary" @click=${() => kit.requestConnect()}>Connect</button></div>
      `
    }

    const screen = this.screen
    if (screen.kind === 'qr') {
      return html`
        <div class="header">
          <button class="icon-button" aria-label="Back" @click=${this.back}>${backIcon}</button>
          <p class="label">WalletConnect</p>
          <span style="width:32px"></span>
        </div>
        <h2 class="title">Scan with your phone.</h2>
        <div class="gap-md qr" role="img" aria-label="WalletConnect QR code">${unsafeSvg(renderSVG(screen.uri, { ecc: 'M', border: 1 }))}</div>
        <div class="gap-md stack">
          <button class="ghost" @click=${() => this.copy(screen.uri)}>${copyIcon} ${this.copied ? 'Copied' : 'Copy link'}</button>
        </div>
      `
    }
    if (screen.kind === 'connecting') {
      return html`
        <div class="header">
          <button class="icon-button" aria-label="Back" @click=${this.back}>${backIcon}</button>
          <p class="label">${screen.connector.name}</p>
          <span style="width:32px"></span>
        </div>
        <h2 class="title">${screen.error ? 'Could not connect.' : 'Confirm in your wallet.'}</h2>
        <div class="gap-lg stack" aria-live="polite">
          ${screen.error
            ? html`<p class="note error">${screen.error}</p>
                <button class="primary" @click=${() => this.connect(kit, screen.connector)}>Try again</button>`
            : html`<p class="note">${loading('Waiting for your wallet')}</p>`}
        </div>
      `
    }

    const connectors = this.state.connectors
    return html`
      <p class="label">Wallet</p>
      <h2 class="title">Connect a wallet.</h2>
      <ul class="list gap-md" role="list">
        ${connectors.map(
          (c) => html`<li>
            <button class="item" @click=${() => this.connect(kit, c)}>
              ${avatar(c.name, c.icon ?? builtInIcon(c))}
              <span class="grow">${c.name}${c.type === 'walletConnect' ? html`<span class="sub">Mobile wallets, by QR or link</span>` : nothing}</span>
            </button>
          </li>`,
        )}
      </ul>
      ${connectors.length === 0 ? html`<p class="note gap-md">No wallets found in this browser. Install one, or use a mobile wallet.</p>` : nothing}
    `
  }
}

const builtInIcon = (c: ConnectorInfo) =>
  c.type === 'walletConnect'
    ? 'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#3B99FC"/><path d="M9.6 12.4c3.5-3.4 9.3-3.4 12.8 0l.4.4a.4.4 0 0 1 0 .6l-1.5 1.4a.2.2 0 0 1-.3 0l-.6-.6a6.5 6.5 0 0 0-8.9 0l-.6.6a.2.2 0 0 1-.3 0L9.1 13.4a.4.4 0 0 1 0-.6l.5-.4Zm15.8 2.9 1.3 1.3a.4.4 0 0 1 0 .6l-5.9 5.8a.5.5 0 0 1-.6 0l-4.2-4.1a.1.1 0 0 0-.2 0l-4.2 4.1a.5.5 0 0 1-.6 0l-5.9-5.8a.4.4 0 0 1 0-.6l1.3-1.3a.5.5 0 0 1 .6 0l4.2 4.1c.1.1.2.1.2 0l4.2-4.1a.5.5 0 0 1 .6 0l4.2 4.1c.1.1.2.1.2 0l4.2-4.1a.5.5 0 0 1 .6 0Z" fill="#fff"/></svg>',
      )
    : undefined

// uqr returns trusted SVG markup built from the URI's bits only (no text content is embedded),
// so it is parsed as SVG rather than interpolated as HTML.
function unsafeSvg(markup: string) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  return doc.documentElement
}
