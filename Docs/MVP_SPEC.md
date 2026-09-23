# Orbit: MVP Technical Specification

**Orbit is a non-custodial pull payment protocol for businesses, organizations, and developers.**
Automate on-chain allowances, route stablecoin payouts & payrolls globally, and capture recurring revenue on USDC rails. We handle the on-chain execution so you can focus on shipping products.

---

## 1. The Problem
Traditional software businesses run effortlessly on automated subscriptions, but Web3 wallets are strictly "push-based." If you want to charge a customer 20 USDC a month or pay three developers every Friday, you have to manually open your wallet, copy addresses, and sign every single transaction.

It’s exhausting, unscalable, and kills the user experience. You simply cannot build a massive SaaS company or decentralized organization if customers and founders must manually sign every recurring ledger transaction.

---

## 2. Core Users & Explicit Use Cases
**Core Users:** Web3 founders, DAO operators, API/AI developers, and remote agencies requiring reliable, automated cash flow without Web2 fiat bloat or manual push payments.

### Scenario 1: The Automated SaaS Subscription (The Pull)
* **The Setup:** You build a premium AI developer tool costing 20 USDC/month. David, a developer in Berlin, wants to subscribe to your "Pro Plan."
* **The Allowance Vault:** David clicks "Subscribe" on your website. Orbit’s checkout widget opens. David connects his Stellar wallet (Freighter) and signs a smart contract allowance: *"I authorize Orbit to pull up to 20 USDC from my wallet every 30 days."*
* **The Magic:** From that moment on, David never touches his wallet for this subscription again. Every 30 days, the smart contract verifies the allowance criteria and executes the pull directly into your settlement treasury.

### Scenario 2: The One-Click Batch Payroll (The Split)
* **The Setup:** You run a DAO or Web3 agency and must disburse weekly payouts: Frontend Dev (400 USDC), Smart Contract Engineer (600 USDC), and Designer (200 USDC).
* **The Execution:** Instead of three separate manual transactions with triple gas overhead, you upload a CSV of contractor addresses and USDC amounts in the Orbit Merchant Dashboard.
* **The Magic:** You click "Run Payroll" and sign **one single time** for 1,200 USDC. The smart contract disburses the exact splits to all three recipients in a single ledger block.

---

## 3. Supported Networks & Multi-Chain Scope

Orbit is architected as a **multi-chain non-custodial protocol** operating on digital dollar rails (USDC Testnet):

| Network | Execution Layer | Supported Wallets | Target Use Case |
| :--- | :--- | :--- | :--- |
| **Stellar Testnet** | Soroban Rust Smart Contracts | Freighter, Albedo, xBull | Sub-cent transaction fees, instant finality (< 1.5s), micro-subscriptions |

Merchants link a **settlement vault** within a unified dashboard profile, receiving funds automatically without disconnecting/reconnecting wallets.

---

## 4. In Scope for MVP (The Build)

To deliver a battle-tested, end-to-end prototype for the grant and early users:

### A. The Merchant Control Center (Next.js / Tailwind)
A high-contrast, minimalist merchant dashboard adapting top billing ergonomics (Bachs/Stripe) into 6 core modules:
1. **Overview (Home):** Live treasury wallet status, core revenue metrics (MRR, Active Subscribers, Settled Volume, Protocol Latency), and interactive settled revenue chart.
2. **Subscription Plans ("Products"):** Tier management and a "+ Create Plan" wizard generating plan IDs and copyable `<OrbitCheckout />` embed snippets.
3. **Subscribers ("Customers"):** Live table of active customer vaults with allowance balances and manual "Execute Pull" triggers.
4. **Batch Payroll Engine (Orbit's Superpower):** Drag-and-drop CSV parser, client-side validation, total calculation, and 1-click batch disbursement execution.
5. **Payment Links:** Hosted checkout URL generator for no-code SaaS, consulting retainers, and community tiers.
6. **Developer Portal:** API secret key generator (`orb_live_...`, `orb_test_...`), webhook endpoint management, and SDK quickstart samples.

### B. The Checkout Widget / SDK (React)
* Standalone embeddable modal component (`<OrbitCheckout planId="..." />`).
* Seamless wallet handshake (Freighter) to authorize recurring on-chain allowances.

### C. Smart Contracts
* **Allowance Vault:** Strictly enforces billing intervals, spending caps, and unauthorized pull protections.
* **Batch Disbursement:** Splits total payouts to an array of recipients in a single atomic transaction.

---

## 5. Development Methodology: "Dashboard-First" Execution

To guarantee world-class UX and eliminate unnecessary blockers during development, Orbit follows a **Dashboard-First** sequence:
1. **Interactive UI & Ergonomics:** Build and review all dashboard modules, modals, and data flows using clean mock states and client-side validation.
2. **Wallet Integration:** Integrate wallet connection hooks (Freighter for Stellar) to verify and link treasury vaults.
3. **Smart Contract Execution:** Connect live testnet smart contracts to trigger on-chain pulls and execute batch payroll transactions.

---

## 6. Out of Scope (Future Roadmap)

* **Fully Autonomous Decentralized Keepers:** In the MVP, pull triggers can be initiated via dashboard button or backend cron. Fully decentralized keeper networks are slated for v2.
* **Cross-Asset Swapping / Path Payments:** MVP operates strictly in native testnet USDC to ensure zero rounding errors and rock-solid accounting.
* **Fiat On/Off-Ramps:** Assumes testnet USDC is pre-funded in user wallets via testnet faucets.
* **Complex Tax/Invoicing Accounting Suites:** Focus remains on payment pipes and core settlement.

---

## 7. Success Criteria & Demo Checklist

1. **The Handshake:** A subscriber connects a wallet to the Orbit Checkout Widget and approves a recurring USDC allowance vault on-chain.
2. **The Pull:** The merchant clicks "Execute Pull" in the dashboard (or via API), successfully pulling the subscription fee directly to the treasury vault.
3. **The Split:** The merchant drops a CSV into the Batch Payroll Engine, clicks "Run Payroll", signs once, and splits USDC payouts across multiple wallets in a single ledger block.
