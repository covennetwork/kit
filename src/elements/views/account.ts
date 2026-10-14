import { html, nothing } from 'lit'
import type { Chain } from 'viem'
import { errorMessage, formatAmount, shortAddress } from '../../core/format.js'
import type { Kit, KitState } from '../../core/kit.js'
import type { Balance } from '../../core/tokens.js'
import { KitElement, avatar, backIcon, copyIcon, loading } from '../base.js'
import { baseStyles } from '../styles.js'

type Screen = 'home' | 'chains'

/** Address, balances on the current chain, network switcher and disconnect. */
export class CovenAccountView extends KitElement {
  static override styles = [baseStyles]

  static override properties = {
    ...KitElement.properties,
    screen: { state: true },
    balances: { state: true },
    loadingBalances: { state: true },
    note: { state: true },
    copied: { state: true },
  }

  declare screen: Screen
  declare balances: Balance[] | undefined
  declare loadingBalances: boolean
  declare note: string | undefined
  declare copied: boolean
  private key = ''
  private request = 0

  constructor() {
    super()
    this.screen = 'home'
    this.loadingBalances = false
    this.copied = false
  }

  protected override onKitBound() {
    this.refresh()
  }

  protected override onKitState(state: KitState) {
    if (`${state.address}:${state.chainId}` !== this.key) this.refresh()
  }

  private refresh() {
    const kit = this.activeKit
    const state = kit?.getState()
    if (!kit || !state?.address) return
    this.key = `${state.address}:${state.chainId}`
    const request = ++this.request
    this.loadingBalances = true
    kit
      .balances()
      .then((balances) => {
        if (request === this.request) this.balances = balances
      })
      .catch(() => {
        if (request === this.request) this.balances = []
      })
      .finally(() => {
        if (request === this.request) this.loadingBalances = false
      })
  }

  private async switchTo(kit: Kit, chain: Chain) {
    this.note = undefined
    try {
      await kit.switchChain(chain.id)
      this.screen = 'home'
    } catch (error) {
      this.note = errorMessage(error)
    }
  }

  private async copy(address: string) {
    try {
      await navigator.clipboard.writeText(address)
      this.copied = true
      setTimeout(() => (this.copied = false), 1600)
    } catch {
      // Clipboard access can be blocked inside iframes.
    }
  }

  override render() {
    const kit = this.activeKit
    const state = this.state
    if (!kit || !state) return this.noKit()
    if (!state.address) return html`<coven-connect-view .kit=${kit}></coven-connect-view>`

    if (this.screen === 'chains') {
      return html`<coven-chain-picker
        .kit=${kit}
        .selected=${state.chainId}
        @coven-back=${() => (this.screen = 'home')}
        @coven-chain=${(e: CustomEvent<Chain>) => this.switchTo(kit, e.detail)}
      ></coven-chain-picker>`
    }

    const chain = kit.chains.find((c) => c.id === state.chainId)
    return html`
      <div class="header">
        <p class="label">Account</p>
        <button class="chip" @click=${() => (this.screen = 'chains')} aria-label="Switch network">
          <span class="dot" aria-hidden="true"></span>${chain?.name ?? `Unsupported network ${state.chainId ?? ''}`}
        </button>
      </div>
      <h2 class="title">
        <button class="slot" style="font:inherit" @click=${() => this.copy(state.address!)} aria-label="Copy address">
          ${shortAddress(state.address)}
        </button>
      </h2>
      <p class="note" aria-live="polite">${this.copied ? 'Address copied.' : `Connected with ${state.connector?.name ?? 'your wallet'}.`}</p>
      ${this.note ? html`<p class="note error gap-md">${this.note}</p>` : nothing}

      <div class="gap-lg">
        <div class="row">
          <p class="label">Balances on ${chain?.name ?? 'this network'}</p>
          <button class="ghost" @click=${() => this.refresh()} ?disabled=${this.loadingBalances}>Refresh</button>
        </div>
        <div class="scroll gap-md">${this.renderBalances()}</div>
      </div>

      <div class="gap-lg stack">
        <button class="ghost" @click=${() => this.copy(state.address!)}>${copyIcon} Copy address</button>
        <button class="ghost" @click=${() => void kit.disconnect()}>Disconnect</button>
      </div>
    `
  }

  private renderBalances() {
    if (this.loadingBalances && !this.balances) return html`<p class="note">${loading('Loading balances')}</p>`
    if (!this.balances?.length) return html`<p class="note">Nothing on this network yet.</p>`
    return html`<ul class="list" role="list">
      ${this.balances.map(
        (b) => html`<li class="item" style="cursor:default">
          ${avatar(b.symbol, b.logoURI)}
          <span class="grow">${b.symbol}<span class="sub">${b.name}</span></span>
          <span>${formatAmount(b.value, b.decimals, 4)}</span>
        </li>`,
      )}
    </ul>`
  }
}

const MAX_ROWS = 80

/** Searchable list of every configured chain, default chain first. */
export class CovenChainPicker extends KitElement {
  static override styles = [baseStyles]

  static override properties = {
    ...KitElement.properties,
    selected: { attribute: false },
    query: { state: true },
  }

  declare selected: number | undefined
  declare query: string

  constructor() {
    super()
    this.query = ''
  }

  override firstUpdated() {
    this.renderRoot.querySelector<HTMLInputElement>('input')?.focus()
  }

  override render() {
    const kit = this.activeKit
    if (!kit) return this.noKit()
    const q = this.query.trim().toLowerCase()
    const matches = kit.chains.filter((c) => !q || c.name.toLowerCase().includes(q) || String(c.id) === q)
    const shown = matches.slice(0, MAX_ROWS)
    return html`
      <div class="header">
        <button class="icon-button" aria-label="Back" @click=${() => this.dispatchEvent(new CustomEvent('coven-back'))}>${backIcon}</button>
        <p class="label">Network</p>
        <span style="width:32px"></span>
      </div>
      <div class="gap-md">
        <input
          class="search"
          type="search"
          placeholder="Search ${kit.chains.length} networks"
          aria-label="Search networks"
          .value=${this.query}
          @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
        />
      </div>
      <ul class="list scroll gap-md" role="listbox" aria-label="Networks">
        ${shown.map(
          (c) => html`<li>
            <button
              class="item"
              role="option"
              aria-selected=${c.id === this.selected ? 'true' : 'false'}
              @click=${() => this.dispatchEvent(new CustomEvent('coven-chain', { detail: c }))}
            >
              ${avatar(c.name)}
              <span class="grow">${c.name}<span class="sub">Chain ${c.id}</span></span>
              ${c.id === this.selected ? html`<span class="note">Current</span>` : nothing}
            </button>
          </li>`,
        )}
      </ul>
      ${matches.length > shown.length ? html`<p class="note gap-md">Showing ${shown.length} of ${matches.length}. Type to narrow it down.</p>` : nothing}
      ${matches.length === 0 ? html`<p class="note gap-md">No network matches “${this.query}”.</p>` : nothing}
    `
  }
}
