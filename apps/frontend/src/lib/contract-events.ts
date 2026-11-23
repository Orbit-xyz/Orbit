/** Pure presentation helpers for Orbit's finalized Soroban event feed (#380). */

export type ContractEventKind = "create_vault" | "pull_funds" | "cancel_vault" | "other";
export type ContractEventStatus = "SUCCESS" | "FAILED";

export interface ContractEventRecord {
  id: string;
  name: string;
  kind: ContractEventKind;
  status: ContractEventStatus;
  ledger: number;
  txHash: string;
  user: string;
  merchant: string;
  amount: string;
  topics: unknown[];
  value: unknown;
  rawXdr: string;
  receivedAt: number;
}

export type ContractEventFilters = {
  type: ContractEventKind | "all";
  status: ContractEventStatus | "all";
  wallet: string;
};

export function classifyContractEvent(name: string): ContractEventKind {
  switch (name) {
    case "vault_created":
    case "trial_vault_created":
    case "vault_delegated":
      return "create_vault";
    case "funds_pulled":
      return "pull_funds";
    case "vault_cancelled":
      return "cancel_vault";
    default:
      return "other";
  }
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

/** Normalize already-decoded RPC topics and values without losing raw data. */
export function normalizeContractEvent(input: {
  id: string;
  name: string;
  ledger: number;
  txHash?: string;
  topics?: unknown[];
  value?: unknown;
  rawXdr?: string;
  status?: ContractEventStatus;
  receivedAt?: number;
}): ContractEventRecord {
  const topics = input.topics ?? [];
  const values = Array.isArray(input.value) ? input.value : [input.value];
  const wallet = text(topics[1]);
  const merchant = text(topics[2]);
  const amount = text(values[0]);
  return {
    id: input.id,
    name: input.name,
    kind: classifyContractEvent(input.name),
    status: input.status ?? "SUCCESS",
    ledger: input.ledger,
    txHash: input.txHash ?? "",
    user: wallet,
    merchant,
    amount,
    topics,
    value: input.value ?? null,
    rawXdr: input.rawXdr ?? "",
    receivedAt: input.receivedAt ?? Date.now(),
  };
}

export function filterContractEvents(
  events: readonly ContractEventRecord[],
  filters: ContractEventFilters,
): ContractEventRecord[] {
  const wallet = filters.wallet.trim().toLowerCase();
  return events.filter((event) => {
    if (filters.type !== "all" && event.kind !== filters.type) return false;
    if (filters.status !== "all" && event.status !== filters.status) return false;
    if (!wallet) return true;
    return (
      event.user.toLowerCase().includes(wallet) ||
      event.merchant.toLowerCase().includes(wallet) ||
      event.txHash.toLowerCase().includes(wallet) ||
      JSON.stringify(event.topics, (_, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      ).toLowerCase().includes(wallet)
    );
  });
}
