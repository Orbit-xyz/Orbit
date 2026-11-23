const tls = require('tls');
const { URL } = require('url');
const { recordWebhookSslStatus } = require('./health-metrics');

/**
 * Checks an HTTPS endpoint's SSL/TLS certificate without sending an HTTP request body.
 *
 * @param {string} endpointUrl - HTTPS URL to inspect.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=5000] - Connection timeout.
 * @returns {Promise<{
 *   valid: boolean,
 *   validTo: Date|null,
 *   daysRemaining: number,
 *   isExpired: boolean,
 *   isSelfSigned: boolean,
 *   error?: string
 * }>}
 */
function inspectEndpointCertificate(endpointUrl, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(endpointUrl);
    } catch (e) {
      return resolve({
        valid: false,
        validTo: null,
        daysRemaining: -1,
        isExpired: true,
        isSelfSigned: false,
        error: 'Invalid URL',
      });
    }

    if (parsed.protocol !== 'https:') {
      return resolve({
        valid: false,
        validTo: null,
        daysRemaining: -1,
        isExpired: false,
        isSelfSigned: false,
        error: 'Non-HTTPS protocol',
      });
    }

    const port = parsed.port ? parseInt(parsed.port, 10) : 443;
    const host = parsed.hostname;

    let resolved = false;
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
      },
      () => {
        if (resolved) return;
        resolved = true;
        try {
          const peerCert = socket.getPeerCertificate();
          const authorized = socket.authorized;
          const authError = socket.authorizationError;

          if (!peerCert || !peerCert.valid_to) {
            socket.destroy();
            return resolve({
              valid: false,
              validTo: null,
              daysRemaining: -1,
              isExpired: true,
              isSelfSigned: false,
              error: authError || 'No certificate presented',
            });
          }

          const validTo = new Date(peerCert.valid_to);
          const now = options.now ? new Date(options.now) : new Date();
          const msRemaining = validTo.getTime() - now.getTime();
          const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
          const isExpired = daysRemaining < 0;
          const isSelfSigned =
            authError === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
            (peerCert.issuer &&
              peerCert.subject &&
              peerCert.issuer.CN === peerCert.subject.CN);

          socket.destroy();
          resolve({
            valid: authorized && !isExpired,
            validTo,
            daysRemaining,
            isExpired,
            isSelfSigned,
            error: authorized ? undefined : authError,
          });
        } catch (err) {
          socket.destroy();
          resolve({
            valid: false,
            validTo: null,
            daysRemaining: -1,
            isExpired: true,
            isSelfSigned: false,
            error: err.message,
          });
        }
      }
    );

    socket.setTimeout(timeoutMs, () => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve({
        valid: false,
        validTo: null,
        daysRemaining: -1,
        isExpired: false,
        isSelfSigned: false,
        error: 'Connection timeout',
      });
    });

    socket.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve({
        valid: false,
        validTo: null,
        daysRemaining: -1,
        isExpired: false,
        isSelfSigned: false,
        error: err.message,
      });
    });
  });
}

/**
 * Calculates remaining validity days from a certificate valid_to date.
 */
function calculateDaysRemaining(validTo, now = new Date()) {
  if (!validTo) return -1;
  const target = validTo instanceof Date ? validTo : new Date(validTo);
  const current = now instanceof Date ? now : new Date(now);
  return Math.floor((target.getTime() - current.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Checks whether an endpoint certificate warrants an alert (< 14 days or invalid/self-signed/expired).
 */
function shouldAlertForCertificate(status) {
  if (!status.valid || status.isExpired || status.isSelfSigned) {
    return true;
  }
  return status.daysRemaining <= 14;
}

/**
 * Audits a list of merchant webhook endpoints.
 *
 * @param {Array<{ url: string, merchant_id?: string, email?: string }>} endpoints
 * @param {object} [options]
 * @param {Function} [options.alertNotifier]
 * @param {Function} [options.inspector]
 * @returns {Promise<{ total: number, validCount: number, expiringSoonCount: number, results: Array<object> }>}
 */
async function auditWebhookSslEndpoints(endpoints, options = {}) {
  const inspector = options.inspector || inspectEndpointCertificate;
  const alertNotifier = options.alertNotifier || null;

  let validCount = 0;
  let expiringSoonCount = 0;
  const results = [];

  for (const ep of endpoints) {
    const certStatus = await inspector(ep.url, options);
    const alertNeeded = shouldAlertForCertificate(certStatus);

    if (certStatus.valid && !alertNeeded) {
      validCount++;
    } else {
      expiringSoonCount++;
    }

    if (alertNeeded && typeof alertNotifier === 'function') {
      try {
        await alertNotifier({
          endpoint: ep.url,
          merchant_id: ep.merchant_id,
          email: ep.email,
          status: certStatus,
          daysRemaining: certStatus.daysRemaining,
          reason: certStatus.isExpired
            ? 'expired'
            : certStatus.isSelfSigned
            ? 'self_signed'
            : certStatus.daysRemaining <= 3
            ? 'expiring_critical_3_days'
            : 'expiring_warning_14_days',
        });
      } catch (err) {
        console.error(`Failed to send SSL alert for ${ep.url}:`, err);
      }
    }

    results.push({
      url: ep.url,
      ...certStatus,
    });
  }

  // Update Prometheus metrics
  if (typeof recordWebhookSslStatus === 'function') {
    recordWebhookSslStatus({ validCount, expiringSoonCount });
  }

  return {
    total: endpoints.length,
    validCount,
    expiringSoonCount,
    results,
  };
}

/**
 * Weekly background cron worker monitor.
 */
class WebhookSslMonitor {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 7 * 24 * 60 * 60 * 1000; // Weekly default
    this.endpointSource = options.endpointSource || (() => []);
    this.alertNotifier = options.alertNotifier || null;
    this.inspector = options.inspector || inspectEndpointCertificate;
    this.timer = null;
  }

  async runOnce() {
    const endpoints = await this.endpointSource();
    return auditWebhookSslEndpoints(endpoints, {
      inspector: this.inspector,
      alertNotifier: this.alertNotifier,
    });
  }

  start() {
    if (this.timer) return;
    this.runOnce().catch((err) => console.error('Initial SSL audit failed:', err));
    this.timer = setInterval(() => {
      this.runOnce().catch((err) => console.error('Periodic SSL audit failed:', err));
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = {
  inspectEndpointCertificate,
  calculateDaysRemaining,
  shouldAlertForCertificate,
  auditWebhookSslEndpoints,
  WebhookSslMonitor,
};
