const { describe, it } = require('node:test');
const assert = require('assert');
const {
  inspectEndpointCertificate,
  calculateDaysRemaining,
  shouldAlertForCertificate,
  auditWebhookSslEndpoints,
  WebhookSslMonitor,
} = require('../webhook-ssl-monitor');
const {
  webhookSslValidGauge,
  webhookSslExpiringSoonGauge,
  businessRegistry,
} = require('../health-metrics');

describe('Webhook SSL Certificate Monitor (#374)', () => {
  const now = new Date('2026-11-20T12:00:00Z');

  describe('calculateDaysRemaining', () => {
    it('calculates remaining days accurately', () => {
      const validTo = new Date('2026-12-04T12:00:00Z'); // 14 days later
      const days = calculateDaysRemaining(validTo, now);
      assert.strictEqual(days, 14);
    });

    it('reports negative days for expired certificates', () => {
      const validTo = new Date('2026-11-10T12:00:00Z'); // 10 days ago
      const days = calculateDaysRemaining(validTo, now);
      assert.strictEqual(days, -10);
    });

    it('returns -1 for null or missing validTo', () => {
      assert.strictEqual(calculateDaysRemaining(null, now), -1);
    });
  });

  describe('shouldAlertForCertificate', () => {
    it('alerts if certificate is expired', () => {
      assert.strictEqual(
        shouldAlertForCertificate({ valid: false, isExpired: true, daysRemaining: -2 }),
        true
      );
    });

    it('alerts if certificate is self-signed', () => {
      assert.strictEqual(
        shouldAlertForCertificate({ valid: false, isSelfSigned: true, daysRemaining: 100 }),
        true
      );
    });

    it('alerts when remaining days are <= 14 days', () => {
      assert.strictEqual(
        shouldAlertForCertificate({ valid: true, isExpired: false, isSelfSigned: false, daysRemaining: 14 }),
        true
      );
      assert.strictEqual(
        shouldAlertForCertificate({ valid: true, isExpired: false, isSelfSigned: false, daysRemaining: 3 }),
        true
      );
    });

    it('does not alert when certificate has plenty of validity (> 14 days)', () => {
      assert.strictEqual(
        shouldAlertForCertificate({ valid: true, isExpired: false, isSelfSigned: false, daysRemaining: 60 }),
        false
      );
    });
  });

  describe('auditWebhookSslEndpoints', () => {
    it('audits multiple endpoints, alerts at 14d & 3d thresholds, and sets metrics gauges', async () => {
      const alerts = [];
      const mockEndpoints = [
        { url: 'https://valid.example.com/webhook', email: 'valid@example.com' },
        { url: 'https://expiring-14d.example.com/webhook', email: 'merchant14@example.com' },
        { url: 'https://expiring-3d.example.com/webhook', email: 'merchant3@example.com' },
        { url: 'https://expired.example.com/webhook', email: 'expired@example.com' },
        { url: 'https://self-signed.example.com/webhook', email: 'self@example.com' },
      ];

      const mockInspector = async (url) => {
        if (url.includes('valid.example')) {
          return { valid: true, validTo: new Date('2027-05-01'), daysRemaining: 160, isExpired: false, isSelfSigned: false };
        }
        if (url.includes('expiring-14d')) {
          return { valid: true, validTo: new Date('2026-12-04'), daysRemaining: 14, isExpired: false, isSelfSigned: false };
        }
        if (url.includes('expiring-3d')) {
          return { valid: true, validTo: new Date('2026-11-23'), daysRemaining: 3, isExpired: false, isSelfSigned: false };
        }
        if (url.includes('expired')) {
          return { valid: false, validTo: new Date('2026-11-01'), daysRemaining: -19, isExpired: true, isSelfSigned: false, error: 'CERT_HAS_EXPIRED' };
        }
        if (url.includes('self-signed')) {
          return { valid: false, validTo: new Date('2027-01-01'), daysRemaining: 40, isExpired: false, isSelfSigned: true, error: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
        }
        return { valid: false, validTo: null, daysRemaining: -1, isExpired: true, isSelfSigned: false, error: 'Unknown' };
      };

      const result = await auditWebhookSslEndpoints(mockEndpoints, {
        inspector: mockInspector,
        alertNotifier: (alert) => alerts.push(alert),
      });

      assert.strictEqual(result.total, 5);
      assert.strictEqual(result.validCount, 1);
      assert.strictEqual(result.expiringSoonCount, 4);

      // Verify alerts were dispatched for the 4 problematic endpoints
      assert.strictEqual(alerts.length, 4);
      assert.strictEqual(alerts.find(a => a.endpoint.includes('expiring-14d')).reason, 'expiring_warning_14_days');
      assert.strictEqual(alerts.find(a => a.endpoint.includes('expiring-3d')).reason, 'expiring_critical_3_days');
      assert.strictEqual(alerts.find(a => a.endpoint.includes('expired')).reason, 'expired');
      assert.strictEqual(alerts.find(a => a.endpoint.includes('self-signed')).reason, 'self_signed');

      // Verify Prometheus metric gauges
      const metricsText = await businessRegistry.metrics();
      assert.ok(metricsText.includes('webhook_ssl_valid_count 1'), 'Expected webhook_ssl_valid_count 1');
      assert.ok(metricsText.includes('webhook_ssl_expiring_soon_count 4'), 'Expected webhook_ssl_expiring_soon_count 4');
    });
  });

  describe('WebhookSslMonitor background runner', () => {
    it('runs audit and stops cleanly', async () => {
      let callCount = 0;
      const monitor = new WebhookSslMonitor({
        intervalMs: 1000,
        endpointSource: async () => [{ url: 'https://mock.orbit.xyz/hook' }],
        inspector: async () => {
          callCount++;
          return { valid: true, validTo: new Date('2027-01-01'), daysRemaining: 100, isExpired: false, isSelfSigned: false };
        },
      });

      const outcome = await monitor.runOnce();
      assert.strictEqual(outcome.total, 1);
      assert.strictEqual(outcome.validCount, 1);
      assert.strictEqual(callCount, 1);

      monitor.start();
      assert.ok(monitor.timer);
      monitor.stop();
      assert.strictEqual(monitor.timer, null);
    });
  });
});
