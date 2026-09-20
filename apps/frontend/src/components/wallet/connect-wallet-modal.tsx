"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnectors } from "wagmi";
import { X, Wallet, ChevronLeft, ChevronRight, ExternalLink, AlertCircle, Loader2 } from "lucide-react";

import { NetworkId } from "@/components/dashboard/dashboard-types";
import { useWallet } from "@/lib/use-wallet";
import {
  CHAIN_OPTIONS,
  EVM_WALLET_HINTS,
  STELLAR_WALLETS,
  isStellarWalletAvailable,
} from "@/lib/wallets";

interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (network: NetworkId, address: string) => void;
  /** Pre-select a chain, e.g. from the dashboard's network switcher. */
  initialNetwork?: NetworkId;
}

type WalletRow = {
  id: string;
  name: string;
  installed: boolean;
  icon?: string;
  installUrl?: string;
};

export function ConnectWalletModal({
  isOpen,
  onClose,
  onConnected,
  initialNetwork,
}: ConnectWalletModalProps) {
  const [step, setStep] = useState<"chain" | "wallet">("chain");
  const [selected, setSelected] = useState<NetworkId>(initialNetwork ?? "arc-testnet");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const wallet = useWallet(selected);
  const connectors = useConnectors();

  // Reset to the chain step each time the modal opens, so it never reopens
  // halfway through a previous attempt.
  useEffect(() => {
    if (isOpen) {
      setStep("chain");
      setSelected(initialNetwork ?? "arc-testnet");
      setPendingId(null);
      wallet.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialNetwork]);

  /**
   * EVM wallets announce themselves via EIP-6963, so the installed list is
   * discovered at runtime rather than hardcoded — MetaMask, Zerion, Coinbase,
   * Bitget, Rabby and anything else the user has all appear automatically.
   * Known wallets that did NOT announce are shown afterwards as install links.
   */
  const evmWallets = useMemo<WalletRow[]>(() => {
    const discovered = connectors
      .filter((c) => c.id !== "injected" || connectors.length === 1)
      .map((c) => ({
        id: c.id,
        name: c.name,
        installed: true,
        icon: c.icon,
      }));

    const seen = new Set(discovered.map((w) => w.name.toLowerCase()));
    const missing = EVM_WALLET_HINTS.filter((h) => !seen.has(h.name.toLowerCase())).map((h) => ({
      id: h.id,
      name: h.name,
      installed: false,
      installUrl: h.installUrl,
    }));

    return [...discovered, ...missing];
  }, [connectors]);

  const stellarWallets = useMemo<WalletRow[]>(
    () =>
      STELLAR_WALLETS.map((w) => ({
        id: w.id,
        name: w.name,
        installed: isStellarWalletAvailable(w.id),
        installUrl: w.installUrl,
      })),
    // Re-evaluated whenever the modal opens, which is when detection matters.
    [isOpen]
  );

  if (!isOpen) return null;

  const chain = CHAIN_OPTIONS.find((c) => c.id === selected)!;
  const rows = chain.family === "evm" ? evmWallets : stellarWallets;

  const handleConnect = async (row: WalletRow) => {
    if (!row.installed) {
      window.open(row.installUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setPendingId(row.id);
    try {
      const address = await wallet.connectWallet(row.id);
      if (address) {
        onConnected?.(selected, address);
        onClose();
      }
    } catch {
      // Message already surfaced through wallet.error.
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-xl bg-white border border-black/10 shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-black/10">
          <div className="flex items-center gap-2.5">
            {step === "wallet" && (
              <button
                onClick={() => {
                  setStep("chain");
                  wallet.clearError();
                }}
                className="p-1.5 -ml-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors"
                aria-label="Back to network selection"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-black">
              <Wallet size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-black tracking-tight">
                {step === "chain" ? "Connect Wallet" : `Connect on ${chain.name}`}
              </h3>
              <p className="text-xs text-neutral-500">
                {step === "chain"
                  ? "Choose the network you want to settle on."
                  : chain.family === "evm"
                    ? "Detected EVM wallets in this browser."
                    : "Stellar wallets supported by Orbit."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step 1 — network */}
        {step === "chain" && (
          <div className="mt-5 space-y-2.5">
            {CHAIN_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  setSelected(option.id);
                  setStep("wallet");
                }}
                className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-black/10 hover:border-black/40 hover:bg-neutral-50 transition-colors text-left group"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-black">{option.name}</span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-black text-white tracking-wide">
                      {option.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-0.5 truncate">{option.subtitle}</p>
                </div>
                <ChevronRight
                  size={16}
                  className="text-neutral-300 group-hover:text-black transition-colors shrink-0"
                />
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — wallet */}
        {step === "wallet" && (
          <div className="mt-5 space-y-2">
            {rows.map((row) => {
              const pending = pendingId === row.id;
              return (
                <button
                  key={row.id}
                  onClick={() => handleConnect(row)}
                  disabled={Boolean(pendingId)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-black/10 hover:border-black/40 hover:bg-neutral-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="w-8 h-8 rounded-lg bg-neutral-100 border border-black/5 flex items-center justify-center overflow-hidden shrink-0">
                    {row.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.icon} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-neutral-500">{row.name[0]}</span>
                    )}
                  </div>

                  <span className="flex-1 text-sm font-semibold text-black truncate">{row.name}</span>

                  {pending ? (
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
                      <Loader2 size={12} className="animate-spin" /> Approve in wallet
                    </span>
                  ) : row.installed ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      Detected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-neutral-400">
                      Install <ExternalLink size={10} />
                    </span>
                  )}
                </button>
              );
            })}

            {rows.length === 0 && (
              <p className="text-xs text-neutral-500 py-6 text-center">
                No wallets detected for this network.
              </p>
            )}
          </div>
        )}

        {wallet.error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-950 flex items-start gap-2">
            <AlertCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
            <span>{wallet.error}</span>
          </div>
        )}

        <p className="mt-5 pt-4 border-t border-black/10 text-[11px] text-neutral-500 leading-relaxed">
          Orbit never takes custody of your funds. Connecting only shares your public address —
          every transfer still requires your signature.
        </p>
      </div>
    </div>
  );
}
