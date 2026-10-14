import type { Coven, Pool, PoolKey } from '@covennetwork/sdk'
import { type Address, type Hex, isAddress } from 'viem'

export type LockedPair = { token0: Address; token1: Address; key?: PoolKey }

const v3PoolAbi = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

/**
 * Turns a pool identifier into its pair. A v3 pool is a contract, so its tokens are read
 * directly. A v4 pool id is a hash of its key and can't be reversed, so it is matched against
 * pool discovery, which carries the key.
 */
export async function resolvePool(coven: Coven, ref: Hex, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<LockedPair> {
  if (isAddress(ref)) {
    try {
      const [token0, token1] = await coven.publicClient.multicall({
        allowFailure: false,
        contracts: [
          { address: ref, abi: v3PoolAbi, functionName: 'token0' },
          { address: ref, abi: v3PoolAbi, functionName: 'token1' },
        ],
      })
      return { token0: token0 as Address, token1: token1 as Address }
    } catch {
      // Not a readable v3 pool; it may be a v4 id. Fall through to discovery.
    }
  }
  const target = ref.toLowerCase()
  return new Promise<LockedPair>((resolve, reject) => {
    let stop = () => {}
    const finish = (run: () => void) => {
      clearTimeout(timer)
      stop()
      options.signal?.removeEventListener('abort', onAbort)
      run()
    }
    const onAbort = () => finish(() => reject(new Error('aborted')))
    const timer = setTimeout(
      () => finish(() => reject(new Error('Could not find that pool. Pass the token pair instead, or check the pool id.'))),
      options.timeoutMs ?? 20_000,
    )
    options.signal?.addEventListener('abort', onAbort)
    stop = coven.pools.watch({
      onPools: (pools: Pool[]) => {
        const match = pools.find((pool) => pool.id.toLowerCase() === target)
        if (match) finish(() => resolve({ token0: match.token0, token1: match.token1, key: match.key }))
      },
      onError: () => undefined,
    })
  })
}
