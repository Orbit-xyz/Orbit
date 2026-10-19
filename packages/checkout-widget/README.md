# Orbit Checkout Widget

`<OrbitCheckout />` is an embeddable React checkout for Orbit pull payments on Stellar Soroban. It loads a plan, lets the customer choose a supported wallet, signs the USDC `approve` and Orbit `create_vault` transactions, waits for both to confirm, and only then records the subscription with the Merchant API.

## Supported wallets

The widget configures only these tree-shakeable modules from Stellar Wallets Kit:

- Freighter
- Albedo
- Lobstr
- Hana
- xBull
- Mobile Wallets (Lobstr, Albedo, WalletConnect via dynamic QR code handover)

## Desktop-to-Mobile Wallet Handover

When desktop users don't have a browser extension installed, they can click "Scan with Mobile Wallet":
- Generates a unique, secure session channel ID with a 5-minute clean expiration timer.
- Renders dynamic high-resolution QR codes supporting Universal Checkout, Lobstr, Albedo, and WalletConnect URI deep links.
- Establishes real-time polling and WebSocket listener on the session channel.
- Automatically detects mobile authorization and on-chain submission, immediately transitioning to the GSAP success animation and receipt view without requiring desktop browser interaction.

The selected wallet is persisted in `localStorage`. Use `allowedWallets` to expose a subset.

## Setup

```bash
cd packages/checkout-widget
npm install
npm run dev
```

Configure the public Vite environment:

```dotenv
VITE_ORBIT_CONTRACT_ID=C...
VITE_USDC_CONTRACT_ID=C...
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

## Props

| Prop | Default | Description |
|---|---|---|
| `planId` | — | Plan UUID loaded from `GET /plans/:id`. |
| `planData` | — | Preloaded plan; must include the merchant wallet address. |
| `apiUrl` | `http://localhost:3001` | Merchant API base URL. |
| `allowedWallets` | all five wallets | Array of Stellar Wallets Kit wallet IDs. |
| `demo` | `false` | Adds an explicitly labelled offline preview option. It never signs or records a subscription. |
| `orbitContractId` | `VITE_ORBIT_CONTRACT_ID` | Orbit contract address. |
| `tokenContractId` | `VITE_USDC_CONTRACT_ID` | USDC SAC address. |
| `rpcUrl` | Stellar testnet RPC | Soroban JSON-RPC endpoint. |
| `networkPassphrase` | Stellar testnet | Network used for signing. |
| `theme` | `auto` | `dark`, `light`, or `auto`. |
| `accentColor` | `#6366f1` | Hex color for buttons and active states. |
| `borderRadius` | `md` | `none`, `sm`, `md`, `lg`, or `full`. |
| `fontFamily` | `inherit` | CSS font family or font stack. |
| `customClasses` | `{}` | Optional `{ modal, header, button }` class names. |
| `allowedOrigins` | `[]` | Trusted parent origins for lifecycle `postMessage` events. Empty permits same-origin parent only. |

```jsx
<OrbitCheckout
  planId="e2a0b3df-2015-4672-9721-a1e94c1408d7"
  apiUrl="http://localhost:3001"
  allowedWallets={["freighter", "albedo", "lobstr", "hana", "xbull"]}
/>
```

The allowance covers 12 billing cycles and expires after those cycles plus a ledger safety margin. If either wallet transaction fails or is rejected, `POST /subscriptions` is not called and the error remains visible in the widget.

Before signatures, the widget simulates the USDC `approve` and Orbit `create_vault` transactions, reads USDC/XLM balances, and displays estimated fees. In-flight hashes are backed up in local storage and can be checked again after a refresh or a long network delay.

## Lifecycle events

Events are sent to the embedding parent with `window.postMessage`. Set explicit `allowedOrigins` values for cross-origin embeds.

| Event | Payload |
|---|---|
| `orbit:ready` | `{ type, planId }` |
| `orbit:wallet_connected` | `{ type, address }` |
| `orbit:subscribed` | `{ type, subscriptionId, planId, txHash }` |
| `orbit:error` | `{ type, message }` |
| `orbit:close` | `{ type }` |

```js
window.addEventListener('message', ({ data, origin }) => {
  if (data.type === 'orbit:subscribed') provisionCustomer(data.planId, data.txHash, origin);
});
```
