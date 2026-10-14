// The Coven site with a wallet already connected on Ethereum: no "Switch to Arc" wall, and the
// swap page stays usable.
import { chromium } from 'playwright-core'

const [url = 'http://localhost:3100/', out = 'site'] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  const ACCOUNT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  const provider = {
    async request({ method }) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ACCOUNT]
      if (method === 'eth_chainId') return '0x1'
      if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }]
      throw Object.assign(new Error('unsupported'), { code: 4200 })
    },
    on() {},
    removeListener() {},
  }
  const info = { uuid: 'test', name: 'Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'network.coven.test' }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
// Connect through the site's own wallet picker if it is showing.
const connect = page.getByRole('button', { name: /^Connect/ })
if (await connect.count()) {
  const options = await page.locator('button').allTextContents()
  console.log('connect screen buttons:', options.map((t) => t.trim()).filter(Boolean).slice(0, 6))
}
await page.screenshot({ path: `${out}.png` })
const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
console.log('shows switch-to-Arc wall:', /Switch to Arc\./.test(body))
console.log('text:', body.slice(0, 220))
console.log('page errors:', errors)
await browser.close()
