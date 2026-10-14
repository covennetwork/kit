# @covennetwork/kit

Wallet connection, account and swap views for any EVM app. One kit instance owns the wallet
connection; the same Web Components render inline, in a modal, inside React, in plain HTML and in
Coven's hosted iframe.

- **Every EVM mainnet viem ships** (390+), Arc by default. Narrow the list or add your own.
- **Every wagmi connector**: EIP-6963 browser wallets, WalletConnect (QR and mobile links),
  MetaMask, Coinbase Wallet, Safe, plus any connector you pass.
- **Balances** of the native coin and every known token on the connected chain.
- **Swaps that follow the pair**: paying with USDC on Base switches the wallet to Base, sends
  through Circle's CCTP, then switches to Arc to buy. Arc pairs switch to Arc.
- **Standards**: EIP-1193, EIP-6963, EIP-3085/3326, CAIP-2/10/19 ids in every event, the WAI-ARIA
  dialog pattern, CSS custom properties for theming.

Try every option in the [playground](https://kit.coven.network).

## Install

```sh
npm install @covennetwork/kit viem
```

## Use with React

```tsx
import { createKit } from '@covennetwork/kit'
import { ConnectButton, CovenWidget, KitProvider, useKitState } from '@covennetwork/kit/react'

const kit = createKit({
  app: { name: 'Your app' },
  integrator: { address: '0xYourFeeAddress', feeBps: 30 },
  theme: { mode: 'dark', accent: '#c8ff5a' },
})

export function App() {
  return (
    <KitProvider kit={kit}>
      <ConnectButton />
      <CovenWidget view="swap" pool="0xPoolAddressOrV4Id" />
      <button onClick={() => kit.open({ view: 'swap', tokenOut: '0xToken' })}>Buy</button>
    </KitProvider>
  )
}
```

Your own transactions use the same connection. With wagmi hooks, hand wagmi the kit's config:

```tsx
<WagmiProvider config={kit.wagmiConfig}>…</WagmiProvider>
```

## Use without a framework

```html
<script type="module">
  import { createKit } from 'https://cdn.jsdelivr.net/npm/@covennetwork/kit@0.1/dist/cdn/kit.js'
  const kit = createKit({ app: { name: 'Your app' } })
  kit.on('swapConfirmed', (swap) => console.log(swap.hash))
</script>

<coven-connect-button></coven-connect-button>
<coven-widget view="swap" token-out="0xToken"></coven-widget>
```

## Views

| View | Parameters |
| --- | --- |
| `connect` | none. Shows the account once connected. |
| `account` | none. Address, balances, network switcher, disconnect. |
| `swap` | `pool`, `tokenIn`, `tokenOut`, `amount`, `slippageBps`, `poolFee`, `tickSpacing`, `hooks` |

Tokens are Arc addresses or CAIP-19 ids for other chains, such as
`eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` for USDC on Base. The same names
work as `<coven-widget>` attributes (kebab-case), `kit.open()` fields, React props and iframe
query parameters.

## Who owns the connection

| `wallet` option | Connects | Use when |
| --- | --- | --- |
| omitted | the kit | you have no wallet setup yet |
| `{ wagmiConfig }` | your wagmi setup | you already use wagmi |
| `{ provider, onConnectRequest }` | your wallet kit | you use RainbowKit, Privy, Dynamic… |

## Events

`connect`, `disconnect`, `accountChanged`, `chainChanged`, `viewChanged`, `swapSubmitted`,
`swapConfirmed`, `error`. Accounts and chains are CAIP-10 and CAIP-2 ids.

Full documentation: https://docs.coven.network/guides/kit/

## License

MIT
