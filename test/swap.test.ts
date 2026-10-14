import { USDC } from '@covennetwork/sdk'
import type { Address, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { type PendingTransfer, type SwapAsset, executeSwap, planSwap, remoteUsdcAssets } from '../src/core/swap.js'

const ARC = 5042
const BASE = 8453
const USER = '0x00000000000000000000000000000000000000aa' as Address
const TOKEN = '0x00000000000000000000000000000000000000bb' as Address

const arcUsdc: SwapAsset = { id: `eip155:${ARC}/erc20:${USDC}`, chainId: ARC, chainName: 'Arc', address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, remote: false }
const arcToken: SwapAsset = { id: `eip155:${ARC}/erc20:${TOKEN}`, chainId: ARC, chainName: 'Arc', address: TOKEN, symbol: 'TKN', name: 'Token', decimals: 18, remote: false }
const [baseUsdc] = remoteUsdcAssets(new Set([BASE]))
const [ethUsdc] = remoteUsdcAssets(new Set([1]))

describe('planSwap', () => {
  it('stays on Arc for an Arc pair', () => {
    const result = planSwap(arcUsdc, arcToken, ARC)
    expect(result.ok && result.plan.kind).toBe('swap')
    expect(result.ok && result.plan.steps.map((s) => [s.id, s.chainId])).toEqual([
      ['switch-arc', ARC],
      ['swap', ARC],
    ])
  })
  it('starts on Base when paying with USDC on Base, then finishes on Arc', () => {
    const result = planSwap(baseUsdc!, arcToken, ARC)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.kind).toBe('deposit')
    expect(result.plan.sourceChainId).toBe(BASE)
    expect(result.plan.steps.map((s) => [s.id, s.chainId])).toEqual([
      ['switch-source', BASE],
      ['send', BASE],
      ['deliver', undefined],
      ['switch-arc', ARC],
      ['swap', ARC],
    ])
  })
  it('just bridges when USDC on Base becomes USDC on Arc', () => {
    const result = planSwap(baseUsdc!, arcUsdc, ARC)
    expect(result.ok && result.plan.swapAfter).toBeUndefined()
    expect(result.ok && result.plan.steps.map((s) => s.id)).toEqual(['switch-source', 'send', 'deliver'])
  })
  it('starts on Arc when sending out to Base', () => {
    const result = planSwap(arcToken, baseUsdc!, ARC)
    expect(result.ok && result.plan.kind).toBe('bridge-out')
    expect(result.ok && result.plan.sourceChainId).toBe(ARC)
  })
  it('refuses two remote chains and identical sides', () => {
    expect(planSwap(baseUsdc!, ethUsdc!, ARC).ok).toBe(false)
    expect(planSwap(arcToken, arcToken, ARC).ok).toBe(false)
  })
})

function fakeCoven(options: { usdcBalances: bigint[] }) {
  const balances = [...options.usdcBalances]
  return {
    swap: vi.fn(async (o: { wallet: WalletClient; amountIn: bigint }) => {
      if ((o.wallet as { chain: { id: number } }).chain.id !== ARC) throw new Error('WRONG_CHAIN')
      return { hash: '0xswap' as const, amountOut: o.amountIn * 2n, quote: {} }
    }),
    bridge: {
      toArc: vi.fn(async (o: { wallet: WalletClient; sourceChainId: number; amount: bigint }) => {
        // The SDK refuses a wallet still bound to another chain, the bug this kit fixes.
        if ((o.wallet as { chain: { id: number } }).chain.id !== o.sourceChainId) throw new Error('WRONG_CHAIN')
        return { hash: '0xburn' as const, amountBurned: o.amount, maxFee: 1000n, sourceChainId: o.sourceChainId }
      }),
      fromArc: vi.fn(),
      waitForDelivery: vi.fn(async () => ({ state: 'delivered' })),
    },
    publicClient: { readContract: vi.fn(async () => balances.shift() ?? 0n) },
  }
}

function memoryStore() {
  let saved: PendingTransfer | undefined
  return {
    save: (t: PendingTransfer) => void (saved = t),
    load: () => saved,
    clear: () => void (saved = undefined),
    get current() {
      return saved
    },
  }
}

describe('executeSwap', () => {
  it('switches to Base to send, back to Arc to buy, and swaps only what arrived', async () => {
    // 7 USDC already on Arc before; 7 + 9.999 after delivery.
    const coven = fakeCoven({ usdcBalances: [7_000_000n, 16_999_000n] })
    const chainsAsked: number[] = []
    const walletOn = vi.fn(async (chainId: number) => {
      chainsAsked.push(chainId)
      return { chain: { id: chainId } } as unknown as WalletClient
    })
    const store = memoryStore()
    const result = planSwap(baseUsdc!, arcToken, ARC)
    if (!result.ok) throw new Error(result.reason)
    const steps: string[][] = []
    const out = await executeSwap(
      { coven: coven as never, arcChainId: ARC, address: USER, walletOn, onSteps: (s) => steps.push(s.map((x) => x.state)), store: store as never },
      result.plan,
      { from: baseUsdc!, to: arcToken, amountIn: 10_000_000n, slippageBps: 50 },
    )
    expect(chainsAsked).toEqual([BASE, ARC])
    expect(coven.bridge.toArc).toHaveBeenCalledWith(expect.objectContaining({ sourceChainId: BASE, amount: 10_000_000n, recipient: USER }))
    // 16.999 - 7 = 9.999 USDC arrived; the 7 that was already there is left alone.
    expect(coven.swap).toHaveBeenCalledWith(expect.objectContaining({ tokenIn: USDC, tokenOut: TOKEN, amountIn: 9_999_000n }))
    expect(out).toEqual({ hash: '0xswap', chainId: ARC, amountOut: 19_998_000n })
    expect(steps.at(-1)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(store.current).toBeUndefined()
  })

  it('keeps the transfer saved if the wallet refuses the swap after delivery', async () => {
    const coven = fakeCoven({ usdcBalances: [0n, 5_000_000n] })
    let calls = 0
    const walletOn = vi.fn(async (chainId: number) => {
      if (++calls === 2) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      return { chain: { id: chainId } } as unknown as WalletClient
    })
    const store = memoryStore()
    const result = planSwap(baseUsdc!, arcToken, ARC)
    if (!result.ok) throw new Error(result.reason)
    let last: string[] = []
    await expect(
      executeSwap(
        { coven: coven as never, arcChainId: ARC, address: USER, walletOn, onSteps: (s) => (last = s.map((x) => x.state)), store: store as never },
        result.plan,
        { from: baseUsdc!, to: arcToken, amountIn: 5_000_000n, slippageBps: 50 },
      ),
    ).rejects.toThrow('User rejected')
    // The USDC landed; the saved transfer lets the user finish the buy later.
    expect(store.current?.kind).toBe('deposit')
    expect(store.current?.swapAfter?.usdcBefore).toBe('0')
    expect(last).toContain('failed')
  })

  it('runs an Arc swap on Arc even when the wallet sits on another chain', async () => {
    const coven = fakeCoven({ usdcBalances: [] })
    const walletOn = vi.fn(async (chainId: number) => ({ chain: { id: chainId } }) as unknown as WalletClient)
    const result = planSwap(arcUsdc, arcToken, ARC)
    if (!result.ok) throw new Error(result.reason)
    await executeSwap({ coven: coven as never, arcChainId: ARC, address: USER, walletOn, onSteps: () => undefined }, result.plan, {
      from: arcUsdc,
      to: arcToken,
      amountIn: 1n,
      slippageBps: 50,
    })
    expect(walletOn).toHaveBeenCalledWith(ARC)
  })
})
