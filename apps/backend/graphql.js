const crypto = require('crypto');
const http = require('http');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@as-integrations/express5');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const { parse, execute, subscribe, GraphQLError } = require('graphql');
const DataLoader = require('dataloader');
const { Keypair, StrKey } = require('@stellar/stellar-sdk');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/use/ws');
const { parseApiKey, hashApiKey } = require('./apiKeys');
const { createEventBus } = require('./event-bus');

const globalDefaultEventBus = createEventBus();

const typeDefs = parse(`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
  schema {
    query: Query
    subscription: SubscriptionStream
  }
  type Merchant @key(fields: "id") {
    id: ID!
    name: String!
    walletAddress: String!
    plans(pagination: Pagination): [Plan!]!
    subscriptions(filter: SubscriberFilter, pagination: Pagination): SubscriptionPage!
    payrollSplits(pagination: Pagination): [PayrollSplit!]!
  }
  type Plan @key(fields: "id") {
    id: ID!
    name: String!
    amount: String!
    currency: String!
    intervalSeconds: String!
    merchant: Merchant
  }
  type Subscription @key(fields: "id") {
    id: ID!
    customerWalletAddress: String!
    status: String!
    nextBillingDate: String!
    plan: Plan
    payments(pagination: Pagination): [Payment!]!
  }
  type Payment {
    id: ID!
    amount: String
    transactionHash: String
    createdAt: String!
  }
  type PaymentSettlement {
    id: ID!
    merchantId: ID!
    subscriptionId: ID
    planId: ID
    customerWalletAddress: String
    amount: String
    currency: String
    txHash: String
    status: String!
    settledAt: String!
    eventType: String
  }
  type SubscriptionEvent {
    id: ID!
    merchantId: ID!
    subscriptionId: ID
    planId: ID
    customerWalletAddress: String
    eventType: String!
    timestamp: String!
    metadata: String
  }
  type PayrollSplit {
    id: ID!
    recipientWallet: String!
    amount: String!
    currency: String!
    createdAt: String!
  }
  input SubscriberFilter { status: String, planId: ID, walletAddress: String }
  input Pagination { limit: Int = 50, offset: Int = 0 }
  input Timeframe { from: String!, to: String! }
  type SubscriptionPage { nodes: [Subscription!]!, total: Int!, limit: Int!, offset: Int! }
  type Analytics { activeSubscribers: Int!, settledPayments: Int!, settledAmount: String!, from: String!, to: String! }
  type Query {
    merchant(id: ID!): Merchant
    subscribers(filter: SubscriberFilter, pagination: Pagination): SubscriptionPage!
    analytics(timeframe: Timeframe!): Analytics!
  }
  type SubscriptionStream {
    subscriptionSettlementFeed(merchantId: ID!): PaymentSettlement!
    paymentSettled(merchantId: ID!): PaymentSettlement!
    subscriptionCreated(merchantId: ID!): SubscriptionEvent!
    vaultCancelled(merchantId: ID!): SubscriptionEvent!
  }
`);

const badInput = (message) => { throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } }); };
const unauthorized = (message = 'Unauthorized') => { throw new GraphQLError(message, { extensions: { code: 'UNAUTHENTICATED' } }); };
const forbidden = (message = 'Forbidden') => { throw new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } }); };

const uuid = (value) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) badInput('Invalid identifier');
    return value;
};

function pagination(input) {
    const limit = input?.limit ?? 50, offset = input?.offset ?? 0;
    if (limit < 1 || limit > 100 || offset < 0 || offset > 100000) badInput('Pagination requires limit 1–100 and offset 0–100000');
    return { limit, offset };
}

