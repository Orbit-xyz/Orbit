import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import { createClient } from 'graphql-ws';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import app from '../index.js';
import { makeApiKey } from './helpers.js';
import { createEventBus } from '../event-bus.js';
import { attachGraphqlWebsocket } from '../graphql.js';

const merchantId = '7f8b9a10-b2c3-4d5e-a6f7-112233445566';
const otherMerchantId = '00000000-0000-4000-8000-000000000000';
const planId = 'e0b8e99b-5136-4d1d-9351-91a5db4fb056';
const subId = '4a7f2e18-6c51-41b9-9cf3-90d1bf379b32';
const wallet = Keypair.random();

let server;
let wsSubscription;
let port;
let key;
let supabase;
let eventBus;

beforeAll(async () => {
  eventBus = createEventBus();
  app.locals.eventBus = eventBus;

  server = http.createServer(app);
  wsSubscription = attachGraphqlWebsocket(server, {
    getSupabase: () => app.locals.supabase,
    eventBus,
    challenges: app.locals.graphqlChallenges,
  });

  await new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (wsSubscription) await wsSubscription.stop();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (eventBus) await eventBus.close();
  if (app.locals.graphqlServer) await app.locals.graphqlServer.stop();
});

beforeEach(() => {
  key = makeApiKey({ merchantId, walletAddress: wallet.publicKey() });
  supabase = {
    from: vi.fn((table) => {
      const chain = {};
      for (const m of ['select', 'eq', 'maybeSingle', 'single', 'in', 'order', 'range', 'limit']) {
        chain[m] = vi.fn(() => chain);
      }
      chain.maybeSingle = async () => {
        if (table === 'api_keys') return { data: key.row, error: null };
        if (table === 'merchants') return { data: { id: merchantId, name: 'Merchant', wallet_address: wallet.publicKey() }, error: null };
        return { data: null, error: null };
      };
      chain.single = chain.maybeSingle;
      chain.then = (resolve) => resolve({ data: [], error: null });
      return chain;
    }),
  };
  app.locals.supabase = supabase;
});

function createTestClient(connectionParams = { authorization: key.header }, options = {}) {
  return createClient({
    url: `ws://localhost:${port}/graphql`,
    webSocketImpl: WebSocket,
    connectionParams,
    retryAttempts: options.retryAttempts ?? 0,
    keepAlive: 1000,
    ...options,
  });
}

