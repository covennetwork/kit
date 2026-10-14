import type { EIP1193Provider } from 'viem'

/**
 * Messages between a page and the hosted Coven iframe. Every message is wrapped in a versioned
 * envelope, so the format can change without breaking hosts on an older version.
 */
export const PROTOCOL = 'coven' as const
export const PROTOCOL_VERSION = 1 as const

export type Envelope<T extends string = string, P = unknown> = {
  protocol: typeof PROTOCOL
  version: typeof PROTOCOL_VERSION
  type: T
  payload: P
}

export type IframeToHost =
  | Envelope<'ready', Record<string, never>>
  | Envelope<'resize', { height: number }>
  | Envelope<'event', { name: string; payload: unknown }>
  | Envelope<'rpc', { id: string; method: string; params?: unknown }>
  | Envelope<'connect-request', Record<string, never>>

export type HostToIframe =
  | Envelope<'rpc-result', { id: string; result?: unknown; error?: { code: number; message: string } }>
  | Envelope<'provider-event', { event: 'accountsChanged' | 'chainChanged' | 'disconnect'; data: unknown }>

export const envelope = <T extends string, P>(type: T, payload: P): Envelope<T, P> => ({ protocol: PROTOCOL, version: PROTOCOL_VERSION, type, payload })

export const isEnvelope = (data: unknown): data is Envelope =>
  typeof data === 'object' && data !== null && (data as Envelope).protocol === PROTOCOL && (data as Envelope).version === PROTOCOL_VERSION && typeof (data as Envelope).type === 'string'

/**
 * Methods the iframe may forward to the host's wallet. Account, chain and transaction methods,
 * plus the read-only calls viem makes through the wallet while preparing a transaction. Message
 * and typed-data signing are deliberately absent: Coven's flows never need them, and a signature
 * request is the one thing a compromised iframe could abuse without a visible transaction.
 */
export const BRIDGED_METHODS = new Set([
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_getCapabilities',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
])

type ProviderEvent = 'accountsChanged' | 'chainChanged' | 'disconnect' | 'connect'

/**
 * Inside the iframe: an EIP-1193 provider whose requests are answered by the host page's wallet.
 * Only messages from the parent window at `parentOrigin` are trusted.
 */
export function createParentProvider(options: { parentOrigin: string; timeoutMs?: number; target?: Window }): EIP1193Provider {
  const target = options.target ?? window.parent
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
  const listeners = new Map<ProviderEvent, Set<(data: unknown) => void>>()

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== target || event.origin !== options.parentOrigin || !isEnvelope(event.data)) return
    const message = event.data as HostToIframe
    if (message.type === 'rpc-result') {
      const entry = pending.get(message.payload.id)
      if (!entry) return
      pending.delete(message.payload.id)
      clearTimeout(entry.timer)
      if (message.payload.error) entry.reject(Object.assign(new Error(message.payload.error.message), { code: message.payload.error.code }))
      else entry.resolve(message.payload.result)
    } else if (message.type === 'provider-event') {
      for (const handler of listeners.get(message.payload.event) ?? []) handler(message.payload.data)
    }
  })

  const provider = {
    request({ method, params }: { method: string; params?: unknown }) {
      if (!BRIDGED_METHODS.has(method)) {
        return Promise.reject(Object.assign(new Error(`${method} is not available in the Coven iframe.`), { code: 4200 }))
      }
      const id = randomId()
      return new Promise((resolve, reject) => {
        // Wallet prompts wait on the user, so the timeout is generous.
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(Object.assign(new Error('The host page did not answer.'), { code: 4900 }))
        }, options.timeoutMs ?? 10 * 60_000)
        pending.set(id, { resolve, reject, timer })
        target.postMessage(envelope('rpc', { id, method, params }), options.parentOrigin)
      })
    },
    on(event: ProviderEvent, handler: (data: unknown) => void) {
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(handler)
      return provider
    },
    removeListener(event: ProviderEvent, handler: (data: unknown) => void) {
      listeners.get(event)?.delete(handler)
      return provider
    },
  }
  return provider as unknown as EIP1193Provider
}

export type BridgeOptions = {
  /** The iframe's origin, e.g. https://coven.network. Messages from anywhere else are ignored. */
  iframeOrigin: string
  /** The host's wallet. */
  provider: EIP1193Provider
  /** Called when the user presses "Connect" inside the iframe. */
  onConnectRequest?: () => void
  /** Receives every kit event the iframe emits. */
  onEvent?: (name: string, payload: unknown) => void
  onResize?: (height: number) => void
}

/** On the host page: answers the iframe's wallet requests with `provider`. Returns a cleanup. */
export function bridgeProvider(iframe: HTMLIFrameElement, options: BridgeOptions): () => void {
  const post = (message: HostToIframe) => iframe.contentWindow?.postMessage(message, options.iframeOrigin)

  const onMessage = async (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== options.iframeOrigin || !isEnvelope(event.data)) return
    const message = event.data as IframeToHost
    if (message.type === 'resize') options.onResize?.(message.payload.height)
    else if (message.type === 'event') options.onEvent?.(message.payload.name, message.payload.payload)
    else if (message.type === 'connect-request') options.onConnectRequest?.()
    else if (message.type === 'rpc') {
      const { id, method, params } = message.payload
      if (!BRIDGED_METHODS.has(method)) {
        post(envelope('rpc-result', { id, error: { code: 4200, message: `${method} is not bridged.` } }))
        return
      }
      try {
        const result = await options.provider.request({ method, params } as never)
        post(envelope('rpc-result', { id, result }))
      } catch (error) {
        const e = error as { code?: number; message?: string }
        post(envelope('rpc-result', { id, error: { code: typeof e.code === 'number' ? e.code : -32603, message: e.message ?? 'Request failed.' } }))
      }
    }
  }
  window.addEventListener('message', onMessage)

  const forward = (name: 'accountsChanged' | 'chainChanged' | 'disconnect') => (data: unknown) => post(envelope('provider-event', { event: name, data }))
  const handlers = { accountsChanged: forward('accountsChanged'), chainChanged: forward('chainChanged'), disconnect: forward('disconnect') }
  const p = options.provider as unknown as { on?: (e: string, h: (d: unknown) => void) => void; removeListener?: (e: string, h: (d: unknown) => void) => void }
  for (const [name, handler] of Object.entries(handlers)) p.on?.(name, handler)

  return () => {
    window.removeEventListener('message', onMessage)
    for (const [name, handler] of Object.entries(handlers)) p.removeListener?.(name, handler)
  }
}

/**
 * The embedding page's origin, as the browser reports it. `ancestorOrigins` cannot be forged by
 * the page; the referrer is the fallback where it is missing (Firefox).
 */
export function embedderOrigin(): string | undefined {
  if (typeof window === 'undefined' || window.parent === window) return undefined
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins
  if (ancestors && ancestors.length > 0) return ancestors[0]
  try {
    return document.referrer ? new URL(document.referrer).origin : undefined
  } catch {
    return undefined
  }
}

function randomId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
