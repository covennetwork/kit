import { CCTP_CHAINS, EURC, USDC, arc } from '@covennetwork/sdk'
import { html, nothing, render } from 'lit'
import { isAddress } from 'viem'
import { type Kit, type KitEventName, type ThemeMode, type ViewName, type ViewRequest, createKit, mainnets, shortAddress, viewRequestToParams } from '../src/index.js'
import { defineElements } from '../src/elements.js'

defineElements()

type ChainSet = 'all' | 'cctp' | 'arc'

type Settings = {
  view: ViewName
  mode: ThemeMode
  accent: string
  useAccent: boolean
  bg: string
  transparent: boolean
  radius: number
  compact: boolean
  pool: string
  tokenIn: string
  tokenOut: string
  amount: string
  slippageBps: number
  integrator: string
  feeBps: number
  chains: ChainSet
  defaultChainId: number
  embed: 'inline' | 'iframe'
  iframeOrigin: string
  codeTab: 'react' | 'html' | 'iframe'
}

const DEFAULTS: Settings = {
  view: 'swap',
  mode: 'light',
  accent: '#000000',
  useAccent: false,
  bg: '#EFECE4',
  transparent: false,
  radius: 20,
  compact: false,
  pool: '',
  tokenIn: '',
  tokenOut: '',
  amount: '',
  slippageBps: 50,
  integrator: '',
  feeBps: 30,
  chains: 'all',
  defaultChainId: arc.id,
  embed: 'inline',
  iframeOrigin: 'https://coven.network',
  codeTab: 'react',
}

const BASE_USDC = `eip155:8453/erc20:${CCTP_CHAINS.find((c) => c.chain.id === 8453)!.usdc}`

const PRESETS: { label: string; apply: Partial<Settings> }[] = [
  { label: 'Open swap', apply: { view: 'swap', pool: '', tokenIn: '', tokenOut: '', amount: '' } },
  { label: 'USDC on Base → EURC', apply: { view: 'swap', pool: '', tokenIn: BASE_USDC, tokenOut: EURC, amount: '5' } },
  { label: 'Arc USDC → EURC', apply: { view: 'swap', pool: '', tokenIn: USDC, tokenOut: EURC, amount: '' } },
  { label: 'Send USDC to Base', apply: { view: 'swap', pool: '', tokenIn: USDC, tokenOut: BASE_USDC, amount: '' } },
  { label: 'Connect', apply: { view: 'connect' } },
  { label: 'Account', apply: { view: 'account' } },
]

// ---- settings, persisted in the URL hash so a configuration can be shared --------------------

