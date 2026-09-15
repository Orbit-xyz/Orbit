# Orbit

**Non-custodial pull payments protocol for businesses that sell, subscribe, and pay globally.**

Automate on-chain allowances, route stablecoin payouts & payrolls globally, and capture recurring revenue with Soroban smart contracts on Stellar.

---

## Overview

Orbit provides the missing execution layer for Web3 recurring revenue and automated global payouts:

- **Allowance Vault**: Smart contract-enforced time and budget limits. Approve once, execute within the rules.
- **Recurring Pulls**: Seamless SaaS subscriptions and retainer billing in USDC without manual monthly signatures.
- **Batch Disbursement**: Disburse payroll or contributor splits to multiple global wallets in a single ledger block.
- **Stellar & Soroban Native**: Built for instant finality (~0.4s) and fractions-of-a-cent fees with testnet USDC.

---

## Repository Structure

```
Orbit/
├── apps/
│   ├── frontend/        # Next.js 15 App Router (TypeScript, Tailwind, Framer Motion, GSAP)
│   └── backend/         # Express API & Stellar SDK bridge
├── packages/
│   └── checkout-widget/ # Drop-in React checkout modal
├── contracts/
│   └── soroban/         # Soroban smart contracts (Rust)
├── Brand/               # Brand identity assets & logos
└── Docs/                # Architecture specifications & build guides
```

---

## Quickstart

### Prerequisites
- Node.js >= 18
- npm or pnpm

### Frontend Development
```bash
# Install dependencies
npm install

# Start Next.js development server (runs on http://localhost:3000)
npm run dev
```

### Backend Development
```bash
cd apps/backend
npm install
npm run dev # or node index.js
```

---

## 📄 License
MIT © Orbit Technologies 2026
