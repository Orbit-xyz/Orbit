"use client";

import { useState } from "react";
import {
  Code2,
  Key,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Webhook,
  Send,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { ApiKeyRecord } from "../dashboard-types";
import { CreateApiKeyModal } from "../modals/create-api-key-modal";
import { DOCS_URL } from "@/lib/links";

const INITIAL_KEYS: ApiKeyRecord[] = [
  {
    id: "key_live_01",
    name: "Production Backend API",
    keyPrefix: "orb_live_...94QA",
    fullKeyPreview: "orb_live_71c2b9a4753f8c8a2d3e7c9f0158b24694QA",
    environment: "live",
    lastUsed: "2 mins ago",
    createdAt: "2026-09-01T10:00:00Z",
  },
  {
    id: "key_test_02",
    name: "Stellar Testnet Sandbox",
    keyPrefix: "orb_test_...3F29",
    fullKeyPreview: "orb_test_9841f3278a948c7e120516d54ea9f0d93F29",
    environment: "test",
    lastUsed: "Yesterday",
    createdAt: "2026-09-10T14:30:00Z",
  },
];

export function DevelopersView() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>(INITIAL_KEYS);
  const [isCreateKeyModalOpen, setIsCreateKeyModalOpen] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Webhook State
  const [webhookUrl, setWebhookUrl] = useState("https://api.yourcompany.com/webhooks/orbit");
  const [isSavedWebhook, setIsSavedWebhook] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [testWebhookResult, setTestWebhookResult] = useState<string | null>(null);
  const [webhookSecret] = useState("whsec_9482f3a7c1b0e4d28e7c9f0158b246");
  const [copiedWebhookSecret, setCopiedWebhookSecret] = useState(false);

  // Code Snippet Tab
  const [codeLanguage, setCodeLanguage] = useState<"curl" | "typescript" | "python">("curl");
  const [copiedCode, setCopiedCode] = useState(false);

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyKey = (fullKey: string, id: string) => {
    navigator.clipboard.writeText(fullKey);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 1800);
  };

  const handleCreateKey = (newKey: ApiKeyRecord) => {
    setKeys((prev) => [newKey, ...prev]);
  };

  const handleRevokeKey = (id: string) => {
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleSaveWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavedWebhook(true);
    setTimeout(() => setIsSavedWebhook(false), 2000);
  };

  const handleTestPing = () => {
    setIsTestingWebhook(true);
    setTestWebhookResult(null);

    setTimeout(() => {
      setIsTestingWebhook(false);
      setTestWebhookResult("200 OK — Test webhook payload successfully delivered in 42ms.");
      setTimeout(() => setTestWebhookResult(null), 5000);
    }, 1000);
  };

  const copySnippet = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const curlSnippet = `curl -X POST https://api.orbit.network/v1/pulls \\
  -H "Authorization: Bearer ${keys[0]?.fullKeyPreview || "orb_live_..."}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "subscription_id": "sub_bob_9421",
    "amount": 29.00,
    "currency": "USDC",
    "idempotency_key": "idem_req_001"
  }'`;

  const tsSnippet = `import { OrbitClient } from "@orbit/sdk";

const orbit = new OrbitClient({
  apiKey: process.env.ORBIT_SECRET_KEY,
});

// Programmatically trigger a usage-based or recurring pull
const pull = await orbit.pulls.create({
  subscriptionId: "sub_bob_9421",
  amount: 29.00,
  currency: "USDC",
  idempotencyKey: "idem_req_001",
});

console.log("Settled on Stellar Soroban:", pull.ledgerHash);`;

  const pythonSnippet = `import os
from orbit import OrbitClient

orbit = OrbitClient(api_key=os.environ.get("ORBIT_SECRET_KEY"))

# Trigger usage-based allowance pull
pull = orbit.pulls.create(
    subscription_id="sub_bob_9421",
    amount=29.00,
    currency="USDC",
    idempotency_key="idem_req_001"
)

print(f"Settled on Stellar: {pull.ledger_hash}")`;

  const activeSnippet =
    codeLanguage === "curl" ? curlSnippet : codeLanguage === "typescript" ? tsSnippet : pythonSnippet;

  return (
    <div className="space-y-8">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-black">
              Developer Portal &amp; API Keys
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black text-white font-bold tracking-wide">
              API
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Manage secret keys, configure event webhooks, and trigger programmatic pull billing.
          </p>
        </div>

        <Link
          href={DOCS_URL}
          className="button button-secondary text-xs h-9 px-3.5 flex items-center gap-1.5 self-start sm:self-auto shrink-0"
        >
          <span>SDK Documentation</span>
          <ExternalLink size={13} />
        </Link>
      </div>

      {/* 2. API Keys Management Section */}
      <div className="rounded-xl border border-black/10 bg-white p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Key size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-black tracking-tight">
                API Secret Keys
              </h3>
              <p className="text-xs text-neutral-500">
                Bearer tokens used to authenticate server-side pull execution and payroll triggers.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsCreateKeyModalOpen(true)}
            className="button button-primary text-xs h-9 px-4 flex items-center gap-1.5 self-start sm:self-auto shrink-0 shadow-xs"
          >
            <Plus size={14} />
            <span>Generate Secret Key</span>
          </button>
        </div>

        {/* Keys Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50/80 border-b border-black/10 text-neutral-500 uppercase tracking-wider font-semibold text-[10px]">
              <tr>
                <th className="py-3 px-4">Key Label</th>
                <th className="py-3 px-4">Secret Key Token</th>
                <th className="py-3 px-4">Environment</th>
                <th className="py-3 px-4">Last Used</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 text-neutral-700">
              {keys.map((k) => {
                const isRevealed = revealedKeys[k.id];
                const displayKey = isRevealed ? k.fullKeyPreview : k.keyPrefix;

                return (
                  <tr key={k.id} className="hover:bg-neutral-50/50 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-black">
                      {k.name}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-black font-medium bg-neutral-100 px-2 py-1 rounded border border-black/5">
                          {displayKey}
                        </span>
                        <button
                          onClick={() => toggleReveal(k.id)}
                          className="p-1 text-neutral-400 hover:text-black transition-colors"
                          title={isRevealed ? "Hide key" : "Reveal key"}
                        >
                          {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button
                          onClick={() => copyKey(k.fullKeyPreview, k.id)}
                          className="p-1 text-neutral-400 hover:text-black transition-colors"
                          title="Copy full key"
                        >
                          {copiedKeyId === k.id ? (
                            <Check size={13} className="text-emerald-600" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      {k.environment === "live" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          LIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                          TESTNET
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-neutral-500 font-mono text-[11px]">
                      {k.lastUsed}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleRevokeKey(k.id)}
                        className="p-1 text-neutral-400 hover:text-red-600 transition-colors"
                        title="Revoke key"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Webhook Dispatcher Section */}
      <div className="rounded-xl border border-black/10 bg-white p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Webhook size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-black tracking-tight">
                Webhook Event Distribution
              </h3>
              <p className="text-xs text-neutral-500">
                Receive cryptographically signed HTTP POST notifications when on-chain pull events settle.
              </p>
            </div>
          </div>

          <button
            onClick={handleTestPing}
            disabled={isTestingWebhook}
            className="button button-secondary text-xs h-9 px-3 flex items-center gap-1.5 self-start sm:self-auto shrink-0"
          >
            {isTestingWebhook ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                <span>Sending Test...</span>
              </>
            ) : (
              <>
                <Send size={12} />
                <span>Test Webhook Ping</span>
              </>
            )}
          </button>
        </div>

        {testWebhookResult && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-center gap-2 animate-in fade-in duration-150">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span className="font-mono">{testWebhookResult}</span>
          </div>
        )}

        <form onSubmit={handleSaveWebhook} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-black uppercase tracking-wider mb-1.5">
                Endpoint URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  required
                  placeholder="https://api.yourcompany.com/webhooks/orbit"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-xs font-mono text-black focus:outline-hidden focus:ring-1 focus:ring-black"
                />
                <button
                  type="submit"
                  className="button button-primary text-xs h-10 px-4 shrink-0"
                >
                  {isSavedWebhook ? "Saved!" : "Save Endpoint"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
                Signing Secret (HMAC-SHA256)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  readOnly
                  value={webhookSecret}
                  className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-xs font-mono bg-neutral-50 text-neutral-600"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookSecret);
                    setCopiedWebhookSecret(true);
                    setTimeout(() => setCopiedWebhookSecret(false), 1800);
                  }}
                  className="button button-secondary text-xs h-10 px-3 shrink-0 flex items-center gap-1"
                  title="Copy secret"
                >
                  {copiedWebhookSecret ? (
                    <Check size={13} className="text-emerald-600" />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
              Subscribed Event Types
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
              {[
                { event: "payment.settled", desc: "USDC pull succeeded" },
                { event: "subscription.created", desc: "Allowance vault signed" },
                { event: "subscription.cancelled", desc: "Vault revoked by user" },
                { event: "payroll.disbursed", desc: "Batch payout executed" },
              ].map((item) => (
                <div
                  key={item.event}
                  className="p-3 rounded-lg border border-black/10 bg-neutral-50/60 flex items-start gap-2.5"
                >
                  <input
                    type="checkbox"
                    defaultChecked
                    id={item.event}
                    className="mt-0.5 rounded border-black/20"
                  />
                  <div>
                    <label
                      htmlFor={item.event}
                      className="font-mono text-xs font-bold text-black block cursor-pointer"
                    >
                      {item.event}
                    </label>
                    <span className="text-[11px] text-neutral-500">
                      {item.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>
      </div>

      {/* 4. Interactive Programmatic Usage API Snippets */}
      <div className="rounded-xl border border-black/10 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Terminal size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-black tracking-tight">
                Programmatic Usage Billing API
              </h3>
              <p className="text-xs text-neutral-500">
                Trigger on-chain USDC pulls on demand (e.g. for AI inference compute or API call volume).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-lg shrink-0">
            {(["curl", "typescript", "python"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setCodeLanguage(lang)}
                className={`text-xs font-mono px-3 py-1 rounded-md transition-colors ${
                  codeLanguage === lang
                    ? "bg-white text-black font-bold shadow-2xs"
                    : "text-neutral-500 hover:text-black"
                }`}
              >
                {lang === "curl" ? "cURL" : lang === "typescript" ? "TypeScript" : "Python"}
              </button>
            ))}
          </div>
        </div>

        <div className="relative rounded-lg bg-[#09090b] text-neutral-200 p-4 font-mono text-xs overflow-x-auto border border-neutral-800">
          <button
            onClick={() => copySnippet(activeSnippet)}
            className="absolute right-3 top-3 button button-secondary text-xs h-7 px-2.5 bg-neutral-800 text-white hover:bg-neutral-700 border-neutral-700 flex items-center gap-1"
          >
            {copiedCode ? (
              <>
                <Check size={11} className="text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copy</span>
              </>
            )}
          </button>
          <pre className="leading-relaxed pr-16">
            <code>{activeSnippet}</code>
          </pre>
        </div>

        <div className="p-3.5 rounded-lg bg-neutral-50 border border-black/5 text-xs text-neutral-600 flex items-start gap-2.5">
          <ShieldCheck size={16} className="text-black shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-black">Idempotency &amp; Nonce Protection:</span>{" "}
            All programmatic pulls accept an <code className="font-mono text-[11px] text-black">idempotency_key</code> to guarantee that automated billing jobs never double-charge a user under network retries.
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateApiKeyModal
        isOpen={isCreateKeyModalOpen}
        onClose={() => setIsCreateKeyModalOpen(false)}
        onCreateKey={handleCreateKey}
      />
    </div>
  );
}
