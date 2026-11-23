"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { getAddress, getNetwork } from "@stellar/freighter-api";
import { useAuth } from "@/lib/auth-context";

interface WalletBalances {
  xlm: string | null;
  usdc: string | null;
  loading: boolean;
}

type StellarNetworkName = "TESTNET" | "FUTURENET" | "PUBLIC";

function normalizeNetwork(raw?: string): StellarNetworkName {
  const upper = (raw || "").toUpperCase();
  if (upper.includes("FUTURE")) return "FUTURENET";
  if (upper.includes("PUBLIC") || upper.includes("MAIN")) return "PUBLIC";
  return "TESTNET";
}

function horizonBaseUrl(network: StellarNetworkName): string {
  if (network === "FUTURENET") return "https://horizon-futurenet.stellar.org";
  if (network === "PUBLIC") return "https://horizon.stellar.org";
  return "https://horizon-testnet.stellar.org";
}

function stellarExpertUrl(address: string, network: StellarNetworkName): string {
  const segment = network === "PUBLIC" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${segment}/account/${address}`;
}

function networkBadgeLabel(network: StellarNetworkName): string {
  if (network === "FUTURENET") return "Stellar Futurenet";
  if (network === "PUBLIC") return "Stellar Mainnet";
  return "Stellar Testnet";
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalance(raw: string | undefined): string {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function WalletPopover() {
  const { user, disconnectWallet, updateWallet } = useAuth();
  const address = user?.walletAddress;

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [network, setNetwork] = useState<StellarNetworkName>("TESTNET");
  const [balances, setBalances] = useState<WalletBalances>({
    xlm: null,
    usdc: null,
    loading: false,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fetchWalletState = useCallback(async (addr: string) => {
    setBalances((prev) => ({ ...prev, loading: true }));
    let activeNet: StellarNetworkName = "TESTNET";
    try {
      const netRes = await getNetwork();
      if (netRes?.network) {
        activeNet = normalizeNetwork(netRes.network);
        setNetwork(activeNet);
      }
    } catch {
      // Fall back to testnet when extension is unavailable.
    }

    try {
      const res = await fetch(`${horizonBaseUrl(activeNet)}/accounts/${addr}`);
      if (!res.ok) {
        setBalances({ xlm: "0.00", usdc: "0.00", loading: false });
        return;
      }
      const data = (await res.json()) as {
        balances?: Array<{ asset_type?: string; asset_code?: string; balance?: string }>;
      };
      const list = data.balances ?? [];
      const nativeRow = list.find((b) => b.asset_type === "native");
      const usdcRow = list.find((b) => b.asset_code === "USDC");
      setBalances({
        xlm: formatBalance(nativeRow?.balance),
        usdc: formatBalance(usdcRow?.balance),
        loading: false,
      });
    } catch {
      setBalances({ xlm: null, usdc: null, loading: false });
    }
  }, []);

  // Load balances whenever the connected address changes or popover opens.
  useEffect(() => {
    if (!address) return;
    void fetchWalletState(address);
  }, [address, open, fetchWalletState]);

  // Close on outside click or Escape key.
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Passive account change sync with Freighter extension.
  useEffect(() => {
    if (!address || user?.walletProvider !== "freighter") return;
    let active = true;
    const syncAccount = async () => {
      try {
        const next = await getAddress();
        if (
          active &&
          next?.address &&
          next.address !== address
        ) {
          updateWallet(next.address, "freighter");
        }
      } catch {
        // Ignore transient extension errors.
      }
    };
    const onFocus = () => {
      void syncAccount();
    };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => {
      void syncAccount();
    }, 5000);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [address, user?.walletProvider, updateWallet]);

  if (!address) return null;

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable.
    }
  };

  const handleDisconnect = () => {
    setOpen(false);
    disconnectWallet();
  };

  return (
    <div ref={containerRef} className="relative" data-testid="wallet-popover">
      {/* Account Pill */}
      <div className="inline-flex items-center rounded-full border border-black/10 bg-white pl-2.5 pr-1 py-1 text-xs shadow-2xs">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-2 font-mono font-medium text-black hover:text-neutral-700 transition-colors"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"
          />
          <span>{truncateAddress(address)}</span>
          <ChevronDown
            size={13}
            className={`text-neutral-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy wallet address"
          title={copied ? "Copied!" : "Copy wallet address"}
          className="ml-1 rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-black transition-colors"
        >
          {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
        </button>
      </div>

      {/* Popover Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Connected wallet details"
          className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-black/10 bg-white p-4 shadow-xl space-y-3.5 text-xs"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {networkBadgeLabel(network)}
            </span>
            <button
              type="button"
              onClick={() => void fetchWalletState(address)}
              disabled={balances.loading}
              aria-label="Refresh wallet balances"
              className="p-1 rounded-md text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={balances.loading ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="rounded-lg border border-black/5 bg-neutral-50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-neutral-500">USDC Balance</span>
              <span className="font-mono font-bold text-black">
                {balances.loading && balances.usdc === null
                  ? "Loading…"
                  : balances.usdc !== null
                    ? `${balances.usdc} USDC`
                    : "Unavailable"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-500">XLM Balance</span>
              <span className="font-mono font-semibold text-neutral-800">
                {balances.loading && balances.xlm === null
                  ? "Loading…"
                  : balances.xlm !== null
                    ? `${balances.xlm} XLM`
                    : "Unavailable"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 pt-1 border-t border-black/5">
            <a
              href={stellarExpertUrl(address, network)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg px-2.5 py-2 font-medium text-neutral-700 hover:bg-neutral-100 hover:text-black transition-colors"
            >
              <span>View on Stellar Expert</span>
              <ExternalLink size={13} className="text-neutral-400" />
            </a>
            <button
              type="button"
              onClick={handleDisconnect}
              className="flex items-center justify-between rounded-lg px-2.5 py-2 font-semibold text-red-700 hover:bg-red-50 transition-colors"
            >
              <span>Disconnect Wallet</span>
              <LogOut size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
