import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'node:module';

// Load both through require, as index.js does, so they share one metrics registry
const require = createRequire(import.meta.url);
const { registerHealthMetrics } = require('../health-metrics.js');
const {
  RPC_SYNC_STATUS,
  classifyLag,
  createRpcLagMonitor,
  registerRpcLagHealthRoute,
} = require('../rpc-lag-monitor.js');

const HORIZON = 'https://horizon.example';

// Desynchronised providers: the RPC reports `rpcLedger`, Horizon reports `consensusLedger`
const providers = ({ rpcLedger, consensusLedger }) => {
  const state = { rpcLedger, consensusLedger };
  const server = { getLatestLedger: vi.fn(async () => ({ sequence: state.rpcLedger })) };
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ core_latest_ledger: state.consensusLedger }) }));
  return { state, server, fetchImpl };
};

const quietLogger = () => ({ warn: vi.fn(), info: vi.fn() });

const monitorFor = (p, overrides = {}) =>
  createRpcLagMonitor({
    getSorobanServer: () => p.server,
    rpcUrl: 'https://rpc.example',
    horizonUrl: HORIZON,
    getFetch: () => p.fetchImpl,
    logger: quietLogger(),
    ...overrides,
  });

describe('classifyLag', () => {
  it('maps lag to OK, DEGRADED (>3) and CRITICAL (>10)', () => {
    expect(classifyLag(0)).toBe(RPC_SYNC_STATUS.OK);
    expect(classifyLag(3)).toBe(RPC_SYNC_STATUS.OK);
    expect(classifyLag(4)).toBe(RPC_SYNC_STATUS.DEGRADED);
    expect(classifyLag(10)).toBe(RPC_SYNC_STATUS.DEGRADED);
    expect(classifyLag(11)).toBe(RPC_SYNC_STATUS.CRITICAL);
    expect(classifyLag(Number.NaN)).toBe(RPC_SYNC_STATUS.UNKNOWN);
  });
});

describe('RPC lag monitor (#365)', () => {
  it('computes consensus minus RPC ledger', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1002 });
    const status = await monitorFor(p).poll();

    expect(status).toMatchObject({ status: 'OK', rpc_lag_ledgers: 2, rpc_ledger: 1000, consensus_ledger: 1002, error: null });
    expect(p.fetchImpl).toHaveBeenCalledWith(`${HORIZON}/`, expect.anything());
  });

  it('marks the RPC DEGRADED and logs a warning past 3 ledgers', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1005 });
    const logger = quietLogger();
    const status = await monitorFor(p, { logger }).poll();

    expect(status.status).toBe(RPC_SYNC_STATUS.DEGRADED);
    expect(status.rpc_lag_ledgers).toBe(5);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('5 ledgers behind'), expect.anything());
  });

  it('marks the RPC CRITICAL past 10 ledgers', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1011 });
    expect((await monitorFor(p).poll()).status).toBe(RPC_SYNC_STATUS.CRITICAL);
  });

  it('recovers to OK once the RPC catches up', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1020 });
    const logger = quietLogger();
    const monitor = monitorFor(p, { logger });
    expect((await monitor.poll()).status).toBe('CRITICAL');

    p.state.rpcLedger = 1020;
    expect((await monitor.poll()).status).toBe('OK');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('caught up'));
  });

  it('does not count an RPC ahead of Horizon as negative lag', async () => {
    const p = providers({ rpcLedger: 1003, consensusLedger: 1002 });
    expect((await monitorFor(p).poll()).rpc_lag_ledgers).toBe(0);
  });

  it('falls back to history_latest_ledger when core_latest_ledger is absent', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 0 });
    p.fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ history_latest_ledger: 1004 }) });
    expect((await monitorFor(p).poll()).rpc_lag_ledgers).toBe(4);
  });

  it('reports UNKNOWN with the error when a provider fails', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1001 });
    const monitor = monitorFor(p);
    await monitor.poll();

    p.fetchImpl.mockResolvedValue({ ok: false, status: 502 });
    const status = await monitor.poll();
    expect(status.status).toBe(RPC_SYNC_STATUS.UNKNOWN);
    expect(status.error).toMatch(/HTTP 502/);
    // last known measurement is kept for operators
    expect(status.rpc_ledger).toBe(1000);
  });

  it('rejects an invalid ledger sequence from the RPC', async () => {
    const p = providers({ rpcLedger: undefined, consensusLedger: 1001 });
    const status = await monitorFor(p).poll();
    expect(status.status).toBe('UNKNOWN');
    expect(status.error).toMatch(/Soroban RPC returned an invalid ledger sequence/);
  });

  it('times out a hung provider instead of blocking', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1001 });
    p.server.getLatestLedger.mockImplementation(() => new Promise(() => {}));
    const status = await monitorFor(p, { timeoutMs: 20 }).poll();
    expect(status.status).toBe('UNKNOWN');
    expect(status.error).toMatch(/timed out/);
  });

  it('shares one in-flight measurement between concurrent polls', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1001 });
    const monitor = monitorFor(p);
    await Promise.all([monitor.poll(), monitor.poll(), monitor.poll()]);
    expect(p.server.getLatestLedger).toHaveBeenCalledTimes(1);
  });

  it('rejects thresholds where critical is not above degraded', () => {
    const p = providers({ rpcLedger: 1, consensusLedger: 1 });
    expect(() => monitorFor(p, { degradedThreshold: 10, criticalThreshold: 5 })).toThrow(/criticalThreshold/);
  });

  describe('background poller', () => {
    afterEach(() => vi.useRealTimers());

    it('polls on an unref\'d interval and stops cleanly', async () => {
      vi.useFakeTimers();
      const p = providers({ rpcLedger: 1000, consensusLedger: 1001 });
      const monitor = monitorFor(p, { intervalMs: 1000 }).start();
      expect(monitor.isRunning()).toBe(true);

      await vi.advanceTimersByTimeAsync(3000);
      expect(p.server.getLatestLedger.mock.calls.length).toBeGreaterThanOrEqual(3);

      monitor.stop();
      const calls = p.server.getLatestLedger.mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000);
      expect(p.server.getLatestLedger).toHaveBeenCalledTimes(calls);
      expect(monitor.isRunning()).toBe(false);
    });
  });
});

