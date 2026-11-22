const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');
const { StrKey, Keypair, rpc, Networks, TransactionBuilder, Contract, Address } = require('@stellar/stellar-sdk');
const { executeIdempotently, withBillingLock, sendResult } = require('./idempotency');
const { API_KEY_ENVIRONMENTS, issueApiKey, requireApiKey } = require('./apiKeys');
const {
    createRateLimiter,
    createStoreFromEnv,
    apiKeyTierLimit,
    apiKeyTierLimitsFromEnv,
    resolveApiKeyTier,
} = require('./rateLimit');
const { createReputationScorer, createHorizonWalletLookup } = require('./reputation');
const { isRelayerError, createRelayerFromEnv } = require('./relayer');
const { createFeeEstimator } = require('./fee-estimator');
const { getAuditLogsQuerySchema, getClientIp, getActorAddress, writeAuditLog } = require('./audit');
const {
    createWebhookSchema,
    updateWebhookSchema,
    backfillWebhookSchema,
    generateSigningSecret,
    dispatchWebhookEvent,
    resendWebhookDelivery,
    replayWebhookEvents,
    replayDeadLetter,
    setDeliveryObserver,
    setEndpointAlertNotifier,
    verifyWebhookEndpoint,
} = require('./webhooks');
const { createDeliveryAlertObserver, createEndpointAlertNotifier, registerWebhookAlertRoutes } = require('./webhook-alerts');
const {
    DUNNING_INTERVAL_DAYS,
    MAX_DUNNING_RETRIES,
    calculateNextDunningRetry,
    generateRecoveryLink,
    markSubscriptionPastDue,
    processDunningRetries,
} = require('./dunning');
const { registerComplianceRoutes } = require('./compliance');
const { registerDunningWorkflowRoutes, loadDunningWorkflow } = require('./dunning-workflow');
const { registerSigningSessionRoutes } = require('./signing-sessions');
const { registerTransactionExportRoute, confirmedSettlementAmount } = require('./transaction-report');
const { registerCustomerPortalRoutes } = require('./customer-portal');
const { registerFailureRecoveryRoutes } = require('./failure-recovery');
const { registerAnalyticsRoutes } = require('./analytics');
const { registerCouponRoutes, normalizeCode } = require('./coupons');
const { registerGraphql } = require('./graphql');
const { createSubscriptionEventBus } = require('./subscription-stream');
const { registerHandoverRoutes } = require('./handover-sessions');
const { configuredIndexer, registerIndexerRoutes } = require('./ledger-indexer');
const { recordPullFailure, registerBillingResolutionRoutes } = require('./billing-resolution');
const {
    isFiatCurrency,
    getRate,
    calculateUsdcUnits,
    quoteUsdcAmount,
    getSupportedRates,
    startOracleWorker,
    SlippageError,
    RateUnavailableError,
} = require('./oracle');
const {
    createExchangeRateWorker,
    buildRatePayload,
} = require('./exchange-rates');
const {
    createPayoutSplitDispatcher,
    createStellarSplitForwarder,
    registerPayoutSplitRoutes,
} = require('./payout-splits');
const {
    createPriceIndexationWorker,
    registerPriceIndexationRoutes,
} = require('./price-indexation');
const {
    createSnapshotExportWorker,
    registerSnapshotRoutes,
} = require('./contract-state-snapshot');
const { getDatabaseManager } = require('./db');
const { registerPrivacyRoutes } = require('./privacy');
const { createUsageBufferFromEnv, registerUsageRoutes, rollupUsage } = require('./usage-meter');
const { registerCohortRoutes } = require('./cohorts');
const { registerNotificationTemplateRoutes } = require('./notification-templates');
const { registerBalanceReminderRoutes } = require('./balance-reminders');
const { registerProofRoutes } = require('./proofs');
const { registerOrganizationRoutes } = require('./organizations');
const { registerRpcProxyRoute, createIpWindowLimiter: createRpcIpWindowLimiter } = require('./rpc-proxy');
const { SimulationCache, getOrSimulate } = require('./simulation-cache');
const { registerHealthMetrics, recordPullOutcome, setDbPoolSource } = require('./health-metrics');
const { registerStorageHealthRoutes } = require('./storage-health');
const { createDisputeAlertProcessor } = require('./dispute-alert-processor');
const { captureStripeRawBody, registerStripeBillingRoutes } = require('./stripe-billing');
const { registerExternalReconciliationRoutes } = require('./external-reconciliation');
const { registerCredentialRoutes } = require('./credentials');
const { registerPaymentLinkRoutes } = require('./payment-links');
const { checkSchemaOnStartup } = require('./migrate');
const { createInvoiceService, registerInvoiceRoutes } = require('./invoices');
const { createEmailDispatcher, sendSettlementReceipt } = require('./receipt-email');
const { getSharedRpcPool } = require('./rpc-pool');
const { registerDevFundingRoutes } = require('./dev-faucet');
const {
    createRemoteMerchantSigner,
    createSupabaseStore: createRecurringPullStore,
    createRecurringPullWorker,
    startRecurringPullWorker,
} = require('./recurring-pulls');

