# Orbit: Step-by-Step Build Guide

This document breaks down the Orbit MVP spec, architecture, and user cases into an actionable, sequential backlog. We focus on building the riskiest, core functionality first, followed by the UI, and finishing with brand polish according to `Brand.md`. 

---

## Phase 1: The Core Engine (Smart Contracts)
**Goal:** Prove that the on-chain logic works. We cannot build a UI without the engine.
**Role:** Smart Contract / Rust Engineer

* **Task 1.1: Environment Setup**
  * Spin up the Stellar Soroban Rust environment.
  * Define the standard token types (testnet USDC) with 7 decimal precision.
* **Task 1.2: The Allowance Vault (The Handshake & Pull)**
  * Write the smart contract function to approve a recurring allowance (e.g., allow `X` amount per `Y` days).
  * Write the execution function allowing a third-party (the backend) to pull funds if the time criteria are met.
* **Task 1.3: Batch Disbursement (The Split)**
  * Write a function that takes a single transaction of $Z and an array of `[Address, Amount]` and splits the funds in a single ledger block.
* **Task 1.4: Unit Testing & Testnet Deployment**
  * Deploy the contract to Stellar Testnet.
  * Write a basic Rust/CLI script to verify the allowance and pulling logic works without any UI.

> **Checkpoint 1: "Engine Running."** We have a live testnet contract that successfully pulls funds and splits payroll without any frontend.

---

## Phase 2: The Data Layer & API
**Goal:** Connect the blockchain to a traditional Web2 backend so merchants can save their plans and we can trigger pulls.
**Role:** Backend / Node.js Engineer

* **Task 2.1: Database Schema (Supabase)**
  * Create `Merchants` table (Wallet Address, Name).
  * Create `Plans` table (Plan ID, Merchant ID, Name, USDC Amount, Interval).
  * Create `Subscriptions` table (Customer Wallet, Plan ID, Status, Next Billing Date).
* **Task 2.2: The Merchant API (Express.js)**
  * Route: `POST /plans` (Create a new pricing plan).
  * Route: `GET /plans/:id` (Fetch plan details for the Checkout Widget).
  * Route: `GET /subscribers` (Fetch active subscribers for the dashboard).
* **Task 2.3: The Blockchain Bridge**
  * Setup `@stellar/stellar-sdk` on the backend.
  * Write the cron job / manual trigger endpoint that hits the Soroban contract to execute "The Pull" for a specific subscription.

> **Checkpoint 2: "The Bridge."** We can create a plan via Postman, and the backend can successfully trigger the Soroban contract to pull testnet USDC.

---

## Phase 3: The Checkout SDK (The Customer Flow)
**Goal:** Build the React widget the SaaS Founder or API Builder drops into their website.
**Role:** Frontend / React Engineer

* **Task 3.1: SDK Initialization & Blank State**
  * Create a standalone React component that accepts a `plan_id` prop.
  * Fetch the plan price and details from the Express API.
* **Task 3.2: Wallet Connection**
  * Integrate `@stellar/freighter-api`. 
  * Build a simple button to connect the Freighter wallet and read the user's address.
* **Task 3.3: The Signature & Handshake**
  * Wire up the "Approve" button to prompt Freighter to sign the Soroban Allowance transaction.
  * Send the success callback to the backend to create a `Subscription` record in Supabase.
* **Task 3.4: Apply the Brand (Brand.md)**
  * Use Inter font.
  * Modal background: `#2C2C2C` (Black Ash) or `#000000` (Black).
  * Primary Action Button: `#FFFFFF` background, `#000000` text.
  * Add a smooth GSAP/Framer Motion success animation.

> cd 
---

## Phase 4: The Merchant Dashboard (The SaaS Founder Flow)
**Goal:** Build the control center for the merchant to manage plans and payroll.
**Role:** Frontend / Fullstack Engineer

* **Task 4.1: Dashboard Scaffolding & Public Pages (Next.js)**
  * Setup Next.js with TailwindCSS animations to be Framer mtion and Gsap.
  * Build the public-facing **Landing Page** and **Home Page** to introduce Orbit to new users.
  * Enforce strict `Brand.md` rules globally across all pages: `#000000` background, `#FFFFFF` text, Inter font.
