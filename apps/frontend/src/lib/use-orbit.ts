"use client";

import { useCallback } from "react";
import { useAccount, useConnect, useDisconnect, usePublicClient, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";

import { ORBIT_PULLER_ABI, ERC20_ABI } from "./orbit-abi";
import { ARC_USDC_ADDRESS, ARC_USDC_DECIMALS, ORBIT_PULLER_ADDRESS, arcTestnet } from "./chains";
import { toBaseUnits } from "./utils";

export type TxResult = { hash: `0x${string}`; explorerUrl: string };

/** Turn a contract revert into something a merchant can act on. */
export function describeOrbitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/TooEarlyToPull/i.test(raw)) {
    return "Not due yet — this subscriber's billing interval has not elapsed.";
  }
  if (/VaultNotFound/i.test(raw)) {
    return "No active allowance vault for this subscriber. They may have cancelled.";
  }
  if (/InvalidParams/i.test(raw)) {
    return "Invalid input — check the recipient addresses and amounts.";
  }
  if (/LengthMismatch/i.test(raw)) {
    return "Recipient and amount counts do not match.";
  }
  if (/insufficient allowance|ERC20InsufficientAllowance/i.test(raw)) {
    return "The subscriber revoked their USDC approval, so funds cannot be pulled.";
  }
  if (/insufficient balance|ERC20InsufficientBalance|transfer amount exceeds/i.test(raw)) {
    return "Insufficient USDC balance to complete this transfer.";
  }
  if (/User rejected|denied transaction|UserRejected/i.test(raw)) {
    return "Transaction rejected in your wallet.";
  }
  if (/chain|network/i.test(raw) && /mismatch|switch/i.test(raw)) {
    return "Wrong network — switch your wallet to Arc Testnet.";
  }
  return raw.split("\n")[0].slice(0, 200);
}

function explorerTx(hash: string) {
  return `${arcTestnet.blockExplorers.default.url}/tx/${hash}`;
}

/**
 * Orbit's on-chain actions for the Arc rail.
 *
 * Every write waits for the receipt before resolving, so the dashboard only
 * updates after the chain has actually accepted it. The previous mock resolved
 * on a timer and would happily show "settled" for a transaction that reverted.
 */
export function useOrbitArc() {
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const onArc = chainId === arcTestnet.id;

  const connect = useCallback(async () => {
    const res = await connectAsync({ connector: injected(), chainId: arcTestnet.id });
    return res.accounts[0];
  }, [connectAsync]);

  const waitFor = useCallback(
    async (hash: `0x${string}`): Promise<TxResult> => {
      if (!publicClient) throw new Error("No RPC client available.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Transaction reverted on-chain.");
      }
      return { hash, explorerUrl: explorerTx(hash) };
    },
    [publicClient]
  );

  /** Check how much USDC the subscriber has approved OrbitPuller to move. */
  const readAllowance = useCallback(
    async (owner: `0x${string}`) => {
      if (!publicClient) throw new Error("No RPC client available.");
      return publicClient.readContract({
        address: ARC_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, ORBIT_PULLER_ADDRESS],
      });
    },
    [publicClient]
  );

  /**
   * Ask the chain whether a pull would succeed, before spending gas finding out.
   * Drives the enabled state of "Execute Pull".
   */
  const isPullable = useCallback(
    async (user: `0x${string}`, merchant: `0x${string}`) => {
      if (!publicClient) return false;
      try {
        return await publicClient.readContract({
          address: ORBIT_PULLER_ADDRESS,
          abi: ORBIT_PULLER_ABI,
          functionName: "isPullable",
          args: [user, merchant],
        });
      } catch {
        return false;
      }
    },
    [publicClient]
  );

  /** Subscriber authorizes a merchant. Amount is human-readable (29.5). */
  const createVault = useCallback(
    async (merchant: `0x${string}`, amount: string | number, intervalSeconds: number) => {
      const hash = await writeContractAsync({
        address: ORBIT_PULLER_ADDRESS,
        abi: ORBIT_PULLER_ABI,
        functionName: "createVault",
        args: [
          merchant,
          ARC_USDC_ADDRESS,
          toBaseUnits(amount, ARC_USDC_DECIMALS),
          BigInt(intervalSeconds),
        ],
        chainId: arcTestnet.id,
      });
      return waitFor(hash);
    },
    [writeContractAsync, waitFor]
  );

  /** Approve OrbitPuller to move USDC. Amount is human-readable. */
  const approveUsdc = useCallback(
    async (amount: string | number) => {
      const hash = await writeContractAsync({
        address: ARC_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ORBIT_PULLER_ADDRESS, toBaseUnits(amount, ARC_USDC_DECIMALS)],
        chainId: arcTestnet.id,
      });
      return waitFor(hash);
    },
    [writeContractAsync, waitFor]
  );

  /** Merchant collects one interval from a subscriber. */
  const pullFunds = useCallback(
    async (subscriber: `0x${string}`) => {
      const hash = await writeContractAsync({
        address: ORBIT_PULLER_ADDRESS,
        abi: ORBIT_PULLER_ABI,
        functionName: "pullFunds",
        args: [subscriber],
        chainId: arcTestnet.id,
      });
      return waitFor(hash);
    },
    [writeContractAsync, waitFor]
  );

  /**
   * Atomic payroll. All recipients settle or none do.
   * Amounts are human-readable and converted at this boundary.
   */
  const batchDisburse = useCallback(
    async (recipients: `0x${string}`[], amounts: (string | number)[]) => {
      if (recipients.length !== amounts.length) {
        throw new Error("Recipient and amount counts do not match.");
      }
      const hash = await writeContractAsync({
        address: ORBIT_PULLER_ADDRESS,
        abi: ORBIT_PULLER_ABI,
        functionName: "batchDisburse",
        args: [
          ARC_USDC_ADDRESS,
          recipients,
          amounts.map((a) => toBaseUnits(a, ARC_USDC_DECIMALS)),
        ],
        chainId: arcTestnet.id,
      });
      return waitFor(hash);
    },
    [writeContractAsync, waitFor]
  );

  return {
    address,
    isConnected,
    onArc,
    connect,
    disconnect,
    readAllowance,
    isPullable,
    createVault,
    approveUsdc,
    pullFunds,
    batchDisburse,
  };
}
