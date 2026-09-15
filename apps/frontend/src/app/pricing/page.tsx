"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Plus, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const FAQS = [
  {
    question: "What does the MVP handle?",
    answer:
      "Orbit handles stablecoin-only pull payments on Stellar Testnet: allowance approvals, merchant-triggered recurring pulls, and one-click batch disbursement.",
  },
  {
    question: "Is Orbit custodial?",
    answer:
      "No. Funds move directly between the customer wallet and the merchant treasury, or from the merchant to payout recipients. Orbit never holds your money.",
  },
  {
    question: "Are pulls fully autonomous?",
    answer:
      "Not in the MVP. A merchant clicks 'Pull Funds' when a billing period is due. Invisible decentralized cron execution is planned for a future release.",
  },
  {
    question: "Does Orbit support assets other than USDC?",
    answer:
      "Not yet. The MVP stays strictly on USDC so the payment math stays simple and dependable. Multi-currency asset swapping is on the future roadmap.",
  },
  {
    question: "What wallets are supported?",
    answer:
      "Freighter and xBull wallets on Stellar Testnet are natively supported for one-click allowance vault creation and transaction signatures.",
  },
];

export default function PricingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const toggleFaq = (idx: number) => {
    setOpenFaq(openFaq === idx ? null : idx);
  };

  return (
    <main>
      <section className="pricing-hero">
        <div className="orbit-container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1>
              Pay for the <span>rails.</span>
              <br />
              Keep the revenue.
            </h1>
            <p>
              Orbit is focused on proving the protocol first. Start with the
              Stellar Testnet playground and see the allowance flow in action.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="orbit-container">
        <div className="pricing-layout">
          {/* Card 1: MVP Playground */}
          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="pricing-card"
          >
            <h2>Testnet access</h2>
            <div className="price">
              <strong>Free</strong>
              <span>while the MVP ships</span>
            </div>
            <p className="pricing-description">
              Explore the checkout widget, create a protected Allowance Vault,
              execute a pull, and route a batch payout with testnet USDC.
            </p>
            <Link
              className="button button-primary button-arrow w-full justify-center"
              href="/get-started"
              data-testid="pricing-button-start"
            >
              Open the playground
            </Link>

            <div className="included">
              <span className="included-title">Included in the demo</span>
              <ul>
                {[
                  "Allowance Vault with time and money limits",
                  "Merchant-triggered recurring pull",
                  "Batch Disbursement to multiple wallets",
                  "Stellar Testnet and testnet USDC",
                ].map((item, index) => (
                  <li key={item} data-testid={`pricing-included-${index}`}>
                    <Check size={14} className="text-white" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="pricing-note">
              No fiat rails, asset swapping, autonomous bots, or accounting
              suite in this MVP.
            </p>
          </motion.article>

          {/* Card 2: Scale */}
          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="pricing-card scale"
          >
            <h2>Protocol access</h2>
            <div className="price">
              <strong>Talk</strong>
              <span>with the team</span>
            </div>
            <p className="pricing-description">
              Building a product around recurring revenue or global payouts?
              Share the flow you need to prove and help shape the next release.
            </p>
            <Link
              className="button button-secondary button-arrow w-full justify-center"
              href="/docs"
              data-testid="pricing-button-talk"
            >
              Read the docs
            </Link>

            <div className="included">
              <span className="included-title">The conversation</span>
              <ul>
                <li>
                  <Check size={14} className="text-white" />
                  <span>SDK and widget integration</span>
                </li>
                <li>
                  <Check size={14} className="text-white" />
                  <span>Allowance safety model</span>
                </li>
                <li>
                  <Check size={14} className="text-white" />
                  <span>Payroll and contributor splits</span>
                </li>
              </ul>
            </div>
          </motion.article>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="pricing-faq">
        <div className="orbit-container faq-grid">
          <div>
            <h2 className="section-title">The short version.</h2>
          </div>

          <div className="faq-list">
            {FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div
                  className={`faq-item ${isOpen ? "open" : ""}`}
                  key={faq.question}
                >
                  <button
                    className="faq-trigger"
                    type="button"
                    onClick={() => toggleFaq(index)}
                    aria-expanded={isOpen}
                    data-testid={`button-faq-${index}`}
                  >
                    <span>{faq.question}</span>
                    <span className="faq-plus">
                      {isOpen ? <Minus size={18} /> : <Plus size={18} />}
                    </span>
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div
                          className="faq-answer"
                          data-testid={`faq-answer-${index}`}
                        >
                          {faq.answer}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