* **Task 4.2: Merchant Auth & Plan Creation**
  * Connect Freighter to log in the merchant.
  * Build the form to create a "MailKit Pro" plan (posts to Express API).
* **Task 4.3: Revenue & Subscriber View**
  * Build a data table (using `#2C2C2C` for borders/dividers) showing active subscribers.
  * Add the "Execute Billing" button to trigger the manual pull for the MVP.
* **Task 4.4: Batch Payroll UI**
  * Build a CSV upload dropzone.
  * Parse the CSV on the client side into a JSON array of `[Address, Amount]`.
  * Wire up the "Run Payroll" button to prompt the merchant's wallet for a single signature to execute the batch disbursement contract.

> **Checkpoint 4: "Dashboard Functional."** The merchant can view revenue, pull funds, and run payroll via the web interface.

---

## Phase 5: End-to-End Polish & Demo Prep
**Goal:** Ensure the entire flow works flawlessly for the grant demo video.
**Role:** Entire Team

* **Task 5.1: The Demo Walkthrough Test**
  * Act as the SaaS Founder: Create a plan in the Dashboard.
  * Act as the Customer: Use the Widget to subscribe to the plan.
  * Act as the SaaS Founder: Execute the billing pull from the Dashboard.
  * Act as the Agency Owner: Upload a CSV and execute Batch Payroll.
* **Task 5.2: UI/UX Audit against `Brand.md`**
  * Strip out any unnecessary colors. Ensure strictly Black (`#000000`), White (`#FFFFFF`), and Black Ash (`#2C2C2C`).
  * Ensure consistent 8pt spacing and typography scale.
* **Task 5.3: Error Handling**
  * Add graceful error messages if a user doesn't have testnet USDC or rejects a Freighter signature.

> **Checkpoint 5: "Demo Ready."** The MVP is fully functional, visually striking, and ready to be recorded.

---
---

# Phase 6: The Arc Rail (Multi-Chain Expansion)

**Goal:** Make Orbit settle USDC on **Arc** — Circle's EVM Layer 1 — alongside Stellar Soroban, so Orbit stops being a Stellar product and becomes a USDC protocol with two rails.
**Role:** Solidity Engineer + Fullstack

> **Why Arc matters for Orbit specifically.** On Stellar we run **two assets**: settlement in USDC, gas in XLM. Every merchant, keeper, and cron job has to hold and top up XLM they don't care about. On Arc, **USDC is the native gas token** — settlement and gas collapse into one asset. For a protocol whose entire thesis is "digital dollar rails," that removes a real operational wart. Arc is also EVM, so we inherit MetaMask, Foundry, wagmi/viem, and the whole tooling ecosystem for free.

> **What already exists.** Arc is *not* a greenfield add. The UI shell was built multi-chain from day one:
> - `apps/frontend/src/components/dashboard/dashboard-types.ts:29` — a full `arc-testnet` NetworkConfig
> - `apps/frontend/src/components/dashboard/dashboard-shell.tsx:45` — live network switcher state
> - `apps/frontend/src/lib/auth-context.tsx:7` — `linkedVaults: { stellar, arc }`
> - `apps/frontend/src/components/dashboard/modals/vault-modal.tsx:86` — Arc EVM vault input, `0x` validation
> - `.gitignore` — already reserves `cache/` and `broadcast/` (Foundry output)
>
> Arc today is **strings and mock state**. Phase 6 makes it real. The UI is the easy part; the execution layer is the work.

> **Status — Tasks 6.1–6.3 are BUILT.** `contracts/evm/` now exists with `OrbitPuller.sol`, a 22-test suite (all passing, including fuzz), and `Deploy.s.sol`. The Solidity in this guide is the design reference; **the files on disk are the source of truth** — read those, not this, when they disagree. Soroban was not modified and its test still passes.
>
> **Remaining blocker:** Task 6.0. Fill `contracts/evm/.env` from the Arc docs before Task 6.4.

