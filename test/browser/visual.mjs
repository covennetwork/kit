// Phone-width and dark-mode screenshots, with the modal open on the connect view.
import { chromium } from 'playwright-core'

const [url, out] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--no-sandbox'] })
const errors = []
for (const [name, viewport, hash] of [
  ['phone', { width: 390, height: 844 }, ''],
  ['dark', { width: 1280, height: 860 }, encodeURIComponent(JSON.stringify({ mode: 'dark', bg: '#0E0E0D', useAccent: true, accent: '#c8ff5a' }))],
]) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${url}#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}-${name}.png` })
  await page.getByRole('button', { name: 'Open as modal' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}-${name}-modal.png` })
  // Escape closes, focus returns.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const open = await page.evaluate(() => document.querySelector('coven-modal')?.hasAttribute('open'))
  console.log(name, 'modal open after Escape:', open)
  await page.close()
}
console.log('errors', errors)
await browser.close()
