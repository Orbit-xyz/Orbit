"use client";

import { motion } from "framer-motion";

const USE_CASES = [
  {
    number: "01",
    audience: "The Emerging Market SaaS Founder",
    description:
      "A developer in Nigeria, India, or Latin America building a SaaS product. Integrate checkout, let the customer pay in USDC, and settle instantly without banking borders or card declines.",
    label: "RECURRING PULL",
  },
  {
    number: "02",
    audience: "API & AI Tool Builders",
    description:
      "Charge exactly $0.45 for metered LLM tokens or API usage at the end of the week without losing 70% of your revenue to Web2 credit card processing minimums.",
    label: "USAGE SETTLEMENT",
  },
  {
    number: "03",
    audience: "B2B Agencies & Global Freelancers",
    description:
      "A Nairobi design agency charges a London client $2,000/month. One smart contract allowance approval means reliable automatic monthly revenue without chasing invoices.",
    label: "RETAINER PULL",
  },
  {
    number: "04",
    audience: "Digital Product Creators & Communities",
    description:
      "Premium Discord communities, paid technical newsletters, and digital engineering templates get 1-click global checkout with zero chargeback risk.",
    label: "GLOBAL CHECKOUT",
  },
  {
    number: "05",
    audience: "Global Payroll & Contractor Platforms",
    description:
      "Remote contractors across 15 countries get stablecoin batch payouts simultaneously on Friday afternoon with a single on-chain signature block.",
    label: "BATCH DISBURSEMENT",
  },
];

export function UseCases() {
  return (
    <section className="section use-cases section-rule" id="use-cases">
      <div className="orbit-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="split-heading"
        >
          <div>
            <h2 className="section-title">One protocol. Five ways to get paid.</h2>
          </div>
          <p className="section-body">
            From a $0.45 API charge to a 1,200 USDC contractor payroll, Orbit
            gives internet businesses an execution layer that respects the rules.
          </p>
        </motion.div>

        <div className="usecase-list">
          {USE_CASES.map((uc, idx) => (
            <motion.div
              key={uc.number}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
              className="usecase-row group"
            >
              <div className="flex items-center gap-3">
                <span className="usecase-number">{uc.number}</span>
                <span className="mono text-[9px] px-2 py-0.5 rounded border border-black/15 text-zinc-600 bg-black/[0.03]">
                  {uc.label}
                </span>
              </div>
              <h3 className="usecase-name transition-colors">
                {uc.audience}
              </h3>
              <p className="usecase-copy">{uc.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