---

## Task 6.0: Resolve the One Blocking Question — ✅ RESOLVED (2026-09-20)

> **Answer: Outcome A. USDC on Arc satisfies `IERC20` directly — Orbit's pull model works unmodified.**
>
> Verified live with `cast` against `https://rpc.testnet.arc.io`, not just read from docs:
> `symbol()` → `"USDC"`, `decimals()` → `6`, `allowance(a,b)` → `0` (responds rather than reverting).
>
> | | Testnet | Mainnet |
> | :--- | :--- | :--- |
> | Chain ID | `5042002` | `5042` |
> | RPC | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
> | Explorer | `https://explorer.testnet.arc.io` | `https://explorer.arc.io` |
> | USDC | `0x3600000000000000000000000000000000000000` | *(same)* |
> | Faucet | `https://faucet.circle.com` | — |
>
> There is **no wrapped USDC** on Arc: the native and ERC-20 interfaces share one balance. Circle's own words — *"On Arc that step is unnecessary because the native USDC token already satisfies `IERC20` directly."*
>
> **⚠ Two Arc-specific facts that change our code:**
> 1. **Decimals differ by interface** — native gas view is **18**, ERC-20 interface is **6**. Arc's guidance is to use the ERC-20 interface exclusively for balances and transfers, and show users one USDC balance. A zero `balanceOf` does *not* mean the native balance is zero. `OrbitPuller` already touches only `IERC20`, so it is correct as written.
> 2. **`scan.arc.network` in `dashboard-types.ts:34` is wrong.** The real explorer is `https://explorer.testnet.arc.io`. Fix during Task 6.5.
>
> Other Arc EVM deviations: block timestamps are non-decreasing but **not strictly increasing** (use block numbers for ordering — our 30-day cadence comparison is unaffected); transfers to the zero address and to blocklisted addresses revert; `PREVRANDAO` returns 0; blob transactions unsupported; finality is instant on inclusion. Fees are EIP-1559 + EWMA, ~$0.001 per ERC-20 transfer.
>
> All of this is captured in `contracts/evm/.env` / `.env.example`. **Original question retained below for context.**

---

**Do not write a line of Solidity until this is answered.** Orbit's entire model depends on an **allowance primitive** (`approve` + `transferFrom`). Native gas tokens on EVM chains (like ETH) have no `approve`. So:

> **Question:** On Arc, is USDC exposed as a standard **ERC-20 contract** (a predeploy/precompile wrapper, or bridged USDC), or *only* as the raw native gas asset?

Go to the official Circle Arc developer docs and confirm. Three possible outcomes:

| Outcome | What it means for Orbit |
| :--- | :--- |
| **A.** Native USDC has an ERC-20 predeploy interface | Best case. Point `OrbitPuller` at that address. Everything below works as written. |
| **B.** A bridged/standard ERC-20 USDC exists on Arc | Also fine. Use that token address. Gas is still paid in native USDC. |
| **C.** Only native, no ERC-20 surface | The pull model needs a wrapper (deposit native → WUSDC ERC-20) or a different auth primitive. **Stop and redesign before building.** |

Record the answer, the **chain ID**, the **RPC URL**, the **USDC token address**, and the **faucet URL** in `apps/backend/.env.example` and `Docs/ARCHITECTURE.md`. Do not guess these values — pull them from the official docs. The explorer is already recorded in the codebase as `https://scan.arc.network`.

---

## Task 6.1: Scaffold the EVM Workspace

Keep Soroban exactly where it is. Arc goes in a sibling directory — the two rails never share a build.

```
contracts/
├── soroban/        # existing — Rust, untouched
└── evm/            # new — Foundry
```

```bash
# From the repo root
curl -L https://foundry.paradigm.xyz | bash && foundryup

mkdir -p contracts/evm && cd contracts/evm
forge init --no-git --no-commit .
forge install OpenZeppelin/openzeppelin-contracts --no-commit

rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```

