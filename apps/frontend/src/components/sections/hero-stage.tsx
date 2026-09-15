"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ReceiptPanel } from "./interactive-panels/receipt-panel";
import { UsagePanel } from "./interactive-panels/usage-panel";
import { RetainerPanel } from "./interactive-panels/retainer-panel";
import { CheckoutPanel } from "./interactive-panels/checkout-panel";
import { PayrollPanel } from "./interactive-panels/payroll-panel";

export const USE_CASES = [
  {
    id: 0,
    title: "Allowance Vault",
    description: "Charge customers periodically without manual renewals or signature fatigue.",
  },
  {
    id: 1,
    title: "Usage Settlement",
    description: "Settle micro-charges and metered API usage without traditional credit card minimum fees.",
  },
  {
    id: 2,
    title: "Retainer Pull",
    description: "Enforce time and budget limits between client and agency across international borders.",
  },
  {
    id: 3,
    title: "Global Checkout",
    description: "Drop-in Web3 checkout widget for recurring subscriptions in digital communities.",
  },
  {
    id: 4,
    title: "Batch Disbursement",
    description: "Disburse stablecoins to multiple global contractors and team members in 1 transaction.",
  },
];

export function HeroStage() {
  const [activeTab, setActiveTab] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setActiveTab((prev) => (prev + 1) % USE_CASES.length);
    }, 5500);
    return () => clearInterval(interval);
  }, [isPaused]);

  return (
    <div
      className="w-full"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Title & Description with smooth upward transition */}
      <div className="mb-4 min-h-[72px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#09090B] mb-1.5">
              {USE_CASES[activeTab].title}
            </h2>
            <p className="text-sm text-[#52525B] leading-relaxed">
              {USE_CASES[activeTab].description}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Visual Panels animating UP one after the other */}
      <div className="relative min-h-[420px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {activeTab === 0 && <ReceiptPanel />}
            {activeTab === 1 && <UsagePanel />}
            {activeTab === 2 && <RetainerPanel />}
            {activeTab === 3 && <CheckoutPanel />}
            {activeTab === 4 && <PayrollPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
