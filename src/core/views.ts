import { type Address, type Hex, getAddress, isAddress } from 'viem'

export const VIEWS = ['connect', 'account', 'swap'] as const
export type ViewName = (typeof VIEWS)[number]

export type SwapViewParams = {
  /** Lock to one Arc pool: a v3 pool address or a v4 pool id. */
  pool?: Hex
  /** Token the user pays with: an Arc address or a CAIP-19 id such as `eip155:8453/erc20:0x…`. */
  tokenIn?: string
  /** Token the user receives, in the same forms as `tokenIn`. */
  tokenOut?: string
  /** Prefilled amount of `tokenIn`, in whole units ("25.5"). */
  amount?: string
  /** Max slippage in basis points. Default 50. */
  slippageBps?: number
  /** With `tokenIn` and `tokenOut`, the rest of a v4 pool key routes through that exact pool. */
  poolFee?: number
  tickSpacing?: number
  hooks?: Address
}

export type ViewRequest =
  | { view: 'connect' }
  | { view: 'account' }
  | ({ view: 'swap' } & SwapViewParams)

export const isViewName = (value: unknown): value is ViewName => VIEWS.includes(value as ViewName)

// An Arc token address, or a CAIP-19 ERC-20 id on any EVM chain.
const TOKEN_REF = /^(?:0x[0-9a-fA-F]{40}|eip155:\d+\/erc20:0x[0-9a-fA-F]{40})$/

const int = (value: string | null | undefined): number | undefined => {
  if (value === null || value === undefined || value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

/**
 * Reads a view request from string key/values, the shape both iframe query strings and HTML
 * attributes arrive in. Unknown or malformed values are dropped, never passed through.
 */
export function parseViewRequest(get: (key: string) => string | null | undefined, fallback: ViewName = 'swap'): ViewRequest {
  const name = get('view')
  const view = isViewName(name) ? name : fallback
  if (view !== 'swap') return { view }
  const request: ViewRequest = { view: 'swap' }
  const pool = get('pool')?.trim()
  if (pool && /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(pool)) request.pool = pool as Hex
  const tokenIn = get('tokenIn')?.trim() ?? get('token-in')?.trim()
  const tokenOut = get('tokenOut')?.trim() ?? get('token-out')?.trim()
  if (tokenIn && TOKEN_REF.test(tokenIn)) request.tokenIn = tokenIn
  if (tokenOut && TOKEN_REF.test(tokenOut)) request.tokenOut = tokenOut
  const amount = get('amount')?.trim()
  if (amount && /^\d*\.?\d+$/.test(amount)) request.amount = amount
  const slippage = int(get('slippageBps') ?? get('slippage-bps'))
  if (slippage !== undefined) request.slippageBps = clampSlippage(slippage)
  const poolFee = int(get('poolFee') ?? get('pool-fee'))
  const tickSpacing = int(get('tickSpacing') ?? get('tick-spacing'))
  const hooks = get('hooks')?.trim()
  if (poolFee !== undefined) request.poolFee = poolFee
  if (tickSpacing !== undefined) request.tickSpacing = tickSpacing
  if (hooks && isAddress(hooks)) request.hooks = getAddress(hooks)
  return request
}

/** The inverse of `parseViewRequest`, for building iframe URLs. */
export function viewRequestToParams(request: ViewRequest): URLSearchParams {
  const params = new URLSearchParams({ view: request.view })
  if (request.view !== 'swap') return params
  for (const key of ['pool', 'tokenIn', 'tokenOut', 'amount', 'slippageBps', 'poolFee', 'tickSpacing', 'hooks'] as const) {
    const value = request[key]
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params
}

export const clampSlippage = (bps: number) => Math.min(Math.max(Math.trunc(bps), 0), 5000)

export const sameRequest = (a: ViewRequest, b: ViewRequest) =>
  viewRequestToParams(a).toString() === viewRequestToParams(b).toString()
