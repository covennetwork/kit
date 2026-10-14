import { USDC, type Pool, type PoolKey } from '@covennetwork/sdk'
import { getPublicClient } from '@wagmi/core'
import { html, nothing, type PropertyValues } from 'lit'
import { type Address, erc20Abi, isAddressEqual } from 'viem'
import { chainId as caipChain, erc20AssetId, parseAsset } from '../../core/caip.js'
import { explorerTxUrl } from '../../core/chains.js'
import { errorMessage, formatAmount, parseAmount, sanitizeAmountInput } from '../../core/format.js'
import type { Kit, KitState } from '../../core/kit.js'
import { type LockedPair, resolvePool } from '../../core/pools.js'
import {
  type PendingTransfer,
  type Step,
  type SwapAsset,
  type SwapPlan,
  type SwapQuote,
  arcAsset,
  assetLabel,
  executeSwap,
  finishDeposit,
  isUsdc,
  pendingStore,
  planSwap,
  quoteSwap,
  remoteUsdcAssets,
  resumedSteps,
  sideOf,
  sortedPoolKey,
} from '../../core/swap.js'
import type { SwapViewParams } from '../../core/views.js'
import { KitElement, avatar, backIcon, flipIcon, loading } from '../base.js'
import { baseStyles } from '../styles.js'

type Screen = 'home' | 'pick-from' | 'pick-to' | 'review' | 'status'

type Flow = { steps: Step[]; detail?: string; error?: string; done: boolean; hash?: `0x${string}`; chainId?: number; title: string }

// Arc pays gas in USDC, so "Max" on Arc USDC leaves this much (0.5 USDC) for fees.
const ARC_GAS_RESERVE = 500_000n
const QUOTE_DEBOUNCE_MS = 320

export class CovenSwapView extends KitElement {
  static override styles = [baseStyles]

  static override properties = {
    ...KitElement.properties,
    params: { attribute: false },
    screen: { state: true },
    assets: { state: true },
    fromId: { state: true },
    toId: { state: true },
    amount: { state: true },
    quote: { state: true },
    quoting: { state: true },
    quoteError: { state: true },
    balance: { state: true },
    locked: { state: true },
    lockError: { state: true },
    flow: { state: true },
    pending: { state: true },
  }

  declare params: SwapViewParams
  declare screen: Screen
  declare assets: SwapAsset[]
  declare fromId: string | undefined
  declare toId: string | undefined
  declare amount: string
  declare quote: SwapQuote | undefined
  declare quoting: boolean
  declare quoteError: string | undefined
  declare balance: bigint | undefined
  declare locked: LockedPair | undefined
  declare lockError: string | undefined
  declare flow: Flow | undefined
  declare pending: PendingTransfer | undefined

  private quoteTimer?: ReturnType<typeof setTimeout>
  private quoteRequest = 0
  private balanceKey = ''
  private stopWatch?: () => void
  private resolveAbort?: AbortController
  private appliedParams?: string

  constructor() {
    super()
    this.params = {}
    this.screen = 'home'
    this.assets = []
    this.amount = ''
    this.quoting = false
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    this.stopWatch?.()
    this.stopWatch = undefined
    this.resolveAbort?.abort()
    clearTimeout(this.quoteTimer)
  }

  protected override onKitBound(kit: Kit) {
    this.loadAssets(kit)
    this.applyParams(kit, true)
    this.pending = pendingStore.load()
  }

  protected override onKitState(state: KitState) {
    if (`${state.address}:${this.fromId}` !== this.balanceKey) this.refreshBalance()
  }

  protected override willUpdate(changed: PropertyValues) {
    super.willUpdate(changed)
    const kit = this.activeKit
    if (kit && changed.has('params')) this.applyParams(kit, false)
    if (changed.has('fromId') || changed.has('toId') || changed.has('amount')) this.scheduleQuote()
    if (changed.has('fromId')) this.refreshBalance()
  }

  // ---- assets and parameters -------------------------------------------------------------

  private loadAssets(kit: Kit) {
    const remote = remoteUsdcAssets(new Set(kit.chains.map((c) => c.id)))
    const refresh = () => {
      const arc = kit.coven.tokens.list().map((t) => arcAsset(t, kit.arcChainId))
      this.assets = [...arc, ...remote]
    }
    refresh()
    void kit.coven.tokens.loadCoinGecko().catch(() => undefined).finally(refresh)
    // New pairs appear within seconds of launch; the watcher adds their tokens to the picker.
    // A locked widget never needs it, and it costs Arc RPC log queries, so it starts on demand.
    this.startWatch = () => {
      if (this.stopWatch || this.locked) return
      this.stopWatch = kit.coven.pools.watch({ onPools: (_pools: Pool[]) => refresh(), onError: () => undefined })
    }
  }

