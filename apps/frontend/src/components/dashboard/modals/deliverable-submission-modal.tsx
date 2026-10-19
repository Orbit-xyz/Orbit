"use client";

import { useState } from "react";
import { X, ExternalLink, Send, AlertCircle, FileText } from "lucide-react";
import { Milestone } from "@/lib/milestone-escrow";

interface Props {
  isOpen: boolean;
  milestone: Milestone | null;
  onClose: () => void;
  onSubmit: (milestoneId: string, deliverableUrl: string, submissionNotes?: string) => void;
}

export function DeliverableSubmissionModal({
  isOpen,
  milestone,
  onClose,
  onSubmit,
}: Props) {
  const [deliverableUrl, setDeliverableUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  if (!isOpen || !milestone) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliverableUrl.trim()) {
      setError("Please provide a deliverable proof URL.");
      return;
    }
    const isUrl = /^https?:\/\//i.test(deliverableUrl.trim()) || /^ipfs:\/\//i.test(deliverableUrl.trim()) || /^git@/i.test(deliverableUrl.trim());
    if (!isUrl) {
      setError("URL must begin with http://, https://, or ipfs://");
      return;
    }

    try {
      onSubmit(milestone.id, deliverableUrl.trim(), notes.trim());
      onClose();
      setDeliverableUrl("");
      setNotes("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit deliverable");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-white rounded-2xl border border-black/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-neutral-50/50">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-black">Submit Milestone Deliverable</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                STAGE {milestone.order}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5 truncate max-w-sm">
              {milestone.title} ({milestone.amount.toLocaleString()} USDC)
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-black hover:bg-black/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {milestone.reviewFeedback && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
              <span className="font-semibold text-amber-950">Previous Merchant Revision Notes:</span>
              <p className="text-[11px] text-amber-800 italic">{milestone.reviewFeedback}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">
              Deliverable Proof URL *
            </label>
            <div className="relative">
              <ExternalLink size={13} className="absolute left-3 top-3 text-neutral-400" />
              <input
                type="url"
                required
                placeholder="https://github.com/Orbit-xyz/Orbit/pull/... or Figma link"
                value={deliverableUrl}
                onChange={(e) => setDeliverableUrl(e.target.value)}
                className="w-full rounded-lg border border-black/10 pl-9 pr-3 py-2 text-xs font-mono text-black bg-white focus:outline-none focus:ring-1 focus:ring-black"
              />
            </div>
            <span className="text-[10px] text-neutral-400 mt-1 block">
              Provide a verifiable GitHub Pull Request, design file, IPFS hash, or live demo URL.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">
              Submission Notes / Changelog (Optional)
            </label>
            <div className="relative">
              <FileText size={13} className="absolute left-3 top-3 text-neutral-400" />
              <textarea
                rows={3}
                placeholder="Describe completed work, test coverage, or instructions for review..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-black/10 pl-9 pr-3 py-2 text-xs text-black bg-white focus:outline-none focus:ring-1 focus:ring-black resize-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/10">
            <button
              type="button"
              onClick={onClose}
              className="button button-secondary text-xs h-9 px-4 text-neutral-600 hover:text-black"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs h-9 px-4 flex items-center gap-1.5"
            >
              <Send size={13} />
              <span>Submit for Review</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
