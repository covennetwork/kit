import { CCTP_CHAINS, arc } from '@covennetwork/sdk'
import type { Chain } from 'viem'
import { CHAIN_DATA } from './chain-data.js'

let cached: Chain[] | undefined

/**
 * Every EVM mainnet viem ships, Arc first. Most come from a generated snapshot (identity, RPCs,
 * explorer, Multicall3); Arc and the CCTP chains, where Coven sends transactions, use their full
 * viem definitions. Arc's comes from the Coven SDK, which adds its Multicall3 deployment.
 */
export function mainnets(): Chain[] {
  if (cached) return cached
  const full = new Map<number, Chain>([[arc.id, arc], ...CCTP_CHAINS.map((c) => [c.chain.id, c.chain] as const)])
  const out: Chain[] = [arc]
  for (const chain of CHAIN_DATA) {
    if (chain.id === arc.id) continue
    out.push(full.get(chain.id) ?? chain)
  }
  cached = out
  return out
}

/** Orders chains so the default chain leads; the rest keep their given order. */
export function withDefaultFirst(chains: readonly Chain[], defaultChainId: number): [Chain, ...Chain[]] {
  const first = chains.find((chain) => chain.id === defaultChainId)
  if (!first) throw new Error(`The default chain ${defaultChainId} is not in the configured chains.`)
  return [first, ...chains.filter((chain) => chain.id !== defaultChainId)]
}

export function explorerTxUrl(chain: Chain | undefined, hash: string): string | undefined {
  const base = chain?.blockExplorers?.default.url
  return base ? `${base.replace(/\/$/, '')}/tx/${hash}` : undefined
}