async function rows(query) {
    const result = await query;
    if (result.error) throw new GraphQLError('Analytics database query failed', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
    return result;
}

// Every loader is scoped to one authenticated merchant AND one request.
function createLoaders(supabase, merchant) {
    if (!supabase || !merchant) return null;
    const byId = (table, scope, columns = '*') => new DataLoader(async (ids) => {
        const { data } = await rows(scope(supabase.from(table).select(columns).in('id', ids)));
        const found = new Map((data || []).map((row) => [row.id, row]));
        return ids.map((id) => found.get(id) || null);
    });
    return {
        merchant: byId('merchants', (q) => q.eq('id', merchant.id)),
        plan: byId('plans', (q) => q.eq('merchant_id', merchant.id), 'id,merchant_id,name,currency,usdc_amount::text,price_amount::text,interval_seconds::text'),
        subscription: new DataLoader(async (ids) => {
            const { data } = await rows(supabase.from('subscriptions').select('*, plans!inner(merchant_id)')
                .in('id', ids).eq('plans.merchant_id', merchant.id));
            const found = new Map((data || []).map((row) => [row.id, row]));
            return ids.map((id) => found.get(id) || null);
        }),
        merchantPlans: new DataLoader((pages) => Promise.all(pages.map(async ({ limit, offset }) =>
            (await rows(supabase.from('plans').select('id,merchant_id,name,currency,usdc_amount::text,price_amount::text,interval_seconds::text')
                .eq('merchant_id', merchant.id).order('id').range(offset, offset + limit - 1))).data || [])), { cacheKeyFn: JSON.stringify }),
        payroll: new DataLoader((pages) => Promise.all(pages.map(async ({ limit, offset }) =>
            (await rows(supabase.from('tax_transactions').select('id,recipient_wallet,amount::text,currency,created_at')
                .eq('merchant_id', merchant.id).order('created_at', { ascending: false }).order('id')
                .range(offset, offset + limit - 1))).data || [])), { cacheKeyFn: JSON.stringify }),
        subscriberPages: new DataLoader((pages) => Promise.all(pages.map((args) => querySubscribers(null, args, { supabase, merchant }))), { cacheKeyFn: JSON.stringify }),
        // Batch all nested payment lists into a single RPC with per-parent limits.
        // A SQL window handles limits without truncating another subscriber's history.
        payments: new DataLoader(async (keys) => {
            const { data } = await rows(supabase.rpc('graphql_subscription_payments', {
                p_merchant_id: merchant.id, p_requests: keys,
            }));
            return keys.map((key, index) => (data || []).filter((row) => row.request_index === index).map((row) => row.payment));
        }, { cacheKeyFn: JSON.stringify }),
    };
}

async function querySubscribers(_, { filter, pagination: input }, ctx) {
    const { limit, offset } = pagination(input);
    let query = ctx.supabase.from('subscriptions').select('*, plans!inner(merchant_id)', { count: 'exact' })
        .eq('plans.merchant_id', ctx.merchant.id);
    if (filter?.status) {
        if (!['active', 'past_due', 'cancelled', 'pending_pull'].includes(filter.status)) badInput('Invalid subscription status');
        query = query.eq('status', filter.status);
    }
    if (filter?.planId) query = query.eq('plan_id', uuid(filter.planId));
    if (filter?.walletAddress) {
        if (!StrKey.isValidEd25519PublicKey(filter.walletAddress)) badInput('Invalid wallet address');
        query = query.eq('customer_wallet_address', filter.walletAddress);
    }
    const { data, count } = await rows(query.order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1));
    return { nodes: data || [], total: count || 0, limit, offset };
}

const subscribers = (_, { filter, pagination: input }, ctx) => ctx.loaders.subscriberPages.load({
    filter: { status: filter?.status, planId: filter?.planId, walletAddress: filter?.walletAddress }, pagination: pagination(input),
});

function formatPaymentSettlement(event) {
    return {
        id: event.id || event.paymentId || event.txHash || crypto.randomUUID(),
        merchantId: event.merchantId,
        subscriptionId: event.subscriptionId || event.subscription_id || null,
        planId: event.planId || event.plan_id || null,
        customerWalletAddress: event.customerWalletAddress || event.customer_wallet_address || null,
        amount: event.amount != null ? String(event.amount) : (event.amount_usdc_units != null ? String(event.amount_usdc_units) : null),
        currency: event.currency || 'USDC',
        txHash: event.txHash || event.tx_hash || null,
        status: event.status || 'settled',
        settledAt: event.settledAt || event.settled_at || event.timestamp || new Date().toISOString(),
        eventType: event.eventType || 'paymentSettled',
    };
}

