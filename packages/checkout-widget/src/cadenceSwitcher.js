export const CADENCES = {
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  ANNUAL: 'annual',
};

export const CADENCE_INTERVAL_SECONDS = {
  weekly: 7 * 86400, // 604800
  monthly: 30 * 86400, // 2592000
  annual: 365 * 86400, // 31536000
};

export const CADENCE_INTERVAL_LEDGERS = {
  weekly: 120960, // ~5s per ledger
  monthly: 518400,
  annual: 6307200,
};

export const DEFAULT_ANNUAL_DISCOUNT_PERCENT = 17;

/**
 * Normalizes cadences input (array or string) into a sanitized list of valid cadences.
 *
 * @param {string[] | string} [cadences]
 * @returns {('weekly' | 'monthly' | 'annual')[]}
 */
export function normalizeCadences(cadences) {
  if (!cadences) return [];
  const list = Array.isArray(cadences) ? cadences : [cadences];
  return list
    .map((c) => String(c).trim().toLowerCase())
    .filter((c) => c === 'weekly' || c === 'monthly' || c === 'annual');
}

/**
 * Computes price for a cadence based on base monthly plan amount.
 *
 * @param {number | string} baseMonthlyAmount
 * @param {'weekly' | 'monthly' | 'annual'} cadence
 * @param {number} [discountPercent=17]
 * @returns {number}
 */
export function computeCadencePrice(
  baseMonthlyAmount,
  cadence,
  discountPercent = DEFAULT_ANNUAL_DISCOUNT_PERCENT
) {
  const base = Number(baseMonthlyAmount) || 0;
  if (cadence === 'weekly') {
    // 7 days out of 30 days approximate ratio
    return Math.max(1, Math.round((base * 7) / 30));
  }
  if (cadence === 'annual') {
    // 12 months with discount (default 17% off ~ 10 months)
    const factor = (100 - discountPercent) / 100;
    return Math.max(1, Math.round(base * 12 * factor));
  }
  return base;
}

/**
 * Returns annual savings percentage badge label, or null if not annual.
 *
 * @param {'weekly' | 'monthly' | 'annual'} cadence
 * @param {number} [discountPercent=17]
 * @returns {string | null}
 */
export function getCadenceSavingsBadge(
  cadence,
  discountPercent = DEFAULT_ANNUAL_DISCOUNT_PERCENT
) {
  if (cadence === 'annual' && discountPercent > 0) {
    return `Save ${discountPercent}%`;
  }
  return null;
}

/**
 * Formats cadence name into display label.
 *
 * @param {string} cadence
 * @returns {string}
 */
export function formatCadenceLabel(cadence) {
  switch (cadence) {
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'annual':
      return 'Annual';
    default:
      return cadence ? cadence.charAt(0).toUpperCase() + cadence.slice(1) : '';
  }
}

/**
 * Formats cadence interval description (e.g. "week", "month", "year")
 *
 * @param {string} cadence
 * @returns {string}
 */
export function formatCadenceInterval(cadence) {
  switch (cadence) {
    case 'weekly':
      return 'week';
    case 'monthly':
      return 'month';
    case 'annual':
      return 'year';
    default:
      return 'cycle';
  }
}

/**
 * Resolves effective plan terms (amount, interval_seconds, interval_ledgers, cadence)
 * given a base plan and selected cadence.
 *
 * @param {object} basePlan
 * @param {'weekly' | 'monthly' | 'annual'} cadence
 * @param {object} [options]
 * @returns {object}
 */
export function resolveCadencePlan(basePlan, cadence, options = {}) {
  if (!basePlan) return null;
  const targetCadence = cadence || 'monthly';
  const intervalSeconds =
    CADENCE_INTERVAL_SECONDS[targetCadence] ||
    Number(basePlan.interval_seconds) ||
    CADENCE_INTERVAL_SECONDS.monthly;
  const intervalLedgers =
    CADENCE_INTERVAL_LEDGERS[targetCadence] || Math.round(intervalSeconds / 5);

  let usdcAmount = Number(basePlan.usdc_amount);
  if (basePlan.cadence_amounts && basePlan.cadence_amounts[targetCadence]) {
    usdcAmount = Number(basePlan.cadence_amounts[targetCadence]);
  } else if (targetCadence !== 'monthly' && basePlan.usdc_amount) {
    usdcAmount = computeCadencePrice(
      basePlan.usdc_amount,
      targetCadence,
      options.discountPercent
    );
  }

  return {
    ...basePlan,
    cadence: targetCadence,
    usdc_amount: usdcAmount,
    interval_seconds: intervalSeconds,
    interval_ledgers: intervalLedgers,
  };
}
