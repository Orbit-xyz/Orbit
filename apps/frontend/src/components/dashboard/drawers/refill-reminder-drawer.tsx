"use client";

import { useEffect, useState } from "react";
import {
  X,
  Mail,
  Calendar,
  AlertTriangle,
  ExternalLink,
  Send,
  RotateCw,
  Wallet,
} from "lucide-react";
import type { SubscriberRecord } from "../dashboard-types";

export interface RefillReminderDrawerProps {
  isOpen: boolean;
  subscriber: SubscriberRecord | null;
  isSending: boolean;
  blockedReason: string | null;
  onClose: () => void;
  onDispatch: (subscriber: SubscriberRecord, customNote: string) => Promise<void> | void;
}

function truncateWallet(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function RefillReminderDrawer({
  isOpen,
  subscriber,
  isSending,
  blockedReason,
  onClose,
  onDispatch,
}: RefillReminderDrawerProps) {
  const [customNote, setCustomNote] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setCustomNote("");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSending) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, subscriber?.id, isSending, onClose]);

  if (!isOpen || !subscriber) return null;

  const customerLabel = truncateWallet(subscriber.walletAddress);
  const formattedPrice = `$${subscriber.amount.toFixed(2)} USDC`;
  const nextPullDisplay = subscriber.nextBillingAt
    ? new Date(subscriber.nextBillingAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : subscriber.nextPullDate;
  const topUpUrl = `/pay/${encodeURIComponent(subscriber.planId)}?topup=${encodeURIComponent(subscriber.walletAddress)}`;
  const currentBalance = subscriber.liquidity?.balance;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSending || blockedReason) return;
    await onDispatch(subscriber, customNote.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refill-reminder-drawer-title"
      onClick={() => {
        if (!isSending) onClose();
      }}
    >
      <div
        className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl border-l border-black/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-neutral-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
              <Mail size={16} />
            </div>
            <div>
              <h3
                id="refill-reminder-drawer-title"
                className="text-sm font-bold text-black tracking-tight"
              >
                Send Balance Reminder
              </h3>
              <p className="text-[11px] text-neutral-500">
                Preview and dispatch an allowance refill alert to this subscriber
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            aria-label="Close refill reminder drawer"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-black hover:bg-neutral-200/70 transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          {/* Subscriber Summary */}
          <div className="rounded-xl border border-black/10 bg-neutral-50 p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-neutral-500 flex items-center gap-1.5">
                <Wallet size={13} />
                Subscriber
              </span>
              <span className="font-mono font-semibold text-black" title={subscriber.walletAddress}>
                {customerLabel}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-500">Plan &amp; Price</span>
              <span className="font-semibold text-black">
                {subscriber.planName} · {formattedPrice}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-500 flex items-center gap-1.5">
                <Calendar size={13} />
                Next Pull Due
              </span>
              <span className="font-semibold text-amber-800">
                {nextPullDisplay}
              </span>
            </div>
            {currentBalance !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-neutral-500">Current USDC Balance</span>
                <span className="font-mono font-semibold text-red-700">
                  ${currentBalance.toFixed(2)} USDC
                </span>
              </div>
            )}
          </div>

          {blockedReason && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900"
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{blockedReason}</span>
            </div>
          )}

          {/* Optional Custom Note */}
          <div className="space-y-1.5">
            <label
              htmlFor="refill-reminder-custom-note"
              className="block text-xs font-semibold text-black"
            >
              Personalized note <span className="font-normal text-neutral-400">(optional)</span>
            </label>
            <textarea
              id="refill-reminder-custom-note"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="Add a friendly reminder or support contact for your subscriber..."
              className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-xs text-black placeholder:text-neutral-400 focus:border-black focus:outline-none resize-none"
            />
          </div>

          {/* Interactive Email Preview */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-black">
              Email Preview
            </span>
            <div className="rounded-xl border border-black/10 bg-white p-4 shadow-2xs space-y-3 text-xs text-neutral-700 leading-relaxed">
              <div className="border-b border-black/5 pb-2">
                <div className="text-[11px] text-neutral-400">Subject</div>
                <div className="font-semibold text-black">
                  Action needed: Top up your wallet for {subscriber.planName} ({formattedPrice})
                </div>
              </div>
              <p>Hi {customerLabel},</p>
              <p>
                Your upcoming subscription renewal for{" "}
                <strong className="text-black">{subscriber.planName}</strong> (
                <strong className="text-black">{formattedPrice}</strong>) is scheduled for{" "}
                <strong className="text-black">{nextPullDisplay}</strong>. Your connected
                Stellar wallet currently has a low USDC balance or allowance, which could cause
                the renewal pull to fail.
              </p>
              {customNote.trim() && (
                <blockquote className="border-l-2 border-indigo-500 bg-indigo-50/50 px-3 py-2 text-neutral-800 italic">
                  {customNote.trim()}
                </blockquote>
              )}
              <div className="pt-1">
                <a
                  href={topUpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3.5 py-2 text-xs font-semibold text-white hover:bg-neutral-800 transition-colors"
                >
                  <span>Top Up Wallet</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-black/10 bg-neutral-50/70">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="button button-secondary h-9 px-4 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSending || blockedReason !== null}
            onClick={() => {
              if (!isSending && !blockedReason) {
                void onDispatch(subscriber, customNote.trim());
              }
            }}
            className="button button-primary h-9 px-4 text-xs inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <>
                <RotateCw size={13} className="animate-spin" />
                <span>Sending Reminder...</span>
              </>
            ) : (
              <>
                <Send size={13} />
                <span>Send Balance Reminder</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
