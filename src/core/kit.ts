import { MAX_INTEGRATOR_FEE_BPS, arc, createCoven, type Coven, type Integrator } from '@covennetwork/sdk'
import {
  type Config,
  type CreateConnectorFn,
  connect as wagmiConnect,
  createConfig,
  createStorage,
  disconnect as wagmiDisconnect,
  getAccount,
  getWalletClient,
  reconnect,
  switchChain as wagmiSwitchChain,
  watchAccount,
  watchConnectors,
} from '@wagmi/core'
import { injected } from '@wagmi/connectors/injected'
import { type Address, type Chain, type EIP1193Provider, type Transport, type WalletClient, http } from 'viem'
import { accountId, chainId as caipChain } from './caip.js'
import { mainnets, withDefaultFirst } from './chains.js'
import { type AppMetadata, defaultConnectors, visibleConnectors } from './connectors.js'
import { Emitter, type KitEventName, type KitEvents } from './events.js'
import { type ResolvedTheme, type Theme, resolveTheme } from './theme.js'
import { type Balance, type TokenInfo, TokenDirectory, UNISWAP_TOKEN_LIST_URL, readBalances } from './tokens.js'
import type { ViewRequest } from './views.js'

/**
 * Who owns the wallet connection. The kit never opens a second one:
 * - managed (default): the kit connects wallets itself, with every standard connector.
 * - wagmiConfig: the host app already uses wagmi; the kit shares that config and connection.
 * - provider: the host has its own wallet kit; the kit uses its EIP-1193 provider and asks the
 *   host to connect instead of showing its own wallet list.
 */
export type WalletOption =
  | {
      walletConnectProjectId?: string
      /** Added to the default set: any wagmi connector (Base Account, Ledger, Porto, a mock…). */
      connectors?: CreateConnectorFn[]
      /** Set false to offer only `connectors`. EIP-6963 browser wallets still appear. */
      defaultConnectors?: boolean
    }
  | { wagmiConfig: Config }
  | { provider: EIP1193Provider; onConnectRequest?: () => void }

export type KitConfig = {
  app?: AppMetadata
  /** Chains to offer. Defaults to every EVM mainnet viem ships. */
  chains?: readonly Chain[]
  /** Chain the kit starts on and the connect flow prefers. Default Arc. */
  defaultChainId?: number
  /** RPC transports per chain id. Defaults to each chain's public RPC. */
  transports?: Record<number, Transport>
  wallet?: WalletOption
  /** Fee recipient and rate (basis points, capped at 300) for every swap made through the kit. */
  integrator?: Integrator
  theme?: Theme
  /** Extra tokens to read balances for, on any chain. */
  tokens?: TokenInfo[]
  /** Token lists in the Uniswap format. Default: the Uniswap default list. */
  tokenLists?: string[]
  /** Becomes the default kit that elements without a `kit` property use. Default true. */
  setAsDefault?: boolean
}

export type WalletMode = 'managed' | 'wagmi' | 'provider'

export type ConnectorInfo = { uid: string; id: string; name: string; icon?: string; type: string }

export type KitState = {
  status: 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
  address?: Address
  /** The chain the wallet is on, which may be any chain, not only Arc. */
  chainId?: number
  connector?: ConnectorInfo
  connectors: ConnectorInfo[]
  modal: { open: boolean; request: ViewRequest }
  theme: ResolvedTheme
}

export interface Kit {
  readonly mode: WalletMode
  readonly wagmiConfig: Config
  readonly coven: Coven
  readonly chains: readonly Chain[]
  readonly arcChainId: number
  readonly defaultChainId: number
  readonly app: AppMetadata
  readonly integrator?: Integrator
  readonly tokens: TokenDirectory
  getState(): KitState
  subscribe(listener: (state: KitState) => void): () => void
  on<K extends KitEventName>(name: K, handler: (payload: KitEvents[K]) => void): () => void
  /** @internal Used by the iframe to forward every event to its host. */
  onAny(handler: (name: KitEventName, payload: unknown) => void): () => void
  /** @internal Emits an event from a view. */
  emit<K extends KitEventName>(name: K, payload: KitEvents[K]): void
  /** Shows a view in the modal. Loads the UI on first use. */
  open(request?: ViewRequest): void
  close(): void
  connect(connectorUid: string): Promise<void>
  disconnect(): Promise<void>
  switchChain(chainId: number): Promise<void>
  /** Asks for a connection: the host's own flow in provider mode, the connect view otherwise. */
  requestConnect(): void
  /** Moves the wallet to `chainId` if needed, then returns a wallet client bound to that chain. */
  walletOn(chainId: number): Promise<WalletClient>
  balances(params?: { address?: Address; chainId?: number }): Promise<Balance[]>
  getProvider(): Promise<EIP1193Provider | undefined>
  getConnector(uid: string): Config['connectors'][number] | undefined
  setTheme(theme: Theme): void
  destroy(): void
}

