"use client";

import { motion } from "framer-motion";

export function MvpBoundaries() {
  return (
    <section className="boundaries-section">
      <div className="orbit-container boundaries-grid">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="section-title">
            Small enough to ship. Clear enough to trust.
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="boundary-list"
        >
          <div>
            <span className="text-white font-semibold">IN SCOPE (MVP)</span>
            <p>
              Allowance Vault smart contracts on Soroban, Batch Disbursement to
              multiple wallets, developer SDK, responsive checkout widget, and
              Stellar Testnet playground for safe testing.
            </p>
          </div>
          <div>
            <span className="text-white/60">OUT OF SCOPE (ROADMAP)</span>
            <p>
              Autonomous cron bots, real-time path payment asset swapping (XLM to
              USDC), fiat credit-card on/off-ramps, and heavy enterprise
              accounting suites are intentionally saved for V2.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
