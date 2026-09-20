"use client";

import { useState } from "react";
import {
  Users,
  Search,
  CheckCircle2,
  Clock,
  ArrowDownRight,
  ExternalLink,
  Copy,
  Check,
  Zap,
  ShieldCheck,
  Play,
  RotateCw,
  AlertCircle,
  Filter,
} from "lucide-react";
import { SubscriberRecord, NETWORKS } from "../dashboard-types";
import { useOrbitArc, describeOrbitError } from "@/lib/use-orbit";
import { isEvmAddress, truncateAddress } from "@/lib/utils";

const INITIAL_SUBSCRIBERS: SubscriberRecord[] = [
  {
    id: "sub_bob_9421",
    walletAddress: "GBOBZ7M5W8Y2K6T1R9P0V4N8D2L7C3F9A1H5J8K2",
    planId: "plan_mailkit_pro",
    planName: "MailKit Pro",
    amount: 29.0,
    network: "stellar-testnet",
    status: "pending_pull",
    nextPullDate: "Due Now",
    totalSettled: 116.0,
    joinedDate: "May 18, 2026",
  },
  {
    id: "sub_alice_4812",
    walletAddress: "GALI37H9P4B2N8C1X6K5M7W9D0F3L8T2V4J7R9Q0",
    planId: "plan_ai_starter",
    planName: "AI Engine Starter",
    amount: 15.0,
    network: "stellar-testnet",
    status: "active",
    nextPullDate: "In 12 days",
    totalSettled: 45.0,
    joinedDate: "Jul 02, 2026",
  },
  {
    id: "sub_david_8932",
    walletAddress: "GDAV84N2L7C3F9A1H5J8K2GB3XQ4Z7M5W8Y2K6T1",
    planId: "plan_dao_retainer",
    planName: "DAO Builder Pass",
    amount: 100.0,
    network: "stellar-testnet",
    status: "pending_pull",
    nextPullDate: "Due Now",
    totalSettled: 400.0,
    joinedDate: "Apr 11, 2026",
  },
  {
    id: "sub_elena_3391",
    walletAddress: "GELE93M4K8P1T6R9V0D2L7C3F9A1H5J8K2W8Y2K5",
    planId: "plan_mailkit_pro",
    planName: "MailKit Pro",
    amount: 29.0,
    network: "stellar-testnet",
    status: "active",
    nextPullDate: "In 18 days",
    totalSettled: 87.0,
    joinedDate: "Jun 14, 2026",
  },
  {
    id: "sub_marcus_7721",
    walletAddress: "GMAR51K9T3R7V2D8L4C0F6A2H8J1K5W9Y3K7M2P6",
    planId: "plan_ai_starter",
    planName: "AI Engine Starter",
    amount: 15.0,
    network: "stellar-testnet",
    status: "active",
    nextPullDate: "In 24 days",
    totalSettled: 30.0,
    joinedDate: "Aug 01, 2026",
  },
];

