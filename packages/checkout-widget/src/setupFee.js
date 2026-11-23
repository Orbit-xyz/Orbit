/**
 * One-time onboarding/setup fee pricing breakdown and initial authorization
 * calculation for <OrbitCheckout /> (#368).
 */

export const STROOPS_PER_USDC = 10_000_000n;

/**
 * Normalize a `setupFee` prop (in USDC) to a non-negative finite number
 * rounded to 2 decimal places. Returns 0 when unset or <= 0.
 */
export function normalizeSetupFee(setupFee) {
  if (setupFee === null || setupFee === undefined || setupFee === "") {
    return 0;
  }
  const parsed = Number(setupFee);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.round(parsed * 100) / 100;
}

/**
 * Convert a USDC decimal amount to 7-decimal Stellar stroops (BigInt).
 */
export function usdcToStroops(amountUsdc) {
  const num = Number(amountUsdc);
  if (!Number.isFinite(num) || num <= 0) return 0n;
  return BigInt(Math.round(num * 10_000_000));
}

/**
 * Human-readable billing cadence label from `intervalSeconds`.
 */
export function formatCadenceLabel(intervalSeconds = 2_592_000) {
  const days = Math.round(Number(intervalSeconds || 2_592_000) / 86_400);
  if (days >= 360 && days <= 370) return "year";
  if (days >= 28 && days <= 31) return "month";
  if (days === 7) return "week";
  if (days === 1) return "day";
  return `${days} days`;
}

/**
 * Build the itemized pricing breakdown when `setupFee > 0` and compute the
 * exact initial authorization amount (setup fee + first billing cycle) in both
 * USDC and stroops.
 */
export function calculateSetupFeeBreakdown({
  recurringAmountUsdc,
  setupFee = 0,
  intervalSeconds = 2_592_000,
  currency = "USDC",
}) {
  const recurringUsdc = Math.max(0, Number(recurringAmountUsdc) || 0);
  const setupFeeUsdc = normalizeSetupFee(setupFee);
  const totalDueTodayUsdc = Math.round((recurringUsdc + setupFeeUsdc) * 100) / 100;
  const cadenceLabel = formatCadenceLabel(intervalSeconds);
  const hasSetupFee = setupFeeUsdc > 0;

  const recurringStroops = usdcToStroops(recurringUsdc);
  const setupFeeStroops = usdcToStroops(setupFeeUsdc);
  const initialAuthorizationStroops = (recurringStroops + setupFeeStroops).toString();

  return {
    hasSetupFee,
    setupFeeUsdc,
    recurringUsdc,
    totalDueTodayUsdc,
    cadenceLabel,
    setupFeeStroops: setupFeeStroops.toString(),
    initialAuthorizationStroops,
    lines: {
      setupFee: `Setup Fee: $${setupFeeUsdc.toFixed(2)} ${currency} (due today)`,
      recurring: `Recurring Plan: $${recurringUsdc.toFixed(2)} ${currency} / ${cadenceLabel}`,
      totalDueToday: `Total Due Today: $${totalDueTodayUsdc.toFixed(2)} ${currency}`,
    },
  };
}

/**
 * Compute the Freighter authorization amount string (in stroops) by adding
 * any one-time setup fee to the first billing cycle's base authorization amount.
 */
export function initialAuthAmountWithSetupFee(baseAmountStroops, setupFee = 0) {
  const base = BigInt(baseAmountStroops);
  const feeStroops = usdcToStroops(normalizeSetupFee(setupFee));
  return (base + feeStroops).toString();
}
