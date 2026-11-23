import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyContractEvent,
  filterContractEvents,
  normalizeContractEvent,
} from "../src/lib/contract-events.ts";

test("Orbit on-chain topics map to the expected dashboard event names", () => {
  assert.equal(classifyContractEvent("vault_created"), "create_vault");
  assert.equal(classifyContractEvent("vault_delegated"), "create_vault");
  assert.equal(classifyContractEvent("funds_pulled"), "pull_funds");
  assert.equal(classifyContractEvent("vault_cancelled"), "cancel_vault");
  assert.equal(classifyContractEvent("unexpected"), "other");
});

test("filtering works by kind, status, wallet, and transaction hash", () => {
  const created = normalizeContractEvent({
    id: "1", name: "vault_created", ledger: 123, txHash: "abc123",
    topics: ["vault_created", "GUSERONE", "GMERCHANT"], value: ["500"],
    rawXdr: "AAAAAQ==", receivedAt: 1,
  });
  const pulled = normalizeContractEvent({
    id: "2", name: "funds_pulled", ledger: 124, txHash: "def456",
    topics: ["funds_pulled", "GUSERTWO", "GMERCHANT"], value: ["300"],
    receivedAt: 2,
  });
  const all = [created, pulled];
  assert.equal(created.amount, "500");
  assert.equal(created.merchant, "GMERCHANT");
  assert.deepEqual(filterContractEvents(all, { type: "create_vault", status: "SUCCESS", wallet: "userone" }), [created]);
  assert.deepEqual(filterContractEvents(all, { type: "pull_funds", status: "all", wallet: "DEF" }), [pulled]);
  assert.deepEqual(filterContractEvents(all, { type: "all", status: "FAILED", wallet: "" }), []);
  assert.deepEqual(filterContractEvents(all, { type: "all", status: "all", wallet: "not-found" }), []);
});
