// Host page on one origin embeds coven.network/embed (another origin) with wallet=host. The iframe
// must use the host's wallet: no wallet list of its own, switch to Base through the host, and
// never forward a signing request.
import { chromium } from 'playwright-core'

const [hostUrl = 'http://localhost:5196/', out = 'bridge.png'] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(hostUrl, { waitUntil: 'networkidle' })
const frame = page.frameLocator('#coven')

// The host wallet is already authorized, so the iframe should come up connected.
await frame.getByRole('button', { name: 'Review' }).waitFor({ timeout: 40_000 })
const hint = await frame.getByText(/This starts on Base/).textContent()
console.log('hint:', hint?.trim())
await frame.getByRole('button', { name: 'Review' }).click()
await frame.getByRole('button', { name: 'Confirm' }).click()
await page.waitForFunction(() => window.__calls.some((c) => c.startsWith('eth_sendTransaction')), null, { timeout: 60_000 })
await page.waitForTimeout(800)
await page.screenshot({ path: out })

await page.evaluate(() => window.__hostile())
await page.waitForTimeout(500)
const result = await page.evaluate(() => ({ calls: window.__calls, events: window.__events, connectRequests: window.__connectRequests, height: document.getElementById('coven').style.height }))
const relevant = result.calls.filter((c) => /switch|sendTransaction|personal_sign/.test(c))
console.log('wallet calls via bridge:', relevant.join(' | '))
console.log('events at host:', [...new Set(result.events)].join(', '))
console.log('iframe height from resize:', result.height)
const ok =
  relevant[0] === 'wallet_switchEthereumChain@0x1->0x2105' &&
  relevant.some((c) => c === 'eth_sendTransaction@0x2105') &&
  !relevant.some((c) => c.startsWith('personal_sign'))
console.log(ok ? 'PASS: iframe used the host wallet, switched to Base, never signed messages' : 'FAIL')
console.log('page errors:', errors)
await browser.close()
process.exit(ok ? 0 : 1)
