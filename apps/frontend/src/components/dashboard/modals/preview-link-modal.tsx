"use client";

import { useState } from "react";
import { X, Wallet, ShieldCheck, CheckCircle2, ArrowRight, ExternalLink } from "lucide-react";
import { PaymentLink } from "../dashboard-types";
import { Brand } from "@/components/layout/brand";

interface PreviewLinkModalProps {
  link: PaymentLink | null;
  businessName: string;
  onClose: () => void;
}

export function PreviewLinkModal({ link, businessName, onClose }: PreviewLinkModalProps) {
  const [isApproved, setIsApproved] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  if (!link) return null;

  const handleSimulatePayment = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
      setIsApproved(true);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-white border border-black/10 shadow-2xl overflow-hidden">
        {/* Hosted Link Header */}
        <div className="p-6 border-b border-black/10 flex items-center justify-between bg-neutral-50/50">
          <Brand variant="black" />
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Customer View */}
        <div className="p-6 space-y-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Payment to {businessName}
            </div>
            <h3 className="text-xl font-bold text-black mt-1">
              {link.title}
            </h3>
            <div className="mt-2 text-3xl font-extrabold text-black font-mono">
              {link.amount.toFixed(2)} <span className="text-sm font-semibold text-neutral-500">USDC</span>
              {link.type === "recurring" && (
                <span className="text-xs text-neutral-500 font-sans font-normal ml-1">
                  / every {link.intervalDays} days
                </span>
              )}
            </div>
          </div>

          {!isApproved ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-black/10 bg-neutral-50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Settlement Asset:</span>
                  <span className="font-mono font-semibold text-black">USDC (Stellar Soroban)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Authorization:</span>
                  <span className="font-mono text-emerald-700 font-medium">Non-Custodial Vault</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Network Gas:</span>
                  <span className="font-mono text-emerald-700">&lt; $0.001 XLM</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSimulatePayment}
                  disabled={isSimulating}
                  className="flex-1 button button-primary text-xs h-11 px-4 flex items-center justify-center gap-2"
                >
                  {isSimulating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Approving on Stellar...</span>
                    </>
                  ) : (
                    <>
                      <Wallet size={15} />
                      <span>Authorize with Freighter</span>
                    </>
                  )}
                </button>
                <a
                  href={`/pay/${link.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-secondary text-xs h-11 px-3 flex items-center justify-center gap-1.5"
                  title="Open Full Hosted Checkout Page"
                >
                  <ExternalLink size={14} />
                  <span className="hidden sm:inline">Hosted</span>
                </a>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-400">
                <ShieldCheck size={13} />
                <span>Protected by Orbit on-chain allowance contract</span>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center space-y-3 animate-in fade-in duration-200">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                <CheckCircle2 size={24} />
              </div>
              <h4 className="font-bold text-black text-base">Payment Authorized</h4>
              <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                Allowance vault created on Stellar Testnet for {businessName}. Recurring pulls will execute on schedule.
              </p>
              <button
                onClick={onClose}
                className="button button-secondary text-xs h-9 px-4 mt-2"
              >
                Close Preview
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
