import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SANDBOX_SETTINGS,
  SANDBOX_OUTCOMES,
  SANDBOX_PUBLIC_KEY,
  SANDBOX_STATES,
  createSandboxWallet,
  dispatchSandboxSubscription,
  runSandboxSubscription,
  transitionSandboxState,
} from '../src/sandbox.js';

const instantSleep = async () => {};
const fixedHex = (bytes) => 'ab'.repeat(bytes);

test('sandbox wallet mirrors Freighter-style methods without an extension', async () => {
  const wallet = createSandboxWallet({ sleep: instantSleep });
  assert.deepEqual(await wallet.isConnected(), { isConnected: true });
  assert.deepEqual(await wallet.getAddress(), { address: SANDBOX_PUBLIC_KEY });
  assert.deepEqual(await wallet.getPublicKey(), { publicKey: SANDBOX_PUBLIC_KEY });
  const signed = await wallet.signTransaction('XDR_BODY', { address: SANDBOX_PUBLIC_KEY });
  assert.equal(signed.signerAddress, SANDBOX_PUBLIC_KEY);
  // Signed output is a marker, not a real envelope that could be submitted.
  assert.match(signed.signedTxXdr, /^SANDBOX_SIGNED:/);
});

test('sandbox wallet waits the configured delay before signing', async () => {
  const waits = [];
  const wallet = createSandboxWallet({
    delayMs: 2000,
    sleep: async (ms) => waits.push(ms),
  });
  await wallet.signTransaction('XDR');
  assert.deepEqual(waits, [2000]);
});

test('each failure outcome rejects with its own error code', async () => {
  const expected = {
    [SANDBOX_OUTCOMES.INSUFFICIENT_BALANCE]: 'INSUFFICIENT_BALANCE',
    [SANDBOX_OUTCOMES.USER_REJECTED]: 'USER_REJECTED',
    [SANDBOX_OUTCOMES.NETWORK_TIMEOUT]: 'NETWORK_TIMEOUT',
  };
  for (const [outcome, code] of Object.entries(expected)) {
    const wallet = createSandboxWallet({ outcome, sleep: instantSleep });
    await assert.rejects(wallet.signTransaction('XDR'), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.sandbox, true);
      return true;
    });
  }
});

test('lifecycle transitions follow connect, sign, settle', () => {
  let state = SANDBOX_STATES.IDLE;
  state = transitionSandboxState(state, 'connect');
  assert.equal(state, SANDBOX_STATES.AWAITING_WALLET);
  state = transitionSandboxState(state, 'sign');
  assert.equal(state, SANDBOX_STATES.CONFIRMING);
  state = transitionSandboxState(state, 'settle');
  assert.equal(state, SANDBOX_STATES.SUCCESS);
  assert.equal(transitionSandboxState(state, 'reset'), SANDBOX_STATES.IDLE);
});

test('failures move to error from either pending state, and out-of-order events are ignored', () => {
  assert.equal(transitionSandboxState(SANDBOX_STATES.AWAITING_WALLET, 'fail'), SANDBOX_STATES.ERROR);
  assert.equal(transitionSandboxState(SANDBOX_STATES.CONFIRMING, 'fail'), SANDBOX_STATES.ERROR);
  assert.equal(transitionSandboxState(SANDBOX_STATES.IDLE, 'settle'), SANDBOX_STATES.IDLE);
  assert.equal(transitionSandboxState(SANDBOX_STATES.SUCCESS, 'fail'), SANDBOX_STATES.SUCCESS);
});

test('happy path resolves with a simulated vault id and 64-char mock transaction hash', async () => {
  const seen = [];
  const payload = await runSandboxSubscription({
    planId: 'plan_1',
    outcome: SANDBOX_OUTCOMES.SUCCESS,
    delayMs: 0,
    sleep: instantSleep,
    hex: fixedHex,
    onTransition: (state) => seen.push(state),
  });
  assert.equal(payload.sandbox, true);
  assert.equal(payload.planId, 'plan_1');
  assert.match(payload.vaultId, /^sbx_vault_/);
  assert.equal(payload.txHash.length, 64);
  assert.deepEqual(seen, [
    SANDBOX_STATES.AWAITING_WALLET,
    SANDBOX_STATES.CONFIRMING,
    SANDBOX_STATES.SUCCESS,
  ]);
});

test('rejected signing ends in the error state and rejects with the outcome code', async () => {
  const seen = [];
  await assert.rejects(
    runSandboxSubscription({
      outcome: SANDBOX_OUTCOMES.USER_REJECTED,
      delayMs: 0,
      sleep: instantSleep,
      onTransition: (state) => seen.push(state),
    }),
    { code: 'USER_REJECTED' },
  );
  assert.equal(seen.at(-1), SANDBOX_STATES.ERROR);
});

test('dispatch routes the success payload to onSuccess only', async () => {
  const calls = { success: [], error: [] };
  const payload = await dispatchSandboxSubscription({
    outcome: SANDBOX_OUTCOMES.SUCCESS,
    delayMs: 0,
    sleep: instantSleep,
    hex: fixedHex,
    onSuccess: (p) => calls.success.push(p),
    onError: (e) => calls.error.push(e),
  });
  assert.equal(calls.success.length, 1);
  assert.equal(calls.success[0], payload);
  assert.equal(calls.error.length, 0);
});

test('dispatch routes failures to onError with a code and message', async () => {
  const calls = { success: [], error: [] };
  const result = await dispatchSandboxSubscription({
    outcome: SANDBOX_OUTCOMES.NETWORK_TIMEOUT,
    delayMs: 0,
    sleep: instantSleep,
    onSuccess: (p) => calls.success.push(p),
    onError: (e) => calls.error.push(e),
  });
  assert.equal(result, null);
  assert.equal(calls.success.length, 0);
  assert.equal(calls.error.length, 1);
  assert.equal(calls.error[0].code, 'NETWORK_TIMEOUT');
  assert.ok(calls.error[0].message.length > 0);
});

test('sandbox never performs network access, even on the happy path', async () => {
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('sandbox must not fetch');
  };
  try {
    for (const outcome of Object.values(SANDBOX_OUTCOMES)) {
      await dispatchSandboxSubscription({
        outcome,
        delayMs: 0,
        sleep: instantSleep,
        onError: () => {},
        onSuccess: () => {},
      });
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('default settings use the success outcome with a 500ms delay', () => {
  assert.equal(DEFAULT_SANDBOX_SETTINGS.outcome, SANDBOX_OUTCOMES.SUCCESS);
  assert.equal(DEFAULT_SANDBOX_SETTINGS.delayMs, 500);
});