Add to `contracts/evm/foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
optimizer = true
optimizer_runs = 200
remappings = ["@openzeppelin/=lib/openzeppelin-contracts/"]

[rpc_endpoints]
arc_testnet = "${ARC_RPC_URL}"

[etherscan]
arc_testnet = { key = "${ARC_SCAN_API_KEY}", url = "${ARC_SCAN_VERIFY_URL}" }
```

---

## Task 6.2: Port the Contract — `OrbitPuller.sol`

This is a **behavioral port** of `contracts/soroban/src/lib.rs`. Same three functions, same invariants, adapted to EVM idioms.

Create `contracts/evm/src/OrbitPuller.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OrbitPuller
/// @notice Non-custodial pull payments and atomic batch payroll, denominated in USDC.
/// @dev EVM port of the Soroban OrbitContract. Funds are NEVER held by this contract;
///      it only moves tokens the payer has explicitly approved, within cadence limits.
contract OrbitPuller is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Mirrors Soroban `VaultData`.
    struct Vault {
        address token;
        uint256 amountPerInterval;
        uint64  intervalSeconds;
        uint64  lastPullTimestamp;
        bool    active;
    }

    /// @dev Mirrors Soroban `VaultKey { user, merchant }`.
    mapping(address => mapping(address => Vault)) public vaults;

    event VaultCreated(
        address indexed user,
        address indexed merchant,
        address token,
        uint256 amountPerInterval,
        uint64  intervalSeconds
    );
    event VaultRevoked(address indexed user, address indexed merchant);
    event FundsPulled(address indexed user, address indexed merchant, uint256 amount, uint64 timestamp);
    event BatchDisbursed(address indexed sender, address indexed token, uint256 total, uint256 recipientCount);

    error InvalidParams();
    error VaultNotFound();
    error TooEarlyToPull();
    error LengthMismatch();

    // ------------------------------------------------------------------
    // 1. THE HANDSHAKE  (Soroban: create_vault)
    // ------------------------------------------------------------------
    /// @notice Subscriber authorizes a merchant to pull a capped amount per interval.
    /// @dev No tokens move here. msg.sender IS the subscriber — this replaces
    ///      Soroban's explicit `user.require_auth()`.
    function createVault(
        address merchant,
        address token,
        uint256 amountPerInterval,
        uint64  intervalSeconds
    ) external {
        if (merchant == address(0) || token == address(0)) revert InvalidParams();
        if (amountPerInterval == 0 || intervalSeconds == 0) revert InvalidParams();

        vaults[msg.sender][merchant] = Vault({
            token:             token,
            amountPerInterval: amountPerInterval,
            intervalSeconds:   intervalSeconds,
            lastPullTimestamp: 0,
            active:            true
        });

        emit VaultCreated(msg.sender, merchant, token, amountPerInterval, intervalSeconds);
    }

    /// @notice Subscriber cancels. Improvement over the Soroban version, which has
    ///         no revoke path and forces users to zero out the token allowance instead.
    function revokeVault(address merchant) external {
        if (!vaults[msg.sender][merchant].active) revert VaultNotFound();
        delete vaults[msg.sender][merchant];
        emit VaultRevoked(msg.sender, merchant);
    }

    // ------------------------------------------------------------------
    // 2. THE PULL  (Soroban: pull_funds)
    // ------------------------------------------------------------------
    /// @notice Merchant collects one interval's payment.
    /// @dev msg.sender IS the merchant — replaces `merchant.require_auth()`.
    ///      Cadence is enforced against block.timestamp, never a client-supplied value.
    function pullFunds(address user) external nonReentrant {
        Vault storage v = vaults[user][msg.sender];
        if (!v.active) revert VaultNotFound();

        if (v.lastPullTimestamp != 0) {
            if (block.timestamp < uint256(v.lastPullTimestamp) + v.intervalSeconds) {
                revert TooEarlyToPull();
            }
        }

        // Checks-Effects-Interactions: stamp BEFORE the transfer to close
        // any double-pull window on a reentrant or malicious token.
        v.lastPullTimestamp = uint64(block.timestamp);

        IERC20(v.token).safeTransferFrom(user, msg.sender, v.amountPerInterval);

        emit FundsPulled(user, msg.sender, v.amountPerInterval, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------
    // 3. THE SPLIT  (Soroban: batch_disburse)
    // ------------------------------------------------------------------
    /// @notice Atomic multi-recipient payout. One signature, N transfers, all-or-nothing.
    /// @dev Reverts wholesale if any leg fails — no partial payroll, same as Soroban.
    function batchDisburse(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        if (recipients.length != amounts.length) revert LengthMismatch();
        if (recipients.length == 0) revert InvalidParams();

        IERC20 t = IERC20(token);
        uint256 total;

        for (uint256 i; i < recipients.length; ++i) {
            t.safeTransferFrom(msg.sender, recipients[i], amounts[i]);
            total += amounts[i];
        }

        emit BatchDisbursed(msg.sender, token, total, recipients.length);
    }

    // ------------------------------------------------------------------
    // VIEWS (for the dashboard)
    // ------------------------------------------------------------------
    function getVault(address user, address merchant) external view returns (Vault memory) {
        return vaults[user][merchant];
    }

    /// @notice True if the merchant can pull right now — drives the "Execute Pull"
    ///         button enabled/disabled state in the Subscribers view.
    function isPullable(address user, address merchant) external view returns (bool) {
        Vault storage v = vaults[user][merchant];
        if (!v.active) return false;
        if (v.lastPullTimestamp == 0) return true;
        return block.timestamp >= uint256(v.lastPullTimestamp) + v.intervalSeconds;
    }
}
```

