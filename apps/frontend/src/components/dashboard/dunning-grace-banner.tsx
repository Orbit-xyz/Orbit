"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Clock, RefreshCw, X, ChevronRight } from "lucide-react";
import {
  computeRemainingTime,
  formatRemainingTime,
} from "./dunning-grace-utils.mjs";

export { computeRemainingTime, formatRemainingTime };

export interface RemainingTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  isExpired: boolean;
}

export interface DunningGraceBannerProps {
  subscriptionId?: string;
  planName?: string;
  merchantName?: string;
  expiresAt: string | number | Date;
  amountUsdc?: string | number;
  currency?: string;
  onRetry?: () => Promise<void> | void;
  onDismiss?: () => void;
  className?: string;
  storageKeyPrefix?: string;
}

export function DunningGraceBanner({
  subscriptionId,
  planName,
  merchantName,
  expiresAt,
  amountUsdc,
  currency = "USDC",
  onRetry,
  onDismiss,
  className = "",
  storageKeyPrefix = "orbit_dunning_dismissed_",
}: DunningGraceBannerProps) {
  const sessionKey = `${storageKeyPrefix}${subscriptionId || "global"}`;

  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrySuccess, setRetrySuccess] = useState(false);
  const [remaining, setRemaining] = useState<RemainingTime>(() =>
    computeRemainingTime(expiresAt)
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem(sessionKey);
        if (stored === "true") {
          setDismissed(true);
        }
      } catch {
        // Ignore sessionStorage read errors in private browsing/sandboxes
      }
    }
  }, [sessionKey]);

  useEffect(() => {
    const update = () => {
      setRemaining(computeRemainingTime(expiresAt));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(sessionKey, "true");
      } catch {
        // Ignore storage errors
      }
    }
    onDismiss?.();
  }, [sessionKey, onDismiss]);

  const handleRestore = useCallback(() => {
    setDismissed(false);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(sessionKey);
      } catch {
        // Ignore storage errors
      }
    }
  }, [sessionKey]);

  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryError(null);
    setRetrySuccess(false);
    try {
      await onRetry();
      setRetrySuccess(true);
    } catch (err) {
      setRetryError(
        err instanceof Error ? err.message : "Payment retry failed. Please check funds."
      );
    } finally {
      setRetrying(false);
    }
  };

  // Persistent collapsed badge when dismissed for the session
  if (dismissed) {
    return (
      <aside
        role="status"
        aria-label="Past due subscription notice"
        className={`flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 shadow-sm ${className}`}
      >
        <button
          onClick={handleRestore}
          className="flex items-center gap-1.5 text-left hover:underline focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <span>
            Payment past due
            {remaining.isExpired ? (
              <strong className="text-red-700"> (Grace period ended)</strong>
            ) : (
              <span> (Grace period ending in {formatRemainingTime(remaining)})</span>
            )}
            {" — "}
            <span className="font-semibold underline">Review &amp; Retry</span>
          </span>
        </button>
        <button
          onClick={handleRestore}
          aria-label="Expand alert banner"
          className="ml-2 text-amber-700 hover:text-amber-900 p-1"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  const isExpired = remaining.isExpired;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`relative overflow-hidden rounded-xl border p-4 sm:p-5 shadow-sm transition-all ${
        isExpired
          ? "border-red-300 bg-red-50 text-red-950"
          : "border-amber-300 bg-gradient-to-r from-amber-50 via-amber-50/80 to-orange-50 text-amber-950"
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
              isExpired ? "bg-red-200 text-red-800" : "bg-amber-200 text-amber-800"
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-sm sm:text-base">
                {isExpired
                  ? "Subscription Grace Period Expired"
                  : "Action Required: Payment Past Due"}
              </h3>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  isExpired
                    ? "bg-red-200/80 text-red-800"
                    : "bg-amber-200/80 text-amber-850"
                }`}
              >
                <Clock className="h-3 w-3" />
                {isExpired ? "Suspended" : formatRemainingTime(remaining)}
              </span>
            </div>

            <p className="mt-1 text-xs sm:text-sm text-neutral-700 leading-relaxed">
              {isExpired ? (
                <>
                  Your subscription to{" "}
                  <strong>{planName || "active plan"}</strong>
                  {merchantName ? ` by ${merchantName}` : ""} has exceeded its grace
                  period. Service access is paused until payment is settled.
                </>
              ) : (
                <>
                  Your recent renewal payment for{" "}
                  <strong>{planName || "your subscription"}</strong>
                  {amountUsdc ? ` (${amountUsdc} ${currency})` : ""} could not be
                  processed. To avoid service disruption, please retry or update your
                  wallet balance before the grace period ends.
                </>
              )}
            </p>

            {retryError && (
              <p className="mt-2 text-xs font-semibold text-red-700">{retryError}</p>
            )}
            {retrySuccess && (
              <p className="mt-2 text-xs font-semibold text-emerald-700">
                Payment retry successful! Refreshing subscription status...
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {onRetry && (
                <button
                  type="button"
                  disabled={retrying}
                  onClick={handleRetry}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${
                    isExpired
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-amber-600 hover:bg-amber-700"
                  }`}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
                  />
                  {retrying
                    ? "Retrying payment..."
                    : isExpired
                    ? "Reactivate subscription"
                    : "Retry payment now"}
                </button>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss banner"
          className="text-neutral-500 hover:text-neutral-800 p-1 rounded-md transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default DunningGraceBanner;
