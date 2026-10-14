import { css, html, nothing } from 'lit'
import type { KitState } from '../core/kit.js'
import { KitElement, closeIcon } from './base.js'
import { baseStyles } from './styles.js'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The modal behind `kit.open()`. It follows the WAI-ARIA dialog pattern: focus moves in and is
 * kept inside, Escape and the backdrop close it, and focus returns to where it was.
 */
export class CovenModal extends KitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: none;
        font-size: 16px;
      }
      :host([open]) {
        display: block;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        background: rgb(0 0 0 / 0.42);
        backdrop-filter: blur(3px);
        animation: fade 200ms ease both;
      }
      .dialog {
        position: absolute;
        left: 50%;
        top: 50%;
        width: min(440px, calc(100vw - 24px));
        max-height: calc(100dvh - 24px);
        overflow-y: auto;
        transform: translate(-50%, -50%);
        border-radius: var(--coven-radius);
        background: var(--coven-surface);
        box-shadow: 0 30px 80px rgb(0 0 0 / 0.25);
        animation: rise 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      @media (max-width: 520px) {
        .dialog {
          top: auto;
          bottom: 0;
          width: 100vw;
          transform: translateX(-50%);
          border-bottom-left-radius: 0;
          border-bottom-right-radius: 0;
          max-height: 92dvh;
        }
      }
      .close {
        position: absolute;
        top: 14px;
        right: 14px;
        z-index: 1;
      }
      coven-widget {
        --coven-bg: var(--coven-surface);
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }
      @keyframes rise {
        from {
          opacity: 0;
          margin-top: 12px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .backdrop,
        .dialog {
          animation: none;
        }
      }
    `,
  ]

  private returnFocus: Element | null = null
  private wasOpen = false
  private lastAddress: string | undefined

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.state?.modal.open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.activeKit?.close()
      return
    }
    if (event.key === 'Tab') this.trapFocus(event)
  }

  override connectedCallback() {
    super.connectedCallback()
    document.addEventListener('keydown', this.onKeyDown, true)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('keydown', this.onKeyDown, true)
  }

  protected override onKitBound() {
    this.lastAddress = this.state?.address
    // The modal is mounted lazily, after `kit.open()` has already changed the state.
    if (this.state) this.onKitState(this.state)
  }

  protected override onKitState(state: KitState) {
    const justConnected = Boolean(state.address) && !this.lastAddress
    this.lastAddress = state.address
    // A modal opened only to connect has nothing left to do once a wallet is connected.
    if (justConnected && state.modal.open && state.modal.request.view === 'connect') {
      this.activeKit?.close()
      return
    }
    const open = state.modal.open
    this.toggleAttribute('open', open)
    if (open && !this.wasOpen) {
      this.returnFocus = deepActiveElement()
      document.documentElement.style.setProperty('overflow', 'hidden')
      void this.updateComplete.then(() => this.focusFirst())
    } else if (!open && this.wasOpen) {
      document.documentElement.style.removeProperty('overflow')
      ;(this.returnFocus as HTMLElement | null)?.focus?.()
      this.returnFocus = null
    }
    this.wasOpen = open
  }

  private focusables(): HTMLElement[] {
    // Focusable elements live in nested shadow roots, so walk them.
    const out: HTMLElement[] = []
    const walk = (root: ParentNode) => {
      for (const el of root.querySelectorAll<HTMLElement>('*')) {
        if (el.matches(FOCUSABLE) && el.offsetParent !== null) out.push(el)
        if (el.shadowRoot) walk(el.shadowRoot)
      }
    }
    const dialog = this.renderRoot.querySelector('.dialog')
    if (dialog) walk(dialog)
    return out
  }

  private focusFirst() {
    const items = this.focusables()
    // Skip the close button so focus lands on the view's first real control.
    ;(items[1] ?? items[0])?.focus()
  }

  private trapFocus(event: KeyboardEvent) {
    const items = this.focusables()
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const active = deepActiveElement()
    if (event.shiftKey && (active === first || !items.includes(active as HTMLElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !items.includes(active as HTMLElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  override render() {
    const kit = this.activeKit
    const state = this.state
    if (!kit || !state?.modal.open) return nothing
    const request = state.modal.request
    const label = request.view === 'swap' ? 'Swap' : request.view === 'account' ? 'Account' : 'Connect a wallet'
    return html`
      <div class="backdrop" @click=${() => kit.close()}></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label=${label}
      >
        <button class="icon-button close" aria-label="Close" @click=${() => kit.close()}>${closeIcon}</button>
        <coven-widget .kit=${kit} .request=${request}></coven-widget>
      </div>
    `
  }
}

function deepActiveElement(): Element | null {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}
