# Orbit Protocol Technical Specification and System Documentation

Non-Custodial Pull Payments and Atomic Batch Payroll Engine on Stellar Soroban

---

## 1. Executive Summary

Orbit Protocol is a decentralized, non-custodial pull payments and automated payout infrastructure engineered natively on **Stellar Soroban**. Orbit resolves the fundamental friction of Web3 commerce: the inability to execute recurring subscription charges or coordinated payroll disbursements without forcing users to lock capital into custodial escrows or requiring manual wallet approvals for every recurring billing cycle.

By implementing Soroban-native **Allowance Vaults**, Orbit separates payment authorization from fund custody. Subscribers grant merchants a time-bounded, spending-capped allowance while retaining 100% custody of their underlying assets. Merchants or automated keepers can pull approved USDC amounts exclusively when mathematical cadence and spending limit criteria are satisfied:

$$\text{Pull Eligibility} \iff \text{LedgerTimestamp} \ge \text{LastPullTimestamp} + \text{IntervalSeconds} \quad \wedge \quad \text{PullAmount} \le \text{ApprovedIntervalCap}$$

Furthermore, Orbit introduces a native **Batch Payroll Engine**, allowing organizations to disburse atomic payouts across hundreds of global contractor wallets in a single ledger block with sub-cent network transaction fees and instant finality.

---

## 2. System Architecture

```
+-------------------------------------------------------------------------------+
|                            CLIENT & PRESENTATION LAYER                        |
|                                                                               |
|   +--------------------------+  +-------------------+  +-------------------+  |
|   |  Merchant Control Center |  |  Hosted Checkout  |  |  Developer Portal |  |
|   |  (Next.js 15 App Router) |  |  (/pay/[id])      |  |  & Docs (/docs)   |  |
|   +--------------------------+  +-------------------+  +-------------------+  |
+---------------------------------------|---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                      OFF-CHAIN INTEGRATION & EMBEDDED SDK                     |
|                                                                               |
|   +--------------------------+  +-------------------+  +-------------------+  |
|   |  <OrbitCheckout />       |  |  Batch CSV Engine |  |  HMAC Webhook     |  |
|   |  React Widget SDK        |  |  Client Parser    |  |  Signer & Relayer |  |
|   +--------------------------+  +-------------------+  +-------------------+  |
+---------------------------------------|---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                     STELLAR SOROBAN LEDGER (TESTNET RAILS)                    |
|                                                                               |
|   +-----------------------------------------------------------------------+   |
|   |  OrbitContract.wasm                                                   |   |
|   |  Contract ID: CAZBZBUWBSQYK2RZ6WHMXVDLIQHSU5WD7ANZYL6HLNSCRUOTNYCDYQNG|   |
|   +-----------------------------------------------------------------------+   |
|            |                                              |                   |
|            v                                              v                   |
|   +---------------------------------------+  +----------------------------+   |
|   |  create_vault() & pull_funds()        |  |  batch_disburse()          |   |
|   |  - Non-custodial allowance storage    |  |  - Single atomic ledger tx |   |
|   |  - Strict timestamp interval check    |  |  - Multi-recipient splits |   |
|   +---------------------------------------+  +----------------------------+   |
|                                       |                                       |
|                                       v                                       |
|   +-----------------------------------------------------------------------+   |
|   |  Stellar Asset Contract (SAC): Native Testnet USDC                    |   |
|   |  token::Client transfer_from() directly to merchant treasury vault    |   |
|   +-----------------------------------------------------------------------+   |
+-------------------------------------------------------------------------------+
```

---

## 3. Core Technical Subsystems

### 3.1 Smart Contracts (Soroban / Rust `no_std`)

Located at `contracts/soroban/src/lib.rs`, the core settlement engine compiles to WebAssembly for the Soroban virtual machine.

1. **`VaultKey` & `VaultData` Structs**:
   ```rust
   #[contracttype]
   pub struct VaultKey {
       pub user: Address,
       pub merchant: Address,
   }

   #[contracttype]
   pub struct VaultData {
       pub token: Address,
       pub amount_per_interval: i128,
       pub interval_seconds: u64,
       pub last_pull_timestamp: u64,
   }
   ```
   Maintains state boundaries in persistent storage indexed uniquely by the `(User, Merchant)` tuple.

2. **`create_vault(env, user, merchant, token, amount_per_interval, interval_seconds)`**:
   - Requires explicit cryptographic authentication from the subscriber (`user.require_auth()`).
   - Persists allowance boundaries on the Soroban ledger without moving underlying tokens.

3. **`pull_funds(env, user, merchant)`**:
   - Requires merchant authentication (`merchant.require_auth()`).
   - Asserts cadence invariant: `current_time >= vault.last_pull_timestamp + vault.interval_seconds`.
   - Executes `transfer_from` through the Stellar Asset Contract (SAC) from `user` directly to `merchant`.
   - Updates `last_pull_timestamp` atomically to prevent double-pull exploits.

4. **`batch_disburse(env, sender, token, splits: Vec<PaymentSplit>)`**:
   - Requires sender authorization (`sender.require_auth()`).
   - Iterates through payment splits and dispatches funds in a single atomic transaction:
     $$\text{TotalDisbursed} = \sum_{i=1}^{N} \text{splits}[i].\text{amount}$$
   - If any transfer fails, the entire transaction reverts atomically with zero partial state corruption.

### 3.2 Merchant Control Center & Frontend Architecture (Next.js 15 App Router)

Built in `apps/frontend` with strict adherence to `Brand.md` monochrome design guidelines (`#000000`, `#FFFFFF`, `#2C2C2C`).