function formatSubscriptionEvent(event) {
    return {
        id: event.id || event.subscriptionId || crypto.randomUUID(),
        merchantId: event.merchantId,
        subscriptionId: event.subscriptionId || event.subscription_id || null,
        planId: event.planId || event.plan_id || null,
        customerWalletAddress: event.customerWalletAddress || event.customer_wallet_address || null,
        eventType: event.eventType || 'subscriptionCreated',
        timestamp: event.timestamp || event.settledAt || new Date().toISOString(),
        metadata: typeof event.metadata === 'object' ? JSON.stringify(event.metadata) : (event.metadata ? String(event.metadata) : null),
    };
}

const resolvers = {
    Query: {
        merchant: (_, { id }, ctx) => ctx.loaders.merchant.load(uuid(id)),
        subscribers,
        analytics: async (_, { timeframe }, ctx) => {
            const from = new Date(timeframe.from), to = new Date(timeframe.to);
            if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 366 * 86400000) {
                badInput('Timeframe must be an increasing date range of at most 366 days');
            }
            const { data } = await rows(ctx.supabase.rpc('merchant_analytics', {
                p_merchant_id: ctx.merchant.id, p_from: from.toISOString(), p_to: to.toISOString(),
            }));
            return { ...data, from: from.toISOString(), to: to.toISOString() };
        },
    },
    Merchant: {
        __resolveReference: ({ id }, ctx) => ctx.loaders.merchant.load(uuid(id)),
        walletAddress: (row) => row.wallet_address,
        plans: (_, { pagination: input }, ctx) => ctx.loaders.merchantPlans.load(pagination(input)),
        subscriptions: subscribers,
        payrollSplits: (_, { pagination: input }, ctx) => ctx.loaders.payroll.load(pagination(input)),
    },
    Plan: {
        __resolveReference: ({ id }, ctx) => ctx.loaders.plan.load(uuid(id)),
        amount: (row) => String(row.price_amount ?? row.usdc_amount),
        currency: (row) => row.currency || 'USDC',
        intervalSeconds: (row) => String(row.interval_seconds),
        merchant: (row, args, ctx) => ctx.loaders.merchant.load(row.merchant_id),
    },
    Subscription: {
        __resolveReference: ({ id }, ctx) => ctx.loaders.subscription.load(uuid(id)),
        customerWalletAddress: (row) => row.customer_wallet_address,
        nextBillingDate: (row) => row.next_billing_date,
        plan: (row, args, ctx) => ctx.loaders.plan.load(row.plan_id),
        payments: (row, { pagination: input }, ctx) => ctx.loaders.payments.load({ id: row.id, ...pagination(input) }),
    },
    SubscriptionStream: {
        subscriptionSettlementFeed: {
            subscribe: (root, { merchantId }, ctx) => {
                const targetId = uuid(merchantId);
                if (!ctx.merchant) unauthorized();
                if (ctx.merchant.id !== targetId) forbidden('merchant_id does not match the authenticated identity');
                const bus = ctx.eventBus || globalDefaultEventBus;
                return bus.createAsyncIterator([`orbit:merchant:${targetId}`], {
                    filter: (event) => event.merchantId === targetId && (event.eventType === 'paymentSettled' || !event.eventType),
                });
            },
            resolve: (event) => formatPaymentSettlement(event),
        },
        paymentSettled: {
            subscribe: (root, { merchantId }, ctx) => {
                const targetId = uuid(merchantId);
                if (!ctx.merchant) unauthorized();
                if (ctx.merchant.id !== targetId) forbidden('merchant_id does not match the authenticated identity');
                const bus = ctx.eventBus || globalDefaultEventBus;
                return bus.createAsyncIterator([`orbit:merchant:${targetId}`], {
                    filter: (event) => event.merchantId === targetId && event.eventType === 'paymentSettled',
                });
            },
            resolve: (event) => formatPaymentSettlement(event),
        },
        subscriptionCreated: {
            subscribe: (root, { merchantId }, ctx) => {
                const targetId = uuid(merchantId);
                if (!ctx.merchant) unauthorized();
                if (ctx.merchant.id !== targetId) forbidden('merchant_id does not match the authenticated identity');
                const bus = ctx.eventBus || globalDefaultEventBus;
                return bus.createAsyncIterator([`orbit:merchant:${targetId}`], {
                    filter: (event) => event.merchantId === targetId && event.eventType === 'subscriptionCreated',
                });
            },
            resolve: (event) => formatSubscriptionEvent(event),
        },
        vaultCancelled: {
            subscribe: (root, { merchantId }, ctx) => {
                const targetId = uuid(merchantId);
                if (!ctx.merchant) unauthorized();
                if (ctx.merchant.id !== targetId) forbidden('merchant_id does not match the authenticated identity');
                const bus = ctx.eventBus || globalDefaultEventBus;
                return bus.createAsyncIterator([`orbit:merchant:${targetId}`], {
                    filter: (event) => event.merchantId === targetId && event.eventType === 'vaultCancelled',
                });
            },
            resolve: (event) => formatSubscriptionEvent(event),
        },
    },
    Payment: {
        amount: (row) => row.changes_after?.amount == null ? null : String(row.changes_after.amount),
        transactionHash: (row) => row.changes_after?.txHash,
        createdAt: (row) => row.created_at,
    },
    PayrollSplit: { recipientWallet: (row) => row.recipient_wallet, amount: (row) => String(row.amount), createdAt: (row) => row.created_at },
};

