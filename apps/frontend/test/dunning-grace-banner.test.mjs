import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeRemainingTime,
  formatRemainingTime,
} from "../src/components/dashboard/dunning-grace-utils.mjs";

describe("DunningGraceBanner logic", () => {
  it("computes remaining time accurately for future dates", () => {
    const now = 1700000000000;
    // 2 days, 3 hours, 4 minutes, 5 seconds later
    const future = now + (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000;

    const remaining = computeRemainingTime(future, now);
    assert.equal(remaining.days, 2);
    assert.equal(remaining.hours, 3);
    assert.equal(remaining.minutes, 4);
    assert.equal(remaining.seconds, 5);
    assert.equal(remaining.isExpired, false);
  });

  it("identifies expired timestamps", () => {
    const now = 1700000000000;
    const past = now - 5000;

    const remaining = computeRemainingTime(past, now);
    assert.equal(remaining.isExpired, true);
    assert.equal(remaining.days, 0);
    assert.equal(remaining.hours, 0);
    assert.equal(remaining.minutes, 0);
    assert.equal(remaining.seconds, 0);
  });

  it("handles invalid dates by marking them expired", () => {
    const remaining = computeRemainingTime("invalid-date-string");
    assert.equal(remaining.isExpired, true);
  });

  it("formats remaining time correctly when active", () => {
    const time = {
      days: 3,
      hours: 12,
      minutes: 30,
      seconds: 45,
      totalMs: 304245000,
      isExpired: false,
    };
    const formatted = formatRemainingTime(time);
    assert.equal(formatted, "3d 12h 30m 45s");
  });

  it("formats remaining time without days when under 24 hours", () => {
    const time = {
      days: 0,
      hours: 5,
      minutes: 15,
      seconds: 20,
      totalMs: 18920000,
      isExpired: false,
    };
    const formatted = formatRemainingTime(time);
    assert.equal(formatted, "5h 15m 20s");
  });

  it("formats remaining time message when expired", () => {
    const time = {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: 0,
      isExpired: true,
    };
    const formatted = formatRemainingTime(time);
    assert.equal(formatted, "Grace period expired");
  });
});
