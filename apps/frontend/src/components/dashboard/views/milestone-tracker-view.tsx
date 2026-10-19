"use client";

import { useState, useEffect, useMemo, useDeferredValue } from "react";
import {
  Layers,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  ExternalLink,
  ShieldCheck,
  RotateCw,
  Search,
  FileCheck,
  Sparkles,
  ArrowRight,
  Wallet,
} from "lucide-react";
import { PriceDisplay } from "@/components/ui/price-display";
import { useAuth } from "@/lib/auth-context";
import {
  MilestoneProject,
  Milestone,
  MilestoneStatus,
  MilestoneReleaseReceipt,
  loadSavedMilestoneProjects,
  saveMilestoneProjects,
  submitMilestoneDeliverable,
  requestMilestoneChanges,
  approveAndReleaseMilestone,
  calculateProjectStats,
} from "@/lib/milestone-escrow";
import { MilestoneProjectBuilderModal } from "../modals/milestone-project-builder-modal";
import { DeliverableSubmissionModal } from "../modals/deliverable-submission-modal";
import { RequestChangesModal } from "../modals/request-changes-modal";
import { MilestoneReceiptModal } from "../modals/milestone-receipt-modal";

export function MilestoneTrackerView() {
  const { user } = useAuth();
  const storageKey = `orbit_milestone_projects:${user?.id || "demo"}`;

  const [projects, setProjects] = useState<MilestoneProject[]>(() =>
    loadSavedMilestoneProjects(storageKey)
  );
  const [activeProjectId, setActiveProjectId] = useState<string>(() =>
    projects[0]?.id || ""
  );
  const [role, setRole] = useState<"merchant" | "contractor">("merchant");

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<"all" | MilestoneStatus>("all");

  // Modals state
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [submittingMilestone, setSubmittingMilestone] = useState<Milestone | null>(null);
  const [requestingChangesMilestone, setRequestingChangesMilestone] = useState<Milestone | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<MilestoneReleaseReceipt | null>(null);
  const [isReleasingId, setIsReleasingId] = useState<string | null>(null);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);

  // Sync projects to storage
  useEffect(() => {
    saveMilestoneProjects(storageKey, projects);
  }, [projects, storageKey]);

  // Active project
  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === activeProjectId) || projects[0] || null;
  }, [projects, activeProjectId]);

  const stats = useMemo(() => {
    if (!activeProject) return null;
    return calculateProjectStats(activeProject);
  }, [activeProject]);

  // Filtered milestones
  const visibleMilestones = useMemo(() => {
    if (!activeProject) return [];
    return activeProject.milestones.filter((m) => {
      const matchesSearch =
        !deferredSearch ||
        m.title.toLowerCase().includes(deferredSearch.toLowerCase()) ||
        m.description?.toLowerCase().includes(deferredSearch.toLowerCase()) ||
        m.submissionNotes?.toLowerCase().includes(deferredSearch.toLowerCase());

      const matchesStatus = statusFilter === "all" || m.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [activeProject, deferredSearch, statusFilter]);

  // Project Creation handler
  const handleProjectCreated = (newProject: MilestoneProject) => {
    setProjects((prev) => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    setActionSuccessNotice(`New milestone agreement "${newProject.title}" successfully created and activated!`);
    setTimeout(() => setActionSuccessNotice(null), 5000);
  };

  // Deliverable Submission handler
  const handleDeliverableSubmit = (
    milestoneId: string,
    deliverableUrl: string,
    notes?: string
  ) => {
    if (!activeProject) return;
    try {
      const updated = submitMilestoneDeliverable(activeProject, milestoneId, deliverableUrl, notes);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setActionSuccessNotice("Deliverable proof submitted successfully! Merchant has been notified for review.");
      setTimeout(() => setActionSuccessNotice(null), 5000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Submission failed");
    }
  };

  // Request Changes handler
  const handleRequestChanges = (milestoneId: string, feedback: string) => {
    if (!activeProject) return;
    try {
      const updated = requestMilestoneChanges(activeProject, milestoneId, feedback);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setActionSuccessNotice("Change request recorded. Escrow tokens remain securely locked awaiting contractor update.");
      setTimeout(() => setActionSuccessNotice(null), 5000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Request changes failed");
    }
  };

  // Approve & Release handler (Freighter signing)
  const handleApproveAndRelease = async (milestone: Milestone) => {
    if (!activeProject || isReleasingId) return;
    setIsReleasingId(milestone.id);

    try {
      const signer = user?.walletAddress || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
      const { project: updated, receipt } = await approveAndReleaseMilestone(
        activeProject,
        milestone.id,
        signer
      );

      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setActiveReceipt(receipt);
      setActionSuccessNotice(
        `On-chain escrow release confirmed! ${receipt.amountUsdc.toLocaleString()} USDC disbursed to ${receipt.contractorAddress.slice(0, 6)}... on ledger #${receipt.ledgerSequence}.`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "On-chain release failed");
    } finally {
      setIsReleasingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar: Title, Role Switcher, New Agreement CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-black">
              Milestone Escrow Tracker
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-700 text-white font-bold tracking-wide">
              FREIGHTER GATES
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Deliverable-gated contractor agreements with cryptographic approval sign-offs on Stellar Soroban.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          {/* Interactive Role Switcher Toggle */}
          <div className="flex items-center rounded-lg border border-black/10 bg-neutral-100 p-0.5 text-xs font-medium">
            <button
              onClick={() => setRole("merchant")}
              className={`px-3 py-1.5 rounded-md transition-all ${
                role === "merchant"
                  ? "bg-white text-black font-semibold shadow-xs"
                  : "text-neutral-500 hover:text-black"
              }`}
            >
              Merchant View
            </button>
            <button
              onClick={() => setRole("contractor")}
              className={`px-3 py-1.5 rounded-md transition-all ${
                role === "contractor"
                  ? "bg-white text-black font-semibold shadow-xs"
                  : "text-neutral-500 hover:text-black"
              }`}
            >
              Contractor View
            </button>
          </div>

          <button
            onClick={() => setIsBuilderOpen(true)}
            className="button button-primary text-xs h-9 px-3.5 flex items-center gap-1.5 shadow-xs"
          >
            <Plus size={14} />
            <span>New Agreement</span>
          </button>
        </div>
      </div>

      {/* Role Context Notification Chip */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-black/5 text-xs">
        <div className="flex items-center gap-2 text-neutral-600">
          <span className="font-semibold text-black">Active Perspective:</span>
          {role === "merchant" ? (
            <span>You are viewing as <strong className="text-black">Merchant / DAO Owner</strong> (authorized to review deliverables, request revisions, and sign on-chain escrow releases).</span>
          ) : (
            <span>You are viewing as <strong className="text-black">Contractor</strong> (authorized to submit deliverable proof links and track approval status).</span>
          )}
        </div>
        <button
          onClick={() => setRole(role === "merchant" ? "contractor" : "merchant")}
          className="text-[11px] underline text-neutral-500 hover:text-black shrink-0"
        >
          Switch to {role === "merchant" ? "Contractor View" : "Merchant View"}
        </button>
      </div>

      {/* Action Success Notice Banner */}
      {actionSuccessNotice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-3 animate-in fade-in duration-200 shadow-xs">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">Action Completed:</span> {actionSuccessNotice}
          </div>
        </div>
      )}

      {/* 2. Project Agreement Selector Tabs */}
      {projects.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-black/5">
          {projects.map((proj) => {
            const isActive = proj.id === activeProject?.id;
            return (
              <button
                key={proj.id}
                onClick={() => setActiveProjectId(proj.id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
                  isActive
                    ? "bg-black text-white font-semibold"
                    : "bg-white text-neutral-600 border border-black/10 hover:border-black/30"
                }`}
              >
                <span>{proj.title}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    isActive ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {proj.milestones.length} stages
                </span>
                {proj.status === "completed" && (
                  <CheckCircle2 size={12} className={isActive ? "text-emerald-300" : "text-emerald-600"} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {activeProject && stats ? (
        <>
          {/* 3. Metrics Ribbon & Agreement Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-white border border-black/10 shadow-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Total Agreement Budget
              </div>
              <div className="text-2xl font-bold text-black mt-2 tracking-tight">
                <PriceDisplay amount={stats.totalUsdc} />
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Contractor: <span className="font-semibold text-black">{activeProject.contractorName}</span>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white border border-black/10 shadow-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Released Payouts
              </div>
              <div className="text-2xl font-bold text-emerald-600 mt-2 tracking-tight">
                <PriceDisplay amount={stats.releasedUsdc} />
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                {stats.completedStages} of {stats.totalStages} milestones disbursed
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white border border-black/10 shadow-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Locked in Escrow
              </div>
              <div className="text-2xl font-bold text-amber-600 mt-2 tracking-tight">
                <PriceDisplay amount={stats.pendingUsdc} />
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Awaiting deliverable review &amp; sign-off
              </div>
            </div>

            <div className="p-5 rounded-xl bg-neutral-900 text-white flex flex-col justify-between shadow-xs">
              <div>
                <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider">
                  Deliverable Progress
                </div>
                <div className="text-xl font-bold mt-1">
                  {stats.progressPercent}% Completed
                </div>
              </div>
              <div className="w-full bg-neutral-800 rounded-full h-2 mt-3 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${stats.progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* 4. Contractor Agreement Meta Card */}
          <div className="p-4 rounded-xl border border-black/10 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center font-bold text-black font-mono">
                {activeProject.contractorName.charAt(0)}
              </div>
              <div>
                <div className="font-semibold text-black">
                  Agreement: {activeProject.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5 font-mono text-[11px] text-neutral-500">
                  <Wallet size={11} />
                  <span>Contractor: {activeProject.contractorAddress}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                Status: {activeProject.status.toUpperCase()}
              </span>
              <a
                href={`https://stellar.expert/explorer/testnet/account/${activeProject.contractorAddress}`}
                target="_blank"
                rel="noreferrer"
                className="button button-secondary text-xs h-7 px-2 flex items-center gap-1 text-neutral-600 hover:text-black"
                title="View Contractor on Stellar Expert"
              >
                <ExternalLink size={11} />
                <span>Explorer</span>
              </a>
            </div>
          </div>

          {/* 5. Milestone Stages Table */}
          <div className="rounded-xl border border-black/10 bg-white overflow-hidden shadow-xs">
            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 p-4 text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
                <Search size={14} className="text-neutral-400 shrink-0" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search stages or deliverable notes..."
                  className="w-full rounded-lg border border-black/10 px-3 py-1.5 text-xs text-black bg-white focus:outline-none focus:ring-1 focus:ring-black"
                />
              </div>

              {/* Status Filter Buttons */}
              <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
                {(["all", "pending", "submitted", "changes_requested", "released"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-md capitalize transition-colors ${
                      statusFilter === s
                        ? "bg-black text-white font-semibold"
                        : "text-neutral-500 hover:bg-neutral-100"
                    }`}
                  >
                    {s === "changes_requested" ? "Changes Requested" : s}
                  </button>
                ))}
              </div>
            </div>

            {/* Table */}
            {visibleMilestones.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50/80 border-b border-black/10 text-neutral-500 uppercase tracking-wider font-semibold text-[10px]">
                    <tr>
                      <th className="py-3.5 px-5">Milestone Stage</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4">Deliverable Proof</th>
                      <th className="py-3.5 px-4">Due Date</th>
                      <th className="py-3.5 px-4">Escrow Amount</th>
                      <th className="py-3.5 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 text-neutral-700">
                    {visibleMilestones.map((ms) => {
                      const isReleasing = isReleasingId === ms.id;

                      return (
                        <tr key={ms.id} className="hover:bg-neutral-50/50 transition-colors">
                          {/* Title & Stage */}
                          <td className="py-4 px-5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] font-bold text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded">
                                #{ms.order}
                              </span>
                              <span className="font-semibold text-black text-xs">
                                {ms.title}
                              </span>
                            </div>
                            {ms.description && (
                              <p className="text-[11px] text-neutral-500 mt-1 max-w-sm leading-relaxed">
                                {ms.description}
                              </p>
                            )}
                            {ms.reviewFeedback && ms.status === "changes_requested" && (
                              <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                                <strong>Feedback:</strong> {ms.reviewFeedback}
                              </div>
                            )}
                          </td>

                          {/* Status Badge */}
                          <td className="py-4 px-4">
                            {ms.status === "released" && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                                <CheckCircle2 size={11} />
                                RELEASED
                              </span>
                            )}
                            {ms.status === "submitted" && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium animate-pulse">
                                <Send size={11} />
                                SUBMITTED
                              </span>
                            )}
                            {ms.status === "changes_requested" && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                                <AlertTriangle size={11} />
                                REVISION
                              </span>
                            )}
                            {ms.status === "pending" && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-black/5 font-medium">
                                <Clock size={11} />
                                PENDING
                              </span>
                            )}
                          </td>

                          {/* Deliverable Proof */}
                          <td className="py-4 px-4">
                            {ms.deliverableUrl ? (
                              <div className="space-y-1">
                                <a
                                  href={ms.deliverableUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 hover:underline max-w-[180px] truncate"
                                  title={ms.deliverableUrl}
                                >
                                  <ExternalLink size={11} className="shrink-0" />
                                  <span className="truncate">{ms.deliverableUrl}</span>
                                </a>
                                {ms.submissionNotes && (
                                  <p className="text-[10px] text-neutral-400 italic max-w-[200px] truncate">
                                    &ldquo;{ms.submissionNotes}&rdquo;
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-neutral-400 text-[11px] italic">
                                Awaiting submission
                              </span>
                            )}
                          </td>

                          {/* Due Date */}
                          <td className="py-4 px-4 font-mono text-neutral-600">
                            {ms.dueDate}
                          </td>

                          {/* Amount */}
                          <td className="py-4 px-4 font-mono font-bold text-black text-sm">
                            <PriceDisplay amount={ms.amount} />
                          </td>

                          {/* Actions */}
                          <td className="py-4 px-5 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {/* Contractor Action */}
                              {role === "contractor" && (
                                <>
                                  {(ms.status === "pending" || ms.status === "changes_requested") && (
                                    <button
                                      onClick={() => setSubmittingMilestone(ms)}
                                      className="button button-primary text-xs h-8 px-3 flex items-center gap-1 shadow-xs"
                                    >
                                      <Send size={12} />
                                      <span>{ms.status === "changes_requested" ? "Resubmit Proof" : "Submit Proof"}</span>
                                    </button>
                                  )}
                                  {ms.status === "submitted" && (
                                    <span className="text-[11px] text-neutral-400 italic px-2">
                                      Under Review
                                    </span>
                                  )}
                                </>
                              )}

                              {/* Merchant Actions */}
                              {role === "merchant" && (
                                <>
                                  {ms.status === "submitted" && (
                                    <>
                                      <button
                                        onClick={() => setRequestingChangesMilestone(ms)}
                                        disabled={isReleasing}
                                        className="button button-secondary text-xs h-8 px-2.5 text-amber-700 hover:text-amber-900 border-amber-200"
                                        title="Request revisions from contractor"
                                      >
                                        <span>Request Changes</span>
                                      </button>

                                      <button
                                        onClick={() => handleApproveAndRelease(ms)}
                                        disabled={isReleasing}
                                        className="button bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-8 px-3 flex items-center gap-1.5 shadow-xs"
                                        title="Sign with Freighter to disburse escrow tokens"
                                      >
                                        {isReleasing ? (
                                          <>
                                            <RotateCw size={12} className="animate-spin" />
                                            <span>Signing...</span>
                                          </>
                                        ) : (
                                          <>
                                            <Sparkles size={12} />
                                            <span>Approve &amp; Release</span>
                                          </>
                                        )}
                                      </button>
                                    </>
                                  )}

                                  {ms.status === "pending" && (
                                    <span className="text-[11px] text-neutral-400 italic px-2">
                                      Awaiting Deliverable
                                    </span>
                                  )}

                                  {ms.status === "changes_requested" && (
                                    <span className="text-[11px] text-amber-600 italic px-2">
                                      Changes Pending
                                    </span>
                                  )}
                                </>
                              )}

                              {/* View Receipt Action (Both) */}
                              {ms.status === "released" && (
                                <button
                                  onClick={() =>
                                    setActiveReceipt({
                                      txHash: ms.txHash || "8d94e77519bf2e3cfeb940fa64c399b104dcba8a2f58e174b1263c9b7db0a218",
                                      ledgerSequence: ms.ledgerSequence || 521894,
                                      contractorAddress: activeProject.contractorAddress,
                                      amountUsdc: ms.amount,
                                      network: activeProject.network,
                                      timestamp: ms.releasedAt || new Date().toISOString(),
                                      sorobanFeeXlm: 0.000125,
                                      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${ms.txHash || "8d94e77519bf2e3cfeb940fa64c399b104dcba8a2f58e174b1263c9b7db0a218"}`,
                                      contractId: "CAZBZBLQ7M2PCO4Y6Q2YVHQ3K3Q5W7JLRK6NVTWPZ3E7X4K3R6XYQNG",
                                    })
                                  }
                                  className="button button-secondary text-xs h-8 px-2.5 flex items-center gap-1 text-emerald-700 hover:text-emerald-900 border-emerald-200"
                                >
                                  <FileCheck size={12} />
                                  <span>View Receipt</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-neutral-500">
                No milestone stages found matching your filter.
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="p-12 text-center rounded-2xl border border-black/10 bg-white">
          <Layers size={32} className="mx-auto text-neutral-400 mb-3" />
          <h4 className="font-semibold text-black text-sm">No Milestone Agreements Found</h4>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1">
            Create your first multi-stage contractor escrow agreement to schedule deliverable-gated payouts.
          </p>
          <button
            onClick={() => setIsBuilderOpen(true)}
            className="button button-primary text-xs h-9 px-4 mt-4 inline-flex items-center gap-1.5"
          >
            <Plus size={14} /> Create Agreement
          </button>
        </div>
      )}

      {/* 6. Protocol Guarantees Ribbon */}
      <div className="p-4 rounded-xl bg-neutral-50 border border-black/5 flex items-start gap-3 text-xs text-neutral-600">
        <ShieldCheck size={18} className="text-black shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-black">Freighter-Gated Milestone Escrow Security:</span>{" "}
          Milestone escrow payouts are protected by Soroban smart contract authorization gates.
          Funds cannot be moved by contractors without explicit cryptographic approval and transaction signature from the hiring merchant.
          All disbursements generate verifiable on-chain receipts on the Stellar ledger.
        </div>
      </div>

      {/* Modals */}
      <MilestoneProjectBuilderModal
        isOpen={isBuilderOpen}
        onClose={() => setIsBuilderOpen(false)}
        onProjectCreated={handleProjectCreated}
        defaultMerchantAddress={user?.walletAddress}
      />

      <DeliverableSubmissionModal
        isOpen={!!submittingMilestone}
        milestone={submittingMilestone}
        onClose={() => setSubmittingMilestone(null)}
        onSubmit={handleDeliverableSubmit}
      />

      <RequestChangesModal
        isOpen={!!requestingChangesMilestone}
        milestone={requestingChangesMilestone}
        onClose={() => setRequestingChangesMilestone(null)}
        onRequestChanges={handleRequestChanges}
      />

      <MilestoneReceiptModal
        isOpen={!!activeReceipt}
        receipt={activeReceipt}
        onClose={() => setActiveReceipt(null)}
      />
    </div>
  );
}
