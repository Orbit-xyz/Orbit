"use client";

import { motion } from "framer-motion";

const FEATURES = [
  {
    index: "01 / ALLOWANCE VAULT",
    title: "Permission with guardrails.",
    description:
      "Set a maximum amount and a time window. The contract cannot pull outside the allowance a customer approved.",
    foot: "TIME LIMIT + MONEY LIMIT",
  },
  {
    index: "02 / RECURRING PULLS",
    title: "Recurring revenue without reminders.",
    description:
      "Subscriptions and retainers become a predictable pull flow. A merchant triggers the billing action when a period is due.",
    foot: "USDC / STELLAR TESTNET",
  },
  {
    index: "03 / BATCH DISBURSEMENT",
    title: "One approval. Every payout.",
    description:
      "Upload recipient wallets and amounts, then route payroll or a contributor split in one contract execution.",
    foot: "MULTI-RECIPIENT ROUTING",
  },
  {
    index: "04 / PLAYGROUND",
    title: "Prove it on testnet.",
    description:
      "Everything in the MVP deploys to Stellar Testnet with testnet USDC so grant judges and builders can interact safely.",
    foot: "SAFE TO INTERACT",
  },
];

export function FeaturesToolkit() {
  return (
    <section className="section features-section" id="features">
      <div className="orbit-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="split-heading"
        >
          <div>
            <span className="eyebrow">THE MVP TOOLKIT</span>
            <h2 className="section-title">
              The payment primitives businesses keep asking for.
            </h2>
          </div>
          <p className="section-body">
            Orbit starts with the essential rails for recurring revenue and global
            payouts. Stablecoin-only, testnet-ready, and intentionally focused.
          </p>
        </motion.div>

        <div className="feature-grid">
          {FEATURES.map((feat, idx) => (
            <motion.article
              key={feat.index}
              initial={{ opacity: 0, scale: 0.98 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
              className="feature-card"
            >
              <span className="feature-index">{feat.index}</span>
              <h3>{feat.title}</h3>
              <p>{feat.description}</p>
              <div className="feature-foot">{feat.foot}</div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
