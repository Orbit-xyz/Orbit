"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
    kicker: "01 / RECURRING PULL",
    description: "Charge customers periodically without manual renewals or signature fatigue.",
  },
  {
    id: 1,
    title: "Usage Settlement",
    kicker: "02 / USAGE SETTLEMENT",
    description: "Settle micro-charges and metered API usage without traditional credit card minimum fees.",
  },
  {
    id: 2,
    title: "Retainer Pull",
    kicker: "03 / RETAINER PULL",
    description: "Enforce time and budget limits between client and agency across international borders.",
  },
  {
    id: 3,
    title: "Global Checkout",
    kicker: "04 / GLOBAL CHECKOUT",
    description: "Drop-in Web3 checkout widget for recurring subscriptions in digital communities.",
  },
  {
    id: 4,
    title: "Batch Disbursement",
    kicker: "05 / BATCH DISBURSEMENT",
    description: "Disburse stablecoins to multiple global contractors and team members in 1 transaction.",
  },
];

export function HeroStage() {
  const [activeTab, setActiveTab] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  useEffect(() => {
    if (!isAutoPlaying) return;
    const interval = setInterval(() => {
      setActiveTab((prev) => (prev + 1) % USE_CASES.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  const handleNext = () => {
    setIsAutoPlaying(false);
    setActiveTab((prev) => (prev + 1) % USE_CASES.length);
  };

  const handlePrev = () => {
    setIsAutoPlaying(false);
    setActiveTab((prev) => (prev - 1 + USE_CASES.length) % USE_CASES.length);
  };

  const selectTab = (idx: number) => {
    setIsAutoPlaying(false);
    setActiveTab(idx);
  };

  return (
    <div className="w-full">
      <div className="case-copy">
        <div className="case-kicker mono">{USE_CASES[activeTab].kicker}</div>
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
            {USE_CASES[activeTab].title}
          </h2>
          <p className="text-sm text-white/70 leading-relaxed">
            {USE_CASES[activeTab].description}
          </p>
        </div>
      </div>

      <div className="relative min-h-[440px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
          >
            {activeTab === 0 && <ReceiptPanel />}
            {activeTab === 1 && <UsagePanel />}
            {activeTab === 2 && <RetainerPanel />}
            {activeTab === 3 && <CheckoutPanel />}
            {activeTab === 4 && <PayrollPanel />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Carousel Controls */}
      <div className="carousel-controls">
        <div className="progress-bars" role="tablist" aria-label="Use case selectors">
          {USE_CASES.map((uc, i) => (
            <button
              key={uc.id}
              type="button"
              role="tab"
              aria-selected={activeTab === i}
              aria-label={`View ${uc.title}`}
              className={`progress-bar ${activeTab === i ? "active" : ""}`}
              onClick={() => selectTab(i)}
            />
          ))}
        </div>

        <div className="carousel-buttons">
          <button
            type="button"
            className="carousel-button"
            onClick={handlePrev}
            aria-label="Previous preview"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="carousel-number mono">
            0{activeTab + 1} <i>/</i> 0{USE_CASES.length}
          </span>
          <button
            type="button"
            className="carousel-button"
            onClick={handleNext}
            aria-label="Next preview"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
