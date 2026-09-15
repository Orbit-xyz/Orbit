"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export function CtaBanner() {
  return (
    <section className="cta-wrap">
      <div className="orbit-container">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="cta-card"
        >
          <span className="eyebrow">THE NEXT CLEAR MOVE</span>
          <h2>Build revenue flows that do not need a nudge.</h2>
          <p>
            Inspect the on-chain Allowance Vault, test batch payroll on Stellar
            Testnet, and replace manual invoice chasing with automated pull
            payments.
          </p>
          <Link
            className="button button-primary button-arrow"
            href="/get-started"
            data-testid="cta-button-get-started"
          >
            Get started with testnet
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
