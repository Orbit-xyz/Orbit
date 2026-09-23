export type DashboardTab =
  | "overview"
  | "plans"
  | "subscribers"
  | "payroll"
  | "links"
  | "developers";

export type NetworkId = "stellar-testnet";

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  badge: string;
  currency: string;
  explorerUrl: string;
  contractStandard: string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  "stellar-testnet": {
    id: "stellar-testnet",
    name: "Stellar Testnet",
    badge: "Soroban Rust",
    currency: "USDC",
    explorerUrl: "https://stellar.expert/explorer/testnet",
    contractStandard: "SEP-0041 / Soroban Vault",
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