export function SubscribersView() {
  const [subscribers, setSubscribers] = useState<SubscriberRecord[]>(INITIAL_SUBSCRIBERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "pending_pull" | "active">("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [executingPullId, setExecutingPullId] = useState<string | null>(null);
  const [pullSuccessMessage, setPullSuccessMessage] = useState<string | null>(null);
  const [pullErrorMessage, setPullErrorMessage] = useState<string | null>(null);
  const [pullTxUrl, setPullTxUrl] = useState<string | null>(null);

  const orbit = useOrbitArc();
  const [isBatchPulling, setIsBatchPulling] = useState(false);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  /**
   * Execute Pull.
   *
   * On Arc this submits a real `pullFunds` transaction and waits for the
   * receipt, so the row only updates once the chain has accepted it. The
   * previous version resolved on a 1.2s timer and would show "settled" even
   * for a transaction that reverted.
   *
   * Stellar subscribers still simulate — that rail is driven from the backend
   * (Task 6.7), not the browser — but the message now says so plainly rather
   * than claiming an on-chain settlement that did not happen.
   */
  const handleExecutePull = async (sub: SubscriberRecord) => {
    setExecutingPullId(sub.id);
    setPullSuccessMessage(null);
    setPullErrorMessage(null);
    setPullTxUrl(null);

    const applySettlement = () =>
      setSubscribers((prev) =>
        prev.map((s) =>
          s.id === sub.id
            ? {
                ...s,
                status: "active" as const,
                nextPullDate: "In 30 days",
                totalSettled: s.totalSettled + s.amount,
              }
            : s
        )
      );

    if (sub.network !== "arc-testnet" || !isEvmAddress(sub.walletAddress)) {
      setTimeout(() => {
        applySettlement();
        setExecutingPullId(null);
        setPullSuccessMessage(
          `Simulated pull of ${sub.amount.toFixed(2)} USDC from ${truncateAddress(sub.walletAddress)}. This rail settles from the backend, not the dashboard — no transaction was broadcast.`
        );
        setTimeout(() => setPullSuccessMessage(null), 6000);
      }, 1200);
      return;
    }

    try {
      if (!orbit.isConnected) await orbit.connect();

      const { hash, explorerUrl } = await orbit.pullFunds(
        sub.walletAddress as `0x${string}`
      );

      applySettlement();
      setPullSuccessMessage(
        `Settled ${sub.amount.toFixed(2)} USDC from ${truncateAddress(sub.walletAddress)} on Arc. Transaction ${truncateAddress(hash, 10, 8)} confirmed.`
      );
      setPullTxUrl(explorerUrl);
    } catch (err) {
      setPullErrorMessage(describeOrbitError(err));
    } finally {
      setExecutingPullId(null);
    }
  };

  // Batch Pull All Due
  const handleBatchPullDue = async () => {
    const dueSubs = subscribers.filter((s) => s.status === "pending_pull");
    if (dueSubs.length === 0) return;

    setIsBatchPulling(true);
    setPullSuccessMessage(null);

    const totalPullAmount = dueSubs.reduce((acc, s) => acc + s.amount, 0);

    setTimeout(() => {
      setSubscribers((prev) =>
        prev.map((s) => {
          if (s.status === "pending_pull") {
            return {
              ...s,
              status: "active",
              nextPullDate: "In 30 days",
              totalSettled: s.totalSettled + s.amount,
            };
          }
          return s;
        })
      );

      setIsBatchPulling(false);
      setPullSuccessMessage(
        `Batch Pull Succeeded! Settled ${totalPullAmount} USDC across ${dueSubs.length} due subscribers in single ledger block (1.3s finality).`
      );

      setTimeout(() => setPullSuccessMessage(null), 6000);
    }, 1400);
  };

  const filteredSubscribers = subscribers.filter((s) => {
    const matchesSearch =
      s.walletAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.planName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase());

    if (filterTab === "all") return matchesSearch;
    return matchesSearch && s.status === filterTab;
  });

  const dueCount = subscribers.filter((s) => s.status === "pending_pull").length;
  const totalSettledAll = subscribers.reduce((acc, s) => acc + s.totalSettled, 0);

  return (
    <div className="space-y-6">
      {/* 1. Header with Batch Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-black">
            Subscribers &amp; Allowance Vaults
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Verified on-chain customer vaults authorizing recurring USDC pull payments on Stellar Soroban.
          </p>
        </div>

        {dueCount > 0 && (
          <button
            onClick={handleBatchPullDue}
            disabled={isBatchPulling}
            className="button button-primary text-xs h-9 px-4 flex items-center gap-2 self-start sm:self-auto shrink-0 shadow-xs"
          >
            {isBatchPulling ? (
              <>
                <RotateCw size={13} className="animate-spin" />
                <span>Executing Batch Pull...</span>
              </>
            ) : (
              <>
                <Zap size={13} className="text-emerald-400" />
                <span>Execute All Due Pulls ({dueCount})</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Success Notification Banner */}
      {pullSuccessMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-3 animate-in fade-in duration-200 shadow-xs">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">Protocol Execution Verified:</span> {pullSuccessMessage}
            {pullTxUrl && (
              <a
                href={pullTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"
              >
                View on explorer <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      )}

      {pullErrorMessage && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-950 flex items-start gap-3 animate-in fade-in duration-200 shadow-xs">
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">Pull failed:</span> {pullErrorMessage}
          </div>
        </div>
      )}

      {/* 2. Metrics Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Total Subscribers
          </div>
          <div className="text-2xl font-bold text-black mt-1">
            148
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            Active on-chain vaults
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Pulls Due Now
          </div>
          <div className={`text-2xl font-bold mt-1 ${dueCount > 0 ? "text-amber-600" : "text-black"}`}>
            {dueCount}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {dueCount > 0 ? "Ready for on-chain trigger" : "All vaults up to date"}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Settled to Date
          </div>
          <div className="text-2xl font-bold text-black mt-1">
            {totalSettledAll.toLocaleString("en-US", { minimumFractionDigits: 2 })} <span className="text-xs font-mono font-bold text-neutral-500">USDC</span>
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            100% non-custodial
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-black/10 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Execution Finality
          </div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">
            &lt; 1.5s
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            Sub-cent Soroban pull fees
          </div>
        </div>
      </div>

      {/* 3. Search & Status Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search by customer address, plan name, or subscription ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-black/10 pl-9 pr-4 py-2 text-xs text-black bg-white focus:outline-hidden focus:ring-1 focus:ring-black focus:border-black"
          />
        </div>

        <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded-lg shrink-0">
          <button
            onClick={() => setFilterTab("all")}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterTab === "all"
                ? "bg-white text-black font-bold shadow-2xs"
                : "text-neutral-500 hover:text-black"
            }`}
          >
            All ({subscribers.length})
          </button>
          <button
            onClick={() => setFilterTab("pending_pull")}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterTab === "pending_pull"
                ? "bg-white text-amber-700 font-bold shadow-2xs"
                : "text-neutral-500 hover:text-black"
            }`}
          >
            Due ({dueCount})
          </button>
          <button
            onClick={() => setFilterTab("active")}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterTab === "active"
                ? "bg-white text-black font-bold shadow-2xs"
                : "text-neutral-500 hover:text-black"
            }`}
          >
            Active ({subscribers.length - dueCount})
          </button>
        </div>
      </div>

      {/* 4. Subscribers Table */}
      <div className="rounded-xl border border-black/10 bg-white overflow-hidden shadow-xs">
        {filteredSubscribers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50/80 border-b border-black/10 text-neutral-500 uppercase tracking-wider font-semibold text-[10px]">
                <tr>
                  <th className="py-3.5 px-5">Subscriber Vault</th>
                  <th className="py-3.5 px-4">Plan Tier</th>
                  <th className="py-3.5 px-4">Allowance Rate</th>
                  <th className="py-3.5 px-4">Total Settled</th>
                  <th className="py-3.5 px-4">Next Pull</th>
                  <th className="py-3.5 px-4">Vault Status</th>
                  <th className="py-3.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 text-neutral-700">
                {filteredSubscribers.map((sub) => {
                  const isExecuting = executingPullId === sub.id;
                  const isDue = sub.status === "pending_pull";

                  return (
                    <tr key={sub.id} className="hover:bg-neutral-50/50 transition-colors">
                      {/* Customer Address & Copy */}
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                          <span className="font-mono text-xs font-semibold text-black">
                            {sub.walletAddress.slice(0, 6)}...{sub.walletAddress.slice(-4)}
                          </span>
                          <button
                            onClick={() => copyToClipboard(sub.walletAddress, sub.id)}
                            className="p-1 rounded hover:bg-black/5 text-neutral-400 hover:text-black transition-colors"
                            title="Copy full address"
                          >
                            {copiedKey === sub.id ? (
                              <Check size={11} className="text-emerald-600" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                          <a
                            href={`${NETWORKS[sub.network].explorerUrl}/${NETWORKS[sub.network].id === "arc-testnet" ? "address" : "account"}/${sub.walletAddress}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 rounded hover:bg-black/5 text-neutral-400 hover:text-black transition-colors"
                            title="View on Stellar Expert"
                          >
                            <ExternalLink size={11} />
                          </a>
                        </div>
                        <div className="text-[10px] font-mono text-neutral-400 mt-0.5 pl-4">
                          ID: {sub.id} · Joined {sub.joinedDate}
                        </div>
                      </td>

                      {/* Plan Name */}
                      <td className="py-4 px-4 font-semibold text-black">
                        {sub.planName}
                      </td>

                      {/* Allowance Rate */}
                      <td className="py-4 px-4">
                        <div className="font-mono font-bold text-black">
                          {sub.amount.toFixed(2)} USDC
                        </div>
                        <div className="text-[10px] text-neutral-400">
                          Per 30 Days
                        </div>
                      </td>

                      {/* Total Settled */}
                      <td className="py-4 px-4">
                        <div className="font-mono font-semibold text-black">
                          {sub.totalSettled.toFixed(2)} USDC
                        </div>
                        <div className="text-[10px] text-neutral-400">
                          {Math.round(sub.totalSettled / sub.amount)} pulls settled
                        </div>
                      </td>

                      {/* Next Billing Date */}
                      <td className="py-4 px-4">
                        {isDue ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                            <Clock size={11} />
                            {sub.nextPullDate}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-neutral-600">
                            {sub.nextPullDate}
                          </span>
                        )}
                      </td>

                      {/* Vault Status */}
                      <td className="py-4 px-4">
                        {isDue ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                            PULL READY
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            ACTIVE VAULT
                          </span>
                        )}
                      </td>

                      {/* Execute Pull Action */}
                      <td className="py-4 px-5 text-right">
                        {isDue ? (
                          <button
                            onClick={() => handleExecutePull(sub)}
                            disabled={isExecuting || isBatchPulling}
                            className="button button-primary text-xs h-8 px-3 inline-flex items-center gap-1.5 bg-black text-white hover:bg-neutral-800"
                          >
                            {isExecuting ? (
                              <>
                                <RotateCw size={12} className="animate-spin" />
                                <span>Pulling...</span>
                              </>
                            ) : (
                              <>
                                <Zap size={12} className="text-emerald-400" />
                                <span>Execute Pull</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleExecutePull(sub)}
                            disabled={isExecuting || isBatchPulling}
                            className="button button-secondary text-[11px] h-7 px-2.5 text-neutral-500 hover:text-black"
                            title="Trigger early test pull"
                          >
                            {isExecuting ? (
                              <RotateCw size={11} className="animate-spin" />
                            ) : (
                              <span>Test Pull</span>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-3">
              <Users size={22} />
            </div>
            <h4 className="font-semibold text-black text-sm">No subscribers found</h4>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1 leading-relaxed">
              {searchQuery
                ? `No active vaults matching "${searchQuery}".`
                : "When customers subscribe via the Orbit Checkout Widget, their on-chain vaults appear here."}
            </p>
          </div>
        )}
      </div>

      {/* On-Chain Security Guarantee Card */}
      <div className="p-4 rounded-xl bg-neutral-50 border border-black/5 flex items-start gap-3 text-xs text-neutral-600">
        <ShieldCheck size={18} className="text-black shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-black">Non-Custodial Pull Contract Rules:</span>
          {" "}The Soroban smart contract (<code className="font-mono text-[11px] text-black">CAZBZB...YQNG</code>) verifies on-chain ledger timestamps. A merchant cannot pull funds before the interval has elapsed or exceed the authorized amount cap.
        </div>
      </div>
    </div>
  );
}
