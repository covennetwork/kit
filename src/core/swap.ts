import { CCTP_CHAINS, USDC, type Coven, type PoolKey, type Quote, type Token } from '@covennetwork/sdk'
import { type Address, type Hash, type WalletClient, erc20Abi, isAddressEqual, zeroAddress } from 'viem'
import { type AssetId, erc20AssetId } from './caip.js'
import type { SwapKind, SwapSide } from './events.js'
import { formatAmount } from './format.js'

/** A token the swap view can pay with or receive: any Arc token, or USDC on a CCTP chain. */
export type SwapAsset = {
  id: AssetId
  chainId: number
  chainName: string
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  /** True for USDC on a chain other than Arc, which moves through Circle's CCTP. */
  remote: boolean
}

export function arcAsset(token: Token, arcChainId: number): SwapAsset {
  return {
    id: erc20AssetId(arcChainId, token.address),
    chainId: arcChainId,
    chainName: 'Arc',
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logoURI: token.logoURI,
    remote: false,
  }
}

/** USDC on every CCTP chain the kit is configured with. */
export function remoteUsdcAssets(chainIds: ReadonlySet<number>): SwapAsset[] {
  return CCTP_CHAINS.filter((c) => chainIds.has(c.chain.id)).map((c) => ({
    id: erc20AssetId(c.chain.id, c.usdc as Address),
    chainId: c.chain.id,
    chainName: c.chain.name,
    address: c.usdc as Address,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    remote: true,
  }))
}

export const isUsdc = (asset: SwapAsset) => asset.remote || isAddressEqual(asset.address, USDC)

export const assetLabel = (asset: SwapAsset) => (asset.remote ? `${asset.symbol} on ${asset.chainName}` : asset.symbol)

export type StepId = 'switch-source' | 'send' | 'deliver' | 'switch-arc' | 'swap'

export type StepState = 'waiting' | 'active' | 'done' | 'failed'

export type Step = { id: StepId; label: string; state: StepState; chainId?: number }

export type SwapPlan = {
  kind: SwapKind
  /** The chain the user's wallet must be on to start. */
  sourceChainId: number
  steps: Step[]
  /** For a deposit that ends in a swap: the Arc token bought with the arriving USDC. */
  swapAfter?: SwapAsset
}

export type PlanResult = { ok: true; plan: SwapPlan } | { ok: false; reason: string }

/**
 * Decides what a swap between two assets takes, and which chain each wallet step runs on. This
 * is where the network switch comes from: a Base → Arc trade starts on Base, so the first step
 * asks the wallet to switch to Base, whatever chain it is on now.
 */
export function planSwap(from: SwapAsset, to: SwapAsset, arcChainId: number): PlanResult {
  if (from.id === to.id) return { ok: false, reason: 'Pick two different tokens.' }
  const step = (id: StepId, label: string, chainId?: number): Step => ({ id, label, state: 'waiting', chainId })
  if (from.remote && to.remote) {
    return { ok: false, reason: 'One side has to be on Arc. To move USDC between two other chains, send it to Arc first.' }
  }
  if (from.remote) {
    const swapAfter = isUsdc(to) ? undefined : to
    return {
      ok: true,
      plan: {
        kind: 'deposit',
        sourceChainId: from.chainId,
        swapAfter,
        steps: [
          step('switch-source', `Switch to ${from.chainName}`, from.chainId),
          step('send', 'Approve and send', from.chainId),
          step('deliver', 'Deliver to Arc'),
          ...(swapAfter ? [step('switch-arc', 'Switch to Arc', arcChainId), step('swap', `Buy ${to.symbol}`, arcChainId)] : []),
        ],
      },
    }
  }
  if (to.remote) {
    return {
      ok: true,
      plan: {
        kind: 'bridge-out',
        sourceChainId: arcChainId,
        steps: [
          step('switch-arc', 'Switch to Arc', arcChainId),
          step('send', isUsdc(from) ? 'Approve and send' : 'Approve, swap and send', arcChainId),
          step('deliver', `Deliver to ${to.chainName}`),
        ],
      },
    }
  }
  return {
    ok: true,
    plan: {
      kind: 'swap',
      sourceChainId: arcChainId,
      steps: [step('switch-arc', 'Switch to Arc', arcChainId), step('swap', 'Approve and swap', arcChainId)],
    },
  }
}

