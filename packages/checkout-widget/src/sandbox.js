/**
 * Simulated checkout sandbox (#355).
 *
 * Lets developers run <OrbitCheckout sandbox /> and automated Cypress/Playwright
 * tests without a Freighter extension, a funded testnet account, or network
 * access. Nothing in this module touches the network: no fetch, no Soroban RPC,
 * no Horizon. Signing is simulated in memory, and every payload it produces is
 * tagged `sandbox: true` so it can never be mistaken for a settled transaction.
 */

export const SANDBOX_PUBLIC_KEY = `GSANDBOX${"A".repeat(48)}`;

export const SANDBOX_OUTCOMES = Object.freeze({
  SUCCESS: "success",
  INSUFFICIENT_BALANCE: "insufficient_balance",
  USER_REJECTED: "user_rejected",
  NETWORK_TIMEOUT: "network_timeout",
});

export const SANDBOX_DELAY_OPTIONS_MS = Object.freeze([0, 500, 2000]);

export const DEFAULT_SANDBOX_SETTINGS = Object.freeze({
  outcome: SANDBOX_OUTCOMES.SUCCESS,
  delayMs: 500,
});

/** Lifecycle states a sandbox subscription moves through. */
export const SANDBOX_STATES = Object.freeze({
  IDLE: "idle",
  AWAITING_WALLET: "awaiting_wallet",
  CONFIRMING: "confirming",
  SUCCESS: "success",
  ERROR: "error",
});

const SANDBOX_ERRORS = Object.freeze({
  [SANDBOX_OUTCOMES.INSUFFICIENT_BALANCE]: {
    code: "INSUFFICIENT_BALANCE",
    message: "Sandbox account has insufficient USDC balance.",
  },
  [SANDBOX_OUTCOMES.USER_REJECTED]: {
    code: "USER_REJECTED",
    message: "The sandbox wallet request was rejected by the user.",
  },
  [SANDBOX_OUTCOMES.NETWORK_TIMEOUT]: {
    code: "NETWORK_TIMEOUT",
    message: "Sandbox network request timed out.",
  },
});

/**
 * Pure transition function for the sandbox lifecycle. Unknown events leave the
 * state unchanged, so out-of-order UI events cannot corrupt the flow.
 */
export function transitionSandboxState(state, event) {
  switch (`${state}:${event}`) {
    case `${SANDBOX_STATES.IDLE}:connect`:
      return SANDBOX_STATES.AWAITING_WALLET;
    case `${SANDBOX_STATES.AWAITING_WALLET}:sign`:
      return SANDBOX_STATES.CONFIRMING;
    case `${SANDBOX_STATES.CONFIRMING}:settle`:
      return SANDBOX_STATES.SUCCESS;
    case `${SANDBOX_STATES.AWAITING_WALLET}:fail`:
    case `${SANDBOX_STATES.CONFIRMING}:fail`:
      return SANDBOX_STATES.ERROR;
    case `${SANDBOX_STATES.SUCCESS}:reset`:
    case `${SANDBOX_STATES.ERROR}:reset`:
      return SANDBOX_STATES.IDLE;
    default:
      return state;
  }
}

/** Returns a lowercase hex string of `bytes` random bytes. */
export function randomHex(bytes = 32) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < bytes; i += 1) {
    out += chars[Math.floor(Math.random() * 16)];
  }
  return out;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sandboxFailure(outcome) {
  const failure = SANDBOX_ERRORS[outcome];
  const error = new Error(failure.message);
  error.code = failure.code;
  error.sandbox = true;
  return error;
}

/**
 * In-memory stand-in for the Freighter API. Mirrors the Freighter v6 return
 * shapes (`isConnected`, `getAddress`, `signTransaction`) and also exposes
 * `getPublicKey` for callers that use the older name.
 */
export function createSandboxWallet({
  outcome = SANDBOX_OUTCOMES.SUCCESS,
  delayMs = 0,
  publicKey = SANDBOX_PUBLIC_KEY,
  sleep = defaultSleep,
} = {}) {
  return {
    isSandbox: true,
    async isConnected() {
      return { isConnected: true };
    },
    async getAddress() {
      return { address: publicKey };
    },
    async getPublicKey() {
      return { publicKey };
    },
    async signTransaction(transactionXdr, opts = {}) {
      await sleep(delayMs);
      if (outcome !== SANDBOX_OUTCOMES.SUCCESS) {
        throw sandboxFailure(outcome);
      }
      // The signed payload is a marker, not a valid Stellar envelope, so it
      // cannot be submitted to a network even if a caller forwards it.
      return {
        signedTxXdr: `SANDBOX_SIGNED:${String(transactionXdr).slice(0, 16)}`,
        signerAddress: opts.address || publicKey,
      };
    },
  };
}

/**
 * Runs one simulated subscription through the sandbox wallet and resolves with
 * the `orbit:subscribed`-shaped payload, or rejects with a `{ code, message }`
 * error. `onTransition` receives each lifecycle state in order.
 */
export async function runSandboxSubscription({
  planId = "sandbox-plan",
  outcome = DEFAULT_SANDBOX_SETTINGS.outcome,
  delayMs = DEFAULT_SANDBOX_SETTINGS.delayMs,
  sleep = defaultSleep,
  hex = randomHex,
  onTransition = () => {},
} = {}) {
  let state = SANDBOX_STATES.IDLE;
  const move = (event) => {
    state = transitionSandboxState(state, event);
    onTransition(state);
  };

  move("connect");
  const wallet = createSandboxWallet({ outcome, delayMs, sleep });
  await wallet.isConnected();

  move("sign");
  try {
    await wallet.signTransaction("SANDBOX_APPROVE_AND_CREATE_VAULT");
  } catch (error) {
    move("fail");
    throw error;
  }

  move("settle");
  return {
    vaultId: `sbx_vault_${hex(8)}`,
    planId,
    txHash: hex(32),
    sandbox: true,
  };
}

/**
 * Drives `runSandboxSubscription` and routes the result to lifecycle callbacks.
 * `onSuccess` gets the payload; `onError` gets `{ code, message }`. Resolves once
 * the callback has run, so callers can await the full lifecycle.
 */
export async function dispatchSandboxSubscription({
  onSuccess,
  onError,
  onTransition,
  ...options
} = {}) {
  try {
    const payload = await runSandboxSubscription({ ...options, onTransition });
    onSuccess?.(payload);
    return payload;
  } catch (error) {
    const failure = { code: error.code || "SANDBOX_ERROR", message: error.message };
    onError?.(failure);
    return null;
  }
}
