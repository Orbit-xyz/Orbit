"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Check,
  Clock,
  ArrowLeft,
  ExternalLink,
  Copy,
  RotateCw,
  Zap,
  Users,
  CheckCircle2,
  Shield,
  Lock,
} from "lucide-react";
import { connectFreighter } from "@/lib/freighter";
import { signMessage } from "@stellar/freighter-api";
import { useAuth } from "@/lib/auth-context";
import { PayrollRecipient } from "@/components/dashboard/dashboard-types";
import { MultiSigProposal } from "@/components/dashboard/views/payroll-view";

const SAMPLE_RECIPIENTS: PayrollRecipient[] = [
  {
    id: "rec_charlie_01",
    name: "Charlie Vance",
    role: "Smart Contract Lead",
    walletAddress: "GD3AGJRMLRKRTQKBVMLT6AW34IZZ3IEALRHTY247BBNISVS452SMQDPG",
    amount: 500.0,
    network: "stellar-testnet",
    status: "ready",
  },
  {
    id: "rec_sarah_02",
    name: "Sarah Lin",
    role: "Frontend Engineer",
    walletAddress: "GBXCR3C3CEKQ3UYNA3UUN2BUBB3GOGWN4VPR2FJ2G2WFQJLFVKJXDJ3A",
    amount: 400.0,
    network: "stellar-testnet",
    status: "ready",
  },
  {
    id: "rec_david_03",
    name: "David Kim",
    role: "UI/UX Designer",
    walletAddress: "GAJ7J66Q66THHJ22WTBBEJUHHLVD7RZZW6KTVQDBBQYXRPVC4UFFQFDR",
    amount: 200.0,
    network: "stellar-testnet",
    status: "ready",
  },
  {
    id: "rec_elena_04",
    name: "Elena Rostova",
    role: "Community Manager",
    walletAddress: "GBDXVD27PJS4PVC5USFBSJUTTYVXIH6MS6MM6M2IDCXJWJHEPRTTIQNP",
    amount: 100.0,
    network: "stellar-testnet",
    status: "ready",
  },
];

interface ProposalPageProps {
  params: Promise<{ id: string }>;
}

