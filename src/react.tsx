import {
  type CSSProperties,
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import { type Kit, type KitState, getDefaultKit } from './core/kit.js'
import type { KitEventName, KitEvents } from './core/events.js'
import type { SwapViewParams, ViewName, ViewRequest } from './core/views.js'
import { defineElements } from './elements/define.js'

if (typeof window !== 'undefined') defineElements()

const KitContext = createContext<Kit | undefined>(undefined)

/** Makes `kit` available to the hooks and components below it. */
export function KitProvider({ kit, children }: { kit: Kit; children?: ReactNode }) {
  return createElement(KitContext.Provider, { value: kit }, children)
}

/** The kit from the nearest `KitProvider`, or the default kit. */
export function useKit(): Kit {
  const kit = useContext(KitContext) ?? getDefaultKit()
  if (!kit) throw new Error('useKit: no kit. Call createKit() and wrap your app in <KitProvider kit={kit}>.')
  return kit
}

/** The kit's state: connection, wallet chain, modal and theme. Re-renders on change. */
export function useKitState(): KitState {
  const kit = useKit()
  return useSyncExternalStore(kit.subscribe, kit.getState, kit.getState)
}

/** Subscribes to a kit event for the component's lifetime. */
export function useKitEvent<K extends KitEventName>(name: K, handler: (payload: KitEvents[K]) => void) {
  const kit = useKit()
  const ref = useRef(handler)
  useLayoutEffect(() => {
    ref.current = handler
  })
  useEffect(() => kit.on(name, (payload) => ref.current(payload)), [kit, name])
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type ElementProps = { kit?: Kit; className?: string; style?: CSSProperties; id?: string }

export type CovenWidgetProps = ElementProps & SwapViewParams & { view?: ViewName; bare?: boolean }

/** Shows one view inline. Same element the modal and the hosted iframe render. */
export function CovenWidget({ kit, className, style, id, view = 'swap', bare, ...params }: CovenWidgetProps) {
  const ref = useRef<HTMLElement & { kit?: Kit; request?: ViewRequest }>(null)
  const contextKit = useContext(KitContext)
  const paramsKey = JSON.stringify(params)
  // Params are compared by value so an inline object literal does not reset the view each render.
  const request = useMemo<ViewRequest>(() => (view === 'swap' ? { view, ...(JSON.parse(paramsKey) as SwapViewParams) } : { view }), [view, paramsKey])
  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.kit = kit ?? contextKit ?? getDefaultKit()
    el.request = request
  }, [kit, contextKit, request])
  return createElement('coven-widget', { ref, class: className, style, id, ...(bare ? { bare: '' } : {}) })
}

/** "Connect wallet", or the connected address and network. Opens the right view on click. */
export function ConnectButton({ kit, className, style, id }: ElementProps) {
  const ref = useRef<HTMLElement & { kit?: Kit }>(null)
  const contextKit = useContext(KitContext)
  useIsomorphicLayoutEffect(() => {
    if (ref.current) ref.current.kit = kit ?? contextKit ?? getDefaultKit()
  }, [kit, contextKit])
  return createElement('coven-connect-button', { ref, class: className, style, id })
}

export type { Kit, KitState, KitEventName, KitEvents, ViewRequest, SwapViewParams, ViewName }
