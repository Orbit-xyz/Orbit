import { NetworkId } from "@/components/dashboard/dashboard-types";

/** Which wallet ecosystem a chain belongs to. Determines how we connect. */
export type WalletFamily = "evm" | "stellar";

export const NETWORK_FAMILY: Record<NetworkId, WalletFamily> = {
  "arc-testnet": "evm",
  "stellar-testnet": "stellar",
};

export interface ChainOption {
  id: NetworkId;
  family: WalletFamily;
  name: string;
  /** What the user recognises this rail by. */
  subtitle: string;
  badge: string;
}

export const CHAIN_OPTIONS: ChainOption[] = [
  {
    id: "arc-testnet",
    family: "evm",
    name: "Arc",
    subtitle: "EVM · USDC is the native gas token",
    badge: "EVM",
  },
  {
    id: "stellar-testnet",
    family: "stellar",
    name: "Stellar",
    subtitle: "Soroban · sub-cent fees, instant finality",
    badge: "SOROBAN",
  },
];

export interface WalletMeta {
  id: string;
  name: string;
  family: WalletFamily;
  installUrl: string;
}

/**
 * Stellar wallets.
 *
 * Unlike EVM, Stellar has no EIP-6963-style discovery standard, so each wallet
 * is detected by the global it injects. Only wallets we can actually drive are
 * listed — a wallet we cannot connect has no business appearing in the picker.
 */
export const STELLAR_WALLETS: WalletMeta[] = [
  {
    id: "freighter",
    name: "Freighter",
    family: "stellar",
    installUrl: "https://www.freighter.app/",
  },
  {
    id: "xbull",
    name: "xBull",
    family: "stellar",
    installUrl: "https://xbull.app/",
  },
  {
    id: "rabet",
    name: "Rabet",
    family: "stellar",
    installUrl: "https://rabet.io/",
  },
];

/** Install links for common EVM wallets that have not announced themselves. */
export const EVM_WALLET_HINTS: WalletMeta[] = [
  { id: "metaMask", name: "MetaMask", family: "evm", installUrl: "https://metamask.io/download/" },
  { id: "zerion", name: "Zerion", family: "evm", installUrl: "https://zerion.io/download" },
  {
    id: "coinbaseWalletSDK",
    name: "Coinbase Wallet",
    family: "evm",
    installUrl: "https://www.coinbase.com/wallet/downloads",
  },
  { id: "bitget", name: "Bitget Wallet", family: "evm", installUrl: "https://web3.bitget.com/en/wallet-download" },
  { id: "rabby", name: "Rabby", family: "evm", installUrl: "https://rabby.io/" },
];

type StellarProvider = {
  getPublicKey?: () => Promise<string>;
  getAddress?: () => Promise<{ address: string } | string>;
  requestAccess?: () => Promise<{ address?: string } | string>;
  connect?: () => Promise<unknown>;
  getUserInfo?: () => Promise<{ publicKey?: string }>;
};

function stellarGlobal(id: string): StellarProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, StellarProvider | undefined>;
  if (id === "freighter") return w.freighterApi ?? w.freighter;
  if (id === "xbull") return w.xBullSDK;
  if (id === "rabet") return w.rabet;
  return undefined;
}

/** Is this Stellar wallet actually installed in the browser right now? */
export function isStellarWalletAvailable(id: string): boolean {
  return stellarGlobal(id) !== undefined;
}

/**
 * Connect a Stellar wallet and return its public key.
 *
 * Each wallet exposes a slightly different API — and Freighter itself changed
 * shape between versions — so every known entry point is tried before giving
 * up, rather than assuming one and silently failing.
 */
export async function connectStellarWallet(id: string): Promise<string> {
  const provider = stellarGlobal(id);
  if (!provider) {
    const meta = STELLAR_WALLETS.find((w) => w.id === id);
    throw new Error(`${meta?.name ?? "That wallet"} is not installed in this browser.`);
  }

  if (typeof provider.requestAccess === "function") {
    const res = await provider.requestAccess();
    const address = typeof res === "string" ? res : res?.address;
    if (address) return address;
  }

  if (typeof provider.getAddress === "function") {
    const res = await provider.getAddress();
    const address = typeof res === "string" ? res : res?.address;
    if (address) return address;
  }

  if (typeof provider.connect === "function" && typeof provider.getUserInfo === "function") {
    await provider.connect();
    const info = await provider.getUserInfo();
    if (info?.publicKey) return info.publicKey;
  }

  if (typeof provider.getPublicKey === "function") {
    const key = await provider.getPublicKey();
    if (key) return key;
  }

  throw new Error("Wallet did not return an address. Unlock it and try again.");
}
