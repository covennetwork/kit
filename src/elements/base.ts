import { LitElement, html, nothing, type PropertyValues } from 'lit'
import { type Kit, type KitState, getDefaultKit, onDefaultKit } from '../core/kit.js'
import { themeVariables } from '../core/theme.js'

/**
 * Base for every kit element: finds its kit (the `kit` property, or the default kit once one is
 * created), re-renders on kit state changes, and writes the theme tokens on its host.
 */
export class KitElement extends LitElement {
  static override properties = {
    kit: { attribute: false },
  }

  declare kit: Kit | undefined
  protected state: KitState | undefined
  private unsubscribe?: () => void
  private stopWaiting?: () => void
  private bound?: Kit

  override connectedCallback() {
    super.connectedCallback()
    this.bind()
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    this.unbind()
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('kit')) this.bind()
  }

  protected get activeKit(): Kit | undefined {
    return this.kit ?? getDefaultKit()
  }

  private bind() {
    const kit = this.activeKit
    if (!kit) {
      this.stopWaiting ??= onDefaultKit(() => this.bind())
      return
    }
    this.stopWaiting?.()
    this.stopWaiting = undefined
    if (this.bound === kit) return
    this.unsubscribe?.()
    this.bound = kit
    this.state = kit.getState()
    this.applyTheme()
    this.unsubscribe = kit.subscribe((state) => {
      const themeChanged = state.theme !== this.state?.theme
      this.state = state
      if (themeChanged) this.applyTheme()
      this.onKitState(state)
      this.requestUpdate()
    })
    this.onKitBound(kit)
    this.requestUpdate()
  }

  private unbind() {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.stopWaiting?.()
    this.stopWaiting = undefined
    this.bound = undefined
  }

  private applyTheme() {
    const theme = this.state?.theme
    if (!theme) return
    for (const [name, value] of Object.entries(themeVariables(theme))) this.style.setProperty(name, value)
    this.toggleAttribute('compact', theme.compact)
    this.dataset.mode = theme.mode
  }

  /** Called once a kit is bound (or re-bound). */
  protected onKitBound(_kit: Kit): void {}

  /** Called on every kit state change, before render. */
  protected onKitState(_state: KitState): void {}

  protected noKit() {
    return html`<p class="note">Create a kit with <code>createKit()</code> to show this.</p>`
  }
}

export const loading = (label = 'Loading') =>
  html`<span class="loading" role="status" aria-label=${label}><span></span><span></span><span></span></span>`

export const avatar = (name: string, icon?: string) =>
  html`<span class="avatar" aria-hidden="true">${icon ? html`<img src=${icon} alt="" loading="lazy" />` : name.slice(0, 1).toUpperCase()}</span>`

export const maybe = <T>(value: T | undefined | null | false, render: (v: T) => unknown) => (value ? render(value) : nothing)

export const backIcon = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
export const closeIcon = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
export const copyIcon = html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
export const flipIcon = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
