import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import app from '../index.js';
import { makeApiKey } from './helpers.js';
import {
  INVALID_REQUEST_SIGNATURE,
  captureSignedRawBody,
  computeRequestSignature,
  requireRequestSignature,
} from '../request-signature.js';

const SECRET = 'orb_test_' + 'a'.repeat(64);
const NOW = 1_800_000_000;

const sign = ({ timestamp = NOW, method, path, body = '', secret = SECRET }) =>
  computeRequestSignature({ secret, timestamp, method, path, body });

// Minimal app with the middleware in front of POST, GET and DELETE handlers
const buildApp = ({ isRequired = () => false } = {}) => {
  const handled = vi.fn();
  const test = express();
  test.use(express.json({ verify: captureSignedRawBody }));
  const verify = requireRequestSignature({ nowSeconds: () => NOW, isRequired });
  const ok = (req, res) => { handled(req.body); res.json({ ok: true, verified: Boolean(req.requestSignatureVerified) }); };
  test.post('/api/plans', verify, ok);
  test.get('/api/plans/:id', verify, ok);
  test.delete('/api/plans/:id', verify, ok);
  return { test, handled };
};

describe('request signature middleware (#364)', () => {
  it('passes a correctly signed POST through to the handler', async () => {
    const { test, handled } = buildApp();
    const body = JSON.stringify({ name: 'Pro', amount: 10 });
    const res = await request(test)
      .post('/api/plans')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', sign({ method: 'POST', path: '/api/plans', body }))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(handled).toHaveBeenCalledWith({ name: 'Pro', amount: 10 });
  });

  it('accepts a sha256= prefixed signature', async () => {
    const { test } = buildApp();
    const body = '{"a":1}';
    const res = await request(test)
      .post('/api/plans')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', `sha256=${sign({ method: 'POST', path: '/api/plans', body })}`)
      .send(body);
    expect(res.status).toBe(200);
  });

  it('rejects a modified payload before the handler runs', async () => {
    const { test, handled } = buildApp();
    const signature = sign({ method: 'POST', path: '/api/plans', body: '{"amount":10}' });
    const res = await request(test)
      .post('/api/plans')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', signature)
      .send('{"amount":1000}');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(INVALID_REQUEST_SIGNATURE);
    expect(handled).not.toHaveBeenCalled();
  });

  it('treats whitespace changes to the body as tampering', async () => {
    const { test } = buildApp();
    const res = await request(test)
      .post('/api/plans')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', sign({ method: 'POST', path: '/api/plans', body: '{"a":1}' }))
      .send('{ "a": 1 }');
    expect(res.status).toBe(401);
  });

  it('rejects a signature made with a different secret', async () => {
    const { test } = buildApp();
    const body = '{"a":1}';
    const res = await request(test)
      .post('/api/plans')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', sign({ method: 'POST', path: '/api/plans', body, secret: 'other' }))
      .send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a signature replayed against another path or method', async () => {
    const { test } = buildApp();
    const signature = sign({ method: 'GET', path: '/api/plans/1' });
    const res = await request(test)
      .delete('/api/plans/1')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', signature);
    expect(res.status).toBe(401);
  });

  it.each([
    ['older than 5 minutes', NOW - 301],
    ['more than 5 minutes in the future', NOW + 301],
  ])('rejects a timestamp %s', async (_label, timestamp) => {
    const { test, handled } = buildApp();
    const body = '{"a":1}';
    const res = await request(test)
      .post('/api/plans')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(timestamp))
      .set('X-Orbit-Request-Signature', sign({ timestamp, method: 'POST', path: '/api/plans', body }))
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/tolerance window/);
    expect(handled).not.toHaveBeenCalled();
  });

  it('accepts a timestamp exactly at the edge of the window', async () => {
    const { test } = buildApp();
    const timestamp = NOW - 300;
    const res = await request(test)
      .get('/api/plans/1')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('X-Orbit-Timestamp', String(timestamp))
      .set('X-Orbit-Request-Signature', sign({ timestamp, method: 'GET', path: '/api/plans/1' }));
    expect(res.status).toBe(200);
  });

  it.each(['GET', 'DELETE'])('verifies %s requests over an empty body', async (method) => {
    const { test } = buildApp();
    const res = await request(test)
      [method.toLowerCase()]('/api/plans/42?expand=true')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', sign({ method, path: '/api/plans/42' }));
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('rejects a non-numeric timestamp, a malformed signature, and a lone header', async () => {
    const { test } = buildApp();
    const base = () => request(test).get('/api/plans/1').set('Authorization', `Bearer ${SECRET}`);

    const badTs = await base().set('X-Orbit-Timestamp', 'yesterday').set('X-Orbit-Request-Signature', 'a'.repeat(64));
    expect(badTs.status).toBe(401);

    const badSig = await base().set('X-Orbit-Timestamp', String(NOW)).set('X-Orbit-Request-Signature', 'not-hex');
    expect(badSig.status).toBe(401);
    expect(badSig.body.error).toMatch(/Malformed/);

    const lone = await base().set('X-Orbit-Timestamp', String(NOW));
    expect(lone.status).toBe(401);
    expect(lone.body.error).toMatch(/sent together/);
  });

  it('rejects a signed request without an API secret', async () => {
    const { test } = buildApp();
    const res = await request(test)
      .get('/api/plans/1')
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', sign({ method: 'GET', path: '/api/plans/1' }));
    expect(res.status).toBe(401);
  });

  it('rejects a signed body that is not JSON rather than skipping it', async () => {
    const { test } = buildApp();
    const res = await request(test)
      .post('/api/plans')
      .set('Authorization', `Bearer ${SECRET}`)
      .set('Content-Type', 'text/plain')
      .set('X-Orbit-Timestamp', String(NOW))
      .set('X-Orbit-Request-Signature', sign({ method: 'POST', path: '/api/plans' }))
      .send('amount=1000');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/JSON body/);
  });

  it('lets unsigned requests through unless signatures are required', async () => {
    const optional = buildApp();
    expect((await request(optional.test).post('/api/plans').send({ a: 1 })).status).toBe(200);

    const required = buildApp({ isRequired: () => true });
    const res = await request(required.test).post('/api/plans').send({ a: 1 });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(INVALID_REQUEST_SIGNATURE);
    expect(required.handled).not.toHaveBeenCalled();
  });
});

