import type { AccountId, AssetId, ChainId } from './caip.js'
import type { ViewRequest } from './views.js'

export type SwapSide = 'buy' | 'sell' | 'swap'

export type SwapEventAsset = { asset: AssetId; symbol: string; decimals: number }

/** Every event the kit emits. The iframe forwards the same names and payloads to its host. */
export type KitEvents = {
  connect: { account: AccountId; chain: ChainId; connector: string }
  disconnect: Record<string, never>
  accountChanged: { account: AccountId }
  chainChanged: { chain: ChainId }
  viewChanged: { open: boolean; request: ViewRequest }
  swapSubmitted: { hash: `0x${string}`; chain: ChainId; kind: SwapKind }
  swapConfirmed: {
    hash: `0x${string}`
    chain: ChainId
    kind: SwapKind
    /** Relative to USDC: `buy` paid USDC, `sell` received it, `swap` is anything else. */
    side: SwapSide
    tokenIn: SwapEventAsset
    tokenOut: SwapEventAsset
    /** Base units as decimal strings, so the payload survives JSON and postMessage. */
    amountIn: string
    amountOut: string
  }
  error: { message: string; code?: string }
}

export type KitEventName = keyof KitEvents

/** `swap` stays on Arc; `deposit` brings USDC from another chain; `bridge-out` sends USDC away. */
export type SwapKind = 'swap' | 'deposit' | 'bridge-out'

type Handler<T> = (payload: T) => void

export class Emitter {
  private handlers = new Map<KitEventName, Set<Handler<never>>>()
  private anyHandlers = new Set<(name: KitEventName, payload: unknown) => void>()

  on<K extends KitEventName>(name: K, handler: Handler<KitEvents[K]>): () => void {
    let set = this.handlers.get(name)
    if (!set) this.handlers.set(name, (set = new Set()))
    set.add(handler as Handler<never>)
    return () => set.delete(handler as Handler<never>)
  }

  /** Receives every event; used by the iframe to forward events to the host page. */
  onAny(handler: (name: KitEventName, payload: unknown) => void): () => void {
    this.anyHandlers.add(handler)
    return () => this.anyHandlers.delete(handler)
  }

  emit<K extends KitEventName>(name: K, payload: KitEvents[K]): void {
    for (const handler of this.handlers.get(name) ?? []) safely(() => (handler as Handler<KitEvents[K]>)(payload))
    for (const handler of this.anyHandlers) safely(() => handler(name, payload))
  }

  clear(): void {
    this.handlers.clear()
    this.anyHandlers.clear()
  }
}

// One integrator's throwing handler must not stop the others or break the kit's own flow.
function safely(run: () => void) {
  try {
    run()
  } catch (error) {
    console.error('[coven-kit] event handler threw', error)
  }
}
