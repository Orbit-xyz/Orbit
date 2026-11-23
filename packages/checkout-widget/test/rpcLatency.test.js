import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLatency,
  pingRpc,
  probeRpcWithFallback,
} from "../src/rpcLatency.js";

describe("rpcLatency (#369)", () => {
  it("classifies latency thresholds: <200ms green, <800ms yellow, >=800ms red", () => {
    const fast = classifyLatency(95);
    assert.equal(fast.color, "green");
    assert.equal(fast.label, "95ms");
    assert.equal(fast.elevated, false);

    const mid = classifyLatency(450);
    assert.equal(mid.color, "yellow");
    assert.equal(mid.label, "450ms");
    assert.equal(mid.elevated, true);

    const slow = classifyLatency(950);
    assert.equal(slow.color, "red");
    assert.equal(slow.label, "950ms");
    assert.equal(slow.elevated, true);
  });

  it("uses primary RPC when ping succeeds within threshold", async () => {
    let clock = 1000;
    const fetchImpl = async () => {
      clock += 85;
      return { ok: true, status: 200 };
    };

    const res = await probeRpcWithFallback(
      "https://primary.rpc",
      "https://backup.rpc",
      { fetchImpl, now: () => clock },
    );

    assert.equal(res.activeRpcUrl, "https://primary.rpc");
    assert.equal(res.usedFallback, false);
    assert.equal(res.latencyMs, 85);
    assert.equal(res.status.color, "green");
  });

  it("automatically fails over to backup RPC on primary timeout", async () => {
    const calls = [];
    const fetchImpl = async (url, { signal }) => {
      calls.push(url);
      if (url === "https://primary.rpc") {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return { ok: true, status: 200 };
    };

    const res = await probeRpcWithFallback(
      "https://primary.rpc",
      "https://backup.rpc",
      { fetchImpl, timeoutMs: 25 },
    );

    assert.deepEqual(calls, ["https://primary.rpc", "https://backup.rpc"]);
    assert.equal(res.activeRpcUrl, "https://backup.rpc");
    assert.equal(res.usedFallback, true);
    assert.equal(res.failedOverFrom, "https://primary.rpc");
  });

  it("fails over when primary latency exceeds 3000ms", async () => {
    let clock = 0;
    const fetchImpl = async (url) => {
      clock += url === "https://primary.rpc" ? 3500 : 120;
      return { ok: true, status: 200 };
    };

    const res = await probeRpcWithFallback(
      "https://primary.rpc",
      "https://backup.rpc",
      { fetchImpl, now: () => clock, timeoutMs: 3000 },
    );

    assert.equal(res.activeRpcUrl, "https://backup.rpc");
    assert.equal(res.usedFallback, true);
    assert.equal(res.latencyMs, 120);
    assert.equal(res.status.color, "green");
  });

  it("returns error details when pingRpc receives a non-2xx status", async () => {
    const res = await pingRpc("https://bad.rpc", {
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /503/);
  });
});
