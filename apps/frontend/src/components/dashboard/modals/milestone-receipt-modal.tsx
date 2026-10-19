"use client";

import { useState } from "react";
import { X, CheckCircle2, Copy, Check, ExternalLink, ShieldCheck } from "lucide-react";
import { MilestoneReleaseReceipt } from "@/lib/milestone-escrow";

interface Props {
  isOpen: boolean;
  receipt: MilestoneReleaseReceipt | null;
  onClose: () => void;
}

export function MilestoneReceiptModal({ isOpen, receipt, onClose }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!isOpen || !receipt) return null;

  const copy = (val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-white rounded-2xl border border-black/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-emerald-50/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-emerald-950">
                Verified On-Chain Escrow Release Receipt
              </h3>
              <p className="text-[11px] text-emerald-800/80">
                Disbursement settled via Freighter on Stellar Soroban
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-black hover:bg-black/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Receipt Content */}
        <div className="p-6 space-y-4 text-xs">
          {/* Amount Hero */}
          <div className="p-4 rounded-xl bg-neutral-50 border border-black/10 text-center">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Released Escrow Amount
            </span>
            <div className="text-3xl font-bold text-black mt-1 font-mono tracking-tight">
              {receipt.amountUsdc.toLocaleString("en-US", { minimumFractionDigits: 2 })}{" "}
              <span className="text-sm text-neutral-500">USDC</span>
            </div>
            <div className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center justify-center gap-1">
              <ShieldCheck size={13} />
              <span>Cryptographically Confirmed</span>
            </div>
          </div>

          {/* Details Table */}
          <div className="space-y-2 rounded-xl border border-black/10 p-4 bg-white divide-y divide-black/5">
            {/* Tx Hash */}
            <div className="pb-2 flex items-center justify-between gap-2">
              <span className="text-neutral-500">Transaction Hash:</span>
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <span>
                  {receipt.txHash.slice(0, 10)}...{receipt.txHash.slice(-8)}
                </span>
                <button
                  onClick={() => copy(receipt.txHash, "tx")}
                  className="p-1 rounded hover:bg-black/5 text-neutral-400 hover:text-black"
                  title="Copy Hash"
                >
                  {copied === "tx" ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                </button>
                <a
                  href={receipt.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1 rounded hover:bg-black/5 text-neutral-400 hover:text-black"
                  title="View on Stellar Expert"
                >
                  <ExternalLink size={11} />
                </a>
              </div>
            </div>

            {/* Contractor Address */}
            <div className="py-2 flex items-center justify-between gap-2">
              <span className="text-neutral-500">Contractor Recipient:</span>
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <span>
                  {receipt.contractorAddress.slice(0, 6)}...{receipt.contractorAddress.slice(-6)}
                </span>
                <button
                  onClick={() => copy(receipt.contractorAddress, "addr")}
                  className="p-1 rounded hover:bg-black/5 text-neutral-400 hover:text-black"
                >
                  {copied === "addr" ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                </button>
              </div>
            </div>

            {/* Ledger Block */}
            <div className="py-2 flex items-center justify-between gap-2">
              <span className="text-neutral-500">Ledger Block Sequence:</span>
              <span className="font-mono font-semibold text-black">
                #{receipt.ledgerSequence.toLocaleString()}
              </span>
            </div>

            {/* Network & Gas */}
            <div className="py-2 flex items-center justify-between gap-2">
              <span className="text-neutral-500">Soroban Gas Fee:</span>
              <span className="font-mono text-emerald-600 font-semibold">
                {receipt.sorobanFeeXlm} XLM (&lt; $0.0001)
              </span>
            </div>

            {/* Timestamp */}
            <div className="pt-2 flex items-center justify-between gap-2">
              <span className="text-neutral-500">Settlement Timestamp:</span>
              <span className="font-mono text-neutral-700">
                {new Date(receipt.timestamp).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <a
              href={receipt.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="button button-secondary text-xs h-9 px-4 flex items-center gap-1.5 text-neutral-700 hover:text-black"
            >
              <ExternalLink size={13} />
              <span>Open Stellar Explorer</span>
            </a>
            <button
              onClick={onClose}
              className="button button-primary text-xs h-9 px-4"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