### Soroban → EVM translation notes

| Soroban | EVM | Note |
| :--- | :--- | :--- |
| `user.require_auth()` | `msg.sender` is the user | EVM auth is implicit; drop the explicit address arg |
| `merchant.require_auth()` | `msg.sender` is the merchant | `pullFunds(user)` takes one arg, not two |
| `transfer_from(contract, user, merchant, amt)` | `safeTransferFrom(user, merchant, amt)` | The contract is `msg.sender` implicitly |
| SAC allowance | `USDC.approve(orbitPuller, amount)` | **The subscriber must approve the OrbitPuller *before* the first pull** |
| `env.ledger().timestamp()` | `block.timestamp` | Same tamper-resistance guarantee |
| `assert!(...)` with string | custom `error` types | Cheaper gas, better decoding in the dashboard |
| *(no events)* | `VaultCreated` / `FundsPulled` / … | **New.** EVM needs events for indexing — the dashboard activity ledger should read these, not mock data |
| 7 decimals | **6 decimals** | See Task 6.6. This will bite you. |

### Two behaviors to decide before you ship

1. **Approval UX.** `approve()` grants a flat total, not a per-interval cap — cadence enforcement lives in `OrbitPuller`, same as Soroban. Decide whether the checkout asks for `type(uint256).max` (one signature forever, standard practice, requires trusting the cadence logic) or `amountPerInterval * N` (finite runway, re-approval prompt every N cycles). **Recommendation: `amountPerInterval * 12` for the MVP** — bounded risk, and a year of runway reads as safe to a reviewer.
2. **Timestamp drift.** Both the Soroban original and this port set `lastPullTimestamp = now`, so a late pull permanently shifts the billing window forward. For calendar-accurate billing use `v.lastPullTimestamp += v.intervalSeconds` instead. Keep parity with Soroban for now; note it as a v2 item.

---

## Task 6.3: Test It

Create `contracts/evm/test/OrbitPuller.t.sol`. Mirror the existing Soroban test (`contracts/soroban/src/test.rs`) so both rails are provably equivalent, then add the EVM-specific cases:

