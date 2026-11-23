import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CADENCES,
  CADENCE_INTERVAL_SECONDS,
  CADENCE_INTERVAL_LEDGERS,
  normalizeCadences,
  computeCadencePrice,
  getCadenceSavingsBadge,
  formatCadenceLabel,
  formatCadenceInterval,
  resolveCadencePlan,
} from '../src/cadenceSwitcher.js';

test('normalizeCadences filters and normalizes valid options', () => {
  assert.deepEqual(normalizeCadences(['WEEKLY', 'monthly', ' Annual ']), [
    'weekly',
    'monthly',
    'annual',
  ]);
  assert.deepEqual(normalizeCadences('monthly'), ['monthly']);
  assert.deepEqual(normalizeCadences(['daily', 'monthly', 'biweekly']), ['monthly']);
  assert.deepEqual(normalizeCadences(null), []);
  assert.deepEqual(normalizeCadences(undefined), []);
});

test('computeCadencePrice scales prices appropriately', () => {
  const baseMonthly = 30000000; // 3 USDC

  // Weekly: ~7/30 of base
  const weekly = computeCadencePrice(baseMonthly, 'weekly');
  assert.equal(weekly, 7000000);

  // Monthly: same as base
  const monthly = computeCadencePrice(baseMonthly, 'monthly');
  assert.equal(monthly, 30000000);

  // Annual with default 17% discount: 30000000 * 12 * 0.83 = 298800000
  const annual = computeCadencePrice(baseMonthly, 'annual');
  assert.equal(annual, 298800000);
});

test('getCadenceSavingsBadge displays discount badge for annual cadence', () => {
  assert.equal(getCadenceSavingsBadge('annual'), 'Save 17%');
  assert.equal(getCadenceSavingsBadge('annual', 20), 'Save 20%');
  assert.equal(getCadenceSavingsBadge('monthly'), null);
  assert.equal(getCadenceSavingsBadge('weekly'), null);
});

test('formatCadenceLabel and formatCadenceInterval provide readable text', () => {
  assert.equal(formatCadenceLabel('weekly'), 'Weekly');
  assert.equal(formatCadenceLabel('monthly'), 'Monthly');
  assert.equal(formatCadenceLabel('annual'), 'Annual');

  assert.equal(formatCadenceInterval('weekly'), 'week');
  assert.equal(formatCadenceInterval('monthly'), 'month');
  assert.equal(formatCadenceInterval('annual'), 'year');
});

test('resolveCadencePlan adjusts intervals and amounts', () => {
  const basePlan = {
    id: 'plan_123',
    name: 'Pro Subscription',
    usdc_amount: 100000000, // 10 USDC monthly
    interval_seconds: CADENCE_INTERVAL_SECONDS.monthly,
  };

  const annualPlan = resolveCadencePlan(basePlan, 'annual');
  assert.equal(annualPlan.cadence, 'annual');
  assert.equal(annualPlan.interval_seconds, CADENCE_INTERVAL_SECONDS.annual);
  assert.equal(annualPlan.interval_ledgers, CADENCE_INTERVAL_LEDGERS.annual);
  assert.equal(annualPlan.usdc_amount, 996000000); // 100M * 12 * 0.83

  const weeklyPlan = resolveCadencePlan(basePlan, 'weekly');
  assert.equal(weeklyPlan.cadence, 'weekly');
  assert.equal(weeklyPlan.interval_seconds, CADENCE_INTERVAL_SECONDS.weekly);
  assert.equal(weeklyPlan.interval_ledgers, CADENCE_INTERVAL_LEDGERS.weekly);
  assert.equal(weeklyPlan.usdc_amount, 23333333); // 100M * 7 / 30
});

test('resolveCadencePlan respects explicit merchant cadence_amounts', () => {
  const basePlan = {
    id: 'plan_custom',
    name: 'Custom Tier',
    usdc_amount: 100000000,
    cadence_amounts: {
      weekly: 25000000,
      annual: 950000000,
    },
  };

  const annualPlan = resolveCadencePlan(basePlan, 'annual');
  assert.equal(annualPlan.usdc_amount, 950000000);

  const weeklyPlan = resolveCadencePlan(basePlan, 'weekly');
  assert.equal(weeklyPlan.usdc_amount, 25000000);
});
