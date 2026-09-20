"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";

import { NetworkId } from "@/components/dashboard/dashboard-types";
import { arcTestnet } from "./chains";
import { NETWORK_FAMILY, connectStellarWallet } from "./wallets";

const STELLAR_SESSION_KEY = "orbit_stellar_wallet";

type StellarSession = { walletId: string; address: string };

function readStellarSession(): StellarSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STELLAR_SESSION_KEY);
    return raw ? (JSON.parse(raw) as StellarSession) : null;
  } catch {
    return null;
  }
}

/**
 * One wallet interface across both rails.
 *
 * Callers pass the network they care about and get back an address — they never
 * branch on chain themselves. This is what ARCHITECTURE.md §7 principle 3 calls
 * "Network-Contextual Actions".
 *
 * EVM and Stellar sessions are held INDEPENDENTLY and on purpose: the Linked
 * Settlement Vault model says a merchant serves both rails at once, so flipping
 * the network switcher must not disconnect the other chain's wallet.
 */
export function useWallet(network: NetworkId) {
  const family = NETWORK_FAMILY[network];

  // --- EVM, via wagmi -------------------------------------------------------
  const { address: evmAddress, isConnected: evmConnected, chainId } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnect: evmDisconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const connectors = useConnectors();

  // --- Stellar, via injected globals ---------------------------------------
  const [stellar, setStellar] = useState<StellarSession | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restored after mount, never during render — the server has no localStorage
  // and reading it inline would desync hydration.
  useEffect(() => {
    setStellar(readStellarSession());
  }, []);

  const connectWallet = useCallback(
    async (walletId: string) => {
      setIsConnecting(true);
      setError(null);
      try {
        if (family === "stellar") {
          const address = await connectStellarWallet(walletId);
          const session = { walletId, address };
          setStellar(session);
          try {
            window.localStorage.setItem(STELLAR_SESSION_KEY, JSON.stringify(session));
          } catch {
            // Private browsing — the session just won't survive a reload.
          }
          return address;
        }

        const connector = connectors.find((c) => c.id === walletId);
        if (!connector) {
          throw new Error("That wallet is no longer available. Refresh and try again.");
        }

        const res = await connectAsync({ connector, chainId: arcTestnet.id });
        return res.accounts[0];
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not connect wallet.";
        setError(/User rejected|denied/i.test(msg) ? "Connection rejected in your wallet." : msg);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [family, connectors, connectAsync]
  );

  const disconnectWallet = useCallback(() => {
    if (family === "stellar") {
      setStellar(null);
      try {
        window.localStorage.removeItem(STELLAR_SESSION_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    evmDisconnect();
  }, [family, evmDisconnect]);

  /** Nudge an EVM wallet onto Arc. No-op on Stellar, which has no concept of it. */
  const ensureCorrectChain = useCallback(async () => {
    if (family !== "evm") return true;
    if (chainId === arcTestnet.id) return true;
    try {
      await switchChainAsync({ chainId: arcTestnet.id });
      return true;
    } catch {
      setError("Switch your wallet to Arc Testnet to continue.");
      return false;
    }
  }, [family, chainId, switchChainAsync]);

  const address = family === "stellar" ? stellar?.address : evmAddress;
  const isConnected = family === "stellar" ? Boolean(stellar) : evmConnected;

  return {
    family,
    address,
    isConnected,
    isConnecting,
    error,
    clearError: () => setError(null),
    connectWallet,
    disconnectWallet,
    ensureCorrectChain,
    /** EVM only: true when connected but pointed at the wrong chain. */
    isWrongChain: family === "evm" && evmConnected && chainId !== arcTestnet.id,
    connectedWalletId: family === "stellar" ? stellar?.walletId : undefined,
  };
}