* `test_CreateVaultAndPull` — mint 100 USDC to subscriber, create a 29 USDC/30-day vault, `approve`, pull → assert merchant holds exactly `29e6` and subscriber holds `71e6`. **This is the direct analogue of the Soroban test.**
* `test_RevertWhen_PullTooEarly` — pull twice in a row, expect `TooEarlyToPull`.
* `test_PullSucceedsAfterInterval` — `vm.warp(block.timestamp + 30 days)`, pull again, assert success.
* `test_RevertWhen_AllowanceRevoked` — subscriber sets `approve(puller, 0)`, expect revert.
* `test_RevertWhen_VaultRevoked` — subscriber calls `revokeVault`, expect `VaultNotFound`.
* `test_RevertWhen_NotMerchant` — a third party calls `pullFunds`, expect `VaultNotFound`.
* `test_BatchDisburseAtomic` — 3 recipients; then re-run with recipient #3 amount exceeding balance and assert **all three balances are unchanged** (atomicity is the headline feature — prove it).
* `test_RevertWhen_BatchLengthMismatch` — arrays of different length, expect `LengthMismatch`.

```bash
cd contracts/evm
forge test -vvv
forge coverage
```

> **Gate:** do not deploy until every test above is green.

---

## Task 6.4: Deploy and Push to Arc

Create `contracts/evm/script/Deploy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OrbitPuller} from "../src/OrbitPuller.sol";

contract Deploy is Script {
    function run() external returns (OrbitPuller puller) {
        // No argument: the signer comes from the CLI, so no private key is ever
        // read from a file this repo could accidentally commit.
        vm.startBroadcast();
        puller = new OrbitPuller();
        vm.stopBroadcast();
        console.log("OrbitPuller deployed at:", address(puller));
    }
}
```

```bash
cd contracts/evm

# 0. Fill in .env from the Arc docs
cp .env.example .env   # then fill ARC_RPC_URL, ARC_CHAIN_ID, ARC_USDC_ADDRESS, …

# 1. Import the deployer key ONCE into an encrypted keystore (no plaintext on disk)
cast wallet import orbit-deployer --interactive

# 2. Fund that address from the Arc testnet faucet.
#    On Arc, gas IS USDC — you need testnet USDC, not a separate gas token.

# 3. Dry run first
forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL

# 4. Broadcast
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_RPC_URL \
  --account orbit-deployer \
  --broadcast \
  --verify

# 4. Confirm on the explorer: https://scan.arc.network/address/<ADDRESS>
```

Record the deployed address in `apps/backend/.env`, `Docs/ARCHITECTURE.md`, and the deployed-contract table in `README.md` §4 — which currently lists only the Soroban contract and needs a second row.

> **Checkpoint 6A: "Second Rail Live."** `OrbitPuller` is verified on Arc testnet and a cast call pulls USDC end to end, with no UI involved. This mirrors Checkpoint 1.

---

## Task 6.5: Wire the Frontend to Arc

The dashboard network switcher already exists and already lists Arc — it just doesn't *do* anything yet.

**Add the EVM wallet layer** (`apps/frontend` currently has **zero** chain dependencies — all Stellar references there are copy and mock state):

```bash
npm --prefix apps/frontend install wagmi viem @tanstack/react-query
```

1. **Define the Arc chain** in a new `apps/frontend/src/lib/chains.ts` using `defineChain` from viem — chain ID, RPC, and `nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 }`, plus the `scan.arc.network` block explorer. Use the values confirmed in Task 6.0.
2. **Wrap the app** in `WagmiProvider` + `QueryClientProvider` inside `apps/frontend/src/app/layout.tsx`.
3. **Generalize the wallet connect.** `apps/frontend/src/app/get-started/page.tsx:62` and `apps/frontend/src/app/pay/[id]/page.tsx:130` currently reach straight for `window.freighter`. Branch on the active network: Freighter for Stellar, wagmi `useConnect` for Arc.
4. **Fix address validation.** `apps/frontend/src/lib/auth-context.tsx:180` decides the chain with `trimmed.startsWith("G")`. That is a reasonable heuristic but not validation — Stellar addresses are 56 chars base32, EVM are 42 chars hex. Validate both properly; the payroll CSV parser and the Payout Address column need the same fix.
5. **Replace mock execution with real calls.** `subscribers-view.tsx:100` and `payroll-view.tsx:176` currently `setTimeout` to fake a transaction. Swap in `useWriteContract` for `pullFunds` / `batchDisburse` when `activeNetwork === "arc-testnet"`, keeping the Soroban path intact for `stellar-testnet`.

