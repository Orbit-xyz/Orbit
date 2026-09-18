"use client";

import { useState } from "react";
import { X, Wallet, CheckCircle2, Shield } from "lucide-react";
import { MerchantUser } from "@/lib/auth-context";

interface VaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: MerchantUser;
  onUpdateVault: (chain: "stellar" | "arc", address: string) => void;
}

export function VaultModal({ isOpen, onClose, user, onUpdateVault }: VaultModalProps) {
  const [stellarAddress, setStellarAddress] = useState(
    user.linkedVaults?.stellar || (user.walletAddress?.startsWith("G") ? user.walletAddress : "")
  );
  const [arcAddress, setArcAddress] = useState(
    user.linkedVaults?.arc || (user.walletAddress?.startsWith("0x") ? user.walletAddress : "")
  );
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (stellarAddress.trim()) {
      onUpdateVault("stellar", stellarAddress.trim());
    }
    if (arcAddress.trim()) {
      onUpdateVault("arc", arcAddress.trim());
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-xl bg-white border border-black/10 shadow-2xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-black/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Shield size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-black tracking-tight">
                Manage Linked Settlement Vaults
              </h3>
              <p className="text-xs text-neutral-500">
                Non-custodial destination addresses for recurring USDC pulls.
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

        <form onSubmit={handleSave} className="mt-6 space-y-5">
          {/* Stellar Vault */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-black uppercase tracking-wider">
                Stellar Soroban Vault (USDC)
              </label>
              <span className="text-[10px] font-mono text-neutral-400">Freighter / Albedo (Starts with G)</span>
            </div>
            <input
              type="text"
              placeholder="e.g. GB3XQ4...94QA"
              value={stellarAddress}
              onChange={(e) => setStellarAddress(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-xs font-mono text-black focus:outline-hidden focus:ring-1 focus:ring-black focus:border-black"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Where subscription pulls from Stellar users will settle.
            </p>
          </div>

          {/* Arc Network Vault */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-black uppercase tracking-wider">
                Arc Network EVM Vault (USDC)
              </label>
              <span className="text-[10px] font-mono text-neutral-400">MetaMask / AppKit (Starts with 0x)</span>
            </div>
            <input
              type="text"
              placeholder="e.g. 0x71C2...3F29"
              value={arcAddress}
              onChange={(e) => setArcAddress(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-xs font-mono text-black focus:outline-hidden focus:ring-1 focus:ring-black focus:border-black"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Where subscription pulls from EVM / Arc users will settle.
            </p>
          </div>

          {savedSuccess && (
            <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <span>Settlement vaults successfully updated.</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-black/10">
            <button
              type="button"
              onClick={onClose}
              className="button button-secondary text-xs h-9 px-4"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs h-9 px-4"
            >
              Save Linked Vaults
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
