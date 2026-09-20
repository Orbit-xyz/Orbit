/*
 * USDC amount handling for the Orbit checkout widget.
 *
 * This package ships standalone to merchant sites, so it cannot import from
 * apps/frontend. Keep this in sync with apps/frontend/src/lib/utils.ts.
 *
 * Orbit settles the same asset on rails with DIFFERENT decimal precision:
 *
 *   Stellar (Soroban SAC USDC) .... 7 decimals
 *   Arc (ERC-20 USDC) ............. 6 decimals
 *
 * Amounts are stored and displayed as human-readable decimals (29.5) and
 * converted to base units only at the chain boundary. Never hardcode a
 * divisor — read decimals from NETWORKS.
 */

export const NETWORKS = {
  "stellar-testnet": {
    id: "stellar-testnet",
    name: "Stellar Testnet",
    decimals: 7,
    walletName: "Freighter",
  },
  "arc-testnet": {
    id: "arc-testnet",
    name: "Arc Testnet",
    // ERC-20 interface is 6 decimals. Arc's native gas view of the same
    // balance is 18 — always read through the ERC-20 interface.
    decimals: 6,
    walletName: "MetaMask",
  },
};

export const DEFAULT_NETWORK = "arc-testnet";

export function networkConfig(networkId) {
  return NETWORKS[networkId] || NETWORKS[DEFAULT_NETWORK];
}

/**
 * Human-readable amount -> chain base units.
 * Throws rather than truncating: silently losing money is the bug this exists
 * to prevent.
 */
export function toBaseUnits(amount, decimals) {
  const raw = typeof amount === "number" ? amount.toFixed(decimals) : String(amount).trim();

  if (!/^-?\d*(\.\d+)?$/.test(raw) || raw === "" || raw === "-") {
    throw new Error(`Invalid amount: ${JSON.stringify(amount)}`);
  }

  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = (negative ? raw.slice(1) : raw).split(".");

  if (fraction.length > decimals) {
    throw new Error(
      `Amount ${raw} has ${fraction.length} decimal places but this chain supports ${decimals}.`
    );
  }

  const base = BigInt(`${whole || "0"}${fraction.padEnd(decimals, "0")}`);
  return negative ? -base : base;
}

/** Chain base units -> human-readable string. */
export function formatUsdc(baseUnits, decimals, fractionDigits = 2) {
  const value = typeof baseUnits === "bigint" ? baseUnits : BigInt(String(baseUnits).trim());
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const divisor = 10n ** BigInt(decimals);
  let whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(decimals, "0");

  let shown = fraction.slice(0, fractionDigits);
  const nextDigit = fraction[fractionDigits];

  if (nextDigit !== undefined && Number(nextDigit) >= 5) {
    const bumped = BigInt(shown || "0") + 1n;
    const limit = 10n ** BigInt(fractionDigits);
    if (fractionDigits === 0 || bumped >= limit) {
      whole += 1n;
      shown = "".padStart(fractionDigits, "0");
    } else {
      shown = bumped.toString().padStart(fractionDigits, "0");
    }
  }

  const sign = negative && (whole !== 0n || BigInt(shown || "0") !== 0n) ? "-" : "";
  return fractionDigits > 0 ? `${sign}${whole}.${shown}` : `${sign}${whole}`;
}

/**
 * Read a plan's price as a human-readable number.
 *
 * Plans store `amount` as a decimal (29.5). Older records used `usdc_amount`
 * in Stellar base units, so those are converted using the plan's own network
 * decimals rather than a hardcoded divisor.
 */
export function planAmount(plan, networkId) {
  if (plan == null) return 0;

  if (plan.amount != null) return Number(plan.amount);

  if (plan.usdc_amount != null) {
    const { decimals } = networkConfig(plan.network || networkId);
    return Number(formatUsdc(plan.usdc_amount, decimals, decimals));
  }

  return 0;
}