describe('signed merchant routes in the API (#364)', () => {
  const merchantId = '7f8b9a10-b2c3-4d5e-a6f7-112233445566';
  const wallet = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  let supabase;
  let apiKey;

  beforeEach(() => {
    supabase = {
      from: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'plan-1', name: 'Pro Plan' }, error: null }),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    };
    apiKey = makeApiKey({ merchantId, walletAddress: wallet });
    supabase.maybeSingle = vi.fn().mockResolvedValue({ data: apiKey.row, error: null });
    app.locals.supabase = supabase;
    app.locals.rateLimiters.ip.reset();
    app.locals.rateLimiters.apiKey.reset();
  });

  afterEach(() => {
    delete app.locals.requireRequestSignatures;
  });

  const planBody = JSON.stringify({ name: 'Pro Plan', usdc_amount: 290000000, interval_seconds: 2592000 });
  const signedPlan = (body, signedBody = body) => {
    const timestamp = Math.floor(Date.now() / 1000);
    return request(app)
      .post('/plans')
      .set('Authorization', apiKey.header)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(timestamp))
      .set('X-Orbit-Request-Signature', computeRequestSignature({
        secret: apiKey.secret, timestamp, method: 'POST', path: '/plans', body: signedBody,
      }))
      .send(body);
  };

  it('creates a plan from a validly signed request', async () => {
    const res = await signedPlan(planBody);
    expect(res.status).toBe(201);
    expect(supabase.insert).toHaveBeenCalled();
  });

  it('rejects a tampered plan request before it reaches the database', async () => {
    const tampered = JSON.stringify({ name: 'Pro Plan', usdc_amount: 1, interval_seconds: 2592000 });
    const res = await signedPlan(tampered, planBody);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(INVALID_REQUEST_SIGNATURE);
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it('rejects unsigned plan requests when signatures are required', async () => {
    app.locals.requireRequestSignatures = true;
    const res = await request(app).post('/plans').set('Authorization', apiKey.header).send(JSON.parse(planBody));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(INVALID_REQUEST_SIGNATURE);
  });

  it('protects /trigger-pull the same way', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await request(app)
      .post('/trigger-pull')
      .set('Authorization', apiKey.header)
      .set('Content-Type', 'application/json')
      .set('X-Orbit-Timestamp', String(timestamp))
      .set('X-Orbit-Request-Signature', computeRequestSignature({
        secret: apiKey.secret, timestamp, method: 'POST', path: '/trigger-pull', body: '{"subscription_id":"x"}',
      }))
      .send('{"subscription_id":"y"}');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(INVALID_REQUEST_SIGNATURE);
  });
});