const app = express();
const feeEstimator = createFeeEstimator({ horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org' });
let defaultUsageBuffer;
const getUsageBuffer = () => app.locals.usageBuffer || (defaultUsageBuffer ??= createUsageBufferFromEnv());
// Set when running behind a reverse proxy so req.ip (used for rate limiting) is the client's address
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(cors());

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;
// Shared by every limiter and the reputation scorer: Redis (with an in-memory
// fallback) when REDIS_URL is set, so limits hold across all API instances
const rateLimitStore = createStoreFromEnv();
// Wallet age is scored only when Horizon is configured; tests inject app.locals.walletLookup
const horizonWalletLookup = process.env.HORIZON_URL
    ? createHorizonWalletLookup({ horizonUrl: process.env.HORIZON_URL })
    : null;
const reputation = createReputationScorer({
    store: rateLimitStore,
    walletLookup: async (address) => {
        const lookup = app.locals.walletLookup || horizonWalletLookup;
        return lookup ? lookup(address) : null;
    },
    ipTrustAfterMs: Number(process.env.REPUTATION_IP_TRUST_AFTER_MS) || undefined,
});
// Coarse per-IP limit on every route, public or not, so unauthenticated traffic
// (including floods of invalid API keys) cannot exhaust the database. Scaled by the
// IP's reputation: new IPs and repeat offenders get less, merchant IPs more.
const ipRateLimit = createRateLimiter({
    name: 'ip',
    store: rateLimitStore,
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: reputation.ipLimit(Number(process.env.IP_RATE_LIMIT_MAX) || 300),
    keyGenerator: (req) => req.ip,
    onLimitReached: (req) => reputation.recordViolation(req.ip),
});
// Per-API-key limit on authenticated merchant routes (#231). The key's tier quota
// (free: 60, pro: 600 requests per window by default) is the base allowance, which
// reputation scoring then scales by key environment and wallet age as before.
const apiKeyTierLimits = apiKeyTierLimitsFromEnv();
const apiKeyTierQuota = apiKeyTierLimit(apiKeyTierLimits);
const apiKeyRateLimit = createRateLimiter({
    name: 'key',
    store: rateLimitStore,
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: (req) => reputation.apiKeyLimit(apiKeyTierQuota(req))(req),
    keyGenerator: (req) => req.apiKey?.id,
    message: "API key rate limit exceeded, please retry later",
    describe: (req) => ({ tier: resolveApiKeyTier(req, apiKeyTierLimits) }),
});
app.locals.rateLimiters = { ip: ipRateLimit, apiKey: apiKeyRateLimit };
app.locals.reputation = reputation;

app.use(ipRateLimit);
// Keeps the raw bytes of Stripe webhooks, which are signed over the exact body (#131)
app.use(express.json({ verify: captureStripeRawBody }));

// Multi-region database manager with read-replica failover (#139)
const dbManager = getDatabaseManager();
const getPrimarySupabase = (appInstance = app) => dbManager.getPrimaryClient(appInstance);
const getReadSupabase = (appInstance = app) => dbManager.getReadClient(appInstance);
const getSupabase = () => getPrimarySupabase(app);

// Stellar asset rate worker (#303). Created lazily so importing the Express app
// never opens a Redis connection; `startServer()` starts the actual timer.
let defaultExchangeRateWorker;
const getExchangeRateWorker = () => {
    if (app.locals.exchangeRateWorker) return app.locals.exchangeRateWorker;
    if (!defaultExchangeRateWorker) {
        defaultExchangeRateWorker = createExchangeRateWorker({
            getFetch: () => app.locals.fetchImpl || globalThis.fetch,
            getSupabase: () => getSupabase(),
        });
    }
    return defaultExchangeRateWorker;
};

// Merchant routes: authenticate the API key, then apply its rate limit
const authenticateMerchant = [requireApiKey(getSupabase), reputation.markAuthenticated, apiKeyRateLimit];
registerAnalyticsRoutes(app, getSupabase);
registerPaymentLinkRoutes(app, getSupabase, authenticateMerchant);
// Testnet Friendbot + USDC trustline bootstrap for local development (#232);
// not registered at all when NODE_ENV=production
registerDevFundingRoutes(app, {
    getFetch: () => app.locals.fetchImpl,
    getHorizonServer: () => app.locals.devHorizonServer,
});

// Allows tests to inject a mock Soroban RPC server instead of hitting testnet
let defaultRpcPool;
const getSorobanServer = (rpcUrl) => {
    if (app.locals.sorobanServer) return app.locals.sorobanServer;
    if (process.env.SOROBAN_RPC_SERVERS) {
        defaultRpcPool ??= getSharedRpcPool();
        return defaultRpcPool.proxy();
    }
    return new rpc.Server(rpcUrl);
};

// One relayer per process: its sequence cache and channel pool must be shared by all requests.
// Tests inject their own through app.locals.relayer.
let defaultRelayer;
const getRelayer = () => {
    if (app.locals.relayer) return app.locals.relayer;
    if (defaultRelayer === undefined) {
        defaultRelayer = createRelayerFromEnv({
            server: getSorobanServer(process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'),
            getSupabase,
            feeEstimator,
            redisClient: rateLimitStore.client || null,
        });
    }
    return defaultRelayer;
};

// Forward transfers for merchant payout splits (#160). The merchant treasury (or a
// dedicated split relayer) signs and pays; when no key is configured, splits are
// still recorded as pending so an operator can reconcile them later.
let defaultSplitForwarder;
const getSplitForwarder = () => {
    if (app.locals.splitForwarder !== undefined) return app.locals.splitForwarder;
    if (defaultSplitForwarder === undefined) {
        const secret = process.env.SPLIT_RELAYER_SECRET_KEY || process.env.RELAYER_SECRET_KEY;
        const tokenContractId = process.env.SPLIT_TOKEN_CONTRACT_ID || process.env.USDC_CONTRACT_ID;
        if (!secret || !tokenContractId) {
            defaultSplitForwarder = null;
        } else {
            defaultSplitForwarder = createStellarSplitForwarder({
                server: getSorobanServer(process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'),
                sourceKeypair: Keypair.fromSecret(secret),
                tokenContractId,
                networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
            });
        }
    }
    return defaultSplitForwarder;
};

const getPayoutSplitDispatcher = () => createPayoutSplitDispatcher({
    supabase: getSupabase(),
    forwarder: getSplitForwarder(),
    getTreasuryWallet: async (merchantId) => {
        const supabase = getSupabase();
        if (!supabase) return null;
        const { data } = await supabase.from('merchants').select('wallet_address').eq('id', merchantId).maybeSingle();
        return data?.wallet_address ?? null;
    },
});

// Per-merchant throttle on relay requests, on top of the general API key limit
const relayRateLimit = createRateLimiter({
    name: 'relay',
    store: rateLimitStore,
    windowMs: Number(process.env.RELAYER_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    limit: Number(process.env.RELAYER_RATE_LIMIT_MAX) || 10,
    keyGenerator: (req) => req.merchant?.id,
    message: "Relay rate limit exceeded, please retry later",
});
app.locals.rateLimiters.relay = relayRateLimit;

// Sponsorship requests come from unauthenticated checkout sessions, so they are
// throttled per client IP rather than per merchant (#297)
const sponsorRateLimit = createRateLimiter({
    name: 'relay-sponsor',
    store: rateLimitStore,
    windowMs: Number(process.env.RELAYER_SPONSOR_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    limit: Number(process.env.RELAYER_SPONSOR_RATE_LIMIT_MAX) || 5,
    keyGenerator: (req) => getClientIp(req) || 'unknown',
    message: "Sponsorship rate limit exceeded, please retry later",
});
app.locals.rateLimiters.relaySponsor = sponsorRateLimit;

// How long to keep polling getTransaction() for a submitted hash before giving up
const TX_POLL_TIMEOUT_MS = Number(process.env.TX_POLL_TIMEOUT_MS) || 30000;
const TX_POLL_INTERVAL_MS = Number(process.env.TX_POLL_INTERVAL_MS) || 1000;

// Billing lease for preparing a pull (simulation only)
const PREPARE_LOCK_TTL_SECONDS = Number(process.env.PREPARE_LOCK_TTL_SECONDS) || 60;
// Billing lease for submitting a pull must outlive confirmation polling
const submitLockTtlSeconds = (pollTimeoutMs) => Math.ceil(pollTimeoutMs / 1000) + 60;
// A relayed pull may also wait for a free channel and retry submission before polling
const relayLockTtlSeconds = (pollTimeoutMs) =>
    submitLockTtlSeconds(pollTimeoutMs) + Math.ceil((Number(process.env.RELAYER_QUEUE_TIMEOUT_MS) || 30000) / 1000) + 30;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls getTransaction(hash) until it settles to SUCCESS/FAILED, or returns NOT_FOUND on timeout
const waitForTransaction = async (server, hash, { timeoutMs = TX_POLL_TIMEOUT_MS, intervalMs = TX_POLL_INTERVAL_MS } = {}) => {
    const deadline = Date.now() + timeoutMs;
    let lastResponse = await server.getTransaction(hash);

    while (lastResponse.status === "NOT_FOUND" && Date.now() < deadline) {
        await sleep(intervalMs);
        lastResponse = await server.getTransaction(hash);
    }

    return lastResponse;
};

// ==========================================
// VALIDATION SCHEMAS
// ==========================================

const stellarAddressSchema = z.string().refine(
    (val) => StrKey.isValidEd25519PublicKey(val),
    { message: "must be a valid Stellar Ed25519 public address" }
);

// merchant_id is taken from the API key; a client-supplied value is only checked against it
const optionalMerchantIdSchema = z.string().uuid("merchant_id must be a valid UUID").optional();

// USDC plans store raw token units (USDC has 7 decimals, so 290000000 = 29
// USDC), same as the contract's amount_per_interval. Fiat plans (USD/EUR) store
// a price_amount in that currency, which the exchange rate oracle converts to
// raw USDC units at the moment of pull (#96).
const usdcPlanSchema = z.object({
    merchant_id: optionalMerchantIdSchema,
    name: z.string().trim().min(1, "name cannot be empty"),
    usdc_amount: z.coerce.number()
        .int("usdc_amount must be an integer in raw token units")
        .positive("usdc_amount must be greater than 0"),
    interval_seconds: z.coerce.number().int().positive("interval_seconds must be a positive integer"),
    currency: z.enum(['USDC']).default('USDC'),
});

const fiatPlanSchema = z.object({
    merchant_id: optionalMerchantIdSchema,
    name: z.string().trim().min(1, "name cannot be empty"),
    price_amount: z.coerce.number()
        .positive("price_amount must be greater than 0"),
    interval_seconds: z.coerce.number().int().positive("interval_seconds must be a positive integer"),
    currency: z.enum(['USD', 'EUR']),
});

// Validates the body against the schema for its pricing currency, so a USDC
// plan still requires usdc_amount and a fiat plan still requires price_amount.
const parseCreatePlanBody = (body) => {
    const currencyResult = z
        .object({ currency: z.enum(['USDC', 'USD', 'EUR']) })
        .safeParse({ currency: body?.currency ?? 'USDC' });
    if (!currencyResult.success) return currencyResult;

    return currencyResult.data.currency === 'USDC'
        ? usdcPlanSchema.safeParse(body)
        : fiatPlanSchema.safeParse(body);
};

const getPlanParamsSchema = z.object({
    id: z.string().uuid("id parameter must be a valid UUID"),
});

const getSubscribersQuerySchema = z.object({
    merchant_id: optionalMerchantIdSchema,
});

const createSubscriptionSchema = z.object({
    plan_id: z.string().uuid("plan_id must be a valid UUID"),
    customer_wallet_address: stellarAddressSchema,
    metadata: z.record(z.any()).optional().default({}),
    coupon_code: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

const triggerPullSchema = z.object({
    subscription_id: z.string().uuid("subscription_id must be a valid UUID"),
}).strict();

const submitPullSchema = z.object({
    subscription_id: z.string().uuid("subscription_id must be a valid UUID"),
    signed_xdr: z.string().min(1, "signed_xdr is required"),
}).strict();

const relaySubmitPullSchema = z.object({
    subscription_id: z.string().uuid("subscription_id must be a valid UUID"),
    signed_auth_entry_xdr: z.string().min(1, "signed_auth_entry_xdr is required"),
}).strict();

const createApiKeySchema = z.object({
    name: z.string().trim().min(1, "name cannot be empty").max(255, "name must be at most 255 characters"),
    environment: z.enum(API_KEY_ENVIRONMENTS, { message: "environment must be 'live' or 'test'" }),
}).strict();

const apiKeyParamsSchema = z.object({
    id: z.string().uuid("id parameter must be a valid UUID"),
});

// PostgREST reports a .single() lookup that matched no rows as an error, not as empty data
const isNoRowsError = (error) => error?.code === 'PGRST116';

// Postgres foreign key violation, e.g. inserting a subscription for a plan that does not exist
const isForeignKeyError = (error) => error?.code === '23503';

// Postgres unique violation, e.g. the same wallet subscribing to the same plan twice
const isUniqueViolation = (error) => error?.code === '23505';

const formatZodError = (err) => {
    const issue = err.issues[0];
    const field = issue.path.join('.') || 'input';
    return `Invalid input on ${field}: ${issue.message}`;
};

// Rejects a client-supplied merchant_id that names a merchant other than the authenticated one
const merchantMismatch = (req, merchantId) =>
    merchantId !== undefined && merchantId !== req.merchant.id;

const MERCHANT_MISMATCH_ERROR = { error: "merchant_id does not match the authenticated API key" };

// ==========================================
// ROUTE 1: POST /plans (Create a new pricing plan)
// ==========================================
app.post('/plans', authenticateMerchant, async (req, res) => {
    const parseResult = parseCreatePlanBody(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }
    if (merchantMismatch(req, parseResult.data.merchant_id)) return res.status(403).json(MERCHANT_MISMATCH_ERROR);

    const { name, currency, interval_seconds } = parseResult.data;
    const merchant_id = req.merchant.id;
    const supabase = getPrimarySupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
    if (!dbManager.isPrimaryHealthy()) {
        return res.status(503).json({ error: "Primary database is currently unavailable; write operations are suspended" });
    }

    const result = await executeIdempotently({
        supabase,
        req,
        label: "creating plan",
        resolveMerchant: () => ({ merchantId: merchant_id }),
    }, async () => {
        // Fiat plans: cache the current USDC equivalent for dashboards. The
        // authoritative amount is always recalculated at the moment of pull;
        // when the cache is cold the placeholder stays 0 until the oracle
        // worker publishes the first rate.
        let usdc_amount = parseResult.data.usdc_amount;
        const price_amount = parseResult.data.price_amount;
        if (isFiatCurrency(currency)) {
            usdc_amount = 0;
            try {
                const rateInfo = await getRate({
                    supabase,
                    fetchImpl: app.locals.fetchImpl,
                    currency,
                    allowNetwork: false,
                });
                if (rateInfo) usdc_amount = calculateUsdcUnits({ amount: price_amount, rate: rateInfo.rate });
            } catch (err) {
                console.error("Error deriving plan usdc_amount from oracle cache:", err.message);
            }
        }

        const { data, error } = await supabase
            .from('plans')
            .insert([{ merchant_id, name, currency, usdc_amount, price_amount, interval_seconds }])
            .select()
            .single();

        if (isForeignKeyError(error)) return { status: 404, body: { error: "Merchant not found" } };
        if (error) throw error;

        await writeAuditLog(supabase, {
            merchantId: merchant_id,
            actorAddress: getActorAddress(req, null),
            action: 'plan.create',
            resourceType: 'plan',
            resourceId: data.id,
            ipAddress: getClientIp(req),
            changesBefore: null,
            changesAfter: data,
        });

        return { status: 201, body: { message: "Plan created successfully", plan: data } };
    });
    sendResult(res, result);
});

// ==========================================
// ROUTE 2: GET /plans/:id (Fetch plan details for Checkout Widget)
// ==========================================
app.get('/plans/:id', async (req, res) => {
    const parseResult = getPlanParamsSchema.safeParse(req.params);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    try {
        const { id } = parseResult.data;
        const supabase = getReadSupabase();
        if (!supabase) return res.status(500).json({ error: "Database client not initialized" });

        const { data, error } = await supabase
            .from('plans')
            .select('*, merchants(name, wallet_address)') // Also fetch the merchant's details
            .eq('id', id)
            .single();

        if (isNoRowsError(error)) return res.status(404).json({ error: "Plan not found" });
        if (error) throw error;
        if (!data) return res.status(404).json({ error: "Plan not found" });

        res.status(200).json({ plan: data });
    } catch (err) {
        console.error("Error fetching plan:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE 3: GET /subscribers (Fetch active subscribers for dashboard)
// ==========================================
app.get('/subscribers', authenticateMerchant, async (req, res) => {
    const parseResult = getSubscribersQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }
    if (merchantMismatch(req, parseResult.data.merchant_id)) return res.status(403).json(MERCHANT_MISMATCH_ERROR);

    try {
        const merchant_id = req.merchant.id;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        // Find all subscriptions tied to plans owned by this merchant
        const { data, error } = await supabase
            .from('subscriptions')
            .select(`
                *,
                plans!inner(merchant_id, name, usdc_amount)
            `)
            .eq('plans.merchant_id', merchant_id);

        if (error) throw error;

        res.status(200).json({ subscribers: data });
    } catch (err) {
        console.error("Error fetching subscribers:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE: GET /rates (Exchange rate oracle)
// ==========================================
// Returns the supported fiat->USDC conversion pairs with their newest cached
// rate, refreshed from the live feed on a cold cache (#96).
app.get('/rates', async (req, res) => {
    try {
        const supabase = getReadSupabase();
        if (!supabase) return res.status(500).json({ error: "Database client not initialized" });

        const rates = await getSupportedRates({ supabase, fetchImpl: app.locals.fetchImpl });
        res.status(200).json(rates);
    } catch (err) {
        console.error("Error fetching exchange rates:", err);
        res.status(500).json({ error: err.message });
    }
});

// Structured Stellar asset rates (#303). Reads only the worker's cache so a
// request never waits on an external oracle; stale/fallback data is labelled.
app.get('/api/rates', async (req, res) => {
    try {
        const snapshot = await getExchangeRateWorker().readSnapshot();
        const payload = buildRatePayload(snapshot);
        res.set('Cache-Control', 'no-store');
        res.set('X-Rate-Cache', payload.cache_status.toUpperCase());
        res.set('X-Rate-Cache-Status', payload.cache_status);
        res.set('X-Rate-Source', payload.rate_source || 'unknown');
        res.set('X-Rate-Freshness', payload.fresh ? 'fresh' : 'stale');
        res.status(200).json(payload);
    } catch (err) {
        console.error("Error fetching Stellar asset rates:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE 4: POST /trigger-pull (The Blockchain Bridge)
// ==========================================
// Loads a subscription owned by the authenticated merchant. Another merchant's
// subscription is reported as not found so its existence is not revealed.
const loadPullContext = async (supabase, subscriptionId, merchant) => {
    const { data: sub, error: subError } = await supabase
        .from('subscriptions')
        .select(`
            *,
            plans ( merchant_id, usdc_amount, interval_seconds, currency, price_amount )
        `)
        .eq('id', subscriptionId)
        .single();

    if (isNoRowsError(subError) || !sub) return { status: 404, error: "Subscription not found" };
    if (subError) throw subError;
    if (sub.plans?.merchant_id !== merchant.id) return { status: 404, error: "Subscription not found" };
    // A coupon quote must not silently charge the fixed-price legacy Soroban vault.
    if (sub.coupon_id && !sub.promotion_onchain_verified) {
        return { status: 409, error: "Promotional vault terms are not verified on-chain; billing is blocked" };
    }

    return { sub, merchant };
};

// Records the confirmed outcome of a pull transaction, whoever submitted it
const applyPullOutcome = async ({
    supabase,
    req,
    sub,
    merchant,
    subscription_id,
    txHash,
    status,
    confirmation = null,
    server = null,
    signedTx = null,
    extraBody = {},
    subscriptionAlreadySettled = false,
    settledAt = null,
    nextBillingDate = null,
    // Seconds spent waiting for Soroban confirmation, for orbit_pull_duration_seconds (#230)
    confirmationSeconds = null,
}) => {
    recordPullOutcome(status, confirmationSeconds);
    if (status === "SUCCESS") {
        const pullTime = settledAt || new Date();
        const nextBilling = nextBillingDate
            ? new Date(nextBillingDate)
            : new Date(pullTime.getTime() + Number(sub.plans.interval_seconds) * 1000);

        if (!subscriptionAlreadySettled) {
            const { error: subscriptionUpdateError } = await supabase
                .from('subscriptions')
                .update({
                    next_billing_date: nextBilling.toISOString(),
                    status: 'active',
                    retry_count: 0,
                    dunning_status: null,
                    next_dunning_retry_at: null,
                    last_failure: null,
                })
                .eq('id', subscription_id);
            if (subscriptionUpdateError) throw subscriptionUpdateError;
        }

        await writeAuditLog(supabase, {
            merchantId: sub.plans.merchant_id,
            actorAddress: getActorAddress(req, merchant.wallet_address),
            action: 'pull.execute',
            resourceType: 'subscription',
            resourceId: subscription_id,
            ipAddress: getClientIp(req),
            changesBefore: { next_billing_date: sub.next_billing_date, status: sub.status },
            changesAfter: { next_billing_date: nextBilling.toISOString(), status: 'active', txHash },
        });

        if (sub.plans.merchant_id) {
            // Fiat plans report the settled amount in raw USDC units
            // converted at the current cached rate (#96)
            let settledAmount = sub.plans.usdc_amount;
            if (isFiatCurrency(sub.plans?.currency)) {
                try {
                    const quote = await quoteUsdcAmount({
                        supabase,
                        plan: sub.plans,
                        subscription: sub,
                        fetchImpl: app.locals.fetchImpl,
                        allowNetwork: false,
                        enforceSlippage: false,
                    });
                    settledAmount = quote.usdc_amount;
                } catch {
                    // Keep the stored plan amount when the cache cannot price it
                }
            }

            // Only emit settlement events for independently verified on-chain transfers.
            const verifiedAmount = confirmedSettlementAmount(confirmation, {
                customerWallet: sub.customer_wallet_address,
                merchantWallet: merchant.wallet_address,
                contractId: process.env.ORBIT_CONTRACT_ID,
            });
            if (verifiedAmount === null) {
                console.error('CRITICAL: confirmed transfer missing verified amount; reconcile transaction:', txHash);
            } else {
                const paymentRecord = {
                    merchant_id: sub.plans.merchant_id,
                    subscription_id,
                    plan_id: sub.plan_id,
                    customer_wallet_address: sub.customer_wallet_address,
                    amount_usdc_units: verifiedAmount,
                    status: 'settled',
                    tx_hash: txHash,
                    settled_at: pullTime.toISOString(),
                };
                const { data: payment, error: paymentError } = await supabase
                    .from('payment_transactions').insert([paymentRecord]).select().single();
                if (paymentError && paymentError.code !== '23505') {
                    console.error('CRITICAL: on-chain settlement needs ledger reconciliation:', txHash, paymentError);
                } else {
                    // Publication happens only after a confirmed transfer is recorded,
                    // and is safe for consumers to deduplicate by transaction hash.
                    app.locals.paymentEventBus?.publish('paymentSettled', {
                        id: txHash, merchantId: sub.plans.merchant_id,
                        subscriptionId: subscription_id,
                        amount: String(verifiedAmount),
                        txHash, status: 'settled', settledAt: pullTime.toISOString(),
                    }).catch((error) => console.error('Settlement stream publish failed:', error));
                }
                if (payment) {
                    try {
                        const invoiceService = app.locals.invoiceService || createInvoiceService({ supabase });
                        const receipt = await invoiceService.createForSettledPayment({
                            payment, merchant, plan: sub.plans, subscription: sub,
                            ledgerSequence: confirmation?.ledger ?? confirmation?.ledgerSequence ?? null,
                        });
                        if (receipt?.invoice && receipt?.pdf) {
                            const dispatcher = app.locals.receiptEmailDispatcher || createEmailDispatcher({
                                fetchImpl: app.locals.fetchImpl || globalThis.fetch,
                            });
                            await sendSettlementReceipt({
                                dispatcher,
                                invoice: receipt.invoice,
                                payment,
                                merchant,
                                plan: sub.plans,
                                subscription: sub,
                                pdf: receipt.pdf,
                            });
                        }
                    } catch (invoiceError) {
                        console.error('Invoice generation failed:', invoiceError);
                    }
                }
            }

            await dispatchWebhookEvent(supabase, {
                merchantId: sub.plans.merchant_id,
                eventType: 'payment.settled',
                payload: {
                    event: 'payment.settled',
                    subscription_id,
                    customer_wallet_address: sub.customer_wallet_address,
                    amount: settledAmount,
                    txHash,
                    settled_at: pullTime.toISOString(),
                },
                fetchImpl: app.locals.fetchImpl,
            });

            // Automated revenue sharing (#160): forward each configured split
            // share from the merchant treasury, recording the primary pull hash
            // next to every secondary split transfer hash. Failures here never
            // fail the settlement itself.
            try {
                await getPayoutSplitDispatcher().handlePaymentSettled({
                    merchantId: sub.plans.merchant_id,
                    subscriptionId: subscription_id,
                    primaryTxHash: txHash,
                    amountUnits: sub.plans.usdc_amount,
                    settledAt: pullTime.toISOString(),
                    fetchImpl: app.locals.fetchImpl,
                });
            } catch (splitErr) {
                console.error("Payout split dispatch failed:", splitErr);
            }
        }

        return {
            status: 200,
            body: { message: "Successfully pulled funds on-chain!", txHash, ...extraBody },
        };
    }

    if (status === "FAILED") {
        await recordPullFailure(supabase, subscription_id, 'Transaction failed on-chain; inspect transaction diagnostics for the specific contract error.', txHash);
        if (server && signedTx) {
            let failureReason = 'Transaction failed on-chain; inspect transaction diagnostics for the specific contract error.';
            try {
                const simulation = await server.simulateTransaction(signedTx);
                if (simulation?.error) failureReason = simulation.error;
            } catch {
                // Keep the original failure when RPC diagnostics are unavailable
            }
            await recordPullFailure(supabase, subscription_id, failureReason, txHash);
        }
        await markSubscriptionPastDue(supabase, subscription_id, {
            actorAddress: merchant.wallet_address,
            ipAddress: getClientIp(req),
            fetchImpl: app.locals.fetchImpl,
        });

        return {
            status: 502,
            body: { error: "Transaction failed on-chain", txHash, ...extraBody },
        };
    }

    // Still NOT_FOUND after the timeout: outcome unknown, let the caller poll later.
    // Keep the lease until it expires so no second pull races the one still in flight.
    await recordPullFailure(supabase, subscription_id, 'RPC timeout: transaction submitted but not yet confirmed. Do not retry until its outcome is known.', txHash);
    if (server && signedTx) {
        await recordPullFailure(
            supabase,
            subscription_id,
            'Transaction submitted, but Soroban RPC confirmation timed out (NOT_FOUND)',
            txHash,
        );
    }
    return {
        status: 202,
        body: { message: "Transaction submitted but not yet confirmed; check back later", txHash, ...extraBody },
        holdLock: true,
    };
};

app.post('/trigger-pull', authenticateMerchant, async (req, res) => {
    const parseResult = triggerPullSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    let ownedSubscriptionId;
    try {
        const { subscription_id } = parseResult.data;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const context = await loadPullContext(supabase, subscription_id, req.merchant);
        if (context.error) return res.status(context.status).json({ error: context.error });
        const { sub, merchant } = context;
        ownedSubscriptionId = subscription_id;

        const result = await executeIdempotently({
            supabase,
            req,
            label: "preparing pull",
            resolveMerchant: () => ({ merchantId: sub.plans.merchant_id }),
        }, async () => {
            // Price the pull (#96): fiat plans convert price_amount into raw
            // USDC units at the live rate and are rejected when the rate moved
            // more than the slippage tolerance away from the quoted rate.
            let pricing;
            try {
                pricing = await quoteUsdcAmount({
                    supabase,
                    plan: sub.plans,
                    subscription: sub,
                    fetchImpl: app.locals.fetchImpl,
                });
            } catch (err) {
                if (err instanceof SlippageError) {
                    return { status: 409, body: { error: err.message, ...err.details } };
                }
                if (err instanceof RateUnavailableError) {
                    return { status: 503, body: { error: err.message } };
                }
                throw err;
            }

            // A fiat subscription created while the rate cache was cold has no
            // quote yet: store this pull's rate so the next one is guarded.
            if (
                isFiatCurrency(sub.plans?.currency) &&
                pricing.rate != null &&
                (sub.quoted_rate === null || sub.quoted_rate === undefined)
            ) {
                const { error: quoteError } = await supabase
                    .from('subscriptions')
                    .update({ quoted_rate: pricing.rate })
                    .eq('id', subscription_id);
                if (quoteError) console.error("Failed to persist subscription quote:", quoteError.message);
            }

            return withBillingLock({
                supabase,
                subscriptionId: subscription_id,
                ttlSeconds: PREPARE_LOCK_TTL_SECONDS,
            }, async () => {
                const ORBIT_CONTRACT_ID = process.env.ORBIT_CONTRACT_ID;
                if (!ORBIT_CONTRACT_ID) {
                    return { status: 500, body: { error: "ORBIT_CONTRACT_ID not set in .env" } };
                }

                const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
                const server = getSorobanServer(rpcUrl);
                const contract = new Contract(ORBIT_CONTRACT_ID);

                // 3. Build the Soroban Transaction
                const account = await server.getAccount(merchant.wallet_address);

                const tx = new TransactionBuilder(account, {
                    fee: String(await feeEstimator.estimate({ priority: "standard" })),
                    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET
                })
                .addOperation(contract.call("pull_funds",
                    Address.fromString(sub.customer_wallet_address).toScVal(),
                    Address.fromString(merchant.wallet_address).toScVal()
                ))
                .setTimeout(30)
                .build();

                // Simulate and return an unsigned envelope. The merchant signs it in their wallet.
                const preparedTx = await server.prepareTransaction(tx);

                await writeAuditLog(supabase, {
                    merchantId: sub.plans.merchant_id,
                    actorAddress: getActorAddress(req, merchant.wallet_address),
                    action: 'pull.prepare',
                    resourceType: 'subscription',
                    resourceId: subscription_id,
                    ipAddress: getClientIp(req),
                    changesBefore: null,
                    changesAfter: { subscription_id, merchant_address: merchant.wallet_address },
                });

                return {
                    status: 200,
                    body: {
                        transaction_xdr: preparedTx.toXDR(),
                        network_passphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
                        merchant_address: merchant.wallet_address,
                        subscription_id,
                        // Amount to settle this cycle (raw USDC units)
                        usdc_amount: pricing.usdc_amount,
                        currency: pricing.currency,
                        rate: pricing.rate,
                    },
                };
            });
        });
        if (result.status >= 500) await recordPullFailure(supabase, subscription_id, result.body?.error || 'Pull preparation failed');
        sendResult(res, result);
    } catch (err) {
        console.error("Error preparing pull:", err);
        if (ownedSubscriptionId) await recordPullFailure(getSupabase(), ownedSubscriptionId, err.message).catch(console.error);
        res.status(500).json({ error: err.message });
    }
});

// Accept only a wallet-signed envelope, verify the merchant signature, then submit it.
app.post('/submit-pull', authenticateMerchant, async (req, res) => {
    const parseResult = submitPullSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ error: formatZodError(parseResult.error) });

    let ownedSubscriptionId;
    try {
        const { subscription_id, signed_xdr } = parseResult.data;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
        const context = await loadPullContext(supabase, subscription_id, req.merchant);
        if (context.error) return res.status(context.status).json({ error: context.error });
        const { sub, merchant } = context;
        ownedSubscriptionId = subscription_id;

        const pollTimeoutMs = app.locals.txPollTimeoutMs ?? TX_POLL_TIMEOUT_MS;

        const result = await executeIdempotently({
            supabase,
            req,
            label: "submitting pull",
            resolveMerchant: () => ({ merchantId: sub.plans.merchant_id }),
        }, async () => {
            const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
            let signedTx;
            try {
                signedTx = TransactionBuilder.fromXDR(signed_xdr, networkPassphrase);
            } catch {
                return { status: 400, body: { error: "signed_xdr is not a valid Stellar transaction envelope" } };
            }
            if (signedTx.source !== merchant.wallet_address) {
                return { status: 401, body: { error: "Transaction source does not match the plan owner's address" } };
            }
            const invocation = signedTx.operations.length === 1 && signedTx.operations[0].type === 'invokeHostFunction'
                ? signedTx.operations[0].func?.invokeContract
                : null;
            const isExpectedPull = invocation
                && invocation.functionName.toString() === 'pull_funds'
                && StrKey.encodeContract(invocation.contractAddress.contractId.value) === process.env.ORBIT_CONTRACT_ID
                && invocation.args.length === 2
                && Address.fromScVal(invocation.args[0]).toString() === sub.customer_wallet_address
                && Address.fromScVal(invocation.args[1]).toString() === merchant.wallet_address;
            if (!isExpectedPull) {
                return { status: 400, body: { error: "Signed transaction does not match this subscription's pull" } };
            }
            const merchantKey = Keypair.fromPublicKey(merchant.wallet_address);
            const hasMerchantSignature = signedTx.signatures.some(({ signature }) =>
                merchantKey.verify(signedTx.hash(), signature.value)
            );
            if (!hasMerchantSignature) {
                return { status: 401, body: { error: "A valid merchant wallet signature is required" } };
            }

            // Only one submission per subscription may be in flight at a time
            return withBillingLock({
                supabase,
                subscriptionId: subscription_id,
                ttlSeconds: submitLockTtlSeconds(pollTimeoutMs),
            }, async () => {
                const server = getSorobanServer(process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org');
                const submitResponse = await server.sendTransaction(signedTx);

                if (submitResponse.status !== "PENDING" && submitResponse.status !== "SUCCESS") {
                    throw new Error(`Transaction submission failed: ${JSON.stringify(submitResponse)}`);
                }

                const txHash = submitResponse.hash;

                // 5. Confirm the transaction actually landed before touching billing state
                const confirmStarted = process.hrtime.bigint();
                const confirmation = await waitForTransaction(server, txHash, {
                    timeoutMs: pollTimeoutMs,
                    intervalMs: app.locals.txPollIntervalMs ?? TX_POLL_INTERVAL_MS,
                });

                return applyPullOutcome({
                    supabase,
                    req,
                    sub,
                    merchant,
                    subscription_id,
                    txHash,
                    status: confirmation.status,
                    confirmation,
                    server,
                    signedTx,
                    confirmationSeconds: Number(process.hrtime.bigint() - confirmStarted) / 1e9,
                });
            });
        });
        sendResult(res, result);
    } catch (err) {
        console.error("Error submitting pull:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE 4b: Sponsored pulls through the fee-bump relayer
// ==========================================
// The merchant signs only the Soroban authorization for pull_funds; the Orbit relayer
// submits the transaction and pays its fees, so the merchant wallet needs no XLM for fees.

const relayerErrorResult = (err) => ({
    status: err.status,
    body: { error: err.message, code: err.code },
    headers: err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : undefined,
});

const RELAYER_NOT_CONFIGURED = { error: "Gas sponsorship relayer is not configured", code: "relayer_unavailable" };

app.post('/relay/prepare-pull', authenticateMerchant, relayRateLimit, async (req, res) => {
    const parseResult = triggerPullSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ error: formatZodError(parseResult.error) });

    try {
        const { subscription_id } = parseResult.data;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
        const relayer = getRelayer();
        if (!relayer) return res.status(503).json(RELAYER_NOT_CONFIGURED);

        const context = await loadPullContext(supabase, subscription_id, req.merchant);
        if (context.error) return res.status(context.status).json({ error: context.error });
        const { sub, merchant } = context;

        let prepared;
        try {
            prepared = await relayer.preparePullAuthorization({
                user: sub.customer_wallet_address,
                merchant: merchant.wallet_address,
            });
        } catch (err) {
            if (isRelayerError(err)) return sendResult(res, relayerErrorResult(err));
            throw err;
        }

        res.status(200).json({
            auth_entry_xdr: prepared.authEntryXdr,
            valid_until_ledger: prepared.validUntilLedger,
            network_passphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
            merchant_address: merchant.wallet_address,
            sponsor_address: relayer.sponsorAddress,
            subscription_id,
        });
    } catch (err) {
        console.error("Error preparing sponsored pull:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/relay/submit-pull', authenticateMerchant, relayRateLimit, async (req, res) => {
    const parseResult = relaySubmitPullSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ error: formatZodError(parseResult.error) });

    try {
        const { subscription_id, signed_auth_entry_xdr } = parseResult.data;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
        const relayer = getRelayer();
        if (!relayer) return res.status(503).json(RELAYER_NOT_CONFIGURED);

        const context = await loadPullContext(supabase, subscription_id, req.merchant);
        if (context.error) return res.status(context.status).json({ error: context.error });
        const { sub, merchant } = context;

        const pollTimeoutMs = app.locals.txPollTimeoutMs ?? TX_POLL_TIMEOUT_MS;
        const pullParties = { user: sub.customer_wallet_address, merchant: merchant.wallet_address };

        const result = await executeIdempotently({
            supabase,
            req,
            label: "relaying pull",
            resolveMerchant: () => ({ merchantId: sub.plans.merchant_id }),
        }, async () => {
            let entry;
            try {
                entry = await relayer.verifyPullAuthorization({ entryXdr: signed_auth_entry_xdr, ...pullParties });
            } catch (err) {
                if (isRelayerError(err)) return relayerErrorResult(err);
                throw err;
            }

            return withBillingLock({
                supabase,
                subscriptionId: subscription_id,
                ttlSeconds: relayLockTtlSeconds(pollTimeoutMs),
            }, async () => {
                let outcome;
                // A relayed pull may be fee-bumped and confirmed more than once; time all of it
                let confirmationNs = 0n;
                try {
                    outcome = await relayer.relayPull({
                        merchantId: merchant.id,
                        entry,
                        ...pullParties,
                        confirm: async (server, hash) => {
                            const started = process.hrtime.bigint();
                            try {
                                return await waitForTransaction(server, hash, {
                                    timeoutMs: pollTimeoutMs,
                                    intervalMs: app.locals.txPollIntervalMs ?? TX_POLL_INTERVAL_MS,
                                });
                            } finally {
                                confirmationNs += process.hrtime.bigint() - started;
                            }
                        },
                    });
                } catch (err) {
                    if (isRelayerError(err)) return relayerErrorResult(err);
                    throw err;
                }

                return applyPullOutcome({
                    supabase, req, sub, merchant, subscription_id,
                    txHash: outcome.txHash,
                    status: outcome.status,
                    confirmationSeconds: Number(confirmationNs) / 1e9,
                    extraBody: {
                        sponsored: true,
                        sponsor_address: relayer.sponsorAddress,
                        fee_charged_stroops: outcome.feeCharged,
                        attempts: outcome.attempts,
                    },
                });
            });
        });
        if (result.status >= 500 && !result.body?.txHash) await recordPullFailure(supabase, subscription_id, result.body?.error || 'Pull submission failed');
        sendResult(res, result);
    } catch (err) {
        console.error("Error relaying pull:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/relay/budget', authenticateMerchant, async (req, res) => {
    try {
        if (!getSupabase()) return res.status(500).json({ error: "Supabase client not initialized" });
        const relayer = getRelayer();
        if (!relayer) return res.status(503).json(RELAYER_NOT_CONFIGURED);

        res.status(200).json({ budget: await relayer.budgetStatus(req.merchant.id) });
    } catch (err) {
        console.error("Error fetching relayer budget:", err);
        console.error("Error submitting pull:", err);
        if (ownedSubscriptionId) await recordPullFailure(getSupabase(), ownedSubscriptionId, err.message).catch(console.error);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/relayer/sponsor (#297)
 * Wraps a subscriber-signed vault-creation transaction in a fee bump paid by the Orbit
 * relayer, so a subscriber holding USDC but no XLM can onboard. The transaction must pass
 * the sponsorship policy (sponsorship.js) and the relayer's fee caps before anything is
 * signed or spent. Body: { signed_tx_xdr } (`tx_xdr` is accepted for the #169 widget).
 *
 * POST /relay/sponsor-transaction is kept as an alias for existing widgets. It used to
 * fee-bump any transaction it was given; it now enforces the same policy.
 */
const sponsorSchema = z.object({
    signed_tx_xdr: z.string().min(1).optional(),
    tx_xdr: z.string().min(1).optional(),
    network_passphrase: z.string().optional(),
}).refine((body) => body.signed_tx_xdr || body.tx_xdr, { message: 'signed_tx_xdr is required' });

const findMerchantByWallet = async (walletAddress) => {
    const supabase = getSupabase();
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('merchants')
        .select('id')
        .eq('wallet_address', walletAddress)
        .maybeSingle();
    if (error) throw error;
    return data ?? null;
};

const SPONSOR_STATUS = { SUCCESS: 200, FAILED: 422, NOT_FOUND: 202 };

const handleSponsorRequest = async (req, res) => {
    const parsed = sponsorSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error), code: 'invalid_request' });
    const relayer = getRelayer();
    if (!relayer) return res.status(503).json(RELAYER_NOT_CONFIGURED);

    const expectedPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
    if (parsed.data.network_passphrase && parsed.data.network_passphrase !== expectedPassphrase) {
        return res.status(400).json({ error: 'This relayer only sponsors transactions on its own network', code: 'wrong_network' });
    }

    try {
        const outcome = await relayer.sponsorUserTransaction({
            txXdr: parsed.data.signed_tx_xdr || parsed.data.tx_xdr,
            resolveMerchant: findMerchantByWallet,
            confirm: (server, hash) => waitForTransaction(server, hash, {
                timeoutMs: app.locals.txPollTimeoutMs ?? TX_POLL_TIMEOUT_MS,
                intervalMs: app.locals.txPollIntervalMs ?? TX_POLL_INTERVAL_MS,
            }),
        });
        const status = outcome.status === 'NOT_FOUND' ? 'PENDING' : outcome.status;
        return res.status(SPONSOR_STATUS[outcome.status] ?? 502).json({
            status,
            tx_hash: outcome.txHash,
            sponsored: true,
            sponsor_address: relayer.sponsorAddress,
            fee_charged_stroops: outcome.feeCharged,
            max_fee_stroops: outcome.maxFee,
            ...(outcome.status === 'FAILED' ? { error: 'The sponsored transaction failed on-chain', code: 'transaction_failed' } : {}),
        });
    } catch (err) {
        if (isRelayerError(err)) return sendResult(res, relayerErrorResult(err));
        console.error('Error sponsoring transaction:', err);
        return res.status(500).json({ error: 'Fee sponsorship failed', code: 'sponsorship_error' });
    }
};

app.post('/api/relayer/sponsor', sponsorRateLimit, handleSponsorRequest);
app.post('/relay/sponsor-transaction', sponsorRateLimit, handleSponsorRequest);

// ==========================================
// ROUTE 5: POST /subscriptions (Create Subscription after Handshake)
// ==========================================
app.post('/subscriptions', async (req, res) => {
    const parseResult = createSubscriptionSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    const { plan_id, customer_wallet_address, metadata, coupon_code } = parseResult.data;
    const supabase = getPrimarySupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
    if (!dbManager.isPrimaryHealthy()) {
        return res.status(503).json({ error: "Primary database is currently unavailable; write operations are suspended" });
    }

    const result = await executeIdempotently({
        supabase,
        req,
        label: "creating subscription",
        // Idempotency keys are scoped to the merchant that owns the plan
        resolveMerchant: async () => {
            const { data: plan, error } = await supabase
                .from('plans')
                .select('merchant_id')
                .eq('id', plan_id)
                .single();
            if (isNoRowsError(error) || !plan) return { status: 404, body: { error: "Plan not found" } };
            if (error) throw error;
            return { merchantId: plan.merchant_id };
        },
    }, async () => {
        const nextBillingDate = new Date().toISOString();

        // Look up the plan so fiat plans can capture the oracle rate as their
        // slippage quote. Non-fatal: the insert below still verifies the plan
        // through its foreign key.
        let planRow = null;
        try {
            const { data: planData, error: planLookupError } = await supabase
                .from('plans')
                .select('merchant_id, currency, price_amount, usdc_amount')
                .eq('id', plan_id);
            if (planLookupError) throw planLookupError;
            planRow = Array.isArray(planData) ? planData[0] : planData || null;
        } catch (err) {
            console.error("Error loading plan for subscription:", err.message);
        }

        const insertPayload = {
            plan_id,
            customer_wallet_address,
            next_billing_date: nextBillingDate,
            metadata: metadata || {},
        };

        // Fiat plans: quote the fiat->USDC rate now. The pull flow later
        // rejects settlements whose live rate moves more than 2% from it.
        if (isFiatCurrency(planRow?.currency)) {
            try {
                const quote = await quoteUsdcAmount({
                    supabase,
                    plan: planRow,
                    fetchImpl: app.locals.fetchImpl,
                    allowNetwork: false,
                    enforceSlippage: false,
                });
                insertPayload.quoted_rate = quote.rate;
            } catch (err) {
                // Cold rate cache: subscribe without a quote; the first pull stores one
                console.error("Unable to quote subscription exchange rate:", err.message);
            }
        }

        // A SQL function locks the coupon and atomically creates the
        // subscription and increments redemptions_count; no read-then-write race.
        let data, error;
        if (coupon_code) {
            const redeemed = await supabase.rpc('redeem_coupon_subscription', {
                p_plan_id: plan_id,
                p_customer_wallet_address: customer_wallet_address,
                p_metadata: metadata || {},
                p_code: normalizeCode(coupon_code),
                p_quoted_rate: insertPayload.quoted_rate ?? null,
            });
            data = Array.isArray(redeemed.data) ? redeemed.data[0] : redeemed.data;
            error = redeemed.error;
            if (error?.code === 'P7501') return { status: 422, body: { error: 'Coupon invalid or incompatible with plan' } };
            if (error?.code === 'P7502') return { status: 409, body: { error: 'Coupon redemption limit reached' } };
            if (error?.code === 'P7503') return { status: 404, body: { error: 'Plan not found' } };
        } else {
            ({ data, error } = await supabase.from('subscriptions')
                .insert([insertPayload]).select().single());
        }

        if (isForeignKeyError(error)) return { status: 404, body: { error: "Plan not found" } };
        if (isUniqueViolation(error)) {
            return { status: 409, body: { error: "This wallet is already subscribed to this plan" } };
        }
        if (error) throw error;

        // Fetch merchant id from plan to scope audit & webhook
        const { data: planData } = await supabase
            .from('plans')
            .select('merchant_id')
            .eq('id', plan_id)
            .single();

        const merchantId = planData?.merchant_id;

        await writeAuditLog(supabase, {
            merchantId,
            actorAddress: getActorAddress(req, customer_wallet_address),
            action: 'subscription.create',
            resourceType: 'subscription',
            resourceId: data.id,
            ipAddress: getClientIp(req),
            changesBefore: null,
            changesAfter: data,
        });

        if (merchantId) {
            await dispatchWebhookEvent(supabase, {
                merchantId,
                eventType: 'subscription.created',
                payload: {
                    event: 'subscription.created',
                    subscription_id: data.id,
                    customer_wallet_address,
                    plan_id,
                    next_billing_date: nextBillingDate,
                },
                fetchImpl: app.locals.fetchImpl,
            });
        }

        if (merchantId) {
            app.locals.paymentEventBus?.publish('subscriptionCreated', {
                merchantId, subscriptionId: data.id,
                id: data.id, status: data.status || 'active',
            }).catch((error) => console.error('Subscription stream publish failed:', error));
        }
        return { status: 201, body: { message: "Subscription created", subscription: data } };
    });
    sendResult(res, result);
});

// ==========================================
// ROUTE 6: API key management (authenticated with an existing key)
// ==========================================
// The first key for a merchant is issued out of band with `npm run create-api-key`.

const API_KEY_COLUMNS = 'id, name, key_prefix, environment, created_at, last_used_at, revoked_at';

// Not wrapped in executeIdempotently: that would persist the one-time secret in idempotency_keys
app.post('/api-keys', authenticateMerchant, async (req, res) => {
    const parseResult = createApiKeySchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    const { name, environment } = parseResult.data;
    // A test key must not be able to escalate itself into live credentials
    if (environment === 'live' && req.apiKey.environment !== 'live') {
        return res.status(403).json({ error: "Live API keys can only be created with a live API key" });
    }

    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { apiKey, secret, error } = await issueApiKey(supabase, { merchantId: req.merchant.id, name, environment });
        if (error) throw error;

        await writeAuditLog(supabase, {
            merchantId: req.merchant.id,
            actorAddress: getActorAddress(req, null),
            action: 'api_key.create',
            resourceType: 'api_key',
            resourceId: apiKey.id,
            ipAddress: getClientIp(req),
            changesBefore: null,
            changesAfter: { name, environment, key_prefix: apiKey.key_prefix },
        });

        res.set('Cache-Control', 'no-store');
        res.status(201).json({
            message: "API key created. Store the secret now; it will not be shown again.",
            api_key: apiKey,
            secret,
        });
    } catch (err) {
        console.error("Error creating API key:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api-keys', authenticateMerchant, async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data, error } = await supabase
            .from('api_keys')
            .select(API_KEY_COLUMNS)
            .eq('merchant_id', req.merchant.id)
            .order('created_at', { ascending: false });
        if (error) throw error;

        res.status(200).json({ api_keys: data });
    } catch (err) {
        console.error("Error listing API keys:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api-keys/:id', authenticateMerchant, async (req, res) => {
    const parseResult = apiKeyParamsSchema.safeParse(req.params);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        // Scoped by merchant_id so one merchant can never revoke another's key
        const { data, error } = await supabase
            .from('api_keys')
            .update({ revoked_at: new Date().toISOString() })
            .eq('id', parseResult.data.id)
            .eq('merchant_id', req.merchant.id)
            .is('revoked_at', null)
            .select(API_KEY_COLUMNS)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: "API key not found or already revoked" });

        await writeAuditLog(supabase, {
            merchantId: req.merchant.id,
            actorAddress: getActorAddress(req, null),
            action: 'api_key.revoke',
            resourceType: 'api_key',
            resourceId: parseResult.data.id,
            ipAddress: getClientIp(req),
            changesBefore: data,
            changesAfter: { revoked_at: data.revoked_at },
        });

        res.status(200).json({ message: "API key revoked", api_key: data });
    } catch (err) {
        console.error("Error revoking API key:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE 7: GET /audit-logs (Compliance & Forensic Audit Trail)
// ==========================================
app.get('/audit-logs', async (req, res) => {
    const parseResult = getAuditLogsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    try {
        const { merchant_id, action, resource_type, start_date, end_date, limit, offset } = parseResult.data;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        let query = supabase
            .from('audit_logs')
            .select('*', { count: 'exact' })
            .eq('merchant_id', merchant_id);

        if (action) query = query.eq('action', action);
        if (resource_type) query = query.eq('resource_type', resource_type);
        if (start_date) query = query.gte('created_at', start_date);
        if (end_date) query = query.lte('created_at', end_date);

        query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

        const { data, count, error } = await query;
        if (error) throw error;

        res.status(200).json({
            audit_logs: data || [],
            total: count ?? (data?.length || 0),
            limit,
            offset,
        });
    } catch (err) {
        console.error("Error fetching audit logs:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE 8: DUNNING MANAGEMENT & RECOVERY
// ==========================================
app.post('/dunning/process', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
        const merchant_id = req.body?.merchant_id;
        // Use the merchant's saved dunning workflow when one exists (#190)
        const workflow = await loadDunningWorkflow(supabase, merchant_id);
        const result = await processDunningRetries(supabase, {
            merchantId: merchant_id,
            fetchImpl: app.locals.fetchImpl,
            workflowSteps: workflow?.steps || null,
        });
        res.status(200).json(result);
    } catch (err) {
        console.error("Error processing dunning retries:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/subscriptions/:id/recovery-link', authenticateMerchant, async (req, res) => {
    try {
        const { id } = req.params;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data: sub, error } = await supabase
            .from('subscriptions')
            .select('*, plans(*)')
            .eq('id', id)
            .single();

        if (isNoRowsError(error) || !sub) return res.status(404).json({ error: "Subscription not found" });
        if (error) throw error;
        // Never disclose whether another merchant owns this subscription.
        if (sub.plans?.merchant_id !== req.merchant.id) {
            return res.status(404).json({ error: "Subscription not found" });
        }

        if (sub.plans?.merchant_id !== req.merchant.id) return res.status(404).json({ error: 'Subscription not found' });

        const recovery = generateRecoveryLink(id, { planId: sub.plan_id });
        res.status(200).json(recovery);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE 8: CUSTOMER MANAGEMENT ACTIONS
// ==========================================
app.post('/subscriptions/:id/cancel', authenticateMerchant, async (req, res) => {
    try {
        const { id } = req.params;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data: sub, error } = await supabase
            .from('subscriptions')
            .select('*, plans(*)')
            .eq('id', id)
            .single();

        if (isNoRowsError(error) || !sub) return res.status(404).json({ error: "Subscription not found" });
        if (error) throw error;
        // Never disclose whether another merchant owns this subscription.
        if (sub.plans?.merchant_id !== req.merchant.id) {
            return res.status(404).json({ error: "Subscription not found" });
        }

        const changesBefore = { status: sub.status };
        const changesAfter = { status: 'cancelled', next_dunning_retry_at: null };

        const { data: updated, error: updateErr } = await supabase
            .from('subscriptions')
            .update(changesAfter)
            .eq('id', id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        // Cancelled subscribers lose their verifiable credentials immediately (#132).
        // Verification also re-checks subscription status, so a failure here only
        // delays the revocation record, never access.
        try {
            await credentialService.revocations.revokeSubscription(supabase, id, 'subscription_cancelled');
        } catch (revokeErr) {
            console.error("Error revoking credentials for cancelled subscription:", id, revokeErr);
        }

        const merchantId = sub.plans?.merchant_id;
        await writeAuditLog(supabase, {
            merchantId,
            actorAddress: getActorAddress(req, sub.customer_wallet_address),
            action: 'subscription.cancel',
            resourceType: 'subscription',
            resourceId: id,
            ipAddress: getClientIp(req),
            changesBefore,
            changesAfter,
        });

        if (merchantId) {
            await dispatchWebhookEvent(supabase, {
                merchantId,
                eventType: 'subscription.cancelled',
                payload: {
                    event: 'subscription.cancelled',
                    subscription_id: id,
                    customer_wallet_address: sub.customer_wallet_address,
                    reason: req.body?.reason || 'merchant_requested',
                },
                fetchImpl: app.locals.fetchImpl,
            });
        }

        if (merchantId) {
            app.locals.paymentEventBus?.publish('vaultCancelled', {
                merchantId, subscriptionId: id, id, status: 'cancelled',
            }).catch((error) => console.error('Subscription cancellation stream failed:', error));
        }
        res.status(200).json({ message: "Subscription cancelled successfully", subscription: updated });
    } catch (err) {
        console.error("Error cancelling subscription:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/subscriptions/:id/refund', authenticateMerchant, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, reason, prorated } = req.body || {};
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data: sub, error } = await supabase
            .from('subscriptions')
            .select('*, plans(*)')
            .eq('id', id)
            .single();

        if (isNoRowsError(error) || !sub) return res.status(404).json({ error: "Subscription not found" });
        if (error) throw error;
        // Never disclose whether another merchant owns this subscription.
        if (sub.plans?.merchant_id !== req.merchant.id) {
            return res.status(404).json({ error: "Subscription not found" });
        }

        const merchantId = sub.plans?.merchant_id;
        const refundAmount = amount ?? sub.plans?.usdc_amount;

        await writeAuditLog(supabase, {
            merchantId,
            actorAddress: getActorAddress(req, sub.customer_wallet_address),
            action: 'subscription.refund',
            resourceType: 'subscription',
            resourceId: id,
            ipAddress: getClientIp(req),
            changesBefore: null,
            changesAfter: { amount: refundAmount, reason, prorated: !!prorated },
        });

        if (merchantId) {
            await dispatchWebhookEvent(supabase, {
                merchantId,
                eventType: 'payment.refunded',
                payload: {
                    event: 'payment.refunded',
                    subscription_id: id,
                    customer_wallet_address: sub.customer_wallet_address,
                    refund_amount: refundAmount,
                    reason: reason || 'Customer refund request',
                    prorated: !!prorated,
                },
                fetchImpl: app.locals.fetchImpl,
            });
        }

        res.status(200).json({
            message: "Refund processed successfully",
            refund: {
                subscription_id: id,
                amount: refundAmount,
                reason: reason || 'Customer refund request',
                prorated: !!prorated,
            },
        });
    } catch (err) {
        console.error("Error processing refund:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/subscriptions/:id/timeline', authenticateMerchant, async (req, res) => {
    try {
        const { id } = req.params;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data: sub, error } = await supabase
            .from('subscriptions')
            .select('*, plans(*)')
            .eq('id', id)
            .single();

        if (isNoRowsError(error) || !sub) return res.status(404).json({ error: "Subscription not found" });
        if (error) throw error;
        // Never disclose whether another merchant owns this subscription.
        if (sub.plans?.merchant_id !== req.merchant.id) {
            return res.status(404).json({ error: "Subscription not found" });
        }

        const { data: logs } = await supabase
            .from('audit_logs')
            .select('*')
            .eq('resource_id', id)
            .order('created_at', { ascending: false });

        const timeline = [];

        timeline.push({
            id: `created-${id}`,
            type: 'subscription_created',
            title: 'Vault Handshake Established',
            description: `Subscriber linked Ed25519 wallet to ${sub.plans?.name || 'plan'}`,
            timestamp: sub.created_at || new Date().toISOString(),
            status: 'success',
        });

        if (logs && Array.isArray(logs)) {
            for (const log of logs) {
                if (log.action === 'pull.execute') {
                    timeline.push({
                        id: log.id,
                        type: 'settled_pull',
                        title: 'Recurring USDC Pull Settled',
                        description: 'Contract executed pull_funds with 1.2s Soroban consensus finality',
                        amount: sub.plans?.usdc_amount,
                        timestamp: log.created_at,
                        status: 'success',
                        txHash: log.changes_after?.txHash,
                    });
                } else if (log.action === 'subscription.past_due') {
                    timeline.push({
                        id: log.id,
                        type: 'failed_pull',
                        title: 'Pull Attempt Failed',
                        description: 'Account balance insufficient or allowance limit reached. Dunning cycle started.',
                        timestamp: log.created_at,
                        status: 'failed',
                    });
                } else if (log.action === 'subscription.dunning_retry') {
                    timeline.push({
                        id: log.id,
                        type: 'dunning_retry',
                        title: `Automated Dunning Attempt #${log.changes_after?.retry_count || 1}`,
                        description: 'Smart recovery schedule retry triggered with merchant webhook dispatch.',
                        timestamp: log.created_at,
                        status: 'warning',
                    });
                } else if (log.action === 'subscription.refund') {
                    timeline.push({
                        id: log.id,
                        type: 'refund',
                        title: 'Prorated Refund Issued',
                        description: `Refund credited back to subscriber (${log.changes_after?.reason || 'merchant initiated'})`,
                        amount: log.changes_after?.amount,
                        timestamp: log.created_at,
                        status: 'info',
                    });
                } else if (log.action === 'subscription.cancel' || log.action === 'subscription.dunning_cancelled') {
                    timeline.push({
                        id: log.id,
                        type: 'cancelled',
                        title: log.action === 'subscription.dunning_cancelled' ? 'Cancelled (Dunning Expired)' : 'Subscription Cancelled',
                        description: 'Vault allowance revoked and recurrence stopped.',
                        timestamp: log.created_at,
                        status: 'failed',
                    });
                }
            }
        }

        timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        res.status(200).json({ timeline, subscription: sub });
    } catch (err) {
        console.error("Error fetching timeline:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ROUTE 9: WEBHOOK MANAGEMENT & DELIVERY LOGS
// ==========================================
app.get('/webhooks', async (req, res) => {
    try {
        const { merchant_id } = req.query;
        if (!merchant_id) return res.status(400).json({ error: "merchant_id is required" });
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data, error } = await supabase
            .from('webhooks')
            .select('*')
            .eq('merchant_id', merchant_id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json({ webhooks: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/webhooks', async (req, res) => {
    const parseResult = createWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    try {
        const { merchant_id, url, events, signing_secret } = parseResult.data;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const secret = signing_secret || generateSigningSecret();
        const { data, error } = await supabase
            .from('webhooks')
            .insert([{
                merchant_id,
                url,
                events,
                signing_secret: secret,
                active: true,
            }])
            .select()
            .single();

        if (isForeignKeyError(error)) return res.status(404).json({ error: "Merchant not found" });
        if (error) throw error;

        await writeAuditLog(supabase, {
            merchantId: merchant_id,
            actorAddress: getActorAddress(req, null),
            action: 'webhook.create',
            resourceType: 'webhook',
            resourceId: data.id,
            ipAddress: getClientIp(req),
            changesBefore: null,
            changesAfter: { url, events, active: true },
        });

        res.status(201).json({ message: "Webhook created successfully", webhook: data });
    } catch (err) {
        console.error("Error creating webhook:", err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/webhooks/:id', async (req, res) => {
    const parseResult = updateWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    try {
        const { id } = req.params;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data: existing, error: existErr } = await supabase
            .from('webhooks')
            .select('*')
            .eq('id', id)
            .single();

        if (isNoRowsError(existErr) || !existing) return res.status(404).json({ error: "Webhook not found" });
        if (existErr) throw existErr;

        const updateData = {};
        if (parseResult.data.url !== undefined) updateData.url = parseResult.data.url;
        if (parseResult.data.events !== undefined) updateData.events = parseResult.data.events;
        if (parseResult.data.active !== undefined) updateData.active = parseResult.data.active;
        if (parseResult.data.signing_secret !== undefined) updateData.signing_secret = parseResult.data.signing_secret;

        const { data: updated, error: updateErr } = await supabase
            .from('webhooks')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        await writeAuditLog(supabase, {
            merchantId: existing.merchant_id,
            actorAddress: getActorAddress(req, null),
            action: 'webhook.update',
            resourceType: 'webhook',
            resourceId: id,
            ipAddress: getClientIp(req),
            changesBefore: existing,
            changesAfter: updated,
        });

        res.status(200).json({ message: "Webhook updated successfully", webhook: updated });
    } catch (err) {
        console.error("Error updating webhook:", err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/webhooks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { data: existing, error: existErr } = await supabase
            .from('webhooks')
            .select('*')
            .eq('id', id)
            .single();

        if (isNoRowsError(existErr) || !existing) return res.status(404).json({ error: "Webhook not found" });
        if (existErr) throw existErr;

        const { error: delErr } = await supabase
            .from('webhooks')
            .delete()
            .eq('id', id);

        if (delErr) throw delErr;

        await writeAuditLog(supabase, {
            merchantId: existing.merchant_id,
            actorAddress: getActorAddress(req, null),
            action: 'webhook.delete',
            resourceType: 'webhook',
            resourceId: id,
            ipAddress: getClientIp(req),
            changesBefore: existing,
            changesAfter: null,
        });

        res.status(200).json({ message: "Webhook deleted successfully" });
    } catch (err) {
        console.error("Error deleting webhook:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/webhooks/deliveries', async (req, res) => {
    try {
        const { merchant_id, webhook_id, limit = 50, offset = 0 } = req.query;
        if (!merchant_id) return res.status(400).json({ error: "merchant_id is required" });
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        let query = supabase
            .from('webhook_deliveries')
            .select('*, webhooks(url)', { count: 'exact' })
            .eq('merchant_id', merchant_id);

        if (webhook_id) query = query.eq('webhook_id', webhook_id);

        query = query
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        const { data, count, error } = await query;
        if (error) throw error;

        res.status(200).json({
            deliveries: data || [],
            total: count ?? (data?.length || 0),
            limit: Number(limit),
            offset: Number(offset),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/webhooks/deliveries/:id/resend', async (req, res) => {
    try {
        const { id } = req.params;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const updated = await resendWebhookDelivery(supabase, id, app.locals.fetchImpl);
        if (!updated) return res.status(404).json({ error: "Delivery record not found" });

        res.status(200).json({ message: "Webhook redelivered successfully", delivery: updated });
    } catch (err) {
        console.error("Error resending webhook delivery:", err);
        res.status(500).json({ error: err.message });
    }
});

// Webhook dead-letter queue (#229): deliveries that failed every automatic retry
app.get('/webhooks/dead-letters', async (req, res) => {
    try {
        const { merchant_id, webhook_id, limit = 50, offset = 0 } = req.query;
        if (!merchant_id) return res.status(400).json({ error: "merchant_id is required" });
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        let query = supabase
            .from('webhook_dead_letters')
            .select('*', { count: 'exact' })
            .eq('merchant_id', merchant_id);
        if (webhook_id) query = query.eq('webhook_id', webhook_id);

        const { data, count, error } = await query
            .order('failed_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);
        if (error) throw error;

        res.status(200).json({
            dead_letters: data || [],
            total: count ?? (data?.length || 0),
            limit: Number(limit),
            offset: Number(offset),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/webhooks/dead-letters/:id/replay', async (req, res) => {
    try {
        const merchantId = req.body?.merchant_id;
        if (!merchantId) return res.status(400).json({ error: "merchant_id is required" });
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const deadLetter = await replayDeadLetter(supabase, req.params.id, {
            merchantId,
            fetchImpl: app.locals.fetchImpl,
        });
        if (!deadLetter) return res.status(404).json({ error: "Dead letter not found" });

        res.status(200).json({
            message: deadLetter.replay_status === 'success'
                ? "Dead letter replayed successfully"
                : "Dead letter replay failed; the endpoint is still rejecting deliveries",
            dead_letter: deadLetter,
        });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error("Error replaying webhook dead letter:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/webhooks/test', async (req, res) => {
    try {
        const { merchant_id, webhook_id, event_type = "payment.settled" } = req.body || {};
        if (!merchant_id) return res.status(400).json({ error: "merchant_id is required" });
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const testPayload = {
            event: event_type,
            test: true,
            timestamp: new Date().toISOString(),
            data: {
                subscription_id: crypto.randomUUID(),
                customer_wallet_address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
                amount: 290000000,
                currency: "USDC",
                status: "success",
            },
        };

        const deliveries = await dispatchWebhookEvent(supabase, {
            merchantId: merchant_id,
            eventType: event_type,
            payload: testPayload,
            fetchImpl: app.locals.fetchImpl,
        });

        res.status(200).json({
            message: "Test webhook event triggered",
            dispatched_count: deliveries.length,
            deliveries,
        });
    } catch (err) {
        console.error("Error sending test webhook:", err);
        res.status(500).json({ error: err.message });
    }
});

// Rotate without downtime: keep the old secret for in-flight retries and use
// the new one for all subsequent deliveries.
app.post('/webhooks/:id/rotate-secret', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase client not initialized' });
    const secret = generateSigningSecret();
    const { data, error } = await supabase.from('webhooks').update({ previous_signing_secret: req.body?.signing_secret || null, signing_secret: secret, secret_rotated_at: new Date().toISOString() }).eq('id', req.params.id).select('id,secret_rotated_at').single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ webhook: data, signing_secret: secret });
});

/// @route GET /api/verify/invoice/:invoiceId
/// @desc Verify invoice cryptographic signature and return settlement details
/// @access Merchant authenticated
app.get('/api/verify/invoice/:invoiceId', authenticateMerchant, async (req, res) => {
    const { invoiceId } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase client not initialized' });

    try {
        // Query the invoice from the database
        const { data, error } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', invoiceId)
            .single();

        if (error || !data) return res.status(404).json({ error: 'Invoice not found' });

        // Compute SHA-256 hash of invoice parameters for verification
        const verificationInput = {
            merchant_address: data.merchant_address,
            invoice_id: data.invoice_id,
            amount: data.amount,
            timestamp: data.timestamp,
        };
        const verificationHash = crypto.createHash('sha256')
            .update(JSON.stringify(verificationInput))
            .digest('hex');

        // Check if the invoice has been tampered with by comparing stored vs current data
        const isValid = data.verification_status !== 'tampered';

        // Return verification status and settlement details
        res.json({
            invoice_id: data.invoice_id,
            merchant_address: data.merchant_address,
            amount: data.amount,
            verification_status: data.verification_status,
            verification_hash,
            is_valid: isValid,
            settled_at: data.settled_at,
            settlement_transaction: data.settlement_transaction,
            verified_at: data.verified_at,
        });
    } catch (err) {
        console.error('Error verifying invoice:', err);
        res.status(500).json({ error: 'Internal server error during invoice verification' });
    }
});

app.post('/webhooks/:id/verify', async (req, res) => {
    try {
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: 'Supabase client not initialized' });
        const result = await verifyWebhookEndpoint(supabase, {
            webhookId: req.params.id,
            fetchImpl: app.locals.fetchImpl,
        });
        if (result.statusCode) return res.status(result.statusCode).json({ error: result.error });
        res.status(result.ok ? 200 : 502).json(result);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

app.post('/webhooks/:id/backfill', async (req, res) => {
    const parseResult = backfillWebhookSchema.safeParse(req.body || {});
    if (!parseResult.success) {
        return res.status(400).json({ error: formatZodError(parseResult.error) });
    }

    try {
        const { id } = req.params;
        const supabase = getSupabase();
        if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });

        const { event_types, start_date, end_date } = parseResult.data;
        const result = await replayWebhookEvents(supabase, {
            webhookId: id,
            eventTypes: event_types,
            startDate: start_date,
            endDate: end_date,
            fetchImpl: app.locals.fetchImpl,
        });

        res.status(200).json({
            message: "Webhook backfill completed successfully",
            total_events: result.total_events,
            replayed_count: result.replayed_count,
            deliveries: result.deliveries,
        });
    } catch (err) {
        if (err.status === 404 || err.message === 'Webhook not found') {
            return res.status(404).json({ error: "Webhook not found" });
        }
        console.error("Error executing webhook backfill:", err);
    }
});

registerComplianceRoutes(app, getSupabase, authenticateMerchant);
registerOrganizationRoutes(app, getSupabase, authenticateMerchant);
registerInvoiceRoutes(app, getSupabase, authenticateMerchant);
registerRpcProxyRoute(app);
registerPrivacyRoutes(app, { getPrimarySupabase, authenticateMerchant });
registerUsageRoutes(app, { getSupabase, authenticateMerchant, getBuffer: getUsageBuffer });
registerCohortRoutes(app, getSupabase, authenticateMerchant);
registerNotificationTemplateRoutes(app, getSupabase, authenticateMerchant);
registerBalanceReminderRoutes(app, { getSupabase, authenticateMerchant });
registerProofRoutes(app, { getPrimarySupabase, authenticateMerchant });
registerSigningSessionRoutes(app, getSupabase, authenticateMerchant);

// Webhook incident alerting: Slack / PagerDuty / email channels and failure telemetry (#189)
registerWebhookAlertRoutes(app, getSupabase, authenticateMerchant);

// Dunning workflow builder: saved retry cadence, email templates and recovery funnel (#190)
registerDunningWorkflowRoutes(app, getSupabase, authenticateMerchant);
setDeliveryObserver(createDeliveryAlertObserver(getSupabase, { throttleStore: rateLimitStore }));
setEndpointAlertNotifier(createEndpointAlertNotifier(getSupabase, { throttleStore: rateLimitStore }));
registerCustomerPortalRoutes(app, getSupabase, getSorobanServer);
registerFailureRecoveryRoutes(app, getSupabase, authenticateMerchant);
registerCouponRoutes(app, getSupabase, authenticateMerchant);
registerBillingResolutionRoutes(app, getSupabase, authenticateMerchant, loadPullContext, getSorobanServer);
registerPayoutSplitRoutes(app, getSupabase, authenticateMerchant, {
    resolveDispatcher: () => getPayoutSplitDispatcher(),
});
registerPriceIndexationRoutes(app, getSupabase, authenticateMerchant);
registerSnapshotRoutes(app, getSupabase, authenticateMerchant, getSorobanServer);
registerHealthMetrics(app, { getSupabase, getSorobanServer, rpcUrl: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org' });
registerStorageHealthRoutes(app);
app.locals.disputeAlertProcessor = createDisputeAlertProcessor({
    supabase: getSupabase(),
    frontendUrl: process.env.FRONTEND_URL || 'https://useorbit.xyz',
});
// orbit_db_pool_active (#230): connections checked out of the backend's pg pools
setDbPoolSource(() => [
    dbManager.primaryPool,
    ...dbManager.replicaPools,
    app.locals.reportPool,
    app.locals.reportReplicaPool,
]);
registerIndexerRoutes(app);
registerStripeBillingRoutes(app, getSupabase, authenticateMerchant);
registerExternalReconciliationRoutes(app, getSupabase);
const credentialService = registerCredentialRoutes(app, getSupabase, authenticateMerchant);
registerHandoverRoutes(app, getSupabase, {
    rpcUrl: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    contractId: process.env.ORBIT_CONTRACT_ID,
    tokenContractId: process.env.USDC_CONTRACT_ID || process.env.TOKEN_CONTRACT_ID,
});
app.locals.paymentEventBus = createSubscriptionEventBus();
app.locals.graphqlServer = registerGraphql(app, getSupabase, authenticateMerchant);

const { validateBrandPatch, BRAND_FIELDS } = require('./brand-profile'); // #350
const BRAND_SELECT = BRAND_FIELDS.join(', ');

// Merchant profile & custom contract persistence (#143)
app.get('/merchant/profile', authenticateMerchant, async (req, res) => {
    try {
        const supabase = getReadSupabase();
        if (!supabase) return res.status(500).json({ error: "Database client not initialized" });
        const { data, error } = await supabase
            .from('merchants')
            .select('id, name, wallet_address, contract_id, created_at, ' + BRAND_SELECT)
            .eq('id', req.merchant.id)
            .single();
        if (error) throw error;
        res.status(200).json({ merchant: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/merchant/profile', authenticateMerchant, async (req, res) => {
    try {
        const supabase = getPrimarySupabase();
        if (!supabase) return res.status(500).json({ error: "Database client not initialized" });
        if (!dbManager.isPrimaryHealthy()) {
            return res.status(503).json({ error: "Primary database is currently unavailable; write operations are suspended" });
        }
        const updates = {};
        if (typeof req.body?.name === 'string' && req.body.name.trim()) {
            updates.name = req.body.name.trim();
        }
        if (typeof req.body?.contract_id === 'string' && req.body.contract_id.trim()) {
            updates.contract_id = req.body.contract_id.trim();
        }
        // #350: brand identity, logo, banner and accent color
        const brand = validateBrandPatch(req.body);
        if (!brand.ok) {
            return res.status(400).json({ error: 'Invalid brand profile', fields: brand.errors });
        }
        Object.assign(updates, brand.patch);
        const { data, error } = await supabase
            .from('merchants')
            .update(updates)
            .eq('id', req.merchant.id)
            .select('id, name, wallet_address, contract_id, created_at, ' + BRAND_SELECT)
            .single();
        if (error) throw error;
        res.status(200).json({ merchant: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PostgreSQL protocol cursor: unlike Supabase REST pagination, the cursor
// never materializes the full transaction table in application memory.
const getReportPool = () => {
    return dbManager.getReportPool(app, { readOnly: true });
};
registerTransactionExportRoute(
    app, authenticateMerchant, getReportPool,
    (sql, values) => {
        const Cursor = require('pg-cursor');
        return new Cursor(sql, values);
    },
);

const PORT = process.env.PORT || 3001;
function startServer() {
    if (getSupabase() && process.env.INDEXER_START_LEDGER) {
        app.locals.ledgerIndexer = configuredIndexer(getSupabase());
        app.locals.indexerWorker = app.locals.ledgerIndexer.start(Number(process.env.INDEXER_INTERVAL_MS) || 5000);
    }
    // Background oracle worker (#96): refreshes the fiat->USDC rate cache on a
    // schedule so /rates and dynamic fiat billing always read fresh quotes.
    const oracleSupabase = getSupabase();
    if (process.env.RECURRING_PULLS_ENABLED === 'true' && !oracleSupabase) {
        throw new Error('Supabase must be configured when recurring pulls are enabled');
    }
    if (oracleSupabase) {
        app.locals.oracleWorker = startOracleWorker({
            supabase: oracleSupabase,
            fetchImpl: app.locals.fetchImpl,
        });

        // Price indexation worker (#164): notifies subscribers inside the advance
        // notice window and applies scheduled plan price changes on their
        // effective date.
        app.locals.priceIndexationWorker = createPriceIndexationWorker({
            supabase: oracleSupabase,
            fetchImpl: app.locals.fetchImpl,
        });
        app.locals.priceIndexationWorker.start(
            Number(process.env.PRICE_INDEXATION_INTERVAL_MS) || undefined,
        );

        // Daily contract state snapshot backup worker (#185): exports Soroban
        // vaults, plans, and admin configs with SHA-256 integrity checksums.
        if (process.env.ORBIT_CONTRACT_ID || process.env.SOROBAN_CONTRACT_ID) {
            app.locals.snapshotExportWorker = createSnapshotExportWorker({
                server: getSorobanServer(process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'),
                supabase: oracleSupabase,
                contractId: process.env.ORBIT_CONTRACT_ID || process.env.SOROBAN_CONTRACT_ID,
            });
            app.locals.snapshotExportWorker.start(
                Number(process.env.SNAPSHOT_EXPORT_INTERVAL_MS) || undefined,
            );
        }

        if (process.env.RECURRING_PULLS_ENABLED === 'true') {
            const contractId = process.env.ORBIT_CONTRACT_ID;
            if (!contractId) throw new Error('ORBIT_CONTRACT_ID is required when recurring pulls are enabled');
            const relayer = getRelayer();
            if (!relayer) throw new Error('RELAYER_SECRET_KEY is required when recurring pulls are enabled');
            const signer = createRemoteMerchantSigner({
                url: process.env.RECURRING_PULL_SIGNER_URL,
                token: process.env.RECURRING_PULL_SIGNER_TOKEN,
                fetchImpl: app.locals.fetchImpl,
            });
            const recurringPullOptions = {};
            if (process.env.RECURRING_PULL_MAX_ATTEMPTS) {
                const maxAttempts = Number(process.env.RECURRING_PULL_MAX_ATTEMPTS);
                if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
                    throw new Error('RECURRING_PULL_MAX_ATTEMPTS must be a positive integer');
                }
                recurringPullOptions.maxAttempts = maxAttempts;
            }
            const recurringPullWorker = createRecurringPullWorker({
                store: createRecurringPullStore(oracleSupabase),
                relayer,
                signer,
                contractId,
                networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
                waitForTransaction: (hash, options) => waitForTransaction(
                    getSorobanServer(process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'),
                    hash,
                    options,
                ),
                settle: async ({ sub, merchant, transactionHash, confirmation, settledAt, nextBillingDate }) => {
                    await applyPullOutcome({
                        supabase: oracleSupabase,
                        req: null,
                        sub,
                        merchant,
                        subscription_id: sub.id,
                        txHash: transactionHash,
                        status: confirmation.status,
                        confirmation,
                        extraBody: { automated: true },
                        subscriptionAlreadySettled: true,
                        settledAt,
                        nextBillingDate,
                    });
                },
                fail: async ({ sub, merchant, transactionHash, error }) => {
                    await recordPullFailure(oracleSupabase, sub.id, error, transactionHash);
                    await markSubscriptionPastDue(oracleSupabase, sub.id, {
                        actorAddress: merchant.wallet_address,
                        fetchImpl: app.locals.fetchImpl,
                    });
                },
                options: recurringPullOptions,
            });
            app.locals.recurringPullWorker = startRecurringPullWorker(recurringPullWorker, {
                intervalMs: Number(process.env.RECURRING_PULL_INTERVAL_MS) || undefined,
            });
        }
    } else {
        console.warn("Oracle worker not started: Supabase client not initialized");
    }

    // Stellar exchange-rate worker (#303): runs independently of request
    // handling even when no database is configured, and degrades to cache or
    // static baselines rather than failing startup.
    app.locals.exchangeRateWorker = getExchangeRateWorker();
    app.locals.exchangeRateWorker.start();

    const usageInterval = setInterval(() => {
        const buffer = getUsageBuffer(), supabase = getSupabase();
        if (buffer && supabase) rollupUsage({ buffer, supabase }).catch((err) => console.error('Usage rollup failed:', err));
    }, Number(process.env.USAGE_ROLLUP_INTERVAL_MS) || 300000);
    usageInterval.unref();

    const httpServer = app.listen(PORT, () => {
        console.log(`Orbit Merchant API running on http://localhost:${PORT}`);
    });
    app.locals.graphqlServer.attachWebsocket(httpServer);

    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        app.locals.exchangeRateWorker?.stop();
        app.locals.oracleWorker?.stop?.();
        httpServer.close(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

// Pre-flight schema guard (#157): never serve against a database whose
// migrations don't match this build.
if (require.main === module) {
    checkSchemaOnStartup()
        .then(startServer)
        .catch((err) => {
            console.error(`Startup aborted: ${err.message}`);
            process.exit(1);
        });
}


// Simulation footprint cache shared across requests (#290).
const sharedSimulationCache = new SimulationCache({
    ttlLedgers: Number(process.env.SIM_CACHE_TTL_LEDGERS) || 10,
});

// POST /simulate/quote — unauthenticated read-only endpoint that returns a
// cached simulation result for the given transaction XDR (#290). The result
// is served from the in-process ledger-TTL cache when possible, saving
// 400-800ms per duplicate pre-flight call.
app.post('/simulate/quote', createRpcIpWindowLimiter({ limit: Number(process.env.RPC_PROXY_RATE_LIMIT_MAX) || 60 }), async (req, res) => {
    const { transaction } = req.body || {};
    if (!transaction || typeof transaction !== 'string') {
        return res.status(400).json({ error: 'transaction (base64 XDR) is required' });
    }
    const proxy = app.locals.rpcProxy;
    if (!proxy) return res.status(503).json({ error: 'RPC proxy not available' });
    try {
        const ledgerResp = await proxy.call({ method: 'getLatestLedger', params: [] });
        const ledger = ledgerResp?.result?.sequence ?? 0;
        const cacheKey = `simulateTransaction:${transaction}`;
        const { value, source } = await getOrSimulate(sharedSimulationCache, cacheKey, {
            ledger,
            simulate: () => proxy.call({ method: 'simulateTransaction', params: [{ transaction }] }),
        });
        res.json({ ...value, cached: source === 'cache' });
    } catch (err) {
        res.status(err.statusCode || 502).json({ error: err.message });
    }
});

// GET /payroll/streams — returns active streaming payroll streams for the merchant (#291).
app.get('/payroll/streams', authenticateMerchant, async (req, res) => {
    const supabase = getReadSupabase();
    if (!supabase) return res.status(500).json({ error: 'Database client not initialized' });
    const { data, error } = await supabase
        .from('payroll_streams')
        .select('id, recipient_address, recipient_label, token_symbol, rate_per_second, start_time, end_time, withdrawn_amount')
        .eq('merchant_id', req.merchant.id)
        .eq('active', true)
        .order('start_time', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const streams = (data || []).map((row) => ({
        id: row.id,
        recipientLabel: row.recipient_label || row.recipient_address,
        tokenSymbol: row.token_symbol || 'USDC',
        ratePerSecond: Number(row.rate_per_second) || 0,
        startTime: new Date(row.start_time).getTime(),
        endTime: new Date(row.end_time).getTime(),
        withdrawnAmount: Number(row.withdrawn_amount) || 0,
    }));
    res.json({ streams });
});

// POST /payroll/streams/claim — submit a withdraw_from_stream transaction (#291).
app.post('/payroll/streams/claim', authenticateMerchant, async (req, res) => {
    const { stream_id, amount, sender_address } = req.body || {};
    if (!stream_id || !amount || !sender_address) {
        return res.status(400).json({ error: 'stream_id, amount, and sender_address are required' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (!StrKey.isValidEd25519PublicKey(sender_address)) {
        return res.status(400).json({ error: 'sender_address must be a valid Stellar public key' });
    }
    const supabase = getPrimarySupabase();
    const { data: streamRow, error: strErr } = await supabase
        .from('payroll_streams')
        .select('id, merchant_id')
        .eq('id', stream_id)
        .eq('merchant_id', req.merchant.id)
        .maybeSingle();
    if (strErr || !streamRow) return res.status(404).json({ error: 'Stream not found or access denied' });
    const relayer = getRelayer();
    if (!relayer) return res.status(503).json({ error: 'Transaction relayer is not configured' });
    const contractId = process.env.ORBIT_CONTRACT_ID;
    if (!contractId) return res.status(503).json({ error: 'ORBIT_CONTRACT_ID is not configured' });
    try {
        const { rpc: RpcLib, Networks, TransactionBuilder, BASE_FEE, Contract, nativeToScVal } = require('@stellar/stellar-sdk');
        const server = getSorobanServer(process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org');
        const account = await server.getAccount(sender_address);
        const rawAmount = BigInt(Math.round(amount * 10_000_000));
        const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
        })
            .addOperation(
                new Contract(contractId).call(
                    'withdraw_from_stream',
                    nativeToScVal(BigInt(stream_id), { type: 'u64' }),
                    nativeToScVal(rawAmount, { type: 'i128' }),
                )
            )
            .setTimeout(60)
            .build();
        const result = await relayer.relay(tx);
        if (result.status !== 'SUCCESS') return res.status(502).json({ error: 'Transaction failed', result });
        res.json({ tx_hash: result.hash, status: result.status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


module.exports = app;
