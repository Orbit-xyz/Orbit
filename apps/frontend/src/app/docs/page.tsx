"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Code2,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  Zap,
  Layers,
  Webhook,
  Key,
  Server,
  ChevronRight,
  FileCode,
  Package,
  Search,
} from "lucide-react";
import { Brand } from "@/components/layout/brand";

type DocSection =
  | "quickstart"
  | "contracts"
  | "widget"
  | "api-plans"
  | "api-pulls"
  | "api-payroll"
  | "webhooks"
  | "errors";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<DocSection>("quickstart");
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [apiLang, setApiLang] = useState<"curl" | "typescript" | "python">("typescript");
  const [searchQuery, setSearchQuery] = useState("");

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const navGroups = [
    {
      title: "Getting Started",
      items: [
        { id: "quickstart" as DocSection, label: "Protocol Overview", icon: Zap },
        { id: "contracts" as DocSection, label: "Soroban Smart Contracts", icon: ShieldCheck },
      ],
    },
    {
      title: "Client Integration",
      items: [
        { id: "widget" as DocSection, label: "Checkout Widget SDK", icon: Package },
      ],
    },
    {
      title: "Merchant API Reference",
      items: [
        { id: "api-plans" as DocSection, label: "Subscription Plans API", icon: Layers },
        { id: "api-pulls" as DocSection, label: "Allowance Pulls API", icon: Key },
        { id: "api-payroll" as DocSection, label: "Batch Payroll Engine", icon: Server },
      ],
    },
    {
      title: "Events & Reliability",
      items: [
        { id: "webhooks" as DocSection, label: "Webhooks & Signatures", icon: Webhook },
        { id: "errors" as DocSection, label: "Error Codes & Retries", icon: FileCode },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#fafafb] flex flex-col text-[#09090b]">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 h-16 border-b border-black/10 bg-white/95 backdrop-blur-md px-6 sm:px-12 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Brand variant="black" />
          <div className="h-4 w-px bg-black/10 hidden sm:block"></div>
          <span className="text-xs font-mono text-neutral-500 uppercase tracking-wider hidden sm:inline-block">
            Developer Documentation
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="button button-primary text-xs h-8 px-3.5 flex items-center gap-1.5"
          >
            <span>Dashboard</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </header>

      {/* Main Documentation Shell */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Sidebar Nav */}
        <aside className="w-64 border-r border-black/10 bg-white p-6 hidden md:block shrink-0 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
          {/* Quick Search */}
          <div className="relative mb-6">
            <Search className="absolute left-2.5 top-2.5 text-neutral-400" size={13} />
            <input
              type="text"
              placeholder="Search docs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-black/10 bg-neutral-50 text-xs text-black placeholder:text-neutral-400 focus:outline-hidden focus:ring-1 focus:ring-black"
            />
          </div>

          <div className="space-y-6">
            {navGroups.map((group, gIdx) => {
              const filteredItems = group.items.filter((item) =>
                item.label.toLowerCase().includes(searchQuery.toLowerCase())
              );
              if (filteredItems.length === 0) return null;

              return (
                <div key={gIdx} className="space-y-1.5">
                  <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider px-2">
                    {group.title}
                  </div>
                  <nav className="space-y-0.5">
                    {filteredItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeSection === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors ${
                            isActive
                              ? "bg-black text-white font-semibold"
                              : "text-neutral-600 hover:text-black hover:bg-neutral-100"
                          }`}
                        >
                          <Icon size={14} />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </nav>
                </div>
              );
            })}
          </div>

          {/* Sidebar Footer Info */}
          <div className="mt-8 pt-6 border-t border-black/10">
            <div className="p-3 rounded-lg bg-neutral-50 border border-black/5 text-[11px] space-y-1">
              <div className="font-bold text-black flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Stellar Soroban Testnet</span>
              </div>
              <div className="font-mono text-neutral-500 truncate text-[10px]" title="CAZBZBUWBSQYK2RZ6WHMXVDLIQHSU5WD7ANZYL6HLNSCRUOTNYCDYQNG">
                CAZBZB...YQNG
              </div>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 p-6 md:p-12 max-w-4xl min-w-0 overflow-y-auto">
          {/* SECTION 1: QUICKSTART */}
          {activeSection === "quickstart" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <Zap size={12} className="text-black" />
                  <span>Introduction</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Protocol Overview &amp; Architecture
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Orbit is a non-custodial pull payments and batch payroll protocol built natively on
                  <strong> Stellar Soroban</strong>. It gives Web3 merchants the same frictionless, automated
                  recurring billing capabilities as Stripe, while preserving user self-custody.
                </p>
              </div>

              {/* Architecture Triad */}
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-black/10 bg-white shadow-2xs space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs">
                    01
                  </div>
                  <h3 className="font-bold text-black text-sm">One-Time Handshake</h3>
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    Customer approves an Allowance Vault on Soroban using Freighter. They set maximum spending caps and billing intervals.
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-black/10 bg-white shadow-2xs space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs">
                    02
                  </div>
                  <h3 className="font-bold text-black text-sm">Automated Pulls</h3>
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    Merchant triggers payment collection programmatically via API or dashboard button. Soroban strictly validates allowance constraints.
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-black/10 bg-white shadow-2xs space-y-2">
                  <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs">
                    03
                  </div>
                  <h3 className="font-bold text-black text-sm">Atomic Batch Splits</h3>
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    Merchants distribute payroll, team payouts, or revenue splits across dozens of wallets in a single ledger block with sub-cent network fees.
                  </p>
                </div>
              </div>

              {/* Core Features Alert */}
              <div className="p-4 rounded-xl bg-neutral-50 border border-black/10 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-black">
                  <ShieldCheck size={16} className="text-emerald-700" />
                  <span>The Orbit Trust Model</span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  Unlike traditional recurring subscriptions that require locking tokens in escrow or trusting centralized custodians,
                  Orbit users retain <strong>100% custody</strong> of their tokens at all times. If a user withdraws their USDC, the merchant cannot pull. If a user cancels their vault, authorization revokes instantly on-chain.
                </p>
              </div>

              {/* Quick Code Sample */}
              <div>
                <h3 className="text-base font-bold text-black mb-2">Initialize Orbit in 3 Lines</h3>
                <div className="rounded-xl border border-black/10 bg-[#09090b] text-white p-4 font-mono text-xs overflow-x-auto relative">
                  <button
                    onClick={() =>
                      copyCode(
                        `import { OrbitClient } from '@orbit/sdk';\n\nconst orbit = new OrbitClient({ apiKey: process.env.ORBIT_API_KEY });\nconst pull = await orbit.pulls.execute({ subscriberId: 'sub_8914' });`,
                        "quickstart_code"
                      )
                    }
                    className="absolute right-3 top-3 p-1.5 rounded bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors"
                  >
                    {copiedCodeId === "quickstart_code" ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  </button>
                  <pre className="text-neutral-300">
                    <span className="text-purple-400">import</span> &#123; OrbitClient &#125; <span className="text-purple-400">from</span> <span className="text-emerald-300">&apos;@orbit/sdk&apos;</span>;{"\n\n"}
                    <span className="text-blue-400">const</span> orbit = <span className="text-purple-400">new</span> <span className="text-yellow-300">OrbitClient</span>(&#123; apiKey: process.env.ORBIT_API_KEY &#125;);{"\n"}
                    <span className="text-blue-400">const</span> pull = <span className="text-purple-400">await</span> orbit.pulls.<span className="text-yellow-300">execute</span>(&#123; subscriberId: <span className="text-emerald-300">&apos;sub_8914&apos;</span> &#125;);
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: SMART CONTRACTS */}
          {activeSection === "contracts" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <ShieldCheck size={12} className="text-black" />
                  <span>On-Chain Verification</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Soroban Smart Contracts
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Orbit’s on-chain settlement logic is authored in Rust and compiled to WebAssembly (WASM) for Stellar Soroban.
                </p>
              </div>

              {/* Deployment Details Table */}
              <div className="rounded-xl border border-black/10 bg-white overflow-hidden shadow-xs">
                <div className="p-4 bg-neutral-50 border-b border-black/10 font-bold text-xs text-black">
                  Stellar Testnet Deployment
                </div>
                <div className="divide-y divide-black/5 text-xs">
                  <div className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                    <span className="text-neutral-500">Contract ID:</span>
                    <span className="font-mono font-bold text-black break-all">
                      CAZBZBUWBSQYK2RZ6WHMXVDLIQHSU5WD7ANZYL6HLNSCRUOTNYCDYQNG
                    </span>
                  </div>
                  <div className="p-4 flex justify-between items-center">
                    <span className="text-neutral-500">Asset Supported:</span>
                    <span className="font-mono font-semibold text-black">Native Testnet USDC</span>
                  </div>
                  <div className="p-4 flex justify-between items-center">
                    <span className="text-neutral-500">Network Passphrase:</span>
                    <span className="font-mono text-neutral-700">Test SDF Network ; September 2015</span>
                  </div>
                  <div className="p-4 flex justify-between items-center">
                    <span className="text-neutral-500">Soroban RPC URL:</span>
                    <span className="font-mono text-neutral-700">https://soroban-testnet.stellar.org</span>
                  </div>
                </div>
              </div>

              {/* Rust Methods */}
              <div className="space-y-4">
                <h3 className="text-base font-bold text-black">Core Contract Invocations</h3>
                
                <div className="space-y-3">
                  <div className="p-4 rounded-xl border border-black/10 bg-white space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-neutral-100 px-2 py-0.5 rounded text-black">
                        create_vault(env, merchant, plan_id, max_amount, interval_seconds)
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600">
                      Executed by customer via Freighter wallet to authorize periodic pull access. Writes state to Soroban ledger storage with strict timestamp validation.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-black/10 bg-white space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-neutral-100 px-2 py-0.5 rounded text-black">
                        pull_payment(env, vault_id)
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600">
                      Executed by the merchant or keeper. Verifies that <code className="font-mono text-black">current_time &gt;= last_pull + interval</code> and amount is within authorized cap before transferring USDC directly to the merchant’s non-custodial treasury.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-black/10 bg-white space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold bg-neutral-100 px-2 py-0.5 rounded text-black">
                        batch_disburse(env, disbursements: Vec&lt;Disbursement&gt;)
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600">
                      Executes atomic payroll splits across up to 100 recipient wallets in a single ledger block. If any recipient transfer fails, the entire transaction reverts atomically.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: CHECKOUT WIDGET SDK */}
          {activeSection === "widget" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <Package size={12} className="text-black" />
                  <span>Frontend Integration</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Checkout Widget SDK
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  The official <code className="font-mono text-black">@orbit/checkout-widget</code> provides a plug-and-play React modal for customer Freighter wallet authorization.
                </p>
              </div>

              {/* Install Code */}
              <div>
                <h3 className="text-sm font-bold text-black mb-2">1. Installation</h3>
                <div className="rounded-xl border border-black/10 bg-[#09090b] text-white p-3.5 font-mono text-xs flex items-center justify-between">
                  <code className="text-neutral-300">npm install @orbit/checkout-widget @stellar/freighter-api</code>
                  <button
                    onClick={() => copyCode("npm install @orbit/checkout-widget @stellar/freighter-api", "install_code")}
                    className="p-1 rounded bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white"
                  >
                    {copiedCodeId === "install_code" ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* Usage Code */}
              <div>
                <h3 className="text-sm font-bold text-black mb-2">2. Embedding the Component</h3>
                <div className="rounded-xl border border-black/10 bg-[#09090b] text-white p-4 font-mono text-xs overflow-x-auto relative">
                  <button
                    onClick={() =>
                      copyCode(
                        `import { OrbitCheckout } from '@orbit/checkout-widget';\n\nexport function SubscriptionModal() {\n  return (\n    <OrbitCheckout\n      planId="plan_monthly_pro"\n      onSuccess={(receipt) => {\n        console.log("Vault Authorized:", receipt.vaultId);\n      }}\n      onError={(err) => {\n        console.error("Authorization Failed:", err);\n      }}\n    />\n  );\n}`,
                        "widget_react_code"
                      )
                    }
                    className="absolute right-3 top-3 p-1.5 rounded bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white"
                  >
                    {copiedCodeId === "widget_react_code" ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  </button>
                  <pre className="text-neutral-300">
                    <span className="text-purple-400">import</span> &#123; OrbitCheckout &#125; <span className="text-purple-400">from</span> <span className="text-emerald-300">&apos;@orbit/checkout-widget&apos;</span>;{"\n\n"}
                    <span className="text-blue-400">export function</span> <span className="text-yellow-300">SubscriptionModal</span>() &#123;{"\n"}
                    {"  "}<span className="text-purple-400">return</span> ({"\n"}
                    {"    "}&lt;<span className="text-blue-400">OrbitCheckout</span>{"\n"}
                    {"      "}planId=<span className="text-emerald-300">&quot;plan_monthly_pro&quot;</span>{"\n"}
                    {"      "}onSuccess=&#123;(receipt) =&gt; &#123;{"\n"}
                    {"        "}console.<span className="text-yellow-300">log</span>(<span className="text-emerald-300">&quot;Vault Authorized:&quot;</span>, receipt.vaultId);{"\n"}
                    {"      "}&#125;&#125;{"\n"}
                    {"      "}onError=&#123;(err) =&gt; &#123;{"\n"}
                    {"        "}console.<span className="text-yellow-300">error</span>(<span className="text-emerald-300">&quot;Authorization Failed:&quot;</span>, err);{"\n"}
                    {"      "}&#125;&#125;{"\n"}
                    {"    "}/&gt;{"\n"}
                    {"  "});{"\n"}
                    &#125;
                  </pre>
                </div>
              </div>

              {/* Props Table */}
              <div>
                <h3 className="text-sm font-bold text-black mb-2">Component Props Reference</h3>
                <div className="rounded-xl border border-black/10 bg-white overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 border-b border-black/10 text-neutral-500 font-semibold text-[10px] uppercase">
                      <tr>
                        <th className="py-2.5 px-4">Prop</th>
                        <th className="py-2.5 px-4">Type</th>
                        <th className="py-2.5 px-4">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 text-neutral-700">
                      <tr>
                        <td className="py-3 px-4 font-mono font-bold text-black">planId</td>
                        <td className="py-3 px-4 font-mono text-purple-600">string</td>
                        <td className="py-3 px-4">The plan ID created in your Orbit Merchant Dashboard.</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono font-bold text-black">onSuccess</td>
                        <td className="py-3 px-4 font-mono text-purple-600">(receipt) =&gt; void</td>
                        <td className="py-3 px-4">Callback triggered upon on-chain Soroban confirmation.</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono font-bold text-black">onError</td>
                        <td className="py-3 px-4 font-mono text-purple-600">(error) =&gt; void</td>
                        <td className="py-3 px-4">Callback triggered if Freighter rejects or transaction fails.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: API PLANS */}
          {activeSection === "api-plans" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <Layers size={12} className="text-black" />
                  <span>REST API</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Subscription Plans API
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Programmatically create and manage subscription tiers and billing cadences.
                </p>
              </div>

              {/* Endpoint Card */}
              <div className="p-4 rounded-xl border border-black/10 bg-white space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                    POST
                  </span>
                  <span className="font-mono text-xs font-bold text-black">
                    https://api.orbitpay.network/v1/plans
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  Creates a new recurring subscription plan and generates a hosted checkout slug.
                </p>
              </div>

              {/* Request & Response */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-black uppercase tracking-wider">
                    Request Payload
                  </span>
                  <div className="flex gap-1 bg-neutral-100 p-0.5 rounded">
                    {(["typescript", "python", "curl"] as const).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setApiLang(lang)}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono capitalize ${
                          apiLang === lang ? "bg-white text-black font-bold shadow-2xs" : "text-neutral-500"
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-black/10 bg-[#09090b] text-white p-4 font-mono text-xs overflow-x-auto">
                  {apiLang === "typescript" && (
                    <pre className="text-neutral-300">
                      <span className="text-blue-400">const</span> response = <span className="text-purple-400">await</span> fetch(<span className="text-emerald-300">&quot;https://api.orbitpay.network/v1/plans&quot;</span>, &#123;{"\n"}
                      {"  "}method: <span className="text-emerald-300">&quot;POST&quot;</span>,{"\n"}
                      {"  "}headers: &#123;{"\n"}
                      {"    "}<span className="text-emerald-300">&quot;Authorization&quot;</span>: <span className="text-emerald-300">&quot;Bearer orb_live_...&quot;</span>,{"\n"}
                      {"    "}<span className="text-emerald-300">&quot;Content-Type&quot;</span>: <span className="text-emerald-300">&quot;application/json&quot;</span>,{"\n"}
                      {"  "}&#125;,{"\n"}
                      {"  "}body: JSON.stringify(&#123;{"\n"}
                      {"    "}name: <span className="text-emerald-300">&quot;Pro Developer Plan&quot;</span>,{"\n"}
                      {"    "}amount: 49.00,{"\n"}
                      {"    "}currency: <span className="text-emerald-300">&quot;USDC&quot;</span>,{"\n"}
                      {"    "}interval_days: 30,{"\n"}
                      {"  "}&#125;),{"\n"}
                      &#125;);
                    </pre>
                  )}
                  {apiLang === "curl" && (
                    <pre className="text-neutral-300">
                      curl -X POST https://api.orbitpay.network/v1/plans \{"\n"}
                      {"  "}-H &quot;Authorization: Bearer orb_live_...&quot; \{"\n"}
                      {"  "}-H &quot;Content-Type: application/json&quot; \{"\n"}
                      {"  "}-d &apos;&#123;&quot;name&quot;: &quot;Pro Developer Plan&quot;, &quot;amount&quot;: 49.0, &quot;interval_days&quot;: 30&#125;&apos;
                    </pre>
                  )}
                  {apiLang === "python" && (
                    <pre className="text-neutral-300">
                      import requests{"\n\n"}
                      res = requests.post({"\""}https://api.orbitpay.network/v1/plans{"\""}, json=&#123;{"\n"}
                      {"    "}{"\""}name{"\""}: {"\""}Pro Developer Plan{"\""},{"\n"}
                      {"    "}{"\""}amount{"\""}: 49.00,{"\n"}
                      {"    "}{"\""}interval_days{"\""}: 30,{"\n"}
                      &#125;, headers=&#123;{"\""}Authorization{"\""}: {"\""}Bearer orb_live_...{"\""}&#125;)
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 5: API PULLS */}
          {activeSection === "api-pulls" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <Key size={12} className="text-black" />
                  <span>Allowance Execution</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Allowance Pulls API
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Trigger automated pulls from authorized subscriber vaults or inspect real-time vault balances.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-black/10 bg-white space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-extrabold bg-black text-white px-2 py-0.5 rounded">
                    POST
                  </span>
                  <span className="font-mono text-xs font-bold text-black">
                    https://api.orbitpay.network/v1/pulls/execute
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  Submits a <code className="font-mono text-black">pull_payment</code> transaction directly to Stellar Soroban on behalf of your merchant settlement vault.
                </p>
              </div>

              <div>
                <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-2">
                  Payload &amp; Response Example
                </h3>
                <div className="rounded-xl border border-black/10 bg-[#09090b] text-white p-4 font-mono text-xs overflow-x-auto">
                  <pre className="text-neutral-300">
                    <span className="text-neutral-500">// Response: 200 OK</span>{"\n"}
                    &#123;{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;status&quot;</span>: <span className="text-emerald-300">&quot;settled&quot;</span>,{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;vault_id&quot;</span>: <span className="text-emerald-300">&quot;vlt_8941_stellar&quot;</span>,{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;amount&quot;</span>: 49.00,{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;currency&quot;</span>: <span className="text-emerald-300">&quot;USDC&quot;</span>,{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;stellar_tx_hash&quot;</span>: <span className="text-emerald-300">&quot;6f4a8b...19e0&quot;</span>,{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;next_pull_eligible&quot;</span>: <span className="text-emerald-300">&quot;2026-10-18T16:00:00Z&quot;</span>{"\n"}
                    &#125;
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 6: BATCH PAYROLL API */}
          {activeSection === "api-payroll" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <Server size={12} className="text-black" />
                  <span>Batch Engine</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Batch Payroll API
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Send programmatic bulk payouts to contributors, contractors, or affiliate partners in a single atomic transaction.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-black/10 bg-white space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                    POST
                  </span>
                  <span className="font-mono text-xs font-bold text-black">
                    https://api.orbitpay.network/v1/payroll/batch
                  </span>
                </div>
                <p className="text-xs text-neutral-600">
                  Disburses USDC from your treasury to an array of recipient wallets atomically.
                </p>
              </div>

              <div>
                <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-2">
                  Batch JSON Payload
                </h3>
                <div className="rounded-xl border border-black/10 bg-[#09090b] text-white p-4 font-mono text-xs overflow-x-auto">
                  <pre className="text-neutral-300">
                    &#123;{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;title&quot;</span>: <span className="text-emerald-300">&quot;September Core Team Payroll&quot;</span>,{"\n"}
                    {"  "}<span className="text-emerald-300">&quot;disbursements&quot;</span>: [ {"\n"}
                    {"    "}&#123; <span className="text-emerald-300">&quot;recipient&quot;</span>: <span className="text-emerald-300">&quot;GBXQ...A8S&quot;</span>, <span className="text-emerald-300">&quot;amount&quot;</span>: 4200.00 &#125;,{"\n"}
                    {"    "}&#123; <span className="text-emerald-300">&quot;recipient&quot;</span>: <span className="text-emerald-300">&quot;GDQP...4N2&quot;</span>, <span className="text-emerald-300">&quot;amount&quot;</span>: 3500.00 &#125;,{"\n"}
                    {"    "}&#123; <span className="text-emerald-300">&quot;recipient&quot;</span>: <span className="text-emerald-300">&quot;GA4B...78K&quot;</span>, <span className="text-emerald-300">&quot;amount&quot;</span>: 1800.00 &#125;{"\n"}
                    {"  "}]{"\n"}
                    &#125;
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 7: WEBHOOKS */}
          {activeSection === "webhooks" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <Webhook size={12} className="text-black" />
                  <span>Real-Time Notifications</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Webhooks &amp; HMAC Signatures
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Listen for on-chain events on your backend server and verify payload integrity with SHA-256 HMAC signatures.
                </p>
              </div>

              {/* Supported Events Table */}
              <div>
                <h3 className="text-base font-bold text-black mb-3">Supported Webhook Events</h3>
                <div className="rounded-xl border border-black/10 bg-white overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 border-b border-black/10 text-neutral-500 font-semibold text-[10px] uppercase">
                      <tr>
                        <th className="py-2.5 px-4">Event Type</th>
                        <th className="py-2.5 px-4">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 text-neutral-700">
                      <tr>
                        <td className="py-3 px-4 font-mono font-bold text-black">subscription.created</td>
                        <td className="py-3 px-4">Triggered when a customer authorizes an allowance vault via checkout.</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono font-bold text-black">pull.settled</td>
                        <td className="py-3 px-4">Triggered when a recurring USDC pull confirms on the Soroban ledger.</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono font-bold text-black">pull.failed</td>
                        <td className="py-3 px-4">Triggered if customer wallet has insufficient balance at pull time.</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-mono font-bold text-black">payroll.disbursed</td>
                        <td className="py-3 px-4">Triggered when a batch disbursement completes successfully.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Signature Verification Snippet */}
              <div>
                <h3 className="text-base font-bold text-black mb-2">HMAC Signature Verification</h3>
                <p className="text-xs text-neutral-500 mb-3">
                  Orbit signs all webhook payloads with your webhook secret in the <code className="font-mono text-black">X-Orbit-Signature</code> header.
                </p>
                <div className="rounded-xl border border-black/10 bg-[#09090b] text-white p-4 font-mono text-xs overflow-x-auto">
                  <pre className="text-neutral-300">
                    <span className="text-purple-400">import</span> crypto <span className="text-purple-400">from</span> <span className="text-emerald-300">&apos;crypto&apos;</span>;{"\n\n"}
                    <span className="text-blue-400">function</span> <span className="text-yellow-300">verifyWebhook</span>(rawBody, signatureHeader, secret) &#123;{"\n"}
                    {"  "}<span className="text-blue-400">const</span> expected = crypto{"\n"}
                    {"    "}.<span className="text-yellow-300">createHmac</span>(<span className="text-emerald-300">&apos;sha256&apos;</span>, secret){"\n"}
                    {"    "}.<span className="text-yellow-300">update</span>(rawBody){"\n"}
                    {"    "}.<span className="text-yellow-300">digest</span>(<span className="text-emerald-300">&apos;hex&apos;</span>);{"\n"}
                    {"  "}<span className="text-purple-400">return</span> crypto.<span className="text-yellow-300">timingSafeEqual</span>(Buffer.<span className="text-yellow-300">from</span>(signatureHeader), Buffer.<span className="text-yellow-300">from</span>(expected));{"\n"}
                    &#125;
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 8: ERROR CODES */}
          {activeSection === "errors" && (
            <div className="space-y-8 animate-in fade-in duration-150">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-500 bg-black/5 px-2.5 py-1 rounded-full border border-black/5 mb-3">
                  <FileCode size={12} className="text-black" />
                  <span>Troubleshooting</span>
                </div>
                <h1 className="text-3xl font-extrabold text-black tracking-tight">
                  Error Codes &amp; Safe Retries
                </h1>
                <p className="text-sm text-neutral-600 mt-2 leading-relaxed">
                  Reference of API status codes and Soroban contract revert explanations.
                </p>
              </div>

              <div className="rounded-xl border border-black/10 bg-white overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 border-b border-black/10 text-neutral-500 font-semibold text-[10px] uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Code</th>
                      <th className="py-2.5 px-4">Reason</th>
                      <th className="py-2.5 px-4">Recommended Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 text-neutral-700">
                    <tr>
                      <td className="py-3 px-4 font-mono font-bold text-red-600">INSUFFICIENT_BALANCE</td>
                      <td className="py-3 px-4">Customer wallet does not contain sufficient USDC to satisfy pull cap.</td>
                      <td className="py-3 px-4">Notify subscriber via email; Orbit auto-retries in 48 hours.</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4 font-mono font-bold text-amber-600">PULL_INTERVAL_PREMATURE</td>
                      <td className="py-3 px-4">Attempted pull before scheduled interval elapsed.</td>
                      <td className="py-3 px-4">Wait until timestamp &gt;= next_pull_eligible.</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4 font-mono font-bold text-neutral-800">VAULT_REVOKED</td>
                      <td className="py-3 px-4">Subscriber revoked allowance on-chain.</td>
                      <td className="py-3 px-4">Mark subscription as canceled in merchant database.</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4 font-mono font-bold text-neutral-800">INVALID_API_KEY</td>
                      <td className="py-3 px-4">Provided API key does not exist or has been revoked.</td>
                      <td className="py-3 px-4">Generate a fresh API key in Developer Portal.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="py-6 border-t border-black/10 bg-white text-center text-xs text-neutral-400">
        <div className="flex items-center justify-center gap-2">
          <span>Orbit Protocol Documentation</span>
          <span>•</span>
          <span>Stellar Soroban Testnet</span>
          <span>•</span>
          <Link href="/dashboard" className="text-black font-semibold hover:underline">
            Go to Merchant Dashboard
          </Link>
        </div>
      </footer>
    </div>
  );
}
