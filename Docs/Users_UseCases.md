## User Cases

Here are the actual businesses and people who will use Orbit:

  ### 1. The Emerging Market SaaS Founder (The Core Target)

  A developer in Nigeria, India, or Latin America building a SaaS product (like an AI design tool or a CRM). They are
  locked out of Stripe, or they are tired of stitching together Paystack, Flutterwave, and Lemonway just to accept
  payments from US and UK customers. With Orbit, they just integrate your checkout, the customer pays in USDC, and the
  founder settles instantly without borders.

  ### 2. API & AI Tool Builders (Usage-Based Billing)

  A startup selling API access or AI compute. Traditional processors charge a fixed $0.30 + 2.9% fee, making micro-
  transactions impossible. Because Orbit is on-chain, they can charge a customer exactly $0.45 for API usage at the end
  of the week without getting killed by Web2 credit card fees.

  ### 3. B2B Agencies & Freelancers (Retainers)

  A design agency in Kenya that charges a client in London $2,000 a month on retainer. Instead of sending an invoice
  every 30 days and begging the client to do a slow bank wire, the London client signs an Orbit allowance once. The
  agency now automatically pulls the $2,000 every month like clockwork.

  ### 4. Digital Product Creators & Communities

  Founders running premium Discord communities, paid newsletters, or selling digital templates. They want a global
  checkout page that works for a buyer in Japan just as easily as a buyer in Canada, without dealing with currency
  conversion fees.

  ### 5. Global Payroll & Contractor Platforms

  Companies that have 50 remote contractors spread across 15 different countries. Instead of using Deel or slow SWIFT
  transfers, they use Orbit’s batch payout feature to route stablecoins to everyone simultaneously on Friday afternoon.


 ## The Pivot:
  We need to strip the heavy "Web3/DAO" language out of the MVP Spec and replace it with "Internet Businesses," "SaaS
  Founders," and "Global Commerce." We hide the blockchain mechanics in the background because the merchant doesn't care
  about Soroban—they just care about getting paid on time without cross-border friction.

  ## Here is exactly how Orbit works in the real world for these businesses, step-by-step.
  

  ### Scenario Case 1: The SaaS Founder (Automated Subscriptions)
  The User: Tunde, a software founder in Lagos, Nigeria. He built MailKit, a software tool that costs $29/month.
  The Problem: Tunde wants to sell globally, but Stripe doesn't support his local bank account, and local African
  processors struggle with US/European customers.
  How he uses Orbit:

  1. The Setup: Tunde logs into the Orbit Merchant Dashboard. He clicks "Create Plan," names it MailKit Pro, and sets
  the price to 29 USDC / month. Orbit gives him a few lines of code (the Orbit Checkout Widget) to paste into his
  website.
  2. The Customer Checkout: A customer in London visits Tunde's site and clicks "Subscribe." The Orbit widget pops up.
  The customer connects their wallet and clicks "Approve." They are signing an on-chain allowance that says: "Orbit can
  pull 29 USDC every 30 days."
  3. The Revenue: The first 29 USDC is pulled instantly into Tunde's wallet. He doesn't have to wait 7 days for a bank
  payout like Stripe.
  4. The Automation: Exactly 30 days later, the London customer is asleep. Orbit’s smart contract automatically pulls
  the next 29 USDC. Tunde has built a global, recurring revenue SaaS business without ever touching a legacy bank.
  

  ### Scenario Case 2: The AI API Builder (Micro-Billing)

  The User: Sarah, an AI researcher in India who built an API that generates images. She charges $0.02 per image
  generated.
  The Problem: She cannot use traditional Web2 payments. Stripe charges a flat fee of $0.30 per transaction, meaning if
  she tries to charge a customer $0.50 for API usage, she loses all her money to fees.
  How she uses Orbit:

  1. The Setup: Sarah integrates Orbit into her API platform.
  2. The Allowance: When a developer signs up to use her API, they must approve an Orbit allowance that says: "Sarah's
  app can pull up to $100 a week, based on my actual usage."
  3. The Micro-Charge: A developer uses her API on Wednesday and generates $3.45 worth of images.
  4. The Execution: At the end of the week, Sarah’s server tells the Orbit contract: "Pull $3.45 from this user."
  Because Orbit runs on Stellar/Soroban, the transaction fee is a fraction of a cent. She captures 100% of her revenue,
  solving a massive problem for usage-based internet businesses.
  

  ### Scenario Case 3: The Global B2B Agency (Retainers & Payroll)

  The User: Alex, who runs a design agency in Argentina. He has a US client paying a $5,000/month retainer. He also has
  4 freelance designers working for him in Brazil, Kenya, Ukraine, and the Philippines.
  The Problem: Chasing the US client to pay an invoice every month takes weeks. And paying his 4 freelancers via SWIFT
  bank transfers costs $40 in fees per person and takes 5 days to clear.
  How he uses Orbit:

  1. The Retainer Pull: Alex sends an Orbit checkout link to his US client. The client approves a $5,000/month allowance.
  Now, Alex never has to chase an invoice again. On the 1st of the month, Orbit automatically pulls $5,000 into Alex's
  treasury wallet.
  2. The Batch Payroll: Now it's Friday, and Alex needs to pay his 4 freelancers.
  3. The Split: Alex logs into the Orbit dashboard, goes to the "Payouts" tab, and uploads a quick CSV with the 4
  freelancers' wallet addresses and their cuts (e.g., $1,000 each).
  4. The One-Click Execution: Alex clicks "Run Payroll." He signs one single transaction. The Orbit contract instantly
  routes the money globally to all 4 freelancers in under 3 seconds.
  

##  Technicalities

### 1. The SDK / Checkout Widget (For their website)

  This is a small package of code you give them (e.g., @orbit/sdk).

  • Where it lives: The merchant installs this on their own website or app.
  • What it does: When a customer clicks "Subscribe," your SDK triggers the Orbit Checkout modal to pop up on their
  screen. This is what handles connecting the user's wallet and asking them to sign the allowance.
  • Why it matters: The merchant doesn't have to write complex blockchain code. They just drop your SDK into their
  frontend, and you handle the crypto magic.

  ### 2. The Merchant Dashboard (The App on your platform)

  This is a web app hosted by you (e.g., dashboard.orbit.com).

  • Where it lives: On your servers. The merchant logs into this every day.
  • What it does: This is their control center. This is where Tunde the founder logs in to:
      • Create a new $29/mo pricing plan (which generates an ID he puts into the SDK).
      • See his Total Revenue and a list of all his active subscribers.
      • Click the "Run Payroll" button and upload his CSV of freelancers.
      • Click "Execute Billing" to trigger the monthly pulls.


  ### How they talk to each other (The Flow)

  1. Tunde logs into Your Dashboard to create a plan.
  2. He pastes Your SDK onto his website.
  3. A customer visits his site, the SDK pops up, and they approve the payment.
  4. The smart contract on Stellar locks in the agreement.
  5. Tunde checks Your Dashboard the next morning and sees his MRR (Monthly Recurring Revenue) has gone up, and the
  money is sitting in his wallet.

  So you are building a two-sided product: an SDK to make it easy for developers to accept payments, and a beautiful
  Dashboard for founders to manage their business.
