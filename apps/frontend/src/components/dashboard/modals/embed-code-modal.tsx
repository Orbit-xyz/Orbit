"use client";

import { useState } from "react";
import { X, Check, Copy, Code2, Layers } from "lucide-react";
import { SubscriptionPlan } from "../dashboard-types";

interface EmbedCodeModalProps {
  plan: SubscriptionPlan | null;
  onClose: () => void;
}

export function EmbedCodeModal({ plan, onClose }: EmbedCodeModalProps) {
  const [tab, setTab] = useState<"react" | "html">("react");
  const [copied, setCopied] = useState(false);

  if (!plan) return null;

  const reactSnippet = `import { OrbitCheckout } from "@orbit/checkout";

export default function PricingPage() {
  return (
    <OrbitCheckout
      planId="${plan.id}"
      onSuccess={({ user, vault }) => {
        console.log("Subscribed on Stellar Soroban:", vault);
      }}
    />
  );
}`;

  const htmlSnippet = `<!-- 1. Include Orbit SDK -->
<script src="https://unpkg.com/@orbit/checkout/dist/orbit.min.js"></script>

<!-- 2. Drop-in Checkout Button -->
<button onclick="Orbit.checkout({ planId: '${plan.id}' })">
  Subscribe for ${plan.amount} USDC / ${plan.intervalDays} Days
</button>`;

  const activeSnippet = tab === "react" ? reactSnippet : htmlSnippet;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-xl bg-white border border-black/10 shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-black/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Code2 size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-black tracking-tight">
                Embed Checkout Widget
              </h3>
              <p className="text-xs text-neutral-500">
                Plan: <span className="font-semibold text-black">{plan.name}</span> ({plan.amount} USDC / {plan.intervalDays} Days)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setTab("react")}
                className={`text-xs font-mono px-3 py-1 rounded-md transition-colors ${
                  tab === "react"
                    ? "bg-white text-black font-bold shadow-2xs"
                    : "text-neutral-500 hover:text-black"
                }`}
              >
                React / Next.js
              </button>
              <button
                type="button"
                onClick={() => setTab("html")}
                className={`text-xs font-mono px-3 py-1 rounded-md transition-colors ${
                  tab === "html"
                    ? "bg-white text-black font-bold shadow-2xs"
                    : "text-neutral-500 hover:text-black"
                }`}
              >
                HTML / Vanilla JS
              </button>
            </div>

            <button
              onClick={handleCopy}
              className="button button-secondary text-xs h-7 px-3 flex items-center gap-1"
            >
              {copied ? (
                <>
                  <Check size={12} className="text-emerald-600" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy Snippet</span>
                </>
              )}
            </button>
          </div>

          <div className="rounded-lg bg-[#09090b] text-neutral-200 p-4 font-mono text-xs overflow-x-auto border border-neutral-800">
            <pre className="leading-relaxed">
              <code>{activeSnippet}</code>
            </pre>
          </div>

          <div className="p-3 rounded-lg bg-neutral-50 border border-black/5 text-xs text-neutral-600">
            When your customer clicks this button, the Orbit modal opens, connects their Freighter wallet on Stellar Soroban, and signs the recurring USDC allowance.
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="button button-primary text-xs h-9 px-4"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
