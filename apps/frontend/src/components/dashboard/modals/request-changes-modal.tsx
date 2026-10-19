"use client";

import { useState } from "react";
import { X, MessageSquareQuote, AlertTriangle } from "lucide-react";
import { Milestone } from "@/lib/milestone-escrow";

interface Props {
  isOpen: boolean;
  milestone: Milestone | null;
  onClose: () => void;
  onRequestChanges: (milestoneId: string, feedback: string) => void;
}

export function RequestChangesModal({
  isOpen,
  milestone,
  onClose,
  onRequestChanges,
}: Props) {
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  if (!isOpen || !milestone) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedback.trim()) {
      setError("Please specify required changes or feedback for the contractor.");
      return;
    }

    try {
      onRequestChanges(milestone.id, feedback.trim());
      onClose();
      setFeedback("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request changes");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-white rounded-2xl border border-black/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-amber-50/50">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-amber-950">Request Deliverable Changes</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-semibold">
                STAGE {milestone.order}
              </span>
            </div>
            <p className="text-xs text-amber-800/80 mt-0.5 truncate max-w-sm">
              {milestone.title}
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
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-900">Escrow Funds Remain Locked:</span> Requesting changes keeps milestone tokens securely held in escrow until updated deliverables are submitted and approved.
            </div>
          </div>

          {milestone.deliverableUrl && (
            <div className="p-2.5 rounded-lg border border-black/10 bg-neutral-50 text-xs flex items-center justify-between">
              <span className="text-neutral-500">Submitted Proof:</span>
              <a
                href={milestone.deliverableUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-blue-600 hover:underline truncate max-w-[260px]"
              >
                {milestone.deliverableUrl}
              </a>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1">
              Required Revisions / Feedback Notes *
            </label>
            <div className="relative">
              <MessageSquareQuote size={14} className="absolute left-3 top-3 text-neutral-400" />
              <textarea
                required
                rows={4}
                placeholder="Detail the corrections, additional tests, or modifications required before disbursement..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
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
              className="button bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs h-9 px-4"
            >
              Send Revision Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
