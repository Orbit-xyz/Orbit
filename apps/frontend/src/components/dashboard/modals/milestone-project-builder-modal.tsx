"use client";

import { useState } from "react";
import { X, Plus, Trash2, AlertCircle, ShieldCheck, Calendar, DollarSign } from "lucide-react";
import {
  MilestoneStageInput,
  CreateMilestoneProjectInput,
  validateProjectInput,
  createMilestoneProject,
  MilestoneProject,
  validateContractorAddress,
  validateMilestoneAmount,
} from "@/lib/milestone-escrow";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: MilestoneProject) => void;
  defaultMerchantAddress?: string;
}

export function MilestoneProjectBuilderModal({
  isOpen,
  onClose,
  onProjectCreated,
  defaultMerchantAddress,
}: Props) {
  const [title, setTitle] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [contractorAddress, setContractorAddress] = useState("");
  const [stages, setStages] = useState<MilestoneStageInput[]>([
    {
      title: "Stage 1: Architecture & Threat Model",
      amount: "500",
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
      description: "Initial specification, threat model and security invariants.",
    },
    {
      title: "Stage 2: Implementation & Code Delivery",
      amount: "500",
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
      description: "Full feature implementation, property fuzzing and unit tests.",
    },
  ]);
  const [errors, setErrors] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleAddStage = () => {
    const nextStageNum = stages.length + 1;
    setStages((prev) => [
      ...prev,
      {
        title: `Stage ${nextStageNum}: Deliverable Delivery`,
        amount: "500",
        dueDate: new Date(Date.now() + (nextStageNum * 7) * 86400000).toISOString().split("T")[0],
        description: "",
      },
    ]);
  };

  const handleRemoveStage = (index: number) => {
    if (stages.length <= 1) {
      setErrors(["Agreement must contain at least one milestone stage."]);
      return;
    }
    setStages((prev) => prev.filter((_, i) => i !== index));
    setErrors([]);
  };

  const handleStageChange = (index: number, field: keyof MilestoneStageInput, value: string) => {
    setStages((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const totalCalculated = stages.reduce((acc, s) => {
    const val = validateMilestoneAmount(s.amount);
    return acc + (val || 0);
  }, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: CreateMilestoneProjectInput = {
      title,
      contractorName,
      contractorAddress,
      merchantAddress: defaultMerchantAddress,
      stages,
    };

    const validation = validateProjectInput(input);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    try {
      const project = createMilestoneProject(input);
      onProjectCreated(project);
      onClose();
      // Reset form
      setTitle("");
      setContractorName("");
      setContractorAddress("");
      setErrors([]);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Failed to create project"]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl border border-black/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-neutral-50/50">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-black">New Milestone Payroll Agreement</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black text-white font-semibold">
                SOROBAN ESCROW
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              Lock funds in on-chain escrow with staged release gates upon merchant approval.
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errors.length > 0 && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-red-700">
                <AlertCircle size={14} className="shrink-0" />
                <span>Please correct the following:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 pl-1 text-[11px] font-mono">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Project Details */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Project Agreement Title *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Smart Contract Protocol Audit & Fuzzing"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-xs text-black bg-white focus:outline-none focus:ring-1 focus:ring-black"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Contractor / Contributor Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Charlie Vance"
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-xs text-black bg-white focus:outline-none focus:ring-1 focus:ring-black"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Contractor Stellar Address (Ed25519) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Starts with G..."
                  value={contractorAddress}
                  onChange={(e) => setContractorAddress(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-xs font-mono text-black bg-white focus:outline-none focus:ring-1 ${
                    contractorAddress
                      ? validateContractorAddress(contractorAddress)
                        ? "border-emerald-300 focus:ring-emerald-500"
                        : "border-red-300 focus:ring-red-500"
                      : "border-black/10 focus:ring-black"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Milestone Stages */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-black uppercase tracking-wider">
                Milestone Stages ({stages.length})
              </label>
              <button
                type="button"
                onClick={handleAddStage}
                className="button button-secondary text-xs h-7 px-2.5 flex items-center gap-1"
              >
                <Plus size={12} />
                <span>Add Stage</span>
              </button>
            </div>

            <div className="space-y-3">
              {stages.map((stage, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl border border-black/10 bg-neutral-50/50 space-y-2.5 transition-colors hover:border-black/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono font-bold text-black bg-white px-2 py-0.5 rounded border border-black/10">
                      STAGE {idx + 1}
                    </span>
                    {stages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveStage(idx)}
                        className="text-neutral-400 hover:text-red-600 p-1 rounded transition-colors"
                        title="Remove stage"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        required
                        placeholder="Milestone Title (e.g. Design & Wireframes)"
                        value={stage.title}
                        onChange={(e) => handleStageChange(idx, "title", e.target.value)}
                        className="w-full rounded-lg border border-black/10 px-3 py-1.5 text-xs text-black bg-white"
                      />
                    </div>
                    <div className="relative">
                      <DollarSign size={12} className="absolute left-2.5 top-2.5 text-neutral-400" />
                      <input
                        type="number"
                        required
                        step="0.0000001"
                        min="0.0000001"
                        placeholder="USDC Amount"
                        value={stage.amount}
                        onChange={(e) => handleStageChange(idx, "amount", e.target.value)}
                        className="w-full rounded-lg border border-black/10 pl-7 pr-3 py-1.5 text-xs font-mono text-black bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <Calendar size={12} className="absolute left-2.5 top-2.5 text-neutral-400" />
                      <input
                        type="date"
                        required
                        value={stage.dueDate}
                        onChange={(e) => handleStageChange(idx, "dueDate", e.target.value)}
                        className="w-full rounded-lg border border-black/10 pl-7 pr-3 py-1.5 text-xs text-black bg-white"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Deliverable Scope or Requirement notes"
                        value={stage.description || ""}
                        onChange={(e) => handleStageChange(idx, "description", e.target.value)}
                        className="w-full rounded-lg border border-black/10 px-3 py-1.5 text-xs text-neutral-700 bg-white"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Escrow Guarantee Callout */}
          <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2.5">
            <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-emerald-900">Cryptographic Escrow Assurance:</span>{" "}
              Total project budget of{" "}
              <strong className="font-mono">{totalCalculated.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC</strong>{" "}
              is scheduled across {stages.length} milestones. Tokens remain safely locked until merchant authorizes disbursement via Freighter signature.
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-black/10">
            <div className="text-xs text-neutral-500">
              Total Escrow Budget:{" "}
              <span className="font-bold text-black font-mono">
                {totalCalculated.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="button button-secondary text-xs h-9 px-4 text-neutral-600 hover:text-black"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary text-xs h-9 px-4 font-semibold"
              >
                Deploy Milestone Agreement
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