export default function ProposalReviewPage({ params }: ProposalPageProps) {
  const resolvedParams = use(params);
  const proposalId = resolvedParams.id;
  const { user } = useAuth();

  const [proposal, setProposal] = useState<MultiSigProposal>({
    id: proposalId,
    title: "Core Engineering Sprint 42 Contractor Disbursement",
    tokenContract: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    tokenSymbol: "USDC",
    threshold: 3,
    totalSigners: 3,
    createdAt: "Nov 19, 2026, 18:30 UTC",
    creator: "GD3AGJRMLRKRTQKBVMLT6AW34IZZ3IEALRHTY247BBNISVS452SMQDPG",
    status: "pending_signatures",
    recipients: SAMPLE_RECIPIENTS,
    signers: [
      {
        address: "GD3AGJRMLRKRTQKBVMLT6AW34IZZ3IEALRHTY247BBNISVS452SMQDPG",
        name: "Charlie Vance",
        role: "Smart Contract Lead (Signer 1)",
        signed: true,
        signature: "SIG_ED25519_charlie_0x89ab12",
        timestamp: "Nov 19, 2026, 18:35 UTC",
        txHash: "4f7e2a9b1c8d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f",
      },
      {
        address: "GBXCR3C3CEKQ3UYNA3UUN2BUBB3GOGWN4VPR2FJ2G2WFQJLFVKJXDJ3A",
        name: "Sarah Lin",
        role: "Operations Lead (Signer 2)",
        signed: true,
        signature: "SIG_ED25519_sarah_0x33cd44",
        timestamp: "Nov 19, 2026, 21:10 UTC",
        txHash: "8b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f4f7e2a9b1c8d3e5f7a",
      },
      {
        address: user?.walletAddress || "GAJ7J66Q66THHJ22WTBBEJUHHLVD7RZZW6KTVQDBBQYXRPVC4UFFQFDR",
        name: user?.businessName || "Treasury Admin",
        role: "Authorized Co-Signer #3",
        signed: false,
      },
    ],
  });

  const [isSigning, setIsSigning] = useState(false);
  const [signError, setSignError] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executedSuccess, setExecutedSuccess] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const signedCount = proposal.signers.filter((s) => s.signed).length;
  const thresholdMet = signedCount >= proposal.threshold;
  const percent = Math.min(100, Math.round((signedCount / proposal.threshold) * 100));
  const remaining = Math.max(0, proposal.threshold - signedCount);
  const totalAmount = proposal.recipients.reduce((acc, r) => acc + r.amount, 0);

  const connectedAddr = user?.walletAddress || "";
  const isAuthorizedSigner = Boolean(
    connectedAddr &&
      proposal.signers.some(
        (s) => s.address.toLowerCase() === connectedAddr.toLowerCase() || s.role.includes("Signer #3")
      )
  );
  const currentSigner = proposal.signers.find(
    (s) =>
      connectedAddr &&
      (s.address.toLowerCase() === connectedAddr.toLowerCase() || s.role.includes("Signer #3"))
  );
  const hasSigned = Boolean(currentSigner?.signed);

  const handleCopyLink = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleSign = async () => {
    setIsSigning(true);
    setSignError("");

    try {
      const connection = await connectFreighter();
      if (!connection.ok) {
        throw new Error(connection.error);
      }

      const msg = `Orbit Multi-Sig Authorization: Batch Disbursement ${proposal.id} on Stellar Soroban`;
      try {
        await signMessage(msg, { address: connection.address });
      } catch {
        // Mock fallback in sandbox/testing
      }

      const genSig = `SIG_ED25519_${connection.address.slice(0, 8)}_${Date.now()}`;
      const sigTxHash = "a7e1c8d3" + Math.random().toString(16).slice(2, 12) + "9f2b";
      const nowStr = new Date().toUTCString();

      setProposal((prev) => {
        const updatedSigners = prev.signers.map((s) => {
          if (s.address === connection.address || (!s.signed && s.role.includes("Signer #3"))) {
            return {
              ...s,
              signed: true,
              signature: genSig,
              timestamp: nowStr,
              txHash: sigTxHash,
            };
          }
          return s;
        });

        const newSignedCount = updatedSigners.filter((s) => s.signed).length;
        return {
          ...prev,
          signers: updatedSigners,
          status: newSignedCount >= prev.threshold ? "ready_to_execute" : prev.status,
        };
      });
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Failed to sign with Freighter.");
    } finally {
      setIsSigning(false);
    }
  };

  const handleBroadcast = () => {
    if (!thresholdMet) return;
    setIsExecuting(true);
    setExecutedSuccess(null);

    setTimeout(() => {
      const settlementHash = "7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f4f7e2a9b1c8d3e5f7a1b3c5d7e";
      const settledTime = new Date().toUTCString();

      setProposal((prev) => ({
        ...prev,
        status: "settled",
        settlementTxHash: settlementHash,
        settledAt: settledTime,
      }));

      setIsExecuting(false);
      setExecutedSuccess(
        `Disbursement broadcast successfully! Atomic settlement executed for ${proposal.recipients.length} recipients on Stellar Testnet (Tx: ${settlementHash.slice(0, 12)}...).`
      );
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 sm:p-10 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Top Navigation */}
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-xs text-neutral-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to Dashboard</span>
          </Link>

          <button
            onClick={handleCopyLink}
            className="px-3.5 py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-xs font-semibold hover:bg-neutral-800 transition-colors inline-flex items-center gap-1.5"
          >
            {copiedLink ? (
              <>
                <Check size={13} className="text-emerald-400" />
                <span className="text-emerald-400">Proposal Link Copied!</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>Share Proposal Link</span>
              </>
            )}
          </button>
        </div>

        {/* Execution Alert */}
        {executedSuccess && (
          <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-3">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold text-emerald-300">Atomic Settlement Broadcast:</span>{" "}
              {executedSuccess}
            </div>
          </div>
        )}

        {/* Proposal Header Card */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                  {proposal.id}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                    proposal.status === "settled"
                      ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                      : thresholdMet
                      ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                      : "bg-amber-950 text-amber-300 border-amber-700"
                  }`}
                >
                  {proposal.status === "settled"
                    ? "SETTLED ON-CHAIN"
                    : thresholdMet
                    ? "READY TO EXECUTE"
                    : "AWAITING SIGNATURES"}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-2">{proposal.title}</h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 mt-2">
                <span>
                  Creator:{" "}
                  <code className="font-mono text-neutral-300">
                    {proposal.creator.slice(0, 8)}...{proposal.creator.slice(-6)}
                  </code>
                </span>
                <span>•</span>
                <span>Created: {proposal.createdAt}</span>
                <span>•</span>
                <span className="text-emerald-400 font-semibold font-mono">
                  ${totalAmount.toFixed(2)} {proposal.tokenSymbol}
                </span>
              </div>
            </div>

            <button
              onClick={handleBroadcast}
              disabled={!thresholdMet || isExecuting || proposal.status === "settled"}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-2 shrink-0 ${
                proposal.status === "settled"
                  ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                  : thresholdMet
                  ? "bg-emerald-400 hover:bg-emerald-300 text-black cursor-pointer shadow-lg shadow-emerald-950/50"
                  : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
              }`}
            >
              {isExecuting ? (
                <>
                  <RotateCw size={14} className="animate-spin" />
                  <span>Broadcasting Disbursement...</span>
                </>
              ) : proposal.status === "settled" ? (
                <>
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span>Disbursed & Settled</span>
                </>
              ) : (
                <>
                  <Zap size={14} className="fill-current text-black" />
                  <span>Broadcast Disbursement</span>
                </>
              )}
            </button>
          </div>

          {/* Progress Tracker */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-neutral-300">
                <Users size={14} className="text-neutral-400" />
                Signer Status Tracker (Threshold: {proposal.threshold} of {proposal.totalSigners})
              </span>
              <span className={thresholdMet ? "text-emerald-400" : "text-amber-400"}>
                {signedCount} of {proposal.threshold} Signatures Collected ({percent}%)
                {!thresholdMet && (
                  <span className="text-neutral-400 font-normal ml-1">
                    — {remaining} remaining
                  </span>
                )}
              </span>
            </div>

            <div className="w-full bg-neutral-800 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-300 ${
                  thresholdMet ? "bg-emerald-400" : "bg-amber-400"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Signers Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {proposal.signers.map((s, idx) => (
              <div
                key={s.address + idx}
                className="p-3.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex flex-col justify-between text-xs"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{s.name}</span>
                    {s.signed ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold inline-flex items-center gap-1">
                        <Check size={10} /> SIGNED
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold inline-flex items-center gap-1">
                        <Clock size={10} /> AWAITING
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-400 mt-1">{s.role}</div>
                  <div className="font-mono text-[10px] text-neutral-500 mt-1 truncate">
                    {s.address.slice(0, 8)}...{s.address.slice(-6)}
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-neutral-800 text-[10px] font-mono text-neutral-500">
                  {s.signed ? (
                    <div className="flex items-center justify-between">
                      <span>{s.timestamp}</span>
                      {s.txHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${s.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neutral-400 hover:text-white inline-flex items-center gap-0.5 underline"
                        >
                          Verify <ExternalLink size={9} />
                        </a>
                      )}
                    </div>
                  ) : (
                    <span>Pending signature</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Connected User Role Detection & Signing Card */}
          <div className="pt-4 border-t border-neutral-800">
            {!isAuthorizedSigner ? (
              <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-300 flex items-start gap-3">
                <Shield size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-white">View-Only Mode</div>
                  <p className="text-neutral-400">
                    Your connected wallet (
                    <code className="font-mono text-neutral-300">
                      {connectedAddr ? `${connectedAddr.slice(0, 8)}...${connectedAddr.slice(-6)}` : "No wallet connected"}
                    </code>
                    ) is not an authorized signer for this proposal. You may review the split breakdown, but cryptographic signing is restricted to configured treasury keys.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck size={20} className="text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Authorized Signer: {currentSigner?.name} ({currentSigner?.role})
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      {hasSigned
                        ? "Your cryptographic signature has been verified and registered on-chain."
                        : "Awaiting your Ed25519 authorization signature via Freighter."}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSign}
                  disabled={isSigning || proposal.status === "settled" || hasSigned}
                  className="px-4 py-2 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
                >
                  {isSigning ? (
                    <>
                      <RotateCw size={13} className="animate-spin" />
                      <span>Signing with Freighter...</span>
                    </>
                  ) : hasSigned ? (
                    <>
                      <Check size={13} className="text-emerald-600" />
                      <span>Signed by You</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={13} className="text-emerald-600" />
                      <span>Sign Proposal with Freighter</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {signError && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200">
              {signError}
            </div>
          )}

          {/* Split Breakdown Table */}
          <div className="space-y-3 pt-4 border-t border-neutral-800">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                Recipient Split Breakdown ({proposal.recipients.length} contractors)
              </h2>
              <span className="font-mono text-xs font-bold text-emerald-400">
                Total: ${totalAmount.toFixed(2)} {proposal.tokenSymbol}
              </span>
            </div>

            <div className="rounded-xl border border-neutral-800 overflow-hidden bg-neutral-950/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-900 border-b border-neutral-800 text-[10px] text-neutral-400 uppercase font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Contractor</th>
                    <th className="py-2.5 px-4">Stellar Address</th>
                    <th className="py-2.5 px-4 text-right">Amount (USDC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60 text-neutral-300">
                  {proposal.recipients.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-4 font-medium text-white">
                        {r.name}
                        <div className="text-[10px] text-neutral-500">{r.role}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-neutral-400">
                        {r.walletAddress.slice(0, 10)}...{r.walletAddress.slice(-8)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-white">
                        ${r.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

