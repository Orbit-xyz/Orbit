import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------------- */
/*  USDC amount handling                                                      */
/* -------------------------------------------------------------------------- */
/*
 *  Orbit settles the same asset on rails with DIFFERENT decimal precision:
 *
 *    Stellar (Soroban SAC USDC) .... 7 decimals
 *    Arc (ERC-20 USDC) ............. 6 decimals
 *
 *  On Arc there is a further trap: the NATIVE gas view of USDC uses 18
 *  decimals while the ERC-20 interface uses 6, and both describe the same
 *  balance. Circle's guidance is to read balances only through the ERC-20
 *  interface. Reading the native one and formatting it as 6 decimals would
 *  display an amount 10^12 too large.
 *
 *  The rule this module enforces:
 *
 *    Store and display HUMAN-READABLE decimal amounts (29.5).
 *    Convert to base units ONLY at the chain boundary, using that chain's
 *    decimals from NETWORKS[id].decimals.
 *
 *  All conversion goes through BigInt. Doing it with floats silently loses
 *  precision on values a payment processor will absolutely encounter.
 */

/**
 * Convert a human-readable amount into chain base units.
 *
 * @throws if the amount has more decimal places than the chain can represent.
 *         Truncating money silently is exactly the bug this module exists to
 *         prevent, so the caller must round explicitly before calling.
 *
 * @example toBaseUnits("29.50", 6) === 29500000n   // Arc
 * @example toBaseUnits("29.50", 7) === 295000000n  // Stellar
 */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }

  // Avoid Number's exponential notation ("1e-7") reaching the parser.
  const raw = typeof amount === "number" ? amount.toFixed(decimals) : amount.trim();

  if (!/^-?\d*(\.\d+)?$/.test(raw) || raw === "" || raw === "-") {
    throw new Error(`Invalid amount: ${JSON.stringify(amount)}`);
  }

  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = (negative ? raw.slice(1) : raw).split(".");

  if (fraction.length > decimals) {
    throw new Error(
      `Amount ${raw} has ${fraction.length} decimal places but this chain supports ${decimals}. ` +
        `Round before converting — do not truncate silently.`
    );
  }

  const padded = fraction.padEnd(decimals, "0");
  const base = BigInt(`${whole || "0"}${padded}`);
  return negative ? -base : base;
}

/**
 * Convert chain base units into a human-readable string.
 *
 * @example formatUsdc(29500000n, 6) === "29.50"   // Arc
 * @example formatUsdc(295000000n, 7) === "29.50"  // Stellar
 */
export function formatUsdc(
  baseUnits: bigint | string | number,
  decimals: number,
  fractionDigits = 2
): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }

  let value: bigint;
  try {
    value = typeof baseUnits === "bigint" ? baseUnits : BigInt(String(baseUnits).trim());
  } catch {
    throw new Error(`Invalid base-unit amount: ${JSON.stringify(baseUnits)}`);
  }

  const negative = value < 0n;
  const abs = negative ? -value : value;

  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(decimals, "0");

  // Round at the requested display precision rather than truncating, so a
  // balance of 0.999 never renders as "0.99".
  let shown = fraction.slice(0, fractionDigits);
  const nextDigit = fraction[fractionDigits];
  let wholeOut = whole;

  if (nextDigit !== undefined && Number(nextDigit) >= 5) {
    const bumped = BigInt(shown || "0") + 1n;
    const limit = 10n ** BigInt(fractionDigits);
    if (fractionDigits === 0 || bumped >= limit) {
      wholeOut += 1n;
      shown = "".padStart(fractionDigits, "0");
    } else {
      shown = bumped.toString().padStart(fractionDigits, "0");
    }
  }

  const sign = negative && (wholeOut !== 0n || BigInt(shown || "0") !== 0n) ? "-" : "";
  return fractionDigits > 0 ? `${sign}${wholeOut}.${shown}` : `${sign}${wholeOut}`;
}

/**
 * Human-readable amount straight to a display string, for values already held
 * as decimals (which is how the dashboard and database store them).
 *
 * @example formatAmount(29) === "29.00"
 */
export function formatAmount(amount: number, fractionDigits = 2): string {
  return amount.toFixed(fractionDigits);
}