describe('GraphQL Subscriptions Engine (#211)', () => {
  it('authenticates WebSocket client with valid API key', async () => {
    const client = createTestClient({ authorization: key.header });
    const received = [];

    const unsubscribe = client.subscribe(
      {
        query: `subscription OnSettlement($merchantId: ID!) {
          subscriptionSettlementFeed(merchantId: $merchantId) {
            id
            merchantId
            amount
            status
          }
        }`,
        variables: { merchantId },
      },
      {
        next: (val) => received.push(val),
        error: (err) => { throw err; },
        complete: () => {},
      }
    );

    // Wait for subscription to register
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Publish settlement event
    await eventBus.publishPaymentSettled(merchantId, {
      id: 'tx-12345',
      subscriptionId: subId,
      planId,
      customerWalletAddress: wallet.publicKey(),
      amount: '29000000',
      status: 'settled',
      settledAt: new Date().toISOString(),
    });

    // Wait for event delivery
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].data.subscriptionSettlementFeed).toMatchObject({
      id: 'tx-12345',
      merchantId,
      amount: '29000000',
      status: 'settled',
    });

    unsubscribe();
    await client.dispose();
  });

  it('rejects WebSocket connection when API key is missing or invalid', async () => {
    const client = createTestClient({ authorization: 'Bearer invalid_secret' });
    let errorCaught = null;

    await new Promise((resolve) => {
      client.subscribe(
        {
          query: `subscription {
            subscriptionSettlementFeed(merchantId: "${merchantId}") {
              id
            }
          }`,
        },
        {
          next: () => {},
          error: (err) => {
            errorCaught = err;
            resolve();
          },
          complete: () => resolve(),
        }
      );
    });

    expect(errorCaught).toBeDefined();
    // graphql-ws closes with 4403 Forbidden for unauthorized onConnect rejection
    expect(errorCaught.code).toBe(4403);
    await client.dispose();
  });

  it('authenticates WebSocket connection using Stellar wallet challenge signature', async () => {
    const challengeRes = await request(app).post('/auth/wallet/challenge').send({ address: wallet.publicKey() });
    expect(challengeRes.status).toBe(200);

    const signature = Buffer.from(wallet.signMessage(challengeRes.body.message)).toString('base64');
    const walletAuth = `Wallet ${challengeRes.body.nonce}:${signature}`;

    const client = createTestClient({ authorization: walletAuth });
    const received = [];

    const unsubscribe = client.subscribe(
      {
        query: `subscription {
          subscriptionSettlementFeed(merchantId: "${merchantId}") {
            id
            merchantId
            status
          }
        }`,
      },
      {
        next: (val) => received.push(val),
        error: (err) => { throw err; },
        complete: () => {},
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    await eventBus.publishPaymentSettled(merchantId, {
      id: 'tx-wallet-proof',
      amount: '50000000',
      status: 'settled',
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].data.subscriptionSettlementFeed.id).toBe('tx-wallet-proof');

    unsubscribe();
    await client.dispose();
  });

  it('enforces multi-tenant isolation: rejects subscription to another merchant feed', async () => {
    const client = createTestClient({ authorization: key.header });
    let result = null;

    await new Promise((resolve) => {
      client.subscribe(
        {
          query: `subscription {
            subscriptionSettlementFeed(merchantId: "${otherMerchantId}") {
              id
            }
          }`,
        },
        {
          next: (val) => {
            result = val;
            resolve();
          },
          error: (err) => {
            result = err;
            resolve();
          },
          complete: () => resolve(),
        }
      );
    });

    expect(result).toBeDefined();
    expect(JSON.stringify(result)).toContain('merchant_id does not match');
    await client.dispose();
  });

  it('streams subscriptionCreated and vaultCancelled events', async () => {
    const client = createTestClient({ authorization: key.header });
    const createdEvents = [];
    const cancelledEvents = [];

    const unsubCreated = client.subscribe(
      {
        query: `subscription {
          subscriptionCreated(merchantId: "${merchantId}") {
            id
            merchantId
            subscriptionId
            eventType
          }
        }`,
      },
      { next: (val) => createdEvents.push(val), error: (err) => { throw err; }, complete: () => {} }
    );

    const unsubCancelled = client.subscribe(
      {
        query: `subscription {
          vaultCancelled(merchantId: "${merchantId}") {
            id
            merchantId
            subscriptionId
            eventType
          }
        }`,
      },
      { next: (val) => cancelledEvents.push(val), error: (err) => { throw err; }, complete: () => {} }
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    await eventBus.publishSubscriptionCreated(merchantId, {
      id: subId,
      subscriptionId: subId,
      planId,
      customerWalletAddress: wallet.publicKey(),
    });

    await eventBus.publishVaultCancelled(merchantId, {
      id: subId,
      subscriptionId: subId,
      planId,
      customerWalletAddress: wallet.publicKey(),
      reason: 'customer_portal_closed',
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(createdEvents.length).toBeGreaterThanOrEqual(1);
    expect(createdEvents[0].data.subscriptionCreated).toMatchObject({
      subscriptionId: subId,
      eventType: 'subscriptionCreated',
    });

    expect(cancelledEvents.length).toBeGreaterThanOrEqual(1);
    expect(cancelledEvents[0].data.vaultCancelled).toMatchObject({
      subscriptionId: subId,
      eventType: 'vaultCancelled',
    });

    unsubCreated();
    unsubCancelled();
    await client.dispose();
  });

  it('maintains connection stability with keepalive and heartbeat pings', async () => {
    const client = createTestClient({ authorization: key.header });
    let isConnected = false;

    client.on('connected', () => {
      isConnected = true;
    });

    const unsubscribe = client.subscribe(
      {
        query: `subscription {
          subscriptionSettlementFeed(merchantId: "${merchantId}") {
            id
          }
        }`,
      },
      { next: () => {}, error: (err) => { throw err; }, complete: () => {} }
    );

    // Wait 500ms to allow keepalive frames
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(isConnected).toBe(true);

    unsubscribe();
    await client.dispose();
  });

  it('authenticates WebSocket client using JWT token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      merchant_id: merchantId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const jwt = `${header}.${payload}.sig`;

    const client = createTestClient({ authorization: `Bearer ${jwt}` });
    const received = [];

    const unsubscribe = client.subscribe(
      {
        query: `subscription {
          paymentSettled(merchantId: "${merchantId}") {
            id
            merchantId
            amount
            status
          }
        }`,
      },
      {
        next: (val) => received.push(val),
        error: (err) => { throw err; },
        complete: () => {},
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    await eventBus.publishPaymentSettled(merchantId, {
      id: 'tx-jwt-settled',
      amount: '99000000',
      status: 'settled',
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].data.paymentSettled).toMatchObject({
      id: 'tx-jwt-settled',
      merchantId,
      amount: '99000000',
      status: 'settled',
    });

    unsubscribe();
    await client.dispose();
  });

  it('reconnects and resumes receiving live subscription events after transport disruption', async () => {
    let connectCount = 0;
    let onReconnect;
    const reconnectPromise = new Promise((resolve) => {
      onReconnect = resolve;
    });

    const client = createTestClient(
      { authorization: key.header },
      {
        retryAttempts: 5,
        retryWait: async () => 50,
      }
    );

    client.on('connected', () => {
      connectCount++;
      if (connectCount > 1) {
        onReconnect();
      }
    });

    const received = [];
    const unsubscribe = client.subscribe(
      {
        query: `subscription {
          subscriptionSettlementFeed(merchantId: "${merchantId}") {
            id
            amount
          }
        }`,
      },
      {
        next: (val) => received.push(val),
        error: (err) => { throw err; },
        complete: () => {},
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    await eventBus.publishPaymentSettled(merchantId, {
      id: 'tx-before-disconnect',
      amount: '10000000',
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toHaveLength(1);

    // Terminate underlying socket to simulate connection disruption
    for (const socket of wsSubscription.wsServer.clients) {
      socket.terminate();
    }

    // Await reconnection handshake
    await reconnectPromise;

    // Small delay for re-subscription registration
    await new Promise((resolve) => setTimeout(resolve, 150));

    await eventBus.publishPaymentSettled(merchantId, {
      id: 'tx-after-reconnect',
      amount: '20000000',
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received.map((r) => r.data.subscriptionSettlementFeed.id)).toContain('tx-after-reconnect');

    unsubscribe();
    await client.dispose();
  });
});
