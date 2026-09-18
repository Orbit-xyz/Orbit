"use client";

import { useState } from "react";
import {
  Wallet,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  TrendingUp,
  Clock,
  Layers,
  Send,
  Users,
  ExternalLink,
} from "lucide-react";
import { MerchantUser } from "@/lib/auth-context";
import { DashboardTab, NetworkId, NETWORKS } from "../dashboard-types";

interface OverviewViewProps {
  user: MerchantUser;
  activeNetwork: NetworkId;
  onNavigateTab: (tab: DashboardTab) => void;
  onOpenVaultModal: () => void;
}

export function OverviewView({
  user,
  activeNetwork,
  onNavigateTab,
  onOpenVaultModal,
}: OverviewViewProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"7D" | "30D" | "ALL">("30D");

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const stellarVault = user.linkedVaults?.stellar || (user.walletAddress?.startsWith("G") ? user.walletAddress : "GB3XQ...94QA");
  const arcVault = user.linkedVaults?.arc || (user.walletAddress?.startsWith("0x") ? user.walletAddress : "0x71C2...3F29");

  // Mock settled revenue curve data points
  const revenuePoints = [
    { label: "Day 1", amount: 450, x: 20, y: 130 },
    { label: "Day 5", amount: 920, x: 80, y: 110 },
    { label: "Day 10", amount: 1480, x: 140, y: 95 },
    { label: "Day 15", amount: 2150, x: 200, y: 80 },
    { label: "Day 20", amount: 3200, x: 260, y: 55 },
    { label: "Day 25", amount: 4100, x: 320, y: 38 },
    { label: "Day 30", amount: 4820, x: 380, y: 20 },
  ];

  const [hoveredPoint, setHoveredPoint] = useState<(typeof revenuePoints)[0] | null>(null);

  return (
    <div className="space-y-8">
      {/* 1. Treasury Settlement Vault Card */}
      <div className="rounded-xl border border-black/10 bg-white p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Wallet size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-black tracking-tight">
                Settlement Treasury Vault (USDC)
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                On-chain destination account where recurring USDC pulls and subscription revenue settle automatically.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenVaultModal}
            className="button button-secondary text-xs h-9 px-3 shrink-0 self-start md:self-auto"
          >
            Manage Vault
          </button>
        </div>

        <div className="mt-5 p-4 rounded-lg border border-black/10 bg-neutral-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></div>
            <div>
              <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                Active Settlement Address
              </div>
              <div className="font-mono text-xs font-semibold text-black mt-0.5 break-all sm:break-normal">
                {user.walletAddress || arcVault || stellarVault}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
              NON-CUSTODIAL · ACTIVE
            </span>
            <button
              onClick={() => copyToClipboard(user.walletAddress || arcVault || stellarVault, "vault")}
              className="p-1.5 rounded hover:bg-black/5 text-neutral-500 hover:text-black transition-colors"
              title="Copy address"
            >
              {copiedKey === "vault" ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Core KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Monthly Recurring Revenue */}
        <div className="p-5 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Monthly Recurring (MRR)
            </span>
            <span className="text-[11px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
              <TrendingUp size={11} /> +14.2%
            </span>
          </div>
          <div className="text-3xl font-bold text-black mt-2 tracking-tight">
            4,820.00 <span className="text-sm font-semibold text-neutral-500 font-mono">USDC</span>
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            Across 148 active customer allowance vaults
          </div>
        </div>

        {/* Active Subscribers */}
        <div className="p-5 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Active Subscribers
            </span>
            <span className="text-[11px] font-mono text-neutral-500">
              100% on-chain
            </span>
          </div>
          <div className="text-3xl font-bold text-black mt-2 tracking-tight">
            148
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            0 chargebacks · 0 payment processor holds
          </div>
        </div>

        {/* Batch Payroll Disbursed */}
        <div className="p-5 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Batch Payroll Volume
            </span>
            <span className="text-[11px] font-mono text-neutral-500">
              1-click payouts
            </span>
          </div>
          <div className="text-3xl font-bold text-black mt-2 tracking-tight">
            18,450.00 <span className="text-sm font-semibold text-neutral-500 font-mono">USDC</span>
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            Disbursed across 42 global contractor wallets
          </div>
        </div>

        {/* Protocol Settlement */}
        <div className="p-5 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              Protocol Settlement
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
          <div className="text-3xl font-bold text-emerald-600 mt-2 tracking-tight">
            &lt; 1.5s
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            Sub-cent non-custodial pull finality
          </div>
        </div>
      </div>

      {/* 3. Settled Revenue Volume Chart & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settled Revenue Chart (2 cols) */}
        <div className="lg:col-span-2 p-6 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-black/5">
            <div>
              <h3 className="text-base font-semibold text-black tracking-tight">
                Settled Revenue Volume (USDC)
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Verified pull settlement volume across billing cycles.
              </p>
            </div>
            <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-lg">
              {(["7D", "30D", "ALL"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeframe(t)}
                  className={`text-xs font-mono px-2.5 py-1 rounded-md transition-colors ${
                    timeframe === t
                      ? "bg-white text-black font-bold shadow-2xs"
                      : "text-neutral-500 hover:text-black"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive SVG Chart */}
          <div className="relative pt-6">
            <div className="h-44 w-full flex items-end">
              <svg
                viewBox="0 0 400 150"
                className="w-full h-full overflow-visible"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="orbitRevGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#09090b" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#09090b" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid lines */}
                <line x1="0" y1="30" x2="400" y2="30" stroke="#f0f0f2" strokeDasharray="3 3" />
                <line x1="0" y1="80" x2="400" y2="80" stroke="#f0f0f2" strokeDasharray="3 3" />
                <line x1="0" y1="130" x2="400" y2="130" stroke="#f0f0f2" />

                {/* Shaded Area */}
                <path
                  d="M 20 130 L 80 110 L 140 95 L 200 80 L 260 55 L 320 38 L 380 20 L 380 145 L 20 145 Z"
                  fill="url(#orbitRevGradient)"
                />

                {/* Line Path */}
                <path
                  d="M 20 130 L 80 110 L 140 95 L 200 80 L 260 55 L 320 38 L 380 20"
                  fill="none"
                  stroke="#09090b"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Interactive Points */}
                {revenuePoints.map((pt, idx) => (
                  <circle
                    key={idx}
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredPoint === pt ? 5 : 3.5}
                    fill="#ffffff"
                    stroke="#09090b"
                    strokeWidth={hoveredPoint === pt ? "2.5" : "2"}
                    className="cursor-pointer transition-all"
                    onMouseEnter={() => setHoveredPoint(pt)}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                ))}
              </svg>
            </div>

            {/* Hover Tooltip */}
            {hoveredPoint && (
              <div
                className="absolute top-2 left-1/2 -translate-x-1/2 bg-black text-white text-xs px-3 py-1.5 rounded-lg shadow-md font-mono"
              >
                {hoveredPoint.label}: <span className="font-bold text-emerald-400">{hoveredPoint.amount} USDC</span>
              </div>
            )}

            {/* Bottom X-Axis labels */}
            <div className="flex justify-between text-[11px] font-mono text-neutral-400 pt-3 border-t border-black/5">
              <span>Day 1</span>
              <span>Day 10</span>
              <span>Day 20</span>
              <span>Day 30</span>
            </div>
          </div>
        </div>

        {/* Quick Launch & Actions (1 col) */}
        <div className="p-6 rounded-xl bg-white border border-black/10 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-base font-semibold text-black tracking-tight">
              Quick Operations
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Deploy new revenue flows or trigger automated disbursements.
            </p>

            <div className="space-y-3 mt-5">
              <button
                onClick={() => onNavigateTab("plans")}
                className="w-full text-left p-3.5 rounded-lg border border-black/10 hover:border-black/30 hover:bg-neutral-50 transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-black/5 flex items-center justify-center text-black">
                    <Layers size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-black group-hover:text-black">
                      Create Subscription Plan
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Generate checkout widget snippet
                    </div>
                  </div>
                </div>
                <ArrowUpRight size={14} className="text-neutral-400 group-hover:text-black transition-colors" />
              </button>

              <button
                onClick={() => onNavigateTab("payroll")}
                className="w-full text-left p-3.5 rounded-lg border border-black/10 hover:border-black/30 hover:bg-neutral-50 transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-black/5 flex items-center justify-center text-black">
                    <Send size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-black group-hover:text-black">
                      Run Batch Payroll
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Disburse global contractor cuts
                    </div>
                  </div>
                </div>
                <ArrowUpRight size={14} className="text-neutral-400 group-hover:text-black transition-colors" />
              </button>

              <button
                onClick={() => onNavigateTab("developers")}
                className="w-full text-left p-3.5 rounded-lg border border-black/10 hover:border-black/30 hover:bg-neutral-50 transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-black/5 flex items-center justify-center text-black">
                    <ExternalLink size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-black group-hover:text-black">
                      Developer API Keys
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Programmatic pulls & SDK setup
                    </div>
                  </div>
                </div>
                <ArrowUpRight size={14} className="text-neutral-400 group-hover:text-black transition-colors" />
              </button>
            </div>
          </div>

          <div className="pt-5 mt-5 border-t border-black/5">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Protocol State:</span>
              <span className="font-mono text-emerald-600 font-medium">Ready for Settlement</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Recent Protocol Activity Feed */}
      <div className="rounded-xl border border-black/10 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-black/5">
          <div>
            <h3 className="text-base font-semibold text-black tracking-tight">
              Recent On-Chain Activity
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Live pull settlements and payroll disbursements.
            </p>
          </div>
          <span className="text-xs font-mono text-neutral-500">
            Real-time feed
          </span>
        </div>

        <div className="divide-y divide-black/5">
          <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 size={16} />
              </div>
              <div>
                <div className="text-xs font-medium text-black">
                  Recurring Subscription Pull Settled · <span className="font-mono text-neutral-600">sub_9482</span>
                </div>
                <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                  Vault: 0x71C...3F29 · Plan: Pro Tier (Monthly)
                </div>
              </div>
            </div>
            <div className="sm:text-right">
              <div className="font-mono text-xs font-bold text-black">+29.00 USDC</div>
              <div className="text-[10px] text-neutral-400">12 mins ago · 1.1s finality</div>
            </div>
          </div>

          <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-neutral-100 text-black flex items-center justify-center shrink-0">
                <Send size={15} />
              </div>
              <div>
                <div className="text-xs font-medium text-black">
                  Batch Payroll Disbursed · <span className="font-mono text-neutral-600">batch_4401</span>
                </div>
                <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                  Split across 4 engineering contractor wallets in single ledger block
                </div>
              </div>
            </div>
            <div className="sm:text-right">
              <div className="font-mono text-xs font-bold text-black">-3,400.00 USDC</div>
              <div className="text-[10px] text-neutral-400">1 hr ago · 1.4s finality</div>
            </div>
          </div>

          <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-neutral-100 text-neutral-700 flex items-center justify-center shrink-0">
                <Users size={15} />
              </div>
              <div>
                <div className="text-xs font-medium text-black">
                  New Customer Allowance Vault Authorized · <span className="font-mono text-neutral-600">0x49a...bc71</span>
                </div>
                <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                  Cap: 100 USDC / 30 Days · Handshake approved via Orbit Checkout Widget
                </div>
              </div>
            </div>
            <div className="sm:text-right">
              <div className="font-mono text-xs text-neutral-500">Allowance Ready</div>
              <div className="text-[10px] text-neutral-400">3 hrs ago</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
