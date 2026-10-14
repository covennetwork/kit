// @vitest-environment happy-dom
import { arc } from '@covennetwork/sdk'
import { mock } from '@wagmi/core'
import { base } from 'viem/chains'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { type Kit, createKit } from '../src/core/kit.js'
import { defineElements } from '../src/elements/define.js'
import { mountModal } from '../src/elements/modal-host.js'

const ACCOUNT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
let kit: Kit

beforeAll(() => defineElements())

afterEach(async () => {
  await kit?.disconnect().catch(() => undefined)
  kit?.destroy()
  document.body.innerHTML = ''
  localStorage.clear()
})

const tick = () => new Promise((r) => setTimeout(r, 0))

async function settle(el: Element) {
  for (let i = 0; i < 6; i++) {
    await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete
    await tick()
  }
}

/** Text of an element and every shadow root under it. */
function deepText(node: Node): string {
  let text = ''
  const walk = (n: Node) => {
    if (n.nodeType === 3) text += n.textContent
    const el = n as Element
    if (el.shadowRoot) el.shadowRoot.childNodes.forEach(walk)
    n.childNodes.forEach(walk)
  }
  walk(node)
  return text.replace(/\s+/g, ' ')
}

function deepQuery<T extends Element>(root: Node, selector: string, match?: (el: T) => boolean): T | undefined {
  let found: T | undefined
  const walk = (n: Node) => {
    if (found) return
    const el = n as Element
    if (el.matches?.(selector) && (!match || match(el as T))) found = el as T
    if (el.shadowRoot) el.shadowRoot.childNodes.forEach(walk)
    n.childNodes.forEach(walk)
  }
  walk(root)
  return found
}

function makeKit() {
  kit = createKit({
    app: { name: 'Test' },
    chains: [arc, base],
    wallet: { defaultConnectors: false, connectors: [mock({ accounts: [ACCOUNT] })] },
  })
  return kit
}

describe('<coven-widget>', () => {
  it('lists wallets, connects, then shows the account', async () => {
    makeKit()
    const el = document.createElement('coven-widget')
    el.setAttribute('view', 'connect')
    document.body.append(el)
    await settle(el)
    expect(deepText(el)).toContain('Connect a wallet.')
    expect(deepText(el)).toContain('Mock Connector')
    deepQuery<HTMLButtonElement>(el, 'button.item')!.click()
    for (let i = 0; i < 20 && !kit.getState().address; i++) await tick()
    await settle(el)
    expect(kit.getState().address).toBe(ACCOUNT)
    expect(deepText(el)).toContain('0xd8dA…6045')
    expect(deepText(el)).toContain('Disconnect')
  })

  it('reads its request from a property as well as attributes', async () => {
    makeKit()
    const el = document.createElement('coven-widget') as HTMLElement & { request: unknown }
    el.request = { view: 'account' }
    document.body.append(el)
    await settle(el)
    // Not connected: the account view falls back to connecting.
    expect(deepText(el)).toContain('Connect a wallet.')
  })

  it('writes theme tokens on its host', async () => {
    makeKit().setTheme({ mode: 'dark', accent: '#ff5500', radius: 8 })
    const el = document.createElement('coven-widget')
    document.body.append(el)
    await settle(el)
    expect(el.style.getPropertyValue('--coven-accent')).toBe('#ff5500')
    expect(el.style.getPropertyValue('--coven-radius')).toBe('8px')
    expect(el.dataset.mode).toBe('dark')
  })
})

describe('<coven-connect-button>', () => {
  it('shows the address and network once connected', async () => {
    makeKit()
    const el = document.createElement('coven-connect-button')
    document.body.append(el)
    await settle(el)
    expect(deepText(el)).toContain('Connect wallet')
    await kit.connect(kit.getState().connectors[0]!.uid)
    await kit.switchChain(base.id)
    await settle(el)
    expect(deepText(el)).toContain('0xd8dA…6045')
    expect(deepText(el)).toContain('Base')
  })
})

describe('<coven-modal>', () => {
  it('opens as an ARIA dialog and closes on Escape', async () => {
    makeKit()
    const modal = mountModal(kit)
    kit.open({ view: 'connect' })
    await settle(modal)
    const dialog = deepQuery(modal, '[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(modal.hasAttribute('open')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle(modal)
    expect(kit.getState().modal.open).toBe(false)
    expect(modal.hasAttribute('open')).toBe(false)
  })

  it('closes by itself after a connect-only request succeeds', async () => {
    makeKit()
    const modal = mountModal(kit)
    kit.open({ view: 'connect' })
    await settle(modal)
    deepQuery<HTMLButtonElement>(modal, 'button.item')!.click()
    for (let i = 0; i < 30 && kit.getState().modal.open; i++) await tick()
    expect(kit.getState().address).toBe(ACCOUNT)
    expect(kit.getState().modal.open).toBe(false)
  })
})

describe('kit.open()', () => {
  it('shows the modal it mounts lazily, even though the state changed first', async () => {
    makeKit()
    kit.open({ view: 'connect' })
    let modal: Element | null = null
    for (let i = 0; i < 50 && !modal?.hasAttribute('open'); i++) {
      await tick()
      modal = document.querySelector('coven-modal')
    }
    expect(modal?.hasAttribute('open')).toBe(true)
    await settle(modal!)
    expect(deepText(modal!)).toContain('Connect a wallet.')
  })
})