- **Route Topology**:
  - `/`: Protocol overview, interactive animated flow diagram, live telemetry KPIs, and developer highlights.
  - `/dashboard`: Unified SaaS Merchant Control Center featuring 6 dedicated operational modules:
    1. **Overview & Settlement Treasury**: Real-time revenue volume curves, connected treasury balance, and live Soroban activity ledger.
    2. **Subscription Plans Engine**: Plan creator with cadence intervals, spending caps, and embed code generators.
    3. **Subscribers & Allowance Vaults**: Customer monitoring table, allowance status filters, and individual or batch pull triggers.
    4. **Batch Payroll Engine**: Client-side CSV parser, validation against Stellar public keys, and 1-click atomic Soroban disbursement.
    5. **Payment Links Manager**: Hosted checkout links with performance conversion analytics and simulation toggles.
    6. **Developer Portal**: Secret API key management, webhook registration with HMAC signing, and SDK snippets.
  - `/pay/[id]`: Dedicated, distraction-free hosted customer checkout page featuring Freighter wallet connection and reviewer simulation fallbacks.
  - `/docs`: Comprehensive, interactive documentation portal with sticky sidebar navigation, syntax-highlighted multi-language snippets, and troubleshooting guides.
  - `/signin`: Project/Company entity authentication interface.

### 3.3 Embeddable Checkout Widget SDK (`@orbit/checkout-widget`)

Located in `packages/checkout-widget`:
- Packaged as a standalone React component `<OrbitCheckout />` using Vite.
- Connects to `@stellar/freighter-api` for seamless on-chain allowance authorizations.
- Implements defensive offline fallback mechanisms to allow seamless client testing and interactive prototyping.

---

## 4. Deployed Smart Contract Registry

The following contract is deployed, verified, and operational on the Stellar Testnet:

| Parameter | Identifier / Value | Subsystem Role |
| :--- | :--- | :--- |
| **Orbit Contract ID** | [`CAZBZBUWBSQYK2RZ6WHMXVDLIQHSU5WD7ANZYL6HLNSCRUOTNYCDYQNG`](https://stellar.expert/explorer/testnet/contract/CAZBZBUWBSQYK2RZ6WHMXVDLIQHSU5WD7ANZYL6HLNSCRUOTNYCDYQNG) | Core Settlement & Batch Engine |
| **Settlement Asset** | Native Testnet USDC (`CBIELTK6YBZJU5UP2WWQEUCYJLPU6QXN`) | On-Chain Denomination |
| **Target Network** | **Stellar Testnet** | High-Throughput Settlement Layer |
| **Network Passphrase** | `Test SDF Network ; September 2015` | Network Identification |
| **Soroban RPC URL** | `https://soroban-testnet.stellar.org` | Horizon & RPC Interface |

---

## 5. Build, Verification, and Deployment Guide

### 5.1 Prerequisites

- Node.js >= v18.0.0
- npm >= v9.0.0
- Rust >= 1.74.0 & `wasm32-unknown-unknown` target
- Soroban CLI >= 20.0.0

### 5.2 Smart Contract Compilation and Test Suite Execution

```bash
# Navigate to the Soroban contract directory
cd contracts/soroban

# Execute the Rust unit test suite
cargo test

# Build release WASM binary
cargo build --target wasm32-unknown-unknown --release
```

### 5.3 Merchant Dashboard & Public Web Application Initialization

```bash
# Navigate to the frontend workspace
cd apps/frontend

# Install dependencies
npm install

# Run TypeScript verification
npm run typecheck

# Build production bundle (verifies all static and dynamic routes)
npm run build

# Launch development server
npm run dev
# Application accessible at http://localhost:3000
```

### 5.4 Standalone Checkout Widget SDK Initialization

```bash
# Navigate to the checkout widget package
cd packages/checkout-widget

# Install dependencies
npm install

# Build widget library with Vite
npm run build

# Run interactive SDK tester
npm run dev
# Tester accessible at http://localhost:5173
```

---

## 6. Test Suite Coverage Summary

Cargo unit test execution log (`contracts/soroban/src/test.rs`):

```
running 1 test
test test::test_allowance_handshake_and_pull ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
```

The test validates the complete lifecycle:
1. Mocking actor signatures via `env.mock_all_auths()`.
2. Initializing mock Stellar Asset Contract with 100 USDC minted to subscriber.
3. Registering `create_vault` with 29 USDC monthly allowance cap.
4. Executing `pull_funds` and verifying exact mathematical balance transfer:
   - Merchant balance: strictly `29_0000000` USDC.
   - Subscriber balance: strictly `71_0000000` USDC.

---

## 7. Security and Integrity Considerations

1. **Non-Custodial Invariant**: The protocol never holds customer funds in custodial escrow. If a customer withdraws their tokens or revokes authorization, unauthorized pulls are mathematically rejected by the token client.
2. **Interval Tampering Prevention**: The contract relies on `env.ledger().timestamp()` rather than client-provided timestamps. Attempts to trigger pulls prematurely revert with `"Too early to pull funds"`.
3. **Atomic Multi-Transfer Rollback**: The `batch_disburse` function wraps all payments into a single Soroban invocation. If any individual recipient address is invalid or sender balance is insufficient, the entire batch aborts, preventing partial payroll payouts.
4. **Strict Architectural Isolation**: Public website navigation is automatically decoupled from the Merchant Control Center, Hosted Checkout (`/pay/[id]`), and Developer Documentation (`/docs`), ensuring zero layout leakage or session contamination.

---

## 8. License

This project is licensed under the MIT License.