export const sideOf = (from: SwapAsset, to: SwapAsset): SwapSide => (isUsdc(from) ? 'buy' : isUsdc(to) ? 'sell' : 'swap')

export type SwapQuote = {
  /** What arrives, exact for Arc swaps and a lower bound for anything through CCTP. */
  amountOut?: bigint
  /** One line describing price, fees and timing. */
  note: string
  /** The router quote, for Arc swaps. */
  quote?: Quote
}

export async function quoteSwap(
  coven: Coven,
  plan: SwapPlan,
  from: SwapAsset,
  to: SwapAsset,
  amountIn: bigint,
  extraPools?: PoolKey[],
): Promise<SwapQuote> {
  if (plan.kind === 'swap') {
    const quote = await coven.quote({ tokenIn: from.address, tokenOut: to.address, amountIn, ...(extraPools?.length ? { extraPools } : {}) })
    const feeToken = coven.tokens.get(quote.feeToken)
    const fee = quote.platformFee + quote.integratorFee
    const route = quote.hops.map((hop) => hop.protocol).join(' → ')
    return {
      amountOut: quote.amountOut,
      quote,
      note: `Fee ${formatAmount(fee, feeToken?.decimals ?? 6)} ${feeToken?.symbol ?? ''}, route ${route}`.trim(),
    }
  }
  if (plan.kind === 'bridge-out') {
    const result = await coven.bridge.quoteFromArc({ tokenIn: from.address, amountIn, destinationChainId: to.chainId })
    return {
      amountOut: result.minReceived,
      note: `At least ${formatAmount(result.minReceived, 6)} USDC lands on ${to.chainName} after Circle's fee, in about 15 to 20 minutes.`,
    }
  }
  const deposit = await coven.bridge.quoteToArc({ sourceChainId: from.chainId, amount: amountIn })
  if (!plan.swapAfter) {
    return {
      amountOut: deposit.minReceived,
      note: `At least ${formatAmount(deposit.minReceived, 6)} USDC lands on Arc after Circle's fee, usually within a minute.`,
    }
  }
  const quote = await coven.quote({ tokenIn: USDC, tokenOut: to.address, amountIn: deposit.minReceived, ...(extraPools?.length ? { extraPools } : {}) })
  return {
    amountOut: quote.amountOut,
    quote,
    note: `Brings USDC from ${from.chainName}, then buys ${to.symbol} on Arc. Priced again when the USDC arrives.`,
  }
}

/** A cross-chain transfer in flight, saved so a reload can finish it. */
export type PendingTransfer = {
  kind: 'deposit' | 'bridge-out'
  hash: Hash
  sourceChainId: number
  createdAt: number
  note: string
  /** Deposits that end in a swap: what to buy, and Arc USDC before the transfer arrived. */
  swapAfter?: { tokenOut: Address; slippageBps: number; usdcBefore: string; extraPools?: PoolKey[] }
}

const PENDING_KEY = 'coven-kit.pending-transfer'
const PENDING_TTL_MS = 6 * 60 * 60 * 1000

export const pendingStore = {
  save(transfer: PendingTransfer) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(transfer))
    } catch {
      // Storage can be unavailable (private windows, partitioned iframes); the flow still runs.
    }
  },
  load(): PendingTransfer | undefined {
    try {
      const raw = localStorage.getItem(PENDING_KEY)
      if (!raw) return undefined
      const transfer = JSON.parse(raw) as PendingTransfer
      if (!transfer.hash || Date.now() - transfer.createdAt > PENDING_TTL_MS) return undefined
      return transfer
    } catch {
      return undefined
    }
  },
  clear() {
    try {
      localStorage.removeItem(PENDING_KEY)
    } catch {
      // nothing to clear
    }
  },
}

