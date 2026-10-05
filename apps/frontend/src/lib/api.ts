import { SubscriberRecord } from "@/components/dashboard/dashboard-types";

export const ORBIT_API_URL =
  process.env.NEXT_PUBLIC_ORBIT_API_URL || "http://localhost:3001";

export interface ApiSubscriptionItem {
  id: string;
  plan_id: string;
  customer_wallet_address: string;
  status: string;
  next_billing_date: string;
  created_at: string;
  plans?: {
    merchant_id?: string;
    name?: string;
    usdc_amount?: number | string;
    interval_seconds?: number | string;
  };
}

export interface GetSubscribersResponse {
  subscribers: ApiSubscriptionItem[];
}

/**
 * Fetches subscribers for a specific merchant from the Merchant API.
 */
export async function fetchSubscribers(
  merchantId: string,
  signal?: AbortSignal
): Promise<ApiSubscriptionItem[]> {
  const url = new URL("/subscribers", ORBIT_API_URL);
  url.searchParams.set("merchant_id", merchantId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    signal,
  });

  if (!res.ok) {
    let errorMsg = `Failed to fetch subscribers (${res.status} ${res.statusText})`;
    try {
      const errorJson = await res.json();
      if (errorJson && typeof errorJson.error === "string") {
        errorMsg = errorJson.error;
      }
    } catch {
      // Fallback to HTTP error
    }
    throw new Error(errorMsg);
  }

  const data: GetSubscribersResponse = await res.json();
  return data.subscribers || [];
}

/**
 * Maps a Supabase API subscription record to the frontend's SubscriberRecord.
 */
export function mapApiSubscriberToRecord(
  item: ApiSubscriptionItem
): SubscriberRecord {
  const now = new Date();
  const nextBilling = new Date(item.next_billing_date);
  const isValidNextBilling = !isNaN(nextBilling.getTime());
  const isDue = isValidNextBilling && nextBilling.getTime() <= now.getTime();

  let status: "active" | "pending_pull" | "past_due" = "active";
  if (item.status === "past_due" || item.status === "cancelled") {
    status = "past_due";
  } else if (isDue || item.status === "pending_pull") {
    status = "pending_pull";
  }

  let nextPullDate = "Active";
  if (isDue) {
    nextPullDate = "Due Now";
  } else if (isValidNextBilling) {
    const diffMs = nextBilling.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    nextPullDate =
      diffDays > 0 ? `In ${diffDays} ${diffDays === 1 ? "day" : "days"}` : "Due Now";
  }

  const createdDate = new Date(item.created_at);
  const joinedDate = !isNaN(createdDate.getTime())
    ? createdDate.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
      })
    : "Recent";

  const amount = Number(item.plans?.usdc_amount || 0);

  return {
    id: item.id,
    walletAddress: item.customer_wallet_address,
    planId: item.plan_id,
    planName: item.plans?.name || "Subscription Plan",
    amount,
    network: "stellar-testnet",
    status,
    nextPullDate,
    totalSettled: amount, // Defaults to 1 billing period settled
    joinedDate,
  };
}
