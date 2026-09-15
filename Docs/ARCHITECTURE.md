# Orbit: Stage 3 Architecture Spec

**Orbit is the financial operating system for the global internet.**
This document outlines the technical stack, data flow, and smart contract architecture required to build the Orbit MVP.

---

## 1. The Tech Stack

We are choosing a battle-tested, high-performance stack that allows us to move fast while looking like a multi-million dollar company.

* **Frontend (Dashboard & Checkout Widget):** Next.js (React), Tailwind CSS. For the checkout widget animations, we will use Framer Motion and GSAP to give it that buttery-smooth, premium Stripe-like feel.
* **Backend / API:** Node.js & Express.js. This will handle the dashboard logic, API usage aggregation, and bridging the frontend to the blockchain.
* **Database:** Supabase (PostgreSQL). We will use this to store merchant accounts, their custom pricing plans, and off-chain records of who is subscribed.
* **Smart Contracts (The Core):** Rust on Soroban (Stellar’s smart contract platform). 
* **Blockchain Bridge:** We will use the official `@stellar/stellar-sdk` and `@stellar/freighter-api` to allow our Next.js frontend and Express backend to talk directly to the Soroban smart contracts.

---

## 2. Dedicated User Flows (Dashboard vs. SDK)

To truly understand the architecture, we must split the app into its two distinct user experiences: the **Merchant** (using the dashboard) and the **Customer** (using the SDK).

### A. The Merchant Flow (Dashboard User)
This flow represents the business owner (e.g., a SaaS founder) logging into the Orbit web app (`dashboard.orbit.network`) to manage their revenue, create pricing plans, and run payroll.

```text
+-----------------+      +-----------------+      +-----------------+
|   Merchant      |      | Orbit Dashboard |      | Supabase &      |
|   (Founder)     |      |   (Next.js)     |      | Express Backend |
+--------+--------+      +--------+--------+      +--------+--------+
         |                        |                        |
         | 1. Connects Wallet     |                        |
         |----------------------->| 2. Auth & Fetch Data   |
         |                        |----------------------->|
         | 3. Creates "Pro Plan"  |                        |
         |----------------------->| 4. Saves to Database   |
         |                        |----------------------->|
         | 5. Uploads CSV         |                        |
         |    (Batch Payroll)     |                        |
         |----------------------->| 6. Parse CSV into JSON |
         |                        |----------------------->|
         | 7. Signs Payload       |                        |
         |<-----------------------|                        |
         | 8. Executes via Wallet |                        |
         +-----------------+      +-----------------+      +-----------------+
```
**Step-by-Step (Dashboard):**
1. **Authentication:** The merchant visits the Orbit dashboard and connects their Freighter wallet to log in securely.
2. **Setup:** They create a new subscription plan (e.g., "$29/mo Pro Plan"). The Next.js frontend sends this to the Express backend, which stores it in Supabase and generates a unique `plan_id`.
3. **Monitoring:** They view a live list of active subscribers pulled from the backend.
4. **Execution:** For batch payroll, they upload a CSV of contractor addresses. The dashboard parses the CSV, bundles it into a JSON array, and prompts their wallet for a single signature to execute the payout via the smart contract.

### B. The Customer Flow (SDK User)
This flow represents the end-user (e.g., a designer) visiting the merchant's website and interacting with the embedded Orbit SDK widget. They never see the dashboard.

```text
+-----------------+      +-----------------+      +-----------------+
|   End User      |      |   Orbit SDK     |      | Orbit Smart     |
|  (Customer)     |      | (React Widget)  |      | Vault (Soroban) |
+--------+--------+      +--------+--------+      +--------+--------+
         |                        |                        |
         | 1. Clicks "Subscribe"  |                        |
         |    on Merchant site    |                        |
         |----------------------->|                        |
         |                        | 2. Fetch Plan Info     |
         |                        |    (e.g., 29 USDC)     |
         | 3. Orbit Modal Pops Up |<-----------------------|
         |<-----------------------|                        |
         | 4. Connects Wallet &   |                        |
         |    Approves Allowance  |                        |
         |----------------------->| 5. Submits Allowance   |
         |                        |    Transaction         |
         |                        |----------------------->| 6. Locks Vault
         | 7. Success Animation   |<-----------------------|
         |<-----------------------|                        |
         +-----------------+      +-----------------+      +-----------------+
```
**Step-by-Step (SDK):**
1. **Trigger:** The customer clicks "Subscribe" directly on the merchant's website.
2. **Initialization:** The embedded Orbit SDK reads the `plan_id` passed by the merchant, reaches out to the Orbit backend to verify the price, and renders a beautiful checkout modal overlay.
3. **Wallet Connection:** The customer connects their wallet (e.g., Freighter) inside the modal.
4. **The Handshake:** The SDK prompts the wallet to sign the specific Allowance transaction (e.g., "Pull up to 29 USDC / 30 days"). 
5. **The Vault:** The transaction is submitted to the Soroban smart contract, locking in the permission. The SDK triggers a buttery-smooth GSAP "Success" animation and passes control back to the merchant's app to grant the user access.

---

## 3. The 30-Day Automated Billing Flow (The Pull)

Once the SDK has established the allowance (Phase B above), the actual automated billing happens invisibly in the background.

```text
+-------------------+       +-------------------+       +-------------------+
|  Orbit Backend    |       | Orbit Smart Vault |       | Merchant Database |
| (Node.js/Express) |       |  (Soroban/Rust)   |       |   (Supabase)      |
+--------+----------+       +--------+----------+       +--------+----------+
         |                           |                           |
         | 1. Check chron job:       |                           |
         |    "Is Bill Due?"         |                           |
         |-------------------------->|                           |
         |                           | 2. Contract verifies:     |
         |                           |    "Time elapsed? Yes."   |
         | 3. Contract pulls funds   |<--------------------------|
         |    and sends to Merchant  |                           |
         |-------------------------->|                           |
         |                           | 4. Update status to       |
         |                           |    "Active/Paid"          |
         |                           |-------------------------->|
         +-------------------+       +-------------------+       +-------------------+
```

---

## 4. Risky Technical Pieces (To De-Risk First)

When building a Web3 project, you don't build the UI first. You build the scariest technical pieces first to prove they work. Here is what we must de-risk immediately:

1. **The Soroban Allowance Logic:** We need to make sure Soroban actually allows a third party (the backend) to execute a transfer on behalf of a user *after* the initial allowance is signed, without requiring a fresh signature. **(Action: Write a simple Rust script to test this before touching Next.js).**
2. **Freighter Wallet UI in the SDK:** Connecting a wallet and triggering a contract call from inside an embedded React widget can get messy with browser extensions. **(Action: Build a blank React page that just connects Freighter and signs a dummy transaction).**
3. **Decimal Math in Rust:** Processing USDC requires handling 7 decimal places accurately in Rust without rounding errors. **(Action: Use standard Stellar SDK data types for currency).**