**In the checkout widget** (`packages/checkout-widget`), the approve step becomes **two transactions on EVM**, not one — this is the biggest UX difference from Stellar and the modal must show it as two steps:

> **Step 1 of 2:** Approve USDC spending → **Step 2 of 2:** Activate allowance vault

If Arc's USDC supports **EIP-2612 `permit`**, step 1 becomes a gasless signature instead of a transaction — collapsing it back to one on-chain action. This is what `contractStandard: "ERC-20 Permit / OrbitPuller"` in `dashboard-types.ts:35` was anticipating. Check for it; it is a materially better demo.

---

## Task 6.6: The Decimals Trap

**Soroban USDC has 7 decimals. EVM USDC has 6.** Amounts are currently hardcoded for Stellar in at least these places:

* `packages/checkout-widget/src/OrbitCheckout.jsx:105` — `(plan.usdc_amount / 10000000).toFixed(2)`
* `packages/checkout-widget/src/OrbitCheckout.jsx:49` — mock `usdc_amount: 490000000`
* `apps/backend/schema.sql` — the `usdc_amount NUMERIC` column comment reads "to handle large Stellar numbers"

Do this properly: add a `decimals` field to `NetworkConfig` in `dashboard-types.ts` (`7` for Stellar, `6` for Arc), and replace every hardcoded divisor with a shared `formatUsdc(amount, network)` helper in `apps/frontend/src/lib/utils.ts`. **Store human-readable decimal amounts in Supabase and scale at the chain boundary** — not the other way round. Getting this wrong means charging customers 10× or 1/10× the intended amount, silently.

Also add a `network` column to the `plans` and `subscriptions` tables in `apps/backend/schema.sql`. Right now the schema assumes one chain, and a `customer_wallet_address VARCHAR(255)` cannot tell you which rail it belongs to.

---

## Task 6.7: The Backend Bridge

`apps/backend/index.js` route `POST /trigger-pull` builds raw Soroban XDR and is hardwired to Stellar. Refactor:

1. Extract the current body into `lib/rails/stellar.js`.
2. Add `lib/rails/arc.js` using `viem` — `walletClient.writeContract({ address, abi, functionName: 'pullFunds', args: [userAddress] })`.
3. Dispatch on the subscription's new `network` column.

**Fix this while you are in the file:** `/trigger-pull` currently accepts `merchant_secret` in the POST body (`index.js:98`) — a merchant's signing secret crossing the wire on every billing call. Do not carry that pattern onto the Arc rail; use a server-held keeper key read from the environment instead.

> *(Verified: `apps/backend/.env` is **not** tracked by git and never has been — the root `.gitignore` catches it. Nothing to rotate.)*

> **Checkpoint 6B: "Two Rails, One Dashboard."** A merchant flips the network switcher to Arc, a customer subscribes with MetaMask, the merchant executes a pull, and USDC moves on Arc — using the same dashboard that still works on Stellar.

---

# Phase 7: De-Soroban the Product Surface

**Goal:** Orbit is no longer a Stellar product. Every user-visible string that says "Soroban" or "Stellar" as though it were *the* chain must become chain-neutral, or must render from the active `NetworkConfig` instead of being hardcoded.

**The rule:** hardcoded chain names in copy are **bugs** now. Anywhere the chain is genuinely relevant, read it from `NETWORKS[activeNetwork]` so the label follows the switcher automatically.

### Copy substitutions

| Current | Replace with |
| :--- | :--- |
| "on Stellar Soroban" | "on-chain" / "on USDC rails" / `{network.name}` |
| "Soroban Verified Rail" | "Verified Settlement Rail" |
| "Soroban smart contract" | "Orbit settlement contract" |
| "Sub-cent Soroban fee" | "Sub-cent network fee" |
| "Connect Freighter Wallet" | "Connect Wallet" (branch the icon on network) |
| "Stellar Address (Starts with G...)" | "Payout Address" + per-network placeholder |
| "Stellar Testnet USDC" | `{network.name} USDC` |
| `< $0.001 XLM` | "< $0.001" (XLM must not appear on an Arc screen) |
| `stellar.expert/...` hardcoded links | `` `${network.explorerUrl}/account/${addr}` `` — the field already exists |