function loadSettings(): Settings {
  try {
    const raw = location.hash.slice(1)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(decodeURIComponent(raw)) as Partial<Settings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

let settings = loadSettings()
const events: { name: string; payload: string; at: string }[] = []
let kit: Kit
let kitKey = ''

function saveSettings() {
  const diff: Partial<Settings> = {}
  for (const key of Object.keys(settings) as (keyof Settings)[]) if (settings[key] !== DEFAULTS[key]) (diff as Record<string, unknown>)[key] = settings[key]
  history.replaceState(null, '', Object.keys(diff).length ? `#${encodeURIComponent(JSON.stringify(diff))}` : location.pathname)
}

function update(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  saveSettings()
  syncKit()
  draw()
}

// ---- the kit ---------------------------------------------------------------------------------

function chainList(set: ChainSet) {
  if (set === 'arc') return [arc]
  if (set === 'cctp') return [arc, ...CCTP_CHAINS.map((c) => c.chain)]
  return mainnets()
}

function themeFromSettings() {
  return {
    mode: settings.mode,
    accent: settings.useAccent ? settings.accent : undefined,
    bg: settings.transparent ? 'transparent' : settings.bg,
    radius: settings.radius,
    compact: settings.compact,
  }
}

/** Theme changes apply live; anything that changes the wallet setup builds a new kit. */
function syncKit() {
  const integrator = isAddress(settings.integrator) ? settings.integrator : undefined
  const chains = chainList(settings.chains)
  const defaultChainId = chains.some((c) => c.id === settings.defaultChainId) ? settings.defaultChainId : arc.id
  const key = JSON.stringify([integrator, settings.feeBps, settings.chains, defaultChainId])
  if (key !== kitKey) {
    kit?.destroy()
    kitKey = key
    kit = createKit({
      app: { name: 'Coven Kit Playground', url: location.origin },
      chains,
      defaultChainId,
      integrator: integrator ? { address: integrator, feeBps: settings.feeBps } : undefined,
      theme: themeFromSettings(),
    })
    for (const name of ['connect', 'disconnect', 'accountChanged', 'chainChanged', 'viewChanged', 'swapSubmitted', 'swapConfirmed', 'error'] as KitEventName[]) {
      kit.on(name, (payload) => {
        events.unshift({ name, payload: JSON.stringify(payload), at: new Date().toLocaleTimeString() })
        events.length = Math.min(events.length, 40)
        draw()
      })
    }
    kit.subscribe(() => draw())
  } else {
    kit.setTheme(themeFromSettings())
  }
  document.documentElement.dataset.theme = settings.mode === 'auto' ? '' : settings.mode
}

function currentRequest(): ViewRequest {
  if (settings.view !== 'swap') return { view: settings.view }
  const request: ViewRequest = { view: 'swap' }
  if (settings.pool.trim()) request.pool = settings.pool.trim() as `0x${string}`
  if (settings.tokenIn.trim()) request.tokenIn = settings.tokenIn.trim()
  if (settings.tokenOut.trim()) request.tokenOut = settings.tokenOut.trim()
  if (settings.amount.trim()) request.amount = settings.amount.trim()
  if (settings.slippageBps !== 50) request.slippageBps = settings.slippageBps
  return request
}

// ---- generated code --------------------------------------------------------------------------

function themeCode(indent: string) {
  const t = themeFromSettings()
  const parts = [`mode: '${t.mode}'`]
  if (t.accent) parts.push(`accent: '${t.accent}'`)
  if (t.bg !== '#EFECE4') parts.push(`bg: '${t.bg}'`)
  if (t.radius !== 20) parts.push(`radius: ${t.radius}`)
  if (t.compact) parts.push('compact: true')
  return `${indent}theme: { ${parts.join(', ')} },`
}

function kitCode(indent = '') {
  const lines = [`${indent}const kit = createKit({`, `${indent}  app: { name: 'Your app' },`]
  if (settings.chains === 'cctp') lines.push(`${indent}  chains: [arc, mainnet, base, arbitrum, optimism, polygon /* … */],`)
  if (settings.chains === 'arc') lines.push(`${indent}  chains: [arc],`)
  if (settings.defaultChainId !== arc.id) lines.push(`${indent}  defaultChainId: ${settings.defaultChainId},`)
  if (isAddress(settings.integrator)) lines.push(`${indent}  integrator: { address: '${settings.integrator}', feeBps: ${settings.feeBps} },`)
  lines.push(themeCode(`${indent}  `))
  lines.push(`${indent}})`)
  return lines.join('\n')
}

function propsCode(request: ViewRequest, style: 'jsx' | 'html') {
  const params = viewRequestToParams(request)
  const out: string[] = []
  for (const [key, value] of params) {
    if (style === 'jsx') out.push(key === 'slippageBps' || key === 'poolFee' || key === 'tickSpacing' ? `${key}={${value}}` : `${key}="${value}"`)
    else out.push(`${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${value}"`)
  }
  return out.join(' ')
}

function code(): string {
  const request = currentRequest()
  if (settings.codeTab === 'react') {
    return `import { createKit } from '@covennetwork/kit'
import { KitProvider, ConnectButton, CovenWidget } from '@covennetwork/kit/react'

${kitCode()}

export function App() {
  return (
    <KitProvider kit={kit}>
      <ConnectButton />
      <CovenWidget ${propsCode(request, 'jsx')} />
      <button onClick={() => kit.open(${JSON.stringify(request).replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'")})}>
        Open as a modal
      </button>
    </KitProvider>
  )
}

kit.on('swapConfirmed', (swap) => console.log(swap.hash, swap.side))`
  }
  if (settings.codeTab === 'html') {
    return `<script type="module">
  import { createKit } from 'https://cdn.jsdelivr.net/npm/@covennetwork/kit@0.1/dist/cdn/kit.js'

${kitCode('  ')}
  kit.on('swapConfirmed', (swap) => console.log(swap.hash))
</script>

<coven-connect-button></coven-connect-button>
<coven-widget ${propsCode(request, 'html')}></coven-widget>`
  }
  return `<iframe
  src="${iframeUrl()}"
  title="Coven"
  allow="clipboard-write"
  style="width:100%;max-width:460px;height:560px;border:0"
></iframe>`
}

function iframeUrl() {
  const params = viewRequestToParams(currentRequest())
  const t = themeFromSettings()
  params.set('theme', t.mode)
  if (t.accent) params.set('accent', t.accent)
  if (settings.transparent) params.set('bg', 'transparent')
  else if (settings.bg !== '#EFECE4') params.set('bg', settings.bg)
  if (settings.compact) params.set('compact', '1')
  if (isAddress(settings.integrator)) {
    params.set('integrator', settings.integrator)
    params.set('integratorFee', String(settings.feeBps))
  }
  return `${settings.iframeOrigin.replace(/\/$/, '')}/embed?${params}`
}

// ---- view ------------------------------------------------------------------------------------

const seg = <T extends string>(value: T, options: [T, string][], onPick: (v: T) => void) =>
  html`<div class="seg" role="group">${options.map(([v, label]) => html`<button type="button" aria-pressed=${v === value} @click=${() => onPick(v)}>${label}</button>`)}</div>`

const text = (label: string, key: keyof Settings, placeholder = '') =>
  html`<label>${label}<input type="text" spellcheck="false" placeholder=${placeholder} .value=${String(settings[key])} @change=${(e: Event) => update({ [key]: (e.target as HTMLInputElement).value } as Partial<Settings>)} /></label>`

function draw() {
  const state = kit.getState()
  const request = currentRequest()
  const chainOptions = chainList(settings.chains)
  const dark = settings.mode === 'dark' || (settings.mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)

  render(
    html`<div class="shell">
      <header class="top">
        <div class="brand"><h1>Coven Kit</h1><span>Playground</span></div>
        <coven-connect-button .kit=${kit}></coven-connect-button>
      </header>

      <p class="lead">Connect any wallet on any EVM chain, show the account, and swap into Arc. <em>Change anything on the left and the kit updates live.</em></p>

      <div class="layout">
        <aside class="panel controls" aria-label="Kit settings">
          <fieldset>
            <legend>View</legend>
            ${seg(settings.view, [['swap', 'Swap'], ['connect', 'Connect'], ['account', 'Account']], (view) => update({ view }))}
            <div class="presets">${PRESETS.map((p) => html`<button type="button" @click=${() => update(p.apply)}>${p.label}</button>`)}</div>
          </fieldset>

          ${settings.view === 'swap'
            ? html`<fieldset>
                <legend>Swap</legend>
                ${text('Pay with (Arc address or CAIP-19 id)', 'tokenIn', '0x… or eip155:8453/erc20:0x…')}
                ${text('Receive', 'tokenOut', '0x… or eip155:1/erc20:0x…')}
                ${text('Lock to a pool (v3 address or v4 id)', 'pool', '0x…')}
                <div class="row2">
                  ${text('Amount', 'amount', '0')}
                  <label>Slippage (bps)<input type="number" min="0" max="5000" .value=${String(settings.slippageBps)} @change=${(e: Event) => update({ slippageBps: Number((e.target as HTMLInputElement).value) || 0 })} /></label>
                </div>
              </fieldset>`
            : nothing}

          <fieldset>
            <legend>Theme</legend>
            ${seg(settings.mode, [['light', 'Light'], ['dark', 'Dark'], ['auto', 'System']], (mode) => update({ mode, bg: mode === 'dark' ? '#0E0E0D' : '#EFECE4' }))}
            <div class="row2">
              <label>Accent
                <span style="display:flex;gap:8px;align-items:center">
                  <input type="color" .value=${settings.accent} @input=${(e: Event) => update({ accent: (e.target as HTMLInputElement).value, useAccent: true })} />
                  <label class="inline"><input type="checkbox" .checked=${settings.useAccent} @change=${(e: Event) => update({ useAccent: (e.target as HTMLInputElement).checked })} />Use</label>
                </span>
              </label>
              <label>Background
                <span style="display:flex;gap:8px;align-items:center">
                  <input type="color" .value=${settings.bg} ?disabled=${settings.transparent} @input=${(e: Event) => update({ bg: (e.target as HTMLInputElement).value })} />
                  <label class="inline"><input type="checkbox" .checked=${settings.transparent} @change=${(e: Event) => update({ transparent: (e.target as HTMLInputElement).checked })} />None</label>
                </span>
              </label>
            </div>
            <label>Corner radius: ${settings.radius}px<input type="range" min="0" max="32" .value=${String(settings.radius)} @input=${(e: Event) => update({ radius: Number((e.target as HTMLInputElement).value) })} /></label>
            <label class="inline"><input type="checkbox" .checked=${settings.compact} @change=${(e: Event) => update({ compact: (e.target as HTMLInputElement).checked })} />Compact</label>
          </fieldset>

          <fieldset>
            <legend>Chains</legend>
            ${seg(settings.chains, [['all', `All ${mainnets().length}`], ['cctp', 'Arc + CCTP'], ['arc', 'Arc only']], (chains) => update({ chains }))}
            <label>Default chain
              <select @change=${(e: Event) => update({ defaultChainId: Number((e.target as HTMLSelectElement).value) })}>
                ${chainOptions.map((c) => html`<option value=${c.id} ?selected=${c.id === settings.defaultChainId}>${c.name}</option>`)}
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Integrator fee</legend>
            ${text('Fee recipient', 'integrator', '0x… (optional)')}
            <label>Fee: ${settings.feeBps} bps (${(settings.feeBps / 100).toFixed(2)}%)<input type="range" min="0" max="300" step="5" .value=${String(settings.feeBps)} @input=${(e: Event) => update({ feeBps: Number((e.target as HTMLInputElement).value) })} /></label>
          </fieldset>

          <button class="btn" type="button" @click=${() => {
            history.replaceState(null, '', location.pathname)
            settings = { ...DEFAULTS }
            update({})
          }}>Reset</button>
        </aside>

        <main class="stage">
          <div class="preview">
            <section class="canvas ${dark ? 'dark' : ''}" aria-label="Preview">
              <div class="canvas-bar">
                ${seg(settings.embed, [['inline', 'Inline'], ['iframe', 'Hosted iframe']], (embed) => update({ embed }))}
                <button class="btn solid" type="button" @click=${() => kit.open(request)}>Open as modal</button>
              </div>
              ${settings.embed === 'inline'
                ? html`<coven-widget .kit=${kit} .request=${request} style="max-width:460px"></coven-widget>`
                : html`<label style="margin-bottom:10px">Iframe origin<input type="text" .value=${settings.iframeOrigin} @change=${(e: Event) => update({ iframeOrigin: (e.target as HTMLInputElement).value })} /></label>
                    <iframe class="hosted" title="Coven hosted iframe" src=${iframeUrl()} allow="clipboard-write"></iframe>`}
            </section>

            <div class="side">
              <section class="panel state" aria-label="Kit state">
                <h2>State</h2>
                <dl>
                  <dt>Status</dt><dd>${state.status}</dd>
                  <dt>Account</dt><dd>${state.address ? shortAddress(state.address) : 'none'}</dd>
                  <dt>Wallet chain</dt><dd>${state.chainId ? `${kit.chains.find((c) => c.id === state.chainId)?.name ?? 'unsupported'} (${state.chainId})` : 'none'}</dd>
                  <dt>Wallet</dt><dd>${state.connector?.name ?? 'none'}</dd>
                  <dt>Chains</dt><dd>${kit.chains.length}</dd>
                  <dt>Modal</dt><dd>${state.modal.open ? `open: ${state.modal.request.view}` : 'closed'}</dd>
                </dl>
              </section>
              <section class="panel" aria-label="Events">
                <h2>Events</h2>
                ${events.length === 0 ? html`<p class="hint">Connect, switch network or swap to see events here.</p>` : nothing}
                <ul class="log">${events.map((e) => html`<li><b>${e.name}</b><span>${e.at} ${e.payload}</span></li>`)}</ul>
              </section>
            </div>
          </div>

          <section class="panel" aria-label="Code">
            <h2>Code for this setup</h2>
            <div class="tabs">${seg(settings.codeTab, [['react', 'React'], ['html', 'HTML'], ['iframe', 'iframe']], (codeTab) => update({ codeTab }))}</div>
            <pre><code>${code()}</code></pre>
            <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn" type="button" @click=${() => void navigator.clipboard.writeText(code())}>Copy code</button>
              <button class="btn" type="button" @click=${() => void navigator.clipboard.writeText(location.href)}>Copy link to this setup</button>
            </div>
          </section>
        </main>
      </div>
      <footer>
        <a href="https://docs.coven.network/guides/kit/">Docs</a> · <a href="https://www.npmjs.com/package/@covennetwork/kit">npm</a> ·
        <a href="https://github.com/covennetwork/kit">GitHub</a>
      </footer>
    </div>`,
    document.getElementById('app')!,
  )
}

syncKit()
draw()
