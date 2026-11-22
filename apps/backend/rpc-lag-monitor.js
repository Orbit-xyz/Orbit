const client = require('prom-client');
const { businessRegistry } = require('./health-metrics');

// Soroban RPC sync health (#365). A background poller compares the ledger the
// configured Soroban RPC reports against the consensus ledger from Horizon. If
// the RPC falls behind, transactions get built against stale sequence numbers,
// so the lag is exposed on /health and /metrics and drives the health status.

const RPC_SYNC_STATUS = Object.freeze({
    OK: 'OK',
    DEGRADED: 'DEGRADED',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN',
});

const DEFAULTS = Object.freeze({
    intervalMs: 10_000,
    // ~15 seconds at 5s per ledger
    degradedThreshold: 3,
    criticalThreshold: 10,
    timeoutMs: 5_000,
});

const rpcLagGauge = new client.Gauge({
    name: 'orbit_rpc_lag_ledgers',
    help: 'Ledgers the Soroban RPC is behind the Stellar consensus ledger reported by Horizon',
    registers: [businessRegistry],
});

const classifyLag = (lag, { degradedThreshold = DEFAULTS.degradedThreshold, criticalThreshold = DEFAULTS.criticalThreshold } = {}) => {
    if (!Number.isFinite(lag)) return RPC_SYNC_STATUS.UNKNOWN;
    if (lag > criticalThreshold) return RPC_SYNC_STATUS.CRITICAL;
    if (lag > degradedThreshold) return RPC_SYNC_STATUS.DEGRADED;
    return RPC_SYNC_STATUS.OK;
};

const withTimeout = (promise, ms, label) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        if (typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const toLedger = (value, label) => {
    const sequence = Number(value);
    if (!Number.isInteger(sequence) || sequence <= 0) throw new Error(`${label} returned an invalid ledger sequence`);
    return sequence;
};

// Horizon's root resource reports the ledger stellar-core has closed
// (`core_latest_ledger`) and the last one Horizon ingested.
async function fetchConsensusLedger(horizonUrl, fetchImpl) {
    const res = await fetchImpl(horizonUrl.replace(/\/+$/, '') + '/', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Horizon responded with HTTP ${res.status}`);
    const body = await res.json();
    return toLedger(body.core_latest_ledger ?? body.history_latest_ledger, 'Horizon');
}

function createRpcLagMonitor({
    getSorobanServer,
    rpcUrl,
    horizonUrl,
    getFetch = () => globalThis.fetch,
    logger = console,
    now = () => new Date(),
    intervalMs = DEFAULTS.intervalMs,
    degradedThreshold = DEFAULTS.degradedThreshold,
    criticalThreshold = DEFAULTS.criticalThreshold,
    timeoutMs = DEFAULTS.timeoutMs,
} = {}) {
    if (typeof getSorobanServer !== 'function') throw new Error('getSorobanServer is required');
    if (!horizonUrl) throw new Error('horizonUrl is required');
    if (!(criticalThreshold > degradedThreshold && degradedThreshold >= 0)) {
        throw new Error('criticalThreshold must be greater than degradedThreshold');
    }
    const thresholds = { degradedThreshold, criticalThreshold };

    let state = {
        status: RPC_SYNC_STATUS.UNKNOWN,
        rpc_lag_ledgers: null,
        rpc_ledger: null,
        consensus_ledger: null,
        checked_at: null,
        error: null,
    };
    let inFlight = null;
    let timer = null;

    async function measure() {
        const [rpcLedger, consensusLedger] = await Promise.all([
            withTimeout(
                Promise.resolve(getSorobanServer(rpcUrl).getLatestLedger()).then((r) => toLedger(r?.sequence, 'Soroban RPC')),
                timeoutMs,
                'Soroban RPC getLatestLedger',
            ),
            withTimeout(fetchConsensusLedger(horizonUrl, getFetch()), timeoutMs, 'Horizon latest ledger'),
        ]);
        // Horizon can trail the RPC by a ledger; an RPC ahead of consensus is not lag.
        const lag = Math.max(0, consensusLedger - rpcLedger);
        return { rpcLedger, consensusLedger, lag };
    }

    async function runPoll() {
        const previous = state.status;
        try {
            const { rpcLedger, consensusLedger, lag } = await measure();
            const status = classifyLag(lag, thresholds);
            state = {
                status,
                rpc_lag_ledgers: lag,
                rpc_ledger: rpcLedger,
                consensus_ledger: consensusLedger,
                checked_at: now().toISOString(),
                error: null,
            };
            rpcLagGauge.set(lag);
            if (status !== RPC_SYNC_STATUS.OK) {
                logger.warn(`[rpc-lag] Soroban RPC is ${lag} ledgers behind consensus (status ${status})`, {
                    rpc_ledger: rpcLedger,
                    consensus_ledger: consensusLedger,
                });
            } else if (previous === RPC_SYNC_STATUS.DEGRADED || previous === RPC_SYNC_STATUS.CRITICAL) {
                logger.info?.(`[rpc-lag] Soroban RPC caught up (lag ${lag} ledgers)`);
            }
        } catch (err) {
            // Keep the last measured ledgers so operators can see what was known.
            state = { ...state, status: RPC_SYNC_STATUS.UNKNOWN, checked_at: now().toISOString(), error: err.message };
            logger.warn(`[rpc-lag] could not measure Soroban RPC lag: ${err.message}`);
        }
        return getStatus();
    }

    // Concurrent callers share one in-flight measurement, so a slow provider
    // can never pile up overlapping polls.
    function poll() {
        if (!inFlight) inFlight = runPoll().finally(() => { inFlight = null; });
        return inFlight;
    }

    function getStatus() {
        return { ...state, thresholds: { ...thresholds } };
    }

    function start() {
        if (timer) return api;
        poll();
        timer = setInterval(poll, intervalMs);
        if (typeof timer.unref === 'function') timer.unref();
        return api;
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    const api = { poll, start, stop, getStatus, isRunning: () => timer !== null };
    return api;
}

// GET /health: RPC sync status. 503 once lag passes the critical threshold.
function registerRpcLagHealthRoute(app, getMonitor) {
    app.get('/health', (req, res) => {
        const monitor = getMonitor();
        if (!monitor) {
            return res.json({ status: RPC_SYNC_STATUS.UNKNOWN, rpc_lag_ledgers: null, error: 'RPC lag monitor not configured' });
        }
        const status = monitor.getStatus();
        res.status(status.status === RPC_SYNC_STATUS.CRITICAL ? 503 : 200).json(status);
    });
}

module.exports = {
    RPC_SYNC_STATUS,
    RPC_LAG_DEFAULTS: DEFAULTS,
    classifyLag,
    createRpcLagMonitor,
    fetchConsensusLedger,
    registerRpcLagHealthRoute,
    rpcLagGauge,
};
