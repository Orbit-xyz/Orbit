export type DashboardTab =
  | "overview"
  | "plans"
  | "subscribers"
  | "payroll"
  | "links"
  | "developers";

export type NetworkId = "stellar-testnet" | "arc-testnet";

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  badge: string;
  currency: string;
  explorerUrl: string;
  contractStandard: string;
  /**
   * Decimal precision of USDC on this rail. The same asset is NOT encoded the
   * same way on both chains, so never hardcode a divisor — read it from here
   * and convert with `toBaseUnits` / `formatUsdc` in `lib/utils`.
   */
  decimals: number;
  /** Deployed Orbit settlement contract on this rail. */
  contractAddress: string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  "stellar-testnet": {
    id: "stellar-testnet",
    name: "Stellar Testnet",
    badge: "Soroban Rust",
    currency: "USDC",
    explorerUrl: "https://stellar.expert/explorer/testnet",
    contractStandard: "SEP-0041 / Soroban Vault",
    decimals: 7,
    contractAddress: "CAZBZBUWBSQYK2RZ6WHMXVDLIQHSU5WD7ANZYL6HLNSCRUOTNYCDYQNG",
  },
  "arc-testnet": {
    id: "arc-testnet",
    name: "Arc Testnet",
    badge: "EVM Solidity",
    currency: "USDC",
    // Verified live: Arc's explorer is Blockscout at explorer.testnet.arc.io.
    // The previous value (scan.arc.network) was not a real Arc domain, so every
    // address link rendered from it would have 404'd.
    explorerUrl: "https://explorer.testnet.arc.io",
    contractStandard: "ERC-20 Permit / OrbitPuller",
    // ERC-20 interface is 6 decimals. Arc's NATIVE gas view of the same USDC
    // balance is 18 — always read through the ERC-20 interface, never native.
    decimals: 6,
    contractAddress: "0x2c0c751e40b89a01309548DaBe7937754447aC92",
  },
};

export interface SubscriptionPlan {
  id: string;
  name: string;
  amount: number;
  currency: string;
  intervalDays: number;
  network: NetworkId;
  activeSubscribers: number;
  status: "active" | "archived";
  createdAt: string;
}

export interface SubscriberRecord {
  id: string;
  walletAddress: string;
  planId: string;
  planName: string;
  amount: number;
  network: NetworkId;
  status: "active" | "pending_pull" | "past_due";
  nextPullDate: string;
  totalSettled: number;
  joinedDate: string;
}

export interface PayrollRecipient {
  id: string;
  name: string;
  walletAddress: string;
  amount: number;
  role: string;
  network: NetworkId;
  status: "ready" | "disbursed" | "failed";
}

export interface PaymentLink {
  id: string;
  title: string;
  amount: number;
  currency: string;
  type: "recurring" | "one_time";
  intervalDays?: number;
  url: string;
  clicks: number;
  conversions: number;
  network: NetworkId;
  status: "active" | "disabled";
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  fullKeyPreview: string;
  environment: "test" | "live";
  lastUsed: string;
  createdAt: string;
}
