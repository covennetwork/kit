import { describe, expect, it } from 'vitest'
import * as viemChains from 'viem/chains'
import { parseAsset, accountId, erc20AssetId } from '../src/core/caip.js'
import { mainnets, withDefaultFirst } from '../src/core/chains.js'
import { visibleConnectors } from '../src/core/connectors.js'
import { formatAmount, parseAmount, sanitizeAmountInput, errorMessage } from '../src/core/format.js'
import { resolveTheme, themeVariables } from '../src/core/theme.js'
import { parseViewRequest, viewRequestToParams } from '../src/core/views.js'

describe('chains', () => {
  const list = mainnets()
  it('puts Arc first and covers every viem mainnet', () => {
    expect(list[0]!.id).toBe(5042)
    const viemMainnets = new Set(
      (Object.values(viemChains) as { id?: number; testnet?: boolean; rpcUrls?: unknown }[])
        .filter((c) => c && typeof c.id === 'number' && c.rpcUrls && !c.testnet && c.id !== 1337 && c.id !== 31337)
        .map((c) => c.id),
    )
    const ours = new Set(list.map((c) => c.id))
    // Fails when viem gains chains and the snapshot was not regenerated (npm run build does it).
    for (const id of viemMainnets) expect(ours.has(id!), `chain ${id} missing; run scripts/gen-chains.mjs`).toBe(true)
  })
  it('has no testnets or local dev chains', () => {
    const ids = new Set(list.map((c) => c.id))
    for (const id of [11155111, 84532, 421614, 31337, 1337, 5042002]) expect(ids.has(id)).toBe(false)
  })
  it('uses full viem definitions where Coven sends transactions', () => {
    expect(list.find((c) => c.id === 8453)).toBe(viemChains.base)
    expect(list.find((c) => c.id === 10)).toBe(viemChains.optimism)
  })
  it('has unique ids', () => {
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
  })
  it('reorders for a default chain', () => {
    expect(withDefaultFirst(list, 8453)[0].id).toBe(8453)
    expect(() => withDefaultFirst(list, 999999999)).toThrow()
  })
})

describe('caip', () => {
  it('parses bare addresses onto the default chain and CAIP-19 ids onto theirs', () => {
    expect(parseAsset('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 5042)).toEqual({
      chainId: 5042,
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    })
    expect(parseAsset('eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 5042)?.chainId).toBe(8453)
    expect(parseAsset('eip155:8453/erc721:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 5042)).toBeUndefined()
    expect(parseAsset('not-a-token', 5042)).toBeUndefined()
  })
  it('checksums ids', () => {
    expect(accountId(1, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe('eip155:1:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(erc20AssetId(8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toBe('eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
  })
})

describe('views', () => {
  it('round-trips a swap request', () => {
    const request = parseViewRequest((k) =>
      new URLSearchParams('view=swap&tokenIn=eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&tokenOut=0x0000000000000000000000000000000000000001&amount=25.5&slippageBps=80').get(k),
    )
    expect(request).toMatchObject({ view: 'swap', amount: '25.5', slippageBps: 80 })
    expect(parseViewRequest((k) => viewRequestToParams(request).get(k))).toEqual(request)
  })
  it('drops malformed values instead of passing them on', () => {
    const request = parseViewRequest((k) => ({ view: 'swap', pool: '0xnope', amount: '1e9', hooks: 'x', slippageBps: '999999' })[k] ?? null)
    expect(request).toEqual({ view: 'swap', slippageBps: 5000 })
  })
  it('accepts kebab-case attribute names', () => {
    const attrs: Record<string, string> = { view: 'swap', 'token-out': '0x0000000000000000000000000000000000000001', 'slippage-bps': '30' }
    expect(parseViewRequest((k) => attrs[k] ?? null)).toMatchObject({ tokenOut: '0x0000000000000000000000000000000000000001', slippageBps: 30 })
  })
  it('falls back to swap for unknown views', () => {
    expect(parseViewRequest((k) => (k === 'view' ? 'settings' : null))).toEqual({ view: 'swap' })
    expect(parseViewRequest((k) => (k === 'tokenIn' ? 'settings' : null))).toEqual({ view: 'swap' })
    expect(parseViewRequest((k) => (k === 'view' ? 'account' : null))).toEqual({ view: 'account' })
  })
})

describe('theme', () => {
  it('resolves auto from the system setting', () => {
    expect(resolveTheme({ mode: 'auto' }, true).mode).toBe('dark')
    expect(resolveTheme({ mode: 'auto' }, false).mode).toBe('light')
  })
  it('refuses values that could escape a CSS custom property', () => {
    const theme = resolveTheme({ bg: 'red;} body{display:none', accent: 'url(x)', font: 'x; background:url(//evil)' })
    expect(theme.bg).toBe('#EFECE4')
    expect(theme.accent).toBeUndefined()
    expect(theme.font).toContain('Inter')
  })
  it('keeps transparent backgrounds but gives the modal an opaque surface', () => {
    const vars = themeVariables(resolveTheme({ bg: 'transparent', mode: 'dark' }))
    expect(vars['--coven-bg']).toBe('transparent')
    expect(vars['--coven-surface']).toBe('#0E0E0D')
  })
})

describe('format', () => {
  it('formats and parses amounts', () => {
    expect(formatAmount(1234567890n, 6)).toBe('1,234.56789')
    expect(parseAmount('1234.56789', 6)).toBe(1234567890n)
    expect(parseAmount('1.2.3', 6)).toBe(0n)
    expect(parseAmount('.5', 18)).toBe(500000000000000000n)
  })
  it('sanitizes amount input', () => {
    expect(sanitizeAmountInput('1,5')).toBe('1.5')
    expect(sanitizeAmountInput('12abc')).toBe('12')
    expect(sanitizeAmountInput('1.2.3')).toBeUndefined()
  })
  it('turns wallet rejections into plain words', () => {
    expect(errorMessage(Object.assign(new Error('User rejected the request.'), { code: 4001 }))).toBe('You cancelled that in your wallet.')
  })
})

describe('connectors', () => {
  it('hides the nameless injected fallback once EIP-6963 wallets announce', () => {
    const list = [
      { id: 'injected', type: 'injected' },
      { id: 'io.metamask', type: 'injected' },
      { id: 'metaMaskSDK', type: 'metaMask' },
      { id: 'walletConnect', type: 'walletConnect' },
    ]
    expect(visibleConnectors(list).map((c) => c.id)).toEqual(['io.metamask', 'walletConnect'])
    expect(visibleConnectors([{ id: 'injected', type: 'injected' }]).map((c) => c.id)).toEqual(['injected'])
  })
})