async function authenticateWsConnection(ctx, getSupabase, challenges) {
    const params = ctx.connectionParams || {};
    const authHeader = params.authorization ||
                       params.Authorization ||
                       params.authToken ||
                       params.token ||
                       params.apiKey ||
                       params.headers?.authorization ||
                       params.headers?.Authorization ||
                       (ctx.extra?.request?.headers?.authorization);

    let rawToken = authHeader;
    if (!rawToken && ctx.extra?.request?.url) {
        try {
            const parsedUrl = new URL(ctx.extra.request.url, 'http://localhost');
            rawToken = parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('apiKey') || parsedUrl.searchParams.get('auth');
        } catch {}
    }

    if (!rawToken || typeof rawToken !== 'string') {
        return null;
    }

    const trimmed = rawToken.trim();

    // 1. Stellar Wallet Challenge Authentication: "Wallet <nonce>:<signature>"
    if (trimmed.startsWith('Wallet ') && challenges) {
        const [nonce, encoded] = trimmed.slice(7).split(':');
        const challenge = challenges.get(nonce);
        challenges.delete(nonce); // One-use proof; prevents replay attacks
        if (!challenge || challenge.expires < Date.now() || !encoded) {
            return null;
        }
        try {
            const valid = Keypair.fromPublicKey(challenge.address)
                .verifyMessage(challenge.message, Buffer.from(encoded, 'base64'));
            if (!valid) return null;

            const supabase = typeof getSupabase === 'function' ? getSupabase() : null;
            if (!supabase) return null;

            const { data, error } = await supabase.from('merchants')
                .select('id,name,wallet_address')
                .eq('wallet_address', challenge.address)
                .maybeSingle();
            if (error || !data) return null;
            return { merchant: data, apiKey: null };
        } catch {
            return null;
        }
    }

    // 2. API Key Authentication: "Bearer orb_..." or "orb_..."
    const secret = trimmed.startsWith('Bearer ') ? trimmed.slice(7).trim() : trimmed;
    const parsedKey = parseApiKey(secret);
    if (parsedKey) {
        const supabase = typeof getSupabase === 'function' ? getSupabase() : null;
        if (!supabase) return null;

        try {
            const { data: keyRow, error } = await supabase
                .from('api_keys')
                .select('id, merchant_id, name, key_prefix, environment, organization_member_wallet, last_used_at, revoked_at, merchants(id, name, wallet_address)')
                .eq('key_hash', hashApiKey(secret))
                .maybeSingle();

            if (error || !keyRow) return null;

            const isActive = !keyRow.revoked_at
                && keyRow.key_prefix === parsedKey.prefix
                && keyRow.environment === parsedKey.environment
                && keyRow.merchants;

            if (!isActive) return null;

            return {
                merchant: keyRow.merchants,
                apiKey: {
                    id: keyRow.id,
                    name: keyRow.name,
                    prefix: keyRow.key_prefix,
                    environment: keyRow.environment,
                    member_wallet: keyRow.organization_member_wallet || keyRow.merchants.wallet_address,
                },
            };
        } catch {
            return null;
        }
    }

    // 3. JWT Token Authentication: 3-part base64 dot-separated string
    const jwtParts = secret.split('.');
    if (jwtParts.length === 3) {
        try {
            if (process.env.JWT_SECRET) {
                const expectedSig = crypto
                    .createHmac('sha256', process.env.JWT_SECRET)
                    .update(`${jwtParts[0]}.${jwtParts[1]}`)
                    .digest('base64url');
                if (expectedSig !== jwtParts[2]) {
                    return null;
                }
            }
            const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8'));
            if (payload.exp && payload.exp * 1000 < Date.now()) {
                return null;
            }
            const merchantId = payload.merchant_id || payload.sub || payload.merchantId;
            if (!merchantId) return null;

            const supabase = typeof getSupabase === 'function' ? getSupabase() : null;
            if (!supabase) return null;

            const { data: merchant, error } = await supabase
                .from('merchants')
                .select('id, name, wallet_address')
                .eq('id', merchantId)
                .maybeSingle();
            if (error || !merchant) return null;
            return { merchant, apiKey: null };
        } catch {
            return null;
        }
    }

    return null;
}

