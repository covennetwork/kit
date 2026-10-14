import { type Address, getAddress, isAddress } from 'viem'

// CAIP-2 chain ids, CAIP-10 account ids and CAIP-19 asset ids for the EVM ("eip155") namespace.
// The kit uses these in every event and in view parameters, so a token on another chain can be
// named without inventing a format: `eip155:8453/erc20:0x8335…2913` is USDC on Base.

export type ChainId = `eip155:${number}`
export type AccountId = `eip155:${number}:${Address}`
export type AssetId = `eip155:${number}/erc20:${Address}` | `eip155:${number}/slip44:${number}`

export const chainId = (id: number): ChainId => `eip155:${id}`

export const accountId = (id: number, address: Address): AccountId => `eip155:${id}:${getAddress(address)}`

export const erc20AssetId = (id: number, address: Address): AssetId => `eip155:${id}/erc20:${getAddress(address)}`

export type ParsedAsset = { chainId: number; address: Address }

/**
 * Reads a token reference. A bare address is taken to be on `defaultChainId`; a CAIP-19 id
 * carries its own chain. Returns undefined for anything else.
 */
export function parseAsset(value: string | undefined, defaultChainId: number): ParsedAsset | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (isAddress(trimmed)) return { chainId: defaultChainId, address: getAddress(trimmed) }
  const match = /^eip155:(\d+)\/erc20:(0x[0-9a-fA-F]{40})$/.exec(trimmed)
  if (!match) return undefined
  return { chainId: Number(match[1]), address: getAddress(match[2]!) }
}