let defaultKit: Kit | undefined
const defaultKitListeners = new Set<(kit: Kit) => void>()

export function getDefaultKit(): Kit | undefined {
  return defaultKit
}

export function setDefaultKit(kit: Kit) {
  defaultKit = kit
  for (const listener of defaultKitListeners) listener(kit)
}

/** Lets elements created before `createKit` runs pick up the kit once it exists. */
export function onDefaultKit(listener: (kit: Kit) => void): () => void {
  defaultKitListeners.add(listener)
  return () => defaultKitListeners.delete(listener)
}

const browser = typeof window !== 'undefined'

// In the browser `fetch` must keep `window` as its receiver; the SDK calls it as `ctx.fetch()`.
const boundFetch: typeof fetch = (input, init) => fetch(input, init)

export function createKit(config: KitConfig = {}): Kit {
  const app: AppMetadata = { name: 'Coven', ...config.app }
  const wallet = config.wallet ?? {}
  const mode: WalletMode = 'wagmiConfig' in wallet ? 'wagmi' : 'provider' in wallet ? 'provider' : 'managed'

  let wagmiConfig: Config
  if ('wagmiConfig' in wallet) {
    wagmiConfig = wallet.wagmiConfig
  } else {
    const defaultChainId = config.defaultChainId ?? arc.id
    const chains = withDefaultFirst(config.chains?.length ? config.chains : mainnets(), defaultChainId)
    const transports: Record<number, Transport> = {}
    for (const chain of chains) transports[chain.id] = config.transports?.[chain.id] ?? http()
    const connectors =
      'provider' in wallet
        ? [hostConnector(wallet.provider, app.name)]
        : [
            ...(wallet.defaultConnectors === false ? [] : defaultConnectors({ app, walletConnectProjectId: wallet.walletConnectProjectId })),
            ...(wallet.connectors ?? []),
          ]
    wagmiConfig = createConfig({
      chains,
      transports,
      connectors,
      multiInjectedProviderDiscovery: mode === 'managed',
      storage: createStorage({ key: 'coven-kit', storage: browser ? safeLocalStorage() : undefined }),
      ssr: !browser,
    })
  }

  const chains = wagmiConfig.chains
  const defaultChainId = chains.some((c) => c.id === (config.defaultChainId ?? arc.id)) ? (config.defaultChainId ?? arc.id) : chains[0].id
  const arcTransport = config.transports?.[arc.id]
  const integrator = config.integrator?.address
    ? { address: config.integrator.address, feeBps: Math.max(0, Math.min(Math.trunc(config.integrator.feeBps || 0), MAX_INTEGRATOR_FEE_BPS)) }
    : undefined
  const coven = createCoven({ fetch: boundFetch, ...(arcTransport ? { arcTransport } : {}), ...(integrator ? { integrator } : {}) })
  const tokens = new TokenDirectory({
    coven,
    arcChainId: arc.id,
    listUrls: config.tokenLists ?? [UNISWAP_TOKEN_LIST_URL],
    extra: config.tokens ?? [],
    fetch: boundFetch,
  })

  const emitter = new Emitter()
  const listeners = new Set<(state: KitState) => void>()
  let themeInput: Theme = config.theme ?? {}
  const media = browser && typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined

  const connectorInfo = (c: Config['connectors'][number]): ConnectorInfo => ({ uid: c.uid, id: c.id, name: c.name, icon: c.icon, type: c.type })
  const readWallet = () => {
    const account = getAccount(wagmiConfig)
    return {
      status: account.status,
      address: account.address,
      chainId: account.chainId,
      connector: account.connector ? connectorInfo(account.connector) : undefined,
    }
  }

  let state: KitState = {
    ...readWallet(),
    connectors: visibleConnectors(wagmiConfig.connectors).map(connectorInfo),
    modal: { open: false, request: { view: 'swap' } },
    theme: resolveTheme(themeInput, media?.matches),
  }

  const set = (patch: Partial<KitState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  const cleanups: (() => void)[] = []

  cleanups.push(
    watchAccount(wagmiConfig, {
      onChange(next, prev) {
        set(readWallet())
        if (next.status === 'connected' && next.address && next.chainId) {
          if (prev.status !== 'connected') {
            emitter.emit('connect', {
              account: accountId(next.chainId, next.address),
              chain: caipChain(next.chainId),
              connector: next.connector?.name ?? 'wallet',
            })
          } else {
            if (prev.address && next.address !== prev.address) emitter.emit('accountChanged', { account: accountId(next.chainId, next.address) })
            if (next.chainId !== prev.chainId) emitter.emit('chainChanged', { chain: caipChain(next.chainId) })
          }
        } else if (next.status === 'disconnected' && prev.status === 'connected') {
          emitter.emit('disconnect', {})
        }
      },
    }),
  )
  cleanups.push(watchConnectors(wagmiConfig, { onChange: (list) => set({ connectors: visibleConnectors(list).map(connectorInfo) }) }))
  if (media) {
    const onScheme = () => set({ theme: resolveTheme(themeInput, media.matches) })
    media.addEventListener('change', onScheme)
    cleanups.push(() => media.removeEventListener('change', onScheme))
  }

  if (browser && mode !== 'wagmi') {
    // Restores the last session (managed) or picks up an already-authorized host wallet (provider).
    void reconnect(wagmiConfig).catch(() => undefined)
  }

  let modalLoaded: Promise<unknown> | undefined

  const kit: Kit = {
    mode,
    wagmiConfig,
    coven,
    chains,
    arcChainId: arc.id,
    defaultChainId,
    app,
    integrator,
    tokens,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    on: (name, handler) => emitter.on(name, handler),
    onAny: (handler) => emitter.onAny(handler),
    emit: (name, payload) => emitter.emit(name, payload),
    open(request = { view: state.address ? 'account' : 'connect' }) {
      if (!browser) return
      modalLoaded ??= import('../elements/modal-host.js').then((m) => m.mountModal(kit))
      set({ modal: { open: true, request } })
      emitter.emit('viewChanged', { open: true, request })
    },
    close() {
      if (!state.modal.open) return
      set({ modal: { ...state.modal, open: false } })
      emitter.emit('viewChanged', { open: false, request: state.modal.request })
    },
    async connect(uid) {
      const connector = wagmiConfig.connectors.find((c) => c.uid === uid)
      if (!connector) throw new Error('That wallet is no longer available.')
      // Connect on the current wallet chain when it is supported; the swap view switches per step.
      await wagmiConnect(wagmiConfig, { connector })
    },
    async disconnect() {
      await wagmiDisconnect(wagmiConfig)
    },
    async switchChain(chainId) {
      if (getAccount(wagmiConfig).chainId === chainId) return
      await wagmiSwitchChain(wagmiConfig, { chainId })
    },
    requestConnect() {
      if ('provider' in wallet && wallet.onConnectRequest) return wallet.onConnectRequest()
      if ('provider' in wallet) {
        const host = wagmiConfig.connectors[0]
        if (host) void wagmiConnect(wagmiConfig, { connector: host }).catch((error: unknown) => emitError(emitter, error))
        return
      }
      kit.open({ view: 'connect' })
    },
    async walletOn(chainId) {
      if (!chains.some((c) => c.id === chainId)) {
        throw new Error(`Chain ${chainId} is not in this app's chain list.`)
      }
      const account = getAccount(wagmiConfig)
      if (!account.address) throw new Error('Connect a wallet first.')
      if (account.chainId !== chainId) await wagmiSwitchChain(wagmiConfig, { chainId })
      // A fresh client every time: one fetched before the switch is still bound to the old chain.
      return getWalletClient(wagmiConfig, { chainId }) as Promise<WalletClient>
    },
    balances(params = {}) {
      const address = params.address ?? state.address
      const chainId = params.chainId ?? state.chainId ?? defaultChainId
      if (!address) return Promise.resolve([])
      return readBalances(wagmiConfig, tokens, { address, chainId })
    },
    async getProvider() {
      const connector = getAccount(wagmiConfig).connector
      return connector ? ((await connector.getProvider()) as EIP1193Provider) : undefined
    },
    getConnector: (uid) => wagmiConfig.connectors.find((c) => c.uid === uid),
    setTheme(theme) {
      themeInput = { ...themeInput, ...theme }
      set({ theme: resolveTheme(themeInput, media?.matches) })
    },
    destroy() {
      for (const cleanup of cleanups) cleanup()
      emitter.clear()
      listeners.clear()
      if (defaultKit === kit) defaultKit = undefined
    },
  }

  if (config.setAsDefault !== false) setDefaultKit(kit)
  return kit
}

function emitError(emitter: Emitter, error: unknown) {
  emitter.emit('error', { message: error instanceof Error ? error.message : String(error) })
}

/** Wraps a host's EIP-1193 provider as the one connector the kit offers in provider mode. */
function hostConnector(provider: EIP1193Provider, name: string): CreateConnectorFn {
  return injected({ target: { id: 'host', name, provider: provider as never }, shimDisconnect: false })
}

function safeLocalStorage() {
  try {
    const probe = '__coven_kit__'
    localStorage.setItem(probe, probe)
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return undefined
  }
}
