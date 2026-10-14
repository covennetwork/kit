// @vitest-environment happy-dom
import { arc } from '@covennetwork/sdk'
import { mock } from '@wagmi/core'
import { base, mainnet } from 'viem/chains'
import { afterEach, describe, expect, it } from 'vitest'
import { type Kit, createKit, getDefaultKit } from '../src/core/kit.js'

const ACCOUNT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
let kit: Kit | undefined

afterEach(async () => {
  await kit?.disconnect().catch(() => undefined)
  kit?.destroy()
  kit = undefined
  localStorage.clear()
})

function testKit(extra: Parameters<typeof createKit>[0] = {}) {
  kit = createKit({
    chains: [mainnet, base, arc],
    wallet: { defaultConnectors: false, connectors: [mock({ accounts: [ACCOUNT] })] },
    ...extra,
  })
  return kit
}

describe('createKit', () => {
  it('defaults to Arc even when it is not listed first, and becomes the default kit', () => {
    const k = testKit()
    expect(k.defaultChainId).toBe(arc.id)
    expect(k.chains[0]!.id).toBe(arc.id)
    expect(getDefaultKit()).toBe(k)
    expect(k.mode).toBe('managed')
  })

  it('offers every viem mainnet when no chains are given', () => {
    kit = createKit({ wallet: { defaultConnectors: false, connectors: [mock({ accounts: [ACCOUNT] })] } })
    expect(kit.chains.length).toBeGreaterThan(300)
    expect(kit.chains[0]!.id).toBe(arc.id)
  })

  it('caps the integrator fee at the router maximum', () => {
    const k = testKit({ integrator: { address: '0x0000000000000000000000000000000000000001', feeBps: 9999 } })
    expect(k.integrator?.feeBps).toBe(300)
  })

  it('emits CAIP-identified events across connect, chain switch and disconnect', async () => {
    const k = testKit()
    const events: [string, unknown][] = []
    for (const name of ['connect', 'chainChanged', 'disconnect'] as const) k.on(name, (p) => events.push([name, p]))
    const uid = k.getState().connectors.find((c) => c.type === 'mock')!.uid
    await k.connect(uid)
    expect(k.getState().address).toBe(ACCOUNT)
    await k.switchChain(base.id)
    expect(k.getState().chainId).toBe(base.id)
    await k.disconnect()
    expect(events[0]).toEqual(['connect', expect.objectContaining({ account: expect.stringMatching(/^eip155:\d+:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045$/) })])
    expect(events).toContainEqual(['chainChanged', { chain: 'eip155:8453' }])
    expect(events.at(-1)).toEqual(['disconnect', {}])
  })

  it('walletOn moves the wallet and returns a client bound to that chain', async () => {
    const k = testKit()
    await k.connect(k.getState().connectors.find((c) => c.type === 'mock')!.uid)
    await k.switchChain(mainnet.id)
    const client = await k.walletOn(base.id)
    expect(client.chain?.id).toBe(base.id)
    expect(k.getState().chainId).toBe(base.id)
    const arcClient = await k.walletOn(arc.id)
    expect(arcClient.chain?.id).toBe(arc.id)
    await expect(k.walletOn(42161)).rejects.toThrow(/not in this app/)
  })

  it('tracks the modal in state and announces view changes', () => {
    const k = testKit()
    const seen: unknown[] = []
    k.on('viewChanged', (p) => seen.push(p))
    k.open({ view: 'swap', tokenOut: '0x0000000000000000000000000000000000000001' })
    expect(k.getState().modal).toEqual({ open: true, request: { view: 'swap', tokenOut: '0x0000000000000000000000000000000000000001' } })
    k.close()
    expect(k.getState().modal.open).toBe(false)
    expect(seen).toHaveLength(2)
  })

  it('opens connect when disconnected and account when connected', async () => {
    const k = testKit()
    k.open()
    expect(k.getState().modal.request).toEqual({ view: 'connect' })
    await k.connect(k.getState().connectors.find((c) => c.type === 'mock')!.uid)
    k.open()
    expect(k.getState().modal.request).toEqual({ view: 'account' })
  })

  it('applies theme changes to state', () => {
    const k = testKit({ theme: { mode: 'dark', accent: '#ff5500' } })
    expect(k.getState().theme).toMatchObject({ mode: 'dark', accent: '#ff5500' })
    k.setTheme({ mode: 'light' })
    expect(k.getState().theme).toMatchObject({ mode: 'light', accent: '#ff5500' })
  })

  it('in provider mode uses only the host wallet and hands connect requests to the host', () => {
    let asked = 0
    const provider = { request: async () => [], on() {}, removeListener() {} }
    kit = createKit({ chains: [arc, base], wallet: { provider: provider as never, onConnectRequest: () => asked++ } })
    expect(kit.mode).toBe('provider')
    expect(kit.wagmiConfig.connectors.map((c) => c.id)).toEqual(['host'])
    kit.requestConnect()
    expect(asked).toBe(1)
  })
})
