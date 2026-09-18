"use client";

import { useState } from "react";
import { X, Link2, Check, Copy, ArrowRight, Sparkles } from "lucide-react";
import { PaymentLink } from "../dashboard-types";

interface CreatePaymentLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLink: (link: PaymentLink) => void;
}

export function CreatePaymentLinkModal({
  isOpen,
  onClose,
  onCreateLink,
}: CreatePaymentLinkModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("500");
  const [type, setType] = useState<"recurring" | "one_time">("recurring");
  const [intervalDays, setIntervalDays] = useState("30");
  const [description, setDescription] = useState("");
  const [createdLink, setCreatedLink] = useState<PaymentLink | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !amount) return;

    const linkId = `plink_${title.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 10)}_${Math.random().toString(36).substring(2, 6)}`;
    const newLink: PaymentLink = {
      id: linkId,
      title: title.trim(),
      amount: parseFloat(amount) || 500,
      currency: "USDC",
      type,
      intervalDays: type === "recurring" ? parseInt(intervalDays, 10) || 30 : undefined,
      url: `https://orbit.network/pay/${linkId}`,
      clicks: 0,
      conversions: 0,
      network: "stellar-testnet",
      status: "active",
    };

    onCreateLink(newLink);
    setCreatedLink(newLink);
    setStep(2);
  };

  const resetAndClose = () => {
    setStep(1);
    setTitle("");
    setAmount("500");
    setType("recurring");
    setIntervalDays("30");
    setDescription("");
    setCreatedLink(null);
    setCopied(false);
    onClose();
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-xl bg-white border border-black/10 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Link2 size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-black tracking-tight">
                {step === 1 ? "Create Hosted Payment Link" : "Payment Link Generated"}
              </h3>
              <p className="text-xs text-neutral-500">
                {step === 1
                  ? "100% no-code checkout URL for B2B retainers and services."
                  : "Share this URL directly with your client or community."}
              </p>
            </div>
          </div>
          <button
            onClick={resetAndClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {step === 1 && (
          <form onSubmit={handleCreate} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-1.5">
                Service / Retainer Title
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Monthly Advisory Retainer, Studio Design Pass"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-xs text-black focus:outline-hidden focus:ring-1 focus:ring-black"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-1.5">
                Billing Model
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setType("recurring")}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    type === "recurring"
                      ? "border-black bg-neutral-50 ring-1 ring-black/5"
                      : "border-black/10 hover:bg-neutral-50"
                  }`}
                >
                  <div className="font-bold text-xs text-black">Recurring Retainer</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5">
                    Automated pull every 30 days
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setType("one_time")}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    type === "one_time"
                      ? "border-black bg-neutral-50 ring-1 ring-black/5"
                      : "border-black/10 hover:bg-neutral-50"
                  }`}
                >
                  <div className="font-bold text-xs text-black">One-Time Payment</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5">
                    Fixed digital dollar invoice
                  </div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-1.5">
                  Amount (USDC)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-lg border border-black/10 pl-3.5 pr-16 py-2.5 text-xs font-mono text-black focus:outline-hidden focus:ring-1 focus:ring-black"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-neutral-400">
                    USDC
                  </span>
                </div>
              </div>

              {type === "recurring" && (
                <div>
                  <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-1.5">
                    Frequency
                  </label>
                  <select
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                    className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-xs text-black bg-white focus:outline-hidden focus:ring-1 focus:ring-black"
                  >
                    <option value="7">Every 7 Days (Weekly)</option>
                    <option value="30">Every 30 Days (Monthly)</option>
                    <option value="90">Every 90 Days (Quarterly)</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-1.5">
                Note to Client (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Includes weekly deliverables and async Slack support"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-xs text-black focus:outline-hidden focus:ring-1 focus:ring-black"
              />
            </div>

            <div className="p-3.5 rounded-lg bg-neutral-50 border border-black/5 text-xs text-neutral-600 flex items-start gap-2.5">
              <Sparkles size={16} className="text-black shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-black">No developer required:</span>{" "}
                Clients open this URL in any browser, connect Freighter, and approve the payment in seconds.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-black/10">
              <button
                type="button"
                onClick={resetAndClose}
                className="button button-secondary text-xs h-9 px-4"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary text-xs h-9 px-4 flex items-center gap-1.5"
              >
                <span>Generate Link</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </form>
        )}

        {step === 2 && createdLink && (
          <div className="p-6 space-y-5">
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-black">{createdLink.title}</div>
                <div className="font-mono text-xs text-emerald-800 mt-0.5">
                  {createdLink.amount} USDC {createdLink.type === "recurring" ? `/ Every ${createdLink.intervalDays} Days` : "(One-Time)"}
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-600 text-white font-bold">
                LIVE URL
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
                Shareable Checkout URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdLink.url}
                  className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-xs font-mono bg-neutral-50 text-black"
                />
                <button
                  onClick={() => copyUrl(createdLink.url)}
                  className="button button-primary text-xs h-10 px-4 shrink-0 flex items-center gap-1.5"
                >
                  {copied ? (
                    <>
                      <Check size={13} className="text-emerald-400" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-black/10">
              <button
                type="button"
                onClick={resetAndClose}
                className="button button-primary text-xs h-9 px-5"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
