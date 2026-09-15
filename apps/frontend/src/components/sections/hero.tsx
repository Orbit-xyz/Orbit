"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";
import { HeroStage } from "./hero-stage";
import { Typewriter } from "@/components/ui/typewriter";

export function Hero() {
  return (
    <section className="hero">
      <div className="orbit-container hero-grid">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="hero-copy"
        >
          <div className="eyebrow">
            NON-CUSTODIAL PULL PAYMENTS FOR BUSINESSES
          </div>

          <h1 className="hero-title">
            Let revenue{" "}
            <Typewriter
              words={["pull itself.", "settle itself.", "automate itself."]}
            />
          </h1>

          <p className="hero-text">
            Automate on-chain allowances, route stablecoin payouts & payrolls
            globally, and capture recurring revenue. We handle the on-chain
            execution, so you can focus on shipping code.
          </p>

          <div className="hero-actions">
            <Link
              className="button button-primary button-arrow"
              href="/get-started"
              data-testid="hero-button-get-started"
            >
              Get started
            </Link>
            <Link
              className="button button-secondary"
              href="/docs"
              data-testid="hero-button-docs"
            >
              Explore the protocol <ArrowUpRight size={15} />
            </Link>
          </div>

          <div className="hero-note">
            <span className="note-mark" />
            Built for USDC on Stellar / Soroban testnet
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
          className="hero-stage"
        >
          <HeroStage />
        </motion.div>
      </div>
    </section>
  );
}