  private startWatch?: () => void

  private applyParams(kit: Kit, force: boolean) {
    const signature = JSON.stringify(this.params ?? {})
    if (!force && signature === this.appliedParams) return
    this.appliedParams = signature
    const p = this.params ?? {}
    this.resolveAbort?.abort()
    this.locked = undefined
    this.lockError = undefined
    if (p.amount) this.amount = p.amount

    const tokenIn = parseAsset(p.tokenIn, kit.arcChainId)
    const tokenOut = parseAsset(p.tokenOut, kit.arcChainId)

    if (p.pool) {
      const abort = (this.resolveAbort = new AbortController())
      resolvePool(kit.coven, p.pool, { signal: abort.signal })
        .then(async (pair) => {
          if (abort.signal.aborted) return
          await this.ensureArcTokens(kit, [pair.token0, pair.token1])
          this.locked = pair
          // Pay with USDC when the pool has it, so "buy" is the default direction.
          const [a, b] = isAddressEqual(pair.token1, USDC) ? [pair.token1, pair.token0] : [pair.token0, pair.token1]
          this.fromId = erc20AssetId(kit.arcChainId, a)
          this.toId = erc20AssetId(kit.arcChainId, b)
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) this.lockError = errorMessage(error)
        })
      return
    }

    if (tokenIn && tokenOut && tokenIn.chainId === kit.arcChainId && tokenOut.chainId === kit.arcChainId) {
      // Both sides named on Arc: lock the pair, and route through the exact v4 pool when the
      // rest of its key is given.
      const key: PoolKey | undefined =
        p.poolFee !== undefined && p.tickSpacing !== undefined ? sortedPoolKey(tokenIn.address, tokenOut.address, p.poolFee, p.tickSpacing, p.hooks) : undefined
      this.locked = { token0: tokenIn.address, token1: tokenOut.address, key }
    }
    void this.ensureArcTokens(kit, [tokenIn, tokenOut].filter((t) => t?.chainId === kit.arcChainId).map((t) => t!.address)).then(() => {
      this.fromId = tokenIn ? erc20AssetId(tokenIn.chainId, tokenIn.address) : erc20AssetId(kit.arcChainId, USDC)
      this.toId = tokenOut ? erc20AssetId(tokenOut.chainId, tokenOut.address) : undefined
    })
  }

  /** Makes sure tokens named by address are in the picker, reading their metadata if needed. */
  private async ensureArcTokens(kit: Kit, addresses: Address[]) {
    const missing = addresses.filter((a) => !kit.coven.tokens.get(a))
    if (missing.length === 0) return
    await Promise.all(missing.map((a) => kit.coven.tokens.resolve(a).catch(() => undefined)))
    const remote = this.assets.filter((a) => a.remote)
    this.assets = [...kit.coven.tokens.list().map((t) => arcAsset(t, kit.arcChainId)), ...remote]
  }

  private get from() {
    return this.assets.find((a) => a.id === this.fromId)
  }

  private get to() {
    return this.assets.find((a) => a.id === this.toId)
  }

  private get amountIn() {
    const from = this.from
    return from ? parseAmount(this.amount, from.decimals) : 0n
  }

  private get plan(): ReturnType<typeof planSwap> | undefined {
    const kit = this.activeKit
    const from = this.from
    const to = this.to
    return kit && from && to ? planSwap(from, to, kit.arcChainId) : undefined
  }

  private get extraPools(): PoolKey[] | undefined {
    return this.locked?.key ? [this.locked.key] : undefined
  }

  // ---- quotes and balances ---------------------------------------------------------------

  private scheduleQuote() {
    clearTimeout(this.quoteTimer)
    const request = ++this.quoteRequest
    this.quote = undefined
    this.quoteError = undefined
    const kit = this.activeKit
    const plan = this.plan
    const from = this.from
    const to = this.to
    const amountIn = this.amountIn
    if (!kit || !plan?.ok || !from || !to || amountIn <= 0n) {
      this.quoting = false
      return
    }
    this.quoting = true
    this.quoteTimer = setTimeout(() => {
      quoteSwap(kit.coven, plan.plan, from, to, amountIn, this.extraPools)
        .then((quote) => {
          if (request === this.quoteRequest) this.quote = quote
        })
        .catch((error: unknown) => {
          if (request === this.quoteRequest) this.quoteError = errorMessage(error)
        })
        .finally(() => {
          if (request === this.quoteRequest) this.quoting = false
        })
    }, QUOTE_DEBOUNCE_MS)
  }

  private refreshBalance() {
    const kit = this.activeKit
    const address = kit?.getState().address
    const from = this.from
    this.balanceKey = `${address}:${this.fromId}`
    if (!kit || !address || !from) {
      this.balance = undefined
      return
    }
    const key = this.balanceKey
    const client = from.chainId === kit.arcChainId ? kit.coven.publicClient : getPublicClient(kit.wagmiConfig, { chainId: from.chainId })
    if (!client) return
    client
      .readContract({ address: from.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
      .then((value) => {
        if (key === this.balanceKey) this.balance = value as bigint
      })
      .catch(() => {
        if (key === this.balanceKey) this.balance = undefined
      })
  }

  private setMax() {
    const from = this.from
    if (!from || this.balance === undefined) return
    const kit = this.activeKit
    const reserve = kit && from.chainId === kit.arcChainId && isUsdc(from) ? ARC_GAS_RESERVE : 0n
    const usable = this.balance > reserve ? this.balance - reserve : 0n
    this.amount = formatAmount(usable, from.decimals, from.decimals).replace(/,/g, '')
  }

  // ---- running the swap ------------------------------------------------------------------

  private async start(kit: Kit, plan: SwapPlan) {
    const from = this.from
    const to = this.to
    const address = kit.getState().address
    if (!from || !to || !address) return
    const amountIn = this.amountIn
    const slippageBps = this.params?.slippageBps ?? 50
    this.flow = { steps: plan.steps, done: false, title: plan.kind === 'swap' ? 'Swapping' : 'Moving your USDC' }
    this.screen = 'status'
    try {
      const result = await executeSwap(
        {
          coven: kit.coven,
          arcChainId: kit.arcChainId,
          address,
          walletOn: (chainId) => kit.walletOn(chainId),
          onSteps: (steps, detail) => {
            if (this.flow) this.flow = { ...this.flow, steps, detail: detail ?? this.flow.detail }
          },
          onSubmitted: (hash, chainId) => {
            if (this.flow) this.flow = { ...this.flow, hash, chainId }
            kit.emit('swapSubmitted', { hash, chain: caipChain(chainId), kind: plan.kind })
          },
        },
        plan,
        { from, to, amountIn, slippageBps, extraPools: this.extraPools },
      )
      this.flow = { ...this.flow!, done: true, title: 'Done', detail: undefined, hash: result.hash, chainId: result.chainId }
      kit.emit('swapConfirmed', {
        hash: result.hash,
        chain: caipChain(result.chainId),
        kind: plan.kind,
        side: sideOf(from, to),
        tokenIn: { asset: from.id, symbol: from.symbol, decimals: from.decimals },
        tokenOut: { asset: to.id, symbol: to.symbol, decimals: to.decimals },
        amountIn: amountIn.toString(),
        amountOut: result.amountOut.toString(),
      })
      this.amount = ''
      this.refreshBalance()
    } catch (error) {
      const message = errorMessage(error)
      this.flow = { ...this.flow!, error: message, title: 'That did not go through' }
      kit.emit('error', { message })
    } finally {
      this.pending = pendingStore.load()
    }
  }

  private async resume(kit: Kit, pending: PendingTransfer) {
    const address = kit.getState().address
    if (!address) return kit.requestConnect()
    const steps = resumedSteps(pending, kit.arcChainId)
    this.flow = { steps, done: false, title: 'Picking up where you left off', detail: pending.note }
    this.screen = 'status'
    try {
      if (pending.kind === 'bridge-out') {
        this.flow = { ...this.flow, steps: steps.map((s) => (s.id === 'deliver' ? { ...s, state: 'active' } : s)) }
        await kit.coven.bridge.waitForDelivery({ sourceChainId: pending.sourceChainId, hash: pending.hash })
        pendingStore.clear()
        this.flow = { ...this.flow, steps: steps.map((s) => ({ ...s, state: 'done' })), done: true, title: 'Delivered' }
      } else {
        const result = await finishDeposit(
          { coven: kit.coven, arcChainId: kit.arcChainId, address, walletOn: (id) => kit.walletOn(id), onSteps: () => undefined },
          pending,
          steps,
          (next, detail) => {
            if (this.flow) this.flow = { ...this.flow, steps: next, detail: detail ?? this.flow.detail }
          },
        )
        this.flow = { ...this.flow!, done: true, title: 'Done', detail: undefined, ...(result ? { hash: result.hash, chainId: result.chainId } : {}) }
      }
    } catch (error) {
      this.flow = { ...this.flow!, error: errorMessage(error), title: 'Could not finish' }
    } finally {
      this.pending = pendingStore.load()
    }
  }

  // ---- rendering -------------------------------------------------------------------------

  override render() {
    const kit = this.activeKit
    const state = this.state
    if (!kit || !state) return this.noKit()

    if (this.params?.pool && !this.locked) {
      return html`
        <p class="label">Pool</p>
        <h2 class="title">${this.lockError ? 'Pool not found.' : 'Loading the pool.'}</h2>
        <p class="note gap-md">${this.lockError ?? loading('Loading the pool')}</p>
      `
    }

    switch (this.screen) {
      case 'pick-from':
      case 'pick-to':
        return this.renderPicker(kit)
      case 'review':
        return this.renderReview(kit, state)
      case 'status':
        if (this.flow) return this.renderStatus(kit)
    }
    return this.renderHome(kit, state)
  }

  private renderPicker(kit: Kit) {
    const picking = this.screen === 'pick-from' ? 'from' : 'to'
    return html`<coven-token-picker
      .kit=${kit}
      .assets=${this.assets}
      .selected=${picking === 'from' ? this.fromId : this.toId}
      .heading=${picking === 'from' ? 'You pay with' : 'You receive'}
      @coven-back=${() => (this.screen = 'home')}
      @coven-asset=${(e: CustomEvent<SwapAsset>) => {
        if (picking === 'from') {
          if (e.detail.id === this.toId) this.toId = this.fromId
          this.fromId = e.detail.id
        } else {
          if (e.detail.id === this.fromId) this.fromId = this.toId
          this.toId = e.detail.id
        }
        this.screen = 'home'
      }}
    ></coven-token-picker>`
  }

  private renderHome(kit: Kit, state: KitState) {
    const from = this.from
    const to = this.to
    const plan = this.plan
    const locked = Boolean(this.locked)
    const amountIn = this.amountIn
    const insufficient = state.address && this.balance !== undefined && amountIn > this.balance
    const outcome = this.quote?.amountOut !== undefined && to ? `${formatAmount(this.quote.amountOut, to.decimals, 6)} ${to.symbol}` : undefined
    const pending = this.pending

    let action: { label: string; disabled: boolean; run?: () => void }
    if (!from || !to) action = { label: 'Pick a token', disabled: true }
    else if (plan && !plan.ok) action = { label: plan.reason, disabled: true }
    else if (amountIn <= 0n) action = { label: 'Enter an amount', disabled: true }
    else if (!state.address) action = { label: 'Connect wallet', disabled: false, run: () => this.needConnect() }
    else if (insufficient) action = { label: `Not enough ${from.symbol}`, disabled: true }
    else action = { label: 'Review', disabled: !this.quote, run: () => (this.screen = 'review') }

    return html`
      <div class="header">
        <p class="label">Swap</p>
        ${state.address
          ? html`<button class="chip" @click=${() => this.dispatchEvent(new CustomEvent('coven-open-account', { bubbles: true, composed: true }))}>
              <span class="dot" aria-hidden="true"></span>${kit.chains.find((c) => c.id === state.chainId)?.name ?? 'Unsupported network'}
            </button>`
          : nothing}
      </div>

      ${pending
        ? html`<div class="gap-md stack" role="status">
            <p class="note">A transfer is still on its way: ${pending.note}.</p>
            <div class="row" style="justify-content:flex-start;gap:20px">
              <button class="ghost" style="color:var(--coven-fg)" @click=${() => this.resume(kit, pending)}>Finish it</button>
              <button class="ghost" @click=${() => {
                pendingStore.clear()
                this.pending = undefined
              }}>Dismiss</button>
            </div>
          </div>`
        : nothing}

      <div class="gap-md title" style="line-height:1.15">
        <span style="display:block">
          <span style="color:var(--coven-ink-muted)">Pay </span>
          <input
            inputmode="decimal"
            autocomplete="off"
            placeholder="0"
            aria-label="Amount to pay"
            .value=${this.amount}
            style="background:transparent;border:0;outline:none;padding:0;field-sizing:content;min-width:1ch;width:${Math.max(this.amount.length, 1) + 0.4}ch;max-width:100%;font:inherit;letter-spacing:inherit;color:inherit"
            @input=${(e: Event) => {
              const input = e.target as HTMLInputElement
              const next = sanitizeAmountInput(input.value)
              if (next === undefined) input.value = this.amount
              else this.amount = next
            }}
          />
          ${locked ? html`<span>${from?.symbol ?? '…'}</span>` : html`<button class="slot" style="font:inherit" @click=${() => (this.screen = 'pick-from')}>${from ? assetLabel(from) : 'a token'}</button>`}
        </span>
        <span style="display:block">
          <span style="color:var(--coven-ink-muted)">get </span>
          ${locked
            ? html`<span>${outcome ?? to?.symbol ?? '…'}</span>`
            : html`<button class="slot" style="font:inherit;${to ? '' : 'color:var(--coven-ink-muted)'}" @click=${() => (this.screen = 'pick-to')}>
                ${outcome ?? (to ? assetLabel(to) : 'something')}
              </button>`}
        </span>
      </div>

      <div class="gap-md stack">
        <div class="row" style="justify-content:flex-start;gap:20px">
          ${from && this.balance !== undefined
            ? html`<button class="ghost" @click=${this.setMax}>Max ${formatAmount(this.balance, from.decimals, 4)} ${from.symbol}</button>`
            : nothing}
          <button
            class="ghost"
            aria-label="Flip direction"
            @click=${() => {
              const fromId = this.fromId
              this.fromId = this.toId
              this.toId = fromId
            }}
          >
            ${flipIcon} Flip
          </button>
        </div>
        <p class="note" aria-live="polite">${this.quoting ? 'Pricing…' : (this.quoteError ?? this.quote?.note ?? (from && to ? 'Type an amount to see the price.' : ''))}</p>
        ${this.networkHint(kit, state)}
        <button class="primary" ?disabled=${action.disabled} @click=${() => action.run?.()}>${action.label}</button>
      </div>
    `
  }

  /** Says up front when the trade starts on a different network than the wallet is on. */
  private networkHint(kit: Kit, state: KitState) {
    const plan = this.plan
    if (!plan?.ok || !state.address || state.chainId === plan.plan.sourceChainId) return nothing
    const name = kit.chains.find((c) => c.id === plan.plan.sourceChainId)?.name ?? `chain ${plan.plan.sourceChainId}`
    return html`<p class="note">This starts on ${name}. Your wallet will ask to switch.</p>`
  }

  private needConnect() {
    this.dispatchEvent(new CustomEvent('coven-need-connect', { bubbles: true, composed: true }))
  }

  private renderReview(kit: Kit, state: KitState) {
    const from = this.from
    const to = this.to
    const plan = this.plan
    if (!from || !to || !plan?.ok) return this.renderHome(kit, state)
    const slippage = this.params?.slippageBps ?? 50
    const chainName = (id: number) => kit.chains.find((c) => c.id === id)?.name ?? `chain ${id}`
    return html`
      <div class="header">
        <button class="icon-button" aria-label="Back" @click=${() => (this.screen = 'home')}>${backIcon}</button>
        <p class="label">Review</p>
        <span style="width:32px"></span>
      </div>
      <h2 class="title">${this.quote?.amountOut !== undefined ? `${formatAmount(this.quote.amountOut, to.decimals, 6)} ${to.symbol}` : `${this.amount} ${from.symbol}`}</h2>
      <div class="gap-lg stack note">
        <div class="row"><span>You pay</span><span style="color:var(--coven-fg)">${this.amount} ${assetLabel(from)}</span></div>
        <div class="row"><span>You get${plan.plan.kind === 'swap' ? '' : ' at least'}</span><span style="color:var(--coven-fg)">${this.quote?.amountOut !== undefined ? formatAmount(this.quote.amountOut, to.decimals, 6) : '…'} ${assetLabel(to)}</span></div>
        <div class="row"><span>Starts on</span><span style="color:var(--coven-fg)">${chainName(plan.plan.sourceChainId)}</span></div>
        <div class="row"><span>Max slippage</span><span style="color:var(--coven-fg)">${(slippage / 100).toFixed(2)}%</span></div>
        ${this.quote ? html`<p class="note">${this.quote.note}</p>` : nothing}
      </div>
      <ol class="ladder gap-lg" aria-label="Steps">
        ${plan.plan.steps.map((s) => html`<li data-state="waiting"><span class="mark" aria-hidden="true">·</span>${s.label}</li>`)}
      </ol>
      <div class="gap-lg">
        <button class="primary" @click=${() => this.start(kit, plan.plan)}>Confirm</button>
      </div>
    `
  }

  private renderStatus(kit: Kit) {
    const flow = this.flow!
    const chain = kit.chains.find((c) => c.id === flow.chainId)
    const link = flow.hash ? explorerTxUrl(chain, flow.hash) : undefined
    const finished = flow.done || Boolean(flow.error)
    return html`
      <p class="label">${flow.error ? 'Failed' : flow.done ? 'Done' : 'Working'}</p>
      <h2 class="title">${flow.error ?? flow.title}</h2>
      <ol class="ladder gap-lg" aria-live="polite">
        ${flow.steps.map(
          (s) =>
            html`<li data-state=${s.state}><span class="mark" aria-hidden="true">${s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : s.state === 'active' ? '→' : ''}</span>${s.label}</li>`,
        )}
      </ol>
      <div class="gap-md stack">
        ${flow.detail && !flow.error ? html`<p class="note">${flow.detail}</p>` : nothing}
        ${link ? html`<a class="note" href=${link} target="_blank" rel="noreferrer">View transaction on ${chain?.name}</a>` : nothing}
      </div>
      <div class="gap-lg">
        <button
          class="primary"
          ?disabled=${!finished}
          @click=${() => {
            this.flow = undefined
            this.screen = 'home'
          }}
        >
          ${finished ? 'Back' : 'Please wait'}
        </button>
      </div>
    `
  }

  override updated() {
    // Pool discovery only feeds the token picker, so it starts the first time the picker opens.
    // Running it on every page load would spend the shared Arc RPC's rate limit on log queries.
    if ((this.screen === 'pick-from' || this.screen === 'pick-to') && !this.locked) this.startWatch?.()
  }
}

/** Searchable token list for the swap view. */
export class CovenTokenPicker extends KitElement {
  static override styles = [baseStyles]

  static override properties = {
    ...KitElement.properties,
    assets: { attribute: false },
    selected: { attribute: false },
    heading: { attribute: false },
    query: { state: true },
  }

  declare assets: SwapAsset[]
  declare selected: string | undefined
  declare heading: string
  declare query: string

  constructor() {
    super()
    this.assets = []
    this.query = ''
    this.heading = 'Pick a token'
  }

  override firstUpdated() {
    this.renderRoot.querySelector<HTMLInputElement>('input')?.focus()
  }

  override render() {
    const q = this.query.trim().toLowerCase()
    const matches = this.assets.filter(
      (a) => !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.address.toLowerCase() === q || a.chainName.toLowerCase().includes(q),
    )
    const shown = matches.slice(0, 100)
    return html`
      <div class="header">
        <button class="icon-button" aria-label="Back" @click=${() => this.dispatchEvent(new CustomEvent('coven-back'))}>${backIcon}</button>
        <p class="label">${this.heading}</p>
        <span style="width:32px"></span>
      </div>
      <div class="gap-md">
        <input
          class="search"
          type="search"
          placeholder="Name, symbol, network or address"
          aria-label="Search tokens"
          .value=${this.query}
          @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
        />
      </div>
      <ul class="list scroll gap-md" role="listbox" aria-label="Tokens">
        ${shown.map(
          (a) => html`<li>
            <button class="item" role="option" aria-selected=${a.id === this.selected ? 'true' : 'false'} @click=${() => this.dispatchEvent(new CustomEvent('coven-asset', { detail: a }))}>
              ${avatar(a.symbol, a.logoURI)}
              <span class="grow">${a.symbol}<span class="sub">${a.remote ? `on ${a.chainName}` : a.name}</span></span>
            </button>
          </li>`,
        )}
      </ul>
      ${matches.length === 0 ? html`<p class="note gap-md">No token matches “${this.query}”.</p>` : nothing}
    `
  }
}
