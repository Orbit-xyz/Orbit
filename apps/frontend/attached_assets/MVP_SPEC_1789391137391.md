# Orbit: MVP Technical Specification

**Orbit is a non-custodial pull-payment protocol for businesses.**
Automate on-chain allowances, route stablecoin payouts & Payrolls globally, and capture recurring revenue. We handle the on-chain execution, so you can focus on shipping code.

---

## 1. The Problem
Traditional software businesses run effortlessly on subscriptions, but Web3 wallets are strictly "push-based." If you want to charge a customer $20 a month or pay three developers every Friday on Stellar, you have to manually open your wallet, copy addresses, and sign every single transaction. 

It’s exhausting, unscalable, and kills the user experience. You simply cannot build a massive SaaS company if your customers have to wake up and manually sign a transaction every 30 days just to keep their account active.

## 2. Core Users & Explicit Use Cases
**Core Users:** Web3 founders, DAO operators, and AI developers building who need reliable, automated cash flow without the friction.

**Scenario 1: The Automated SaaS Subscription (The Pull)**
* **The Setup:** You built a premium AI design tool that costs 20 USDC a month. David, a designer in Berlin, wants to subscribe to your "Pro Plan."
* **The Allowance Vault:** David clicks "Subscribe" on your website. Orbit’s checkout widget pops up. David connects his wallet and signs a smart contract allowance that essentially says: *"I give this app permission to pull up to 20 USDC from my wallet every 30 days."*
* **The Magic:** From that moment on, David never has to open his wallet for this app again. Every 30 days, the Soroban contract checks the time limits and automatically pulls the 20 USDC to your treasury. You get paid while David sleeps.

**Scenario 2: The One-Click Batch Payroll (The Split)**
* **The Setup:** You run a DAO or Web3 startup and need to pay a frontend developer (400 USDC), a smart contract engineer (600 USDC), and a community manager (200 USDC) at the end of the week.
* **The Execution:** Instead of doing three separate, manual transfers and paying gas three times, you log into the Orbit Dashboard. You upload a quick list (or CSV) of their wallet addresses and the amounts they are owed.
* **The Magic:** You click "Run Payroll" and sign *one single time* for 1,200 USDC. The Orbit smart contract instantly takes the total amount and routes the exact cuts to all three people in a fraction of a second. Everyone gets paid simultaneously.

## 3. In Scope for MVP (The Build)
To prove this infrastructure works for the grant, we are building the absolute essentials:

* **Soroban Smart Contracts (Rust):** This is the brain on the blockchain. We are building the `Allowance Vault` (to strictly enforce time and money limits so users are protected) and a `Batch Disbursement` function (to split money instantly to multiple people).
* **The Merchant Dashboard (Next.js/Tailwind):** A clean, professional web app where a founder can log in, create a pricing plan, see who is actively subscribed, and hit the button to run their weekly batch payroll.
* **The Checkout Widget (React):** A simple, beautiful modal for the customer. They just connect their Freighter or xBull wallet, click approve, and the widget handles all the complex on-chain allowance logic behind the scenes.
* **The Playground:** Everything will be deployed live on the Stellar Testnet using testnet USDC, making it perfectly safe and easy for grant judges to interact with.

## 4. Out of Scope (Future Roadmap)
We are keeping the MVP lean so we can ship fast. These features are explicitly saved for Version 2 so we don't get bogged down:

* **Fully Autonomous Bots:** For the MVP, a human (the merchant) will still need to click a "Pull Funds" button on their dashboard when a month is up to trigger the smart contract. Setting up decentralized, automated cron jobs to do this invisibly is complex and slated for the future.
* **Asset Swapping (Path Payments):** We aren't doing real-time conversions of XLM to USDC yet. To keep the math simple and bulletproof, the MVP will deal strictly in USDC.
* **Fiat On/Off-Ramps:** We assume the grant judges testing our demo already have testnet USDC in their wallets.
* **Tax and Accounting Dashboards:** We are building the foundational payment pipes, not a full accounting suite.

## 5. Success Criteria (The Demo Reality Check)
We know we are ready to hit "Submit" on the grant application when we can record a demo video showing this exact flow working flawlessly:

1. **The Handshake:** A user connects their wallet to the widget and successfully signs a transaction that creates their on-chain Allowance Vault.
2. **The Pull:** The merchant clicks "Execute Billing" on their dashboard, and the Soroban contract successfully pulls the correct amount of USDC from the user, respecting the vault's limits.
3. **The Split:** The merchant enters three wallet addresses into the dashboard, hits "Run Batch," and the contract instantly sends the right amount of USDC to all three people in one single ledger execution block.
