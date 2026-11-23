import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSetupFee,
  calculateSetupFeeBreakdown,
  initialAuthAmountWithSetupFee,
} from "../src/setupFee.js";

describe("setupFee (#368)", () => {
  it("normalizes missing, zero, negative, and decimal setup fees", () => {
    assert.equal(normalizeSetupFee(undefined), 0);
    assert.equal(normalizeSetupFee(0), 0);
    assert.equal(normalizeSetupFee(-15), 0);
    assert.equal(normalizeSetupFee(50), 50);
    assert.equal(normalizeSetupFee("29.99"), 29.99);
  });

  it("renders itemized breakdown strings and totals for setup fee + recurring plan", () => {
    const breakdown = calculateSetupFeeBreakdown({
      recurringAmountUsdc: 20,
      setupFee: 50,
      intervalSeconds: 30 * 86_400,
    });

    assert.equal(breakdown.hasSetupFee, true);
    assert.equal(breakdown.setupFeeUsdc, 50);
    assert.equal(breakdown.recurringUsdc, 20);
    assert.equal(breakdown.totalDueTodayUsdc, 70);
    assert.equal(breakdown.lines.setupFee, "Setup Fee: $50.00 USDC (due today)");
    assert.equal(breakdown.lines.recurring, "Recurring Plan: $20.00 USDC / month");
    assert.equal(breakdown.lines.totalDueToday, "Total Due Today: $70.00 USDC");
    assert.equal(breakdown.initialAuthorizationStroops, "700000000");
  });

  it("does not flag hasSetupFee when setupFee is 0", () => {
    const breakdown = calculateSetupFeeBreakdown({
      recurringAmountUsdc: 20,
      setupFee: 0,
    });
    assert.equal(breakdown.hasSetupFee, false);
    assert.equal(breakdown.totalDueTodayUsdc, 20);
    assert.equal(breakdown.initialAuthorizationStroops, "200000000");
  });

  it("includes setup fee in the initial Freighter authorization amount (stroops)", () => {
    // 20 USDC recurring (200_000_000 stroops) + 50 USDC setup fee (500_000_000 stroops)
    assert.equal(initialAuthAmountWithSetupFee("200000000", 50), "700000000");
    assert.equal(initialAuthAmountWithSetupFee("200000000", 0), "200000000");
  });
});