### File-by-file worklist

**Public / marketing**
* `apps/frontend/src/components/sections/hero.tsx:51` — "Built for USDC on Stellar / Soroban testnet" → **"Built for USDC on Stellar and Arc"**. This is the first line a grant reviewer reads; it currently undersells the protocol as single-chain.
* `apps/frontend/src/app/pay/[id]/page.tsx` — lines 68, 117, 182, 204, 253, 256, 277, 301, 361. The hosted checkout is customer-facing and mentions Stellar/Soroban/Freighter nine times.

**Dashboard**
* `views/payroll-view.tsx` — lines 93 (CSV header `StellarWallet` → `WalletAddress`), 176, 182, 213, 302, 374, 414, 425, 459, 463, 525
* `views/subscribers-view.tsx` — lines 100, 105, 186, 267, 361, 365, 490
* `views/plans-view.tsx` — lines 95, 118
* `views/developers-view.tsx` — lines 37, 129, 144 (SDK snippets say `Settled on Stellar Soroban:`)
* `modals/vault-modal.tsx:70` — keep both vault labels; this modal is *correctly* chain-specific
* `modals/preview-link-modal.tsx` — lines 66, 74, 87, 92, 120
* `modals/create-plan-modal.tsx` — lines 65, 93, 179
* `modals/embed-code-modal.tsx` — lines 25, 124
* `modals/create-payment-link-modal.tsx:209`

**Docs portal** — `apps/frontend/src/app/docs/page.tsx` is the heaviest offender (22 hits: lines 53, 160, 184, 197, 206, 266, 269, 276, 294, 312, 354, 427, 432, 560, 669, 718, 765). Restructure the "Soroban Smart Contracts" section into **"Smart Contracts"** with two tabs — *Stellar (Soroban / Rust)* and *Arc (EVM / Solidity)* — and add the Arc deployment block alongside the existing Stellar one.

**Widget** — `packages/checkout-widget/src/App.jsx:79,134` and `OrbitCheckout.jsx:71,157`.

**Repo docs** — `README.md` still opens with "on Stellar Soroban" and its §2 architecture diagram shows a single Soroban ledger box. Redraw it with both rails under a shared dashboard/SDK layer, and add the Arc contract to the §4 registry table.

> Keep `contracts/soroban/` named as it is. Internal Stellar-specific identifiers (`stellarAddress`, `isStellar`, `lib/rails/stellar.js`) are **correct and should stay** — this phase is about *user-visible copy* and *hardcoded assumptions*, not renaming working code.

> **Checkpoint 7: "Chain-Neutral."** Grep the frontend for `Soroban|Stellar|Freighter|XLM` and every remaining hit is either an internal identifier, a genuinely Stellar-specific UI branch, or a label rendered from `NetworkConfig`. Set the switcher to Arc, walk the entire dashboard and checkout, and confirm the word "Soroban" never appears on screen.

---

## Phase 6–7 Execution Order

Build in this order — each step de-risks the next:

1. **6.0** Confirm USDC's ERC-20 surface on Arc ← *blocking; everything depends on this*
2. **6.1 → 6.3** Foundry scaffold, `OrbitPuller.sol`, full test suite
3. **6.4** Deploy + verify on Arc testnet → **Checkpoint 6A**
4. **6.6** Decimals + schema `network` column ← *do this before UI, or you will debug 10× amounts through three layers*
5. **6.5** wagmi wallet layer + real contract calls
6. **6.7** Backend rail dispatch → **Checkpoint 6B**
7. **Phase 7** De-Soroban the copy → **Checkpoint 7**
8. Re-record the demo walkthrough (Phase 5, Task 5.1) **on both rails**