describe('/health and /metrics (#365)', () => {
  const db = { from: () => ({ select: () => ({ limit: async () => ({ error: null }), eq: async () => ({ count: 0 }) }) }) };

  const appWith = (monitor) => {
    const app = express();
    registerHealthMetrics(app, {
      getSupabase: () => db,
      getSorobanServer: () => ({ getLatestLedger: async () => ({ sequence: 1 }) }),
      getMetricsToken: () => 'metrics-secret',
    });
    registerRpcLagHealthRoute(app, () => monitor);
    return app;
  };

  it('returns 200 with rpc_lag_ledgers while the RPC is in sync or degraded', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1004 });
    const monitor = monitorFor(p);
    await monitor.poll();

    const res = await request(appWith(monitor)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'DEGRADED', rpc_lag_ledgers: 4 });
    expect(res.body.thresholds).toEqual({ degradedThreshold: 3, criticalThreshold: 10 });
  });

  it('returns 503 once lag passes the critical threshold', async () => {
    const p = providers({ rpcLedger: 1000, consensusLedger: 1015 });
    const monitor = monitorFor(p);
    await monitor.poll();

    const res = await request(appWith(monitor)).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'CRITICAL', rpc_lag_ledgers: 15 });
  });

  it('reports UNKNOWN before the first measurement and without a monitor', async () => {
    const p = providers({ rpcLedger: 1, consensusLedger: 1 });
    const fresh = await request(appWith(monitorFor(p))).get('/health');
    expect(fresh.status).toBe(200);
    expect(fresh.body.status).toBe('UNKNOWN');

    const missing = await request(appWith(null)).get('/health');
    expect(missing.body.status).toBe('UNKNOWN');
  });

  it('exposes orbit_rpc_lag_ledgers on /metrics', async () => {
    const p = providers({ rpcLedger: 2000, consensusLedger: 2007 });
    const monitor = monitorFor(p);
    await monitor.poll();

    const res = await request(appWith(monitor)).get('/metrics').set('Authorization', 'Bearer metrics-secret');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^orbit_rpc_lag_ledgers 7$/m);
  });
});
