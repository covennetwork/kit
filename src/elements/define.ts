import { CovenConnectButton } from './connect-button.js'
import { CovenModal } from './modal.js'
import { CovenAccountView, CovenChainPicker } from './views/account.js'
import { CovenConnectView } from './views/connect.js'
import { CovenSwapView, CovenTokenPicker } from './views/swap.js'
import { CovenWidget } from './widget.js'

const ELEMENTS: [string, CustomElementConstructor][] = [
  ['coven-widget', CovenWidget],
  ['coven-modal', CovenModal],
  ['coven-connect-button', CovenConnectButton],
  ['coven-connect-view', CovenConnectView],
  ['coven-account-view', CovenAccountView],
  ['coven-chain-picker', CovenChainPicker],
  ['coven-swap-view', CovenSwapView],
  ['coven-token-picker', CovenTokenPicker],
]

/** Registers every kit element once. Safe to call repeatedly and from several bundles. */
export function defineElements() {
  if (typeof customElements === 'undefined') return
  for (const [name, ctor] of ELEMENTS) if (!customElements.get(name)) customElements.define(name, ctor)
}

export { CovenAccountView, CovenChainPicker, CovenConnectButton, CovenConnectView, CovenModal, CovenSwapView, CovenTokenPicker, CovenWidget }
