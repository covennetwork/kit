import type { CreateConnectorFn } from '@wagmi/core'
import { coinbaseWallet } from '@wagmi/connectors/coinbaseWallet'
import { injected } from '@wagmi/connectors/injected'
import { metaMask } from '@wagmi/connectors/metaMask'
import { safe } from '@wagmi/connectors/safe'
import { walletConnect } from '@wagmi/connectors/walletConnect'

/**
 * Coven's WalletConnect project id. It is public by design (it ships to every browser that loads
 * a WalletConnect dapp). Integrators can pass their own to get their own usage dashboard.
 */
export const COVEN_WALLETCONNECT_PROJECT_ID = '793c9762929d3486e9f983c3c724d5dc'

export type AppMetadata = {
  name: string
  description?: string
  url?: string
  icon?: string
}

export type ConnectorOptions = {
  app: AppMetadata
  walletConnectProjectId?: string
}

/**
 * The default connector set. EIP-6963 discovery (enabled on the config) adds every installed
 * browser wallet on top of these, each as its own connector.
 *
 * Base Account is left out on purpose: its SDK imports viem's full chain list, which roughly
 * doubles the kit's first load. Apps that want it pass `baseAccount()` in `wallet.connectors`.
 */
export function defaultConnectors({ app, walletConnectProjectId }: ConnectorOptions): CreateConnectorFn[] {
  const url = app.url ?? (typeof location !== 'undefined' ? location.origin : 'https://coven.network')
  const icons = app.icon ? [app.icon] : []
  const projectId = walletConnectProjectId || COVEN_WALLETCONNECT_PROJECT_ID
  const connectors: CreateConnectorFn[] = [
    // The legacy `window.ethereum` fallback, for wallets that do not announce through EIP-6963.
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId,
      // The kit draws its own QR code from the `display_uri` message.
      showQrModal: false,
      metadata: { name: app.name, description: app.description ?? app.name, url, icons },
    }),
    metaMask({ dapp: { name: app.name, url, ...(app.icon ? { iconUrl: app.icon } : {}) } }),
    coinbaseWallet({ appName: app.name, ...(app.icon ? { appLogoUrl: app.icon } : {}) }),
  ]
  // The Safe connector only works when the app runs inside the Safe{Wallet} interface, which
  // loads dapps in an iframe. Anywhere else it would sit in the list and fail.
  if (typeof window !== 'undefined' && window.parent !== window) connectors.push(safe())
  return connectors
}

/**
 * Which connectors to show. Once EIP-6963 has surfaced the real wallets behind `window.ethereum`,
 * the generic `injected` entry is a nameless duplicate, so it is hidden. When nothing announced
 * itself (a plain mobile browser, an old extension), it stays as the only browser wallet entry.
 */
export function visibleConnectors<T extends { id: string; type: string }>(connectors: readonly T[]): T[] {
  const announced = connectors.some((c) => c.type === 'injected' && c.id !== 'injected')
  const seen = new Set<string>()
  return connectors.filter((c) => {
    if (announced && c.type === 'injected' && c.id === 'injected') return false
    // MetaMask announces through EIP-6963 *and* has its own SDK connector; keep the announced one.
    if (c.id === 'metaMaskSDK' && connectors.some((o) => o.id === 'io.metamask')) return false
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}
