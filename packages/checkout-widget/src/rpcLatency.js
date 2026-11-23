/**
 * Soroban RPC latency monitor and automated fallback selector (#369).
 *
 * Pure ES module with injectable fetch/timer dependencies so it can be unit
 * tested offline with `node --test`.
 */

export const LATENCY_THRESHOLDS = Object.freeze({
  greenMaxMs: 200,
  yellowMaxMs: 800,
  timeoutMs: 3000,
});

export const DEFAULT_BACKUP_RPC_URLS = Object.freeze({
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
});

/**
 * Classify a round-trip latency measurement (in ms) into status color,
 * badge label, and user-facing tooltip text.
 *
 * Thresholds:
 *  - < 200ms  -> green
 *  - < 800ms  -> yellow (elevated)
 *  - >= 800ms -> red (slow / elevated)
 */
export function classifyLatency(latencyMs) {
  if (latencyMs === null || latencyMs === undefined || !Number.isFinite(latencyMs)) {
    return {
      level: "unknown",
      color: "gray",
      dot: "#9ca3af",
      label: "Checking…",
      elevated: false,
      tooltip: "Checking Soroban RPC connection latency…",
    };
  }

  const ms = Math.max(0, Math.round(latencyMs));
  if (ms < LATENCY_THRESHOLDS.greenMaxMs) {
    return {
      level: "good",
      color: "green",
      dot: "#10b981",
      label: `${ms}ms`,
      elevated: false,
      tooltip: `Soroban RPC connection is healthy (${ms}ms).`,
    };
  }
  if (ms < LATENCY_THRESHOLDS.yellowMaxMs) {
    return {
      level: "elevated",
      color: "yellow",
      dot: "#f59e0b",
      label: `${ms}ms`,
      elevated: true,
      tooltip: `Network latency is elevated (${ms}ms). Authorization may take a few extra seconds.`,
    };
  }
  return {
    level: "slow",
    color: "red",
    dot: "#ef4444",
    label: `${ms}ms`,
    elevated: true,
    tooltip: `High network latency (${ms}ms) detected. Your mobile or RPC connection is slow; checkout may take longer than usual.`,
  };
}

/**
 * Send a lightweight JSON-RPC `getHealth` ping and measure round-trip time.
 */
export async function pingRpc(
  url,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = LATENCY_THRESHOLDS.timeoutMs,
    now = () => Date.now(),
  } = {},
) {
  if (!url || typeof fetchImpl !== "function") {
    return {
      ok: false,
      url,
      latencyMs: null,
      timedOut: false,
      error: "RPC URL or fetch implementation unavailable",
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const startedAt = now();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, now() - startedAt);
    if (!response || !response.ok) {
      return {
        ok: false,
        url,
        latencyMs,
        timedOut: false,
        error: `RPC returned HTTP ${response?.status ?? "unknown"}`,
      };
    }
    return { ok: true, url, latencyMs, timedOut: false };
  } catch (err) {
    const latencyMs = Math.max(0, now() - startedAt);
    return {
      ok: false,
      url,
      latencyMs,
      timedOut: timedOut || err?.name === "AbortError",
      error: timedOut
        ? `RPC ping timed out after ${timeoutMs}ms`
        : err?.message || "RPC ping failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the primary Soroban RPC endpoint asynchronously and automatically
 * fail over to `backupUrl` if the primary ping exceeds `timeoutMs` (3,000ms),
 * times out, or fails.
 */
export async function probeRpcWithFallback(
  primaryUrl,
  backupUrl,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? LATENCY_THRESHOLDS.timeoutMs;
  const primary = await pingRpc(primaryUrl, { ...options, timeoutMs });

  const primaryHealthy =
    primary.ok &&
    primary.latencyMs !== null &&
    primary.latencyMs <= timeoutMs;

  if (primaryHealthy) {
    return {
      activeRpcUrl: primaryUrl,
      latencyMs: primary.latencyMs,
      status: classifyLatency(primary.latencyMs),
      usedFallback: false,
      failedOverFrom: null,
      error: null,
    };
  }

  if (backupUrl && backupUrl !== primaryUrl) {
    const backup = await pingRpc(backupUrl, { ...options, timeoutMs });
    if (backup.ok) {
      return {
        activeRpcUrl: backupUrl,
        latencyMs: backup.latencyMs,
        status: classifyLatency(backup.latencyMs),
        usedFallback: true,
        failedOverFrom: primaryUrl,
        error: null,
      };
    }
    return {
      activeRpcUrl: primaryUrl,
      latencyMs: primary.latencyMs ?? timeoutMs,
      status: classifyLatency(primary.latencyMs ?? timeoutMs),
      usedFallback: false,
      failedOverFrom: null,
      error: backup.error || primary.error || "Both primary and backup RPC endpoints failed",
    };
  }

  return {
    activeRpcUrl: primaryUrl,
    latencyMs: primary.latencyMs ?? timeoutMs,
    status: classifyLatency(primary.latencyMs ?? timeoutMs),
    usedFallback: false,
    failedOverFrom: null,
    error: primary.error || "Primary RPC endpoint exceeded latency threshold",
  };
}