export type ExecuteContext = {
  coven: Coven
  arcChainId: number
  address: Address
  /** Switches the wallet to `chainId` if needed and returns a wallet client bound to it. */
  walletOn: (chainId: number) => Promise<WalletClient>
  onSteps: (steps: Step[], detail?: string) => void
  onSubmitted?: (hash: Hash, chainId: number) => void
  store?: typeof pendingStore
}

export type ExecuteResult = { hash: Hash; chainId: number; amountOut: bigint }

const advance = (steps: Step[], id: StepId, state: StepState): Step[] =>
  steps.map((step) => (step.id === id ? { ...step, state } : step))

/** Runs a plan step by step. Every wallet step first moves the wallet to that step's chain. */
export async function executeSwap(
  ctx: ExecuteContext,
  plan: SwapPlan,
  params: { from: SwapAsset; to: SwapAsset; amountIn: bigint; slippageBps: number; extraPools?: PoolKey[] },
): Promise<ExecuteResult> {
  const store = ctx.store ?? pendingStore
  let steps = plan.steps.map((s) => ({ ...s }))
  const mark = (id: StepId, state: StepState, detail?: string) => {
    steps = advance(steps, id, state)
    ctx.onSteps(steps, detail)
  }
  let current: StepId = steps[0]!.id
  const run = async <T>(id: StepId, detail: string, task: () => Promise<T>): Promise<T> => {
    current = id
    mark(id, 'active', detail)
    const result = await task()
    mark(id, 'done')
    return result
  }

  try {
    if (plan.kind === 'swap') {
      const wallet = await run('switch-arc', 'Confirm the network switch in your wallet.', () => ctx.walletOn(ctx.arcChainId))
      const result = await run('swap', 'Approving the exact amount, then swapping.', () =>
        ctx.coven.swap({
          wallet,
          tokenIn: params.from.address,
          tokenOut: params.to.address,
          amountIn: params.amountIn,
          slippageBps: params.slippageBps,
          ...(params.extraPools?.length ? { extraPools: params.extraPools } : {}),
        }),
      )
      ctx.onSubmitted?.(result.hash, ctx.arcChainId)
      return { hash: result.hash, chainId: ctx.arcChainId, amountOut: result.amountOut }
    }

    if (plan.kind === 'bridge-out') {
      const wallet = await run('switch-arc', 'Confirm the network switch in your wallet.', () => ctx.walletOn(ctx.arcChainId))
      const result = await run('send', 'Approve, then send.', () =>
        ctx.coven.bridge.fromArc({
          wallet,
          tokenIn: params.from.address,
          amountIn: params.amountIn,
          destinationChainId: params.to.chainId,
          recipient: ctx.address,
          slippageBps: params.slippageBps,
        }),
      )
      ctx.onSubmitted?.(result.hash, ctx.arcChainId)
      store.save({ kind: 'bridge-out', hash: result.hash, sourceChainId: ctx.arcChainId, createdAt: Date.now(), note: `Sending USDC to ${params.to.chainName}` })
      await run('deliver', `Circle is delivering it to ${params.to.chainName}.`, () =>
        ctx.coven.bridge.waitForDelivery({ sourceChainId: ctx.arcChainId, hash: result.hash }),
      )
      store.clear()
      return { hash: result.hash, chainId: ctx.arcChainId, amountOut: result.amountBurned - result.maxFee }
    }

    // Deposit: USDC on another chain comes to Arc, then optionally buys an Arc token.
    const usdcBefore = plan.swapAfter ? await arcUsdcBalance(ctx.coven, ctx.address) : 0n
    const sourceWallet = await run('switch-source', 'Confirm the network switch in your wallet.', () => ctx.walletOn(plan.sourceChainId))
    const sent = await run('send', 'Approve, then send.', () =>
      ctx.coven.bridge.toArc({ wallet: sourceWallet, sourceChainId: plan.sourceChainId, amount: params.amountIn, recipient: ctx.address }),
    )
    ctx.onSubmitted?.(sent.hash, plan.sourceChainId)
    const pending: PendingTransfer = {
      kind: 'deposit',
      hash: sent.hash,
      sourceChainId: plan.sourceChainId,
      createdAt: Date.now(),
      note: plan.swapAfter ? `Buying ${plan.swapAfter.symbol} with USDC from ${params.from.chainName}` : `Bringing USDC from ${params.from.chainName}`,
      ...(plan.swapAfter
        ? { swapAfter: { tokenOut: plan.swapAfter.address, slippageBps: params.slippageBps, usdcBefore: usdcBefore.toString(), extraPools: params.extraPools } }
        : {}),
    }
    store.save(pending)
    const finished = await finishDeposit(ctx, pending, steps, (next, detail) => {
      steps = next
      ctx.onSteps(steps, detail)
    })
    return finished ?? { hash: sent.hash, chainId: plan.sourceChainId, amountOut: sent.amountBurned - sent.maxFee }
  } catch (error) {
    mark(current, 'failed')
    throw error
  }
}