function attachGraphqlWebsocket(httpServer, { getSupabase, eventBus, challenges, schema: customSchema } = {}) {
    const wsServer = new WebSocketServer({
        server: httpServer,
        path: '/graphql',
    });

    // Transport-level heartbeat pings to detect zombie/stale connections
    const pingInterval = setInterval(() => {
        for (const client of wsServer.clients) {
            if (client.isAlive === false) {
                client.terminate();
                continue;
            }
            client.isAlive = false;
            client.ping();
        }
    }, 30000);
    pingInterval.unref?.();

    wsServer.on('connection', (socket) => {
        socket.isAlive = true;
        socket.on('pong', () => {
            socket.isAlive = true;
        });
    });

    const activeSchema = customSchema || buildSubgraphSchema([{ typeDefs, resolvers }]);

    const serverCleanup = useServer({
        schema: activeSchema,
        execute,
        subscribe,
        keepAlive: 12000, // Sends protocol keepalive / ping every 12 seconds
        onConnect: async (ctx) => {
            const auth = await authenticateWsConnection(ctx, getSupabase, challenges);
            if (!auth) {
                return false; // Closes connection with 4403 Forbidden
            }
            ctx.extra.merchant = auth.merchant;
            ctx.extra.apiKey = auth.apiKey || null;
            return true;
        },
        context: async (ctx) => {
            const merchant = ctx.extra.merchant;
            const supabase = typeof getSupabase === 'function' ? getSupabase() : null;
            return {
                merchant,
                walletAddress: merchant?.wallet_address,
                apiKey: ctx.extra.apiKey || null,
                supabase,
                loaders: (merchant && supabase) ? createLoaders(supabase, merchant) : null,
                eventBus: eventBus || globalDefaultEventBus,
            };
        },
    }, wsServer);

    const closeHandler = async () => {
        clearInterval(pingInterval);
        await serverCleanup.dispose();
        wsServer.close();
    };

    return {
        wsServer,
        serverCleanup,
        dispose: closeHandler,
        stop: closeHandler,
    };
}

