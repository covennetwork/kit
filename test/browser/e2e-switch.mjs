// End-to-end: a fake EIP-6963 wallet on Ethereum mainnet pays with USDC on Base. The kit must ask
// the wallet to switch to Base (0x2105) before it sends anything, then send from Base.
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://localhost:5198/'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.addInitScript(() => {
  const ACCOUNT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  let chainId = '0x1'
  let authorized = false
  const listeners = {}
  const calls = (window.__walletCalls = [])
  const emit = (event, data) => (listeners[event] ?? []).forEach((h) => h(data))
  const provider = {
    async request({ method, params }) {
      calls.push({ method, params, chainId })
      switch (method) {
        case 'eth_requestAccounts':
          authorized = true
          return [ACCOUNT]
        case 'eth_accounts':
          return authorized ? [ACCOUNT] : []
        case 'eth_chainId':
          return chainId
        case 'wallet_switchEthereumChain':
          chainId = params[0].chainId
          emit('chainChanged', chainId)
          return null
        case 'wallet_requestPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        case 'eth_sendTransaction':
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        default: {
          // Reads go to the public RPC of whatever chain the wallet is on.
          const rpc = { '0x1': 'https://eth.llamarpc.com', '0x2105': 'https://mainnet.base.org', '0x13b2': 'https://rpc.mainnet.arc.io' }[chainId]
          const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
          const json = await res.json()
          if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code })
          return json.result
        }
      }
    },
    on(event, handler) {
      ;(listeners[event] ??= []).push(handler)
    },
    removeListener(event, handler) {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler)
    },
  }
  const info = { uuid: 'test-wallet', name: 'Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'network.coven.test' }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})

const preset = encodeURIComponent(JSON.stringify({ tokenIn: 'eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', tokenOut: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', amount: '5' }))
await page.goto(`${url}#${preset}`, { waitUntil: 'networkidle' })
const widget = page.locator('.canvas coven-widget')

// Connect through the widget: the primary button asks for a wallet.
await widget.getByRole('button', { name: 'Connect wallet' }).click()
await widget.getByRole('button', { name: /Test Wallet/ }).click()
await page.waitForFunction(() => window.__walletCalls.some((c) => c.method === 'eth_requestAccounts'))
await page.waitForTimeout(800)

const hint = await widget.getByText(/This starts on Base/).textContent({ timeout: 15_000 })
console.log('hint:', hint?.trim())
await widget.getByRole('button', { name: 'Review' }).click({ timeout: 30_000 })
console.log('review:', (await widget.getByText('Starts on').locator('..').textContent()).replace(/\s+/g, ' ').trim())
await page.screenshot({ path: process.argv[3] ?? 'review.png' })
await widget.getByRole('button', { name: 'Confirm' }).click()
await page.waitForFunction(() => window.__walletCalls.some((c) => c.method === 'eth_sendTransaction'), null, { timeout: 60_000 })
await page.waitForTimeout(500)

const calls = await page.evaluate(() => window.__walletCalls.map((c) => `${c.method}@${c.chainId}${c.method === 'wallet_switchEthereumChain' ? '->' + c.params[0].chainId : ''}`))
const relevant = calls.filter((c) => /switch|sendTransaction/.test(c))
console.log('wallet calls:', relevant.join(' | '))
const status = (await widget.locator('coven-swap-view').textContent()).replace(/\s+/g, ' ').trim()
console.log('status:', status.slice(0, 200))
await page.screenshot({ path: (process.argv[3] ?? 'review.png').replace('.png', '-status.png') })

const switchIndex = calls.findIndex((c) => c.includes('wallet_switchEthereumChain@0x1->0x2105'))
const sendIndex = calls.findIndex((c) => c.startsWith('eth_sendTransaction@0x2105'))
const ok = switchIndex >= 0 && sendIndex > switchIndex
console.log(ok ? 'PASS: switched to Base, then sent from Base' : 'FAIL')
console.log('page errors:', errors)
await browser.close()
process.exit(ok ? 0 : 1)
