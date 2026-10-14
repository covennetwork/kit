import { css, html, nothing, type PropertyValues } from 'lit'
import type { KitState } from '../core/kit.js'
import { type ViewRequest, parseViewRequest } from '../core/views.js'
import { KitElement, backIcon } from './base.js'
import { baseStyles } from './styles.js'

type Overlay = 'connect' | 'account' | undefined

const ATTRIBUTES = ['view', 'pool', 'token-in', 'token-out', 'amount', 'slippage-bps', 'pool-fee', 'tick-spacing', 'hooks'] as const

/**
 * `<coven-widget view="swap" pool="0x…">` shows one view inline. The modal renders this same
 * element, and the hosted iframe renders it too, so every embed shares one implementation.
 *
 * Views that need a wallet ask for one through a `coven-need-connect` event; the widget shows the
 * connect view on top and returns to where the user was once connected.
 */
export class CovenWidget extends KitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        container-type: inline-size;
      }
      .frame {
        padding: 24px;
        background: var(--coven-bg);
        border-radius: var(--coven-radius);
      }
      :host([compact]) .frame {
        padding: 18px;
      }
      :host([bare]) .frame {
        padding: 0;
        background: transparent;
        border-radius: 0;
      }
    `,
  ]

  static override properties = {
    ...KitElement.properties,
    request: { attribute: false },
    overlay: { state: true },
    ...Object.fromEntries(ATTRIBUTES.map((name) => [name, { type: String, reflect: false }])),
  }

  /** Set as a property to skip attributes entirely: `widget.request = { view: 'swap', pool }`. */
  declare request: ViewRequest | undefined
  declare overlay: Overlay

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed)
    if (changed.has('request') || ATTRIBUTES.some((a) => changed.has(a as never))) this.overlay = undefined
  }

  /** The request from the `request` property, or else from attributes. */
  get resolvedRequest(): ViewRequest {
    if (this.request) return this.request
    const attrs = (key: string) => {
      const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      return this.getAttribute(kebab) ?? this.getAttribute(key)
    }
    return parseViewRequest(attrs, 'swap')
  }

  protected override onKitState(state: KitState) {
    // Once connected, a connect overlay has done its job.
    if (this.overlay === 'connect' && state.address) this.overlay = undefined
  }

  override render() {
    const kit = this.activeKit
    if (!kit || !this.state) return html`<div class="frame">${this.noKit()}</div>`
    const request = this.resolvedRequest
    const back = html`<div class="header" style="margin-bottom:6px">
      <button class="icon-button" aria-label="Back" @click=${() => (this.overlay = undefined)}>${backIcon}</button>
    </div>`

    let body
    if (this.overlay === 'connect') body = html`${back}<coven-connect-view .kit=${kit}></coven-connect-view>`
    else if (this.overlay === 'account') body = html`${back}<coven-account-view .kit=${kit}></coven-account-view>`
    else if (request.view === 'swap') {
      const { view: _view, ...params } = request
      body = html`<coven-swap-view .kit=${kit} .params=${params}></coven-swap-view>`
    } else if (request.view === 'account' || this.state.address) body = html`<coven-account-view .kit=${kit}></coven-account-view>`
    else body = html`<coven-connect-view .kit=${kit}></coven-connect-view>`

    return html`<div
      class="frame enter"
      @coven-need-connect=${(e: Event) => {
        e.stopPropagation()
        if (kit.mode === 'provider') kit.requestConnect()
        else this.overlay = 'connect'
      }}
      @coven-open-account=${(e: Event) => {
        e.stopPropagation()
        this.overlay = 'account'
      }}
    >
      ${body ?? nothing}
    </div>`
  }
}
