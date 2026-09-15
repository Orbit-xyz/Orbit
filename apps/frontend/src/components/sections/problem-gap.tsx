"use client";

import { motion } from "framer-motion";

export function ProblemGap() {
  return (
    <section className="section gap-section" id="gap">
      <div className="orbit-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="split-heading"
        >
          <div>
            <span className="eyebrow">THE PROBLEM</span>
            <h2 className="section-title">
              Web3 wallets can push money. Businesses need to pull it.
            </h2>
          </div>
          <p className="section-body gap-body">
            Traditional software businesses run effortlessly on subscriptions. Web3
            wallets are still strictly push-based: customers manually sign every 30
            days, and operators copy addresses to pay every contractor. It is
            exhausting, unscalable, and it kills customer retention.
          </p>
        </motion.div>

        <div className="gap-compare">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="compare-col"
          >
            <div className="compare-label">
              <span>PUSH-ONLY WALLETS</span>
              <span className="mono">01 / FRICTION</span>
            </div>
            <h3>Every payment starts with a reminder.</h3>
            <p>
              Manual transfers, copy-pasted addresses, high churn, failed
              renewals, and multiple manual signatures just to settle a weekly
              contractor batch.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="compare-col"
          >
            <div className="compare-label">
              <span className="text-white font-semibold">ORBIT PROTOCOL</span>
              <span className="mono text-white">02 / AUTOMATION</span>
            </div>
            <h3>Approve once. Execute within the rules.</h3>
            <p>
              The Allowance Vault smart contract strictly enforces time windows and
              spending caps while Orbit executes pull payments directly between
              wallets.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
