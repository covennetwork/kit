import { CCTP_CHAINS, arc, type Coven } from '@covennetwork/sdk'
import { getBalance, getPublicClient, type Config } from '@wagmi/core'
import { type Address, erc20Abi, getAddress, isAddress } from 'viem'

export type TokenInfo = {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export type Balance = {
  chainId: number
  /** Undefined for the chain's native coin. */
  address?: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  value: bigint
}

export const UNISWAP_TOKEN_LIST_URL = 'https://tokens.uniswap.org'

/** Tokens per chain, from token lists in the Uniswap token-list format. */
export class TokenDirectory {
  private lists = new Map<string, Promise<TokenInfo[]>>()

  constructor(
    private readonly options: {
      coven: Coven
      arcChainId: number
      listUrls: string[]
      extra: TokenInfo[]
      fetch: typeof fetch
    },
  ) {}

  /** Every token the kit knows on `chainId`: token lists, CCTP USDC, Arc's registry, extras. */
  async tokens(chainId: number): Promise<TokenInfo[]> {
    const out = new Map<string, TokenInfo>()
    const add = (token: TokenInfo) => {
      if (token.chainId !== chainId || !isAddress(token.address)) return
      const key = token.address.toLowerCase()
      if (!out.has(key)) out.set(key, { ...token, address: getAddress(token.address) })
    }
    if (chainId === this.options.arcChainId) {
      for (const token of this.options.coven.tokens.list()) add({ ...token, chainId })
    }
    for (const chain of CCTP_CHAINS) {
      if (chain.chain.id === chainId) add({ chainId, address: chain.usdc, symbol: 'USDC', name: 'USD Coin', decimals: 6 })
    }
    for (const token of this.options.extra) add(token)
    const lists = await Promise.all(this.options.listUrls.map((url) => this.list(url)))
    for (const list of lists) for (const token of list) add(token)
    return [...out.values()]
  }

  private list(url: string): Promise<TokenInfo[]> {
    let pending = this.lists.get(url)
    if (!pending) {
      pending = this.options
        .fetch(url)
        .then((res) => (res.ok ? (res.json() as Promise<{ tokens?: unknown[] }>) : { tokens: [] }))
        .then((json) => (Array.isArray(json.tokens) ? json.tokens.filter(isTokenInfo) : []))
        .catch(() => {
          // A failed list is retried on the next call rather than cached as empty.
          this.lists.delete(url)
          return []
        })
      this.lists.set(url, pending)
    }
    return pending
  }
}

function isTokenInfo(value: unknown): value is TokenInfo {
  const t = value as TokenInfo
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof t.chainId === 'number' &&
    typeof t.address === 'string' &&
    typeof t.symbol === 'string' &&
    typeof t.decimals === 'number' &&
    t.decimals >= 0 &&
    t.decimals <= 36
  )
}

const BALANCE_BATCH = 200

/**
 * Non-zero balances of `address` on `chainId`: the native coin plus every known token, read in
 * Multicall3 batches where the chain has it. Native first, then tokens by symbol.
 */
export async function readBalances(
  config: Config,
  directory: TokenDirectory,
  params: { address: Address; chainId: number },
): Promise<Balance[]> {
  const { address, chainId } = params
  const chain = config.chains.find((c) => c.id === chainId)
  if (!chain) return []
  const client = getPublicClient(config, { chainId })
  const tokens = await directory.tokens(chainId)

  const nativePromise = getBalance(config, { address, chainId })
    .then((b) => b.value)
    .catch(() => undefined)

  const values: (bigint | undefined)[] = []
  if (client && tokens.length > 0) {
    const hasMulticall = Boolean(chain.contracts?.multicall3)
    for (let i = 0; i < tokens.length; i += BALANCE_BATCH) {
      const batch = tokens.slice(i, i + BALANCE_BATCH)
      if (hasMulticall) {
        const results = await client
          .multicall({
            allowFailure: true,
            contracts: batch.map((token) => ({
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf' as const,
              args: [address] as const,
            })),
          })
          .catch(() => batch.map(() => ({ status: 'failure' as const })))
        for (const r of results) values.push(r.status === 'success' ? (r.result as bigint) : undefined)
      } else {
        // Without Multicall3, one call per token; capped so an unknown chain can't fan out wide.
        const results = await Promise.all(
          batch.slice(0, 40).map((token) =>
            client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).catch(() => undefined),
          ),
        )
        values.push(...results, ...batch.slice(40).map(() => undefined))
      }
    }
  }

  const out: Balance[] = []
  const native = await nativePromise
  // Arc's native coin is USDC, the same balance as the ERC-20 at 0x3600…, which the token list
  // already reports with its 6 decimals. Listing both would show the money twice.
  if (native !== undefined && native > 0n && chainId !== arc.id) {
    out.push({
      chainId,
      symbol: chain.nativeCurrency.symbol,
      name: chain.nativeCurrency.name,
      decimals: chain.nativeCurrency.decimals,
      value: native,
    })
  }
  const held: Balance[] = []
  tokens.forEach((token, index) => {
    const value = values[index]
    if (value && value > 0n) held.push({ ...token, value })
  })
  held.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return [...out, ...held]
}