function registerGraphql(app, getSupabase, authenticateMerchant, options = {}) {
    const challenges = new Map();
    if (app && app.locals) {
        app.locals.graphqlChallenges = challenges;
    }

    app.post('/auth/wallet/challenge', (req, res) => {
        const address = req.body?.address;
        if (!StrKey.isValidEd25519PublicKey(address || '')) return res.status(400).json({ error: 'Invalid wallet address' });
        for (const [nonce, challenge] of challenges) if (challenge.expires <= Date.now()) challenges.delete(nonce);
        if (challenges.size >= 10000) return res.status(429).json({ error: 'Too many pending wallet challenges' });
        const nonce = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 300000;
        const message = `Orbit merchant analytics\nWallet: ${address}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}`;
        challenges.set(nonce, { address, expires, message });
        res.json({ nonce, message, expires_at: new Date(expires).toISOString() });
    });

    const authenticate = async (req, res, next) => {
        if (!req.get('Authorization')?.startsWith('Wallet ')) return authenticateMerchant[0](req, res, () => authenticateMerchant[1](req, res, next));
        const [nonce, encoded] = req.get('Authorization').slice(7).split(':');
        const challenge = challenges.get(nonce);
        challenges.delete(nonce); // one-use proof; no replay window
        try {
            if (!challenge || challenge.expires < Date.now() || !encoded ||
                !Keypair.fromPublicKey(challenge.address).verifyMessage(challenge.message, Buffer.from(encoded, 'base64'))) {
                return res.status(401).json({ error: 'Invalid or expired wallet proof' });
            }
            const supabase = getSupabase();
            if (!supabase) return res.status(503).json({ error: 'Supabase client not initialized' });
            const { data, error } = await supabase.from('merchants').select('id,name,wallet_address')
                .eq('wallet_address', challenge.address).maybeSingle();
            if (error) throw error;
            if (!data) return res.status(401).json({ error: 'Wallet is not a registered merchant' });
            req.merchant = data;
            next();
        } catch { res.status(401).json({ error: 'Wallet authentication failed' }); }
    };

    const schema = buildSubgraphSchema([{ typeDefs, resolvers }]);
    const server = new ApolloServer({
        schema,
        includeStacktraceInErrorResponses: false,
        plugins: [{
            async requestDidStart() {
                return {
                    async didResolveOperation({ document }) {
                        let fields = 0;
                        const fragments = new Map(document.definitions.filter((d) => d.kind === 'FragmentDefinition').map((d) => [d.name.value, d]));
                        function walk(set, depth = 0, seen = new Set()) {
                            if (!set) return;
                            if (depth > 10) badInput('Query nesting limit exceeded');
                            for (const selection of set.selections) {
                                if (++fields > 500) badInput('Query field limit exceeded');
                                if (selection.kind === 'FragmentSpread') {
                                    if (seen.has(selection.name.value)) continue;
                                    walk(fragments.get(selection.name.value)?.selectionSet, depth, new Set([...seen, selection.name.value]));
                                } else walk(selection.selectionSet, depth + 1, seen);
                            }
                        }
                        for (const operation of document.definitions.filter((d) => d.kind === 'OperationDefinition')) walk(operation.selectionSet);
                    }
                };
            }
        }],
    });

    const eventBus = options.eventBus || (app?.locals?.eventBus) || globalDefaultEventBus;

    let middleware;
    const ready = server.start().then(() => {
        middleware = expressMiddleware(server, {
            context: async ({ req }) => ({
                merchant: req.merchant,
                walletAddress: req.merchant?.wallet_address,
                apiKey: req.apiKey || null,
                supabase: getSupabase(),
                loaders: createLoaders(getSupabase(), req.merchant),
                eventBus: app?.locals?.eventBus || eventBus,
            }),
        });
    });

    app.use('/graphql', authenticate, async (req, res, next) => {
        try {
            await ready;
            return middleware(req, res, next);
        } catch (error) {
            next(error);
        }
    });

    server.schema = schema;
    server.attachWebsocketServer = (httpServer, wsOptions = {}) => attachGraphqlWebsocket(httpServer, {
        getSupabase,
        eventBus: app?.locals?.eventBus || eventBus,
        challenges,
        schema,
        ...wsOptions,
    });

    if (app && app.locals) {
        app.locals.attachGraphqlWebsocket = server.attachWebsocketServer;
    }

    return server;
}

module.exports = {
    registerGraphql,
    createLoaders,
    attachGraphqlWebsocket,
    typeDefs,
    resolvers,
    formatPaymentSettlement,
    formatSubscriptionEvent,
    authenticateWsConnection,
    globalDefaultEventBus,
};
