// Opens a page in headless Chrome, reports console errors, and saves screenshots.
import { chromium } from 'playwright-core'

const [url, out = 'shot', width = '1360', height = '1000'] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`))
await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch((e) => errors.push(`goto: ${e.message}`))
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}.png`, fullPage: true })
console.log(JSON.stringify({ errors }, null, 1))
await browser.close()
