import { defineChain } from "viem";

/**
 * Arc — Circle's EVM Layer-1, where USDC is the native gas token.
 *
 * Values verified live against the chain (see Docs/Build_Guide.md Task 6.0),
 * not copied from a chain list.
 *
 * ⚠ `nativeCurrency.decimals` is 18 because that is what the NATIVE gas view
 * uses. The ERC-20 interface for the same USDC balance uses 6. Never use this
 * value to format a token amount — read decimals from NETWORKS in
 * dashboard-types.ts, which is the ERC-20 figure Orbit settles in.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.io"], webSocket: ["wss://rpc.testnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.arc.io"] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

/**
 * USDC on Arc. Same system address on testnet and mainnet.
 *
 * Unusually, this is both the native gas token AND a standard ERC-20 — the two
 * interfaces share one balance, so there is no wrapped USDC to bridge through.
 */
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

/** ERC-20 decimals for USDC on Arc. The native gas view uses 18 — do not mix them. */
export const ARC_USDC_DECIMALS = 6;

/** Deployed OrbitPuller on Arc testnet. Verified on explorer.testnet.arc.io. */
export const ORBIT_PULLER_ADDRESS = "0x2c0c751e40b89a01309548DaBe7937754447aC92" as const;

/** Permit2, canonical address — for gasless approvals (not yet wired). */
export const ARC_PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
