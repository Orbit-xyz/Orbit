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

> **Checkpoint 3: "The Handshake Working."** A user can click a button on a dummy HTML page, pop the widget, connect Freighter, and successfully approve an allowance on-chain.

---

## Phase 4: The Merchant Dashboard (The SaaS Founder Flow)
**Goal:** Build the control center for the merchant to manage plans and payroll.
**Role:** Frontend / Fullstack Engineer

* **Task 4.1: Dashboard Scaffolding & Public Pages (Next.js)**
  * Setup Next.js with TailwindCSS.
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