/**
 * Waits for a deposit to land and, if it was a buy, swaps exactly the USDC that arrived (the
 * Arc balance minus what was there before), never the user's whole balance.
 */
export async function finishDeposit(
  ctx: ExecuteContext,
  pending: PendingTransfer,
  steps: Step[],
  onSteps: (steps: Step[], detail?: string) => void,
): Promise<ExecuteResult | undefined> {
  const store = ctx.store ?? pendingStore
  let current = steps
  const mark = (id: StepId, state: StepState, detail?: string) => {
    current = advance(current, id, state)
    onSteps(current, detail)
  }
  mark('deliver', 'active', 'Circle is delivering your USDC to Arc.')
  await ctx.coven.bridge.waitForDelivery({ sourceChainId: pending.sourceChainId, hash: pending.hash })
  mark('deliver', 'done')
  if (!pending.swapAfter) {
    store.clear()
    return undefined
  }
  mark('switch-arc', 'active', 'Confirm the network switch in your wallet.')
  const wallet = await ctx.walletOn(ctx.arcChainId)
  mark('switch-arc', 'done')
  mark('swap', 'active', 'Pricing again, since the market moved while it travelled.')
  const after = await arcUsdcBalance(ctx.coven, ctx.address)
  const arrived = after - BigInt(pending.swapAfter.usdcBefore)
  if (arrived <= 0n) {
    store.clear()
    throw new Error('The USDC arrived, but your Arc balance did not go up. Nothing was swapped.')
  }
  const result = await ctx.coven.swap({
    wallet,
    tokenIn: USDC,
    tokenOut: pending.swapAfter.tokenOut,
    amountIn: arrived,
    slippageBps: pending.swapAfter.slippageBps,
    ...(pending.swapAfter.extraPools?.length ? { extraPools: pending.swapAfter.extraPools } : {}),
  })
  ctx.onSubmitted?.(result.hash, ctx.arcChainId)
  store.clear()
  mark('swap', 'done')
  return { hash: result.hash, chainId: ctx.arcChainId, amountOut: result.amountOut }
}

async function arcUsdcBalance(coven: Coven, address: Address): Promise<bigint> {
  return coven.publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
}

/** Steps for a deposit resumed after a reload: everything before delivery already happened. */
export function resumedSteps(pending: PendingTransfer, arcChainId: number): Step[] {
  const done = (id: StepId, label: string, chainId?: number): Step => ({ id, label, state: 'done', chainId })
  const waiting = (id: StepId, label: string, chainId?: number): Step => ({ id, label, state: 'waiting', chainId })
  return [
    done('switch-source', 'Switch network', pending.sourceChainId),
    done('send', 'Approve and send', pending.sourceChainId),
    waiting('deliver', pending.kind === 'deposit' ? 'Deliver to Arc' : 'Deliver'),
    ...(pending.swapAfter ? [waiting('switch-arc', 'Switch to Arc', arcChainId), waiting('swap', 'Swap on Arc', arcChainId)] : []),
  ]
}

/** Uniswap pool keys need currency0 < currency1; integrators pass the pair in display order. */
export function sortedPoolKey(a: Address, b: Address, fee: number, tickSpacing: number, hooks: Address = zeroAddress): PoolKey {
  const [currency0, currency1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
  return { currency0, currency1, fee, tickSpacing, hooks }
}
