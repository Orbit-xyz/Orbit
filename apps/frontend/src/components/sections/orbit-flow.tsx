"use client";

import { motion } from "framer-motion";

const STEPS = [
  {
    num: "01 / APPROVE",
    title: "Create an Allowance Vault.",
    body: "The customer connects their wallet and signs a smart contract vault with strict time windows and spending caps.",
  },
  {
    num: "02 / EXECUTE",
    title: "Pull when the rule is due.",
    body: "A merchant triggers the approved pull when billing is due. Funds move wallet-to-treasury, never through Orbit custody.",
  },
  {
    num: "03 / SPLIT",
    title: "Pay a whole team at once.",
    body: "Batch Disbursement routes exact payment amounts to multiple recipient wallets simultaneously in one single ledger block.",
  },
];

export function OrbitFlow() {
  return (
    <section className="section ink-section steps-section" id="how-it-works">
      <div className="orbit-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="steps-heading"
        >
          <div>
            <h2 className="section-title">A safer way to move on-chain money.</h2>
          </div>
          <p className="section-body">
            The MVP keeps the handshake visible and the rules explicit. No
            custody, no mystery middleware.
          </p>
        </motion.div>

        <div className="steps-list">
          {STEPS.map((step, idx) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: idx * 0.15 }}
              className="step group hover:bg-white/[0.02] transition-colors"
            >
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
