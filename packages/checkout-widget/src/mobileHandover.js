import QRCode from 'qrcode';

export const HANDOVER_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_POLL_INTERVAL_MS = 1500;

// Local in-memory session registry for offline, mock, and test environments
const localSessions = new Map();

/**
 * Generate a unique session channel ID for desktop-to-mobile handover.
 */
export function generateChannelId() {
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `orbit_mhandover_${time}_${rand}`;
}

/**
 * Build deep-link payloads for supported mobile wallets and universal handover.
 */
export function buildHandoverPayloads({
  channelId,
  planId,
  planName = 'Orbit Subscription',
  amount = '0',
  merchantAddress = '',
  merchantName = '',
  apiUrl = 'http://localhost:3001',
  networkPassphrase = 'Test SDF Network ; September 2015',
}) {
  const encodedPlanId = encodeURIComponent(planId || '');
  const encodedChannel = encodeURIComponent(channelId);
  const encodedMerchant = encodeURIComponent(merchantAddress);
  const encodedAmount = encodeURIComponent(amount);
  const encodedPassphrase = encodeURIComponent(networkPassphrase);

  // Universal Web Handover: Opens mobile-friendly web approval flow
  const universal = `${apiUrl}/checkout/mobile?channelId=${encodedChannel}&planId=${encodedPlanId}&amount=${encodedAmount}&merchant=${encodedMerchant}&network=${encodedPassphrase}`;

  // WalletConnect URI v2 scheme
  const walletConnect = `wc:${channelId}@2?relay-protocol=irn&symKey=${channelId.slice(-32).padStart(32, '0')}&expiry=${Date.now() + HANDOVER_EXPIRY_MS}`;

  // Lobstr Mobile Deep Link scheme
  const lobstr = `lobstr://orbit/approve?channelId=${encodedChannel}&planId=${encodedPlanId}&amount=${encodedAmount}&merchant=${encodedMerchant}&network=${encodedPassphrase}`;

  // Albedo Mobile Deep Link URI scheme
  const albedo = `https://albedo.link/#tx?channelId=${encodedChannel}&planId=${encodedPlanId}&amount=${encodedAmount}&merchant=${encodedMerchant}&network=${encodedPassphrase}`;

  return {
    universal,
    walletConnect,
    lobstr,
    albedo,
  };
}

/**
 * Create a new handover session object.
 */
export function createHandoverSession({
  planId,
  planName,
  amount,
  merchantAddress,
  merchantName,
  apiUrl = 'http://localhost:3001',
  networkPassphrase,
  metadata = {},
}) {
  const channelId = generateChannelId();
  const createdAt = Date.now();
  const expiresAt = createdAt + HANDOVER_EXPIRY_MS;

  const payloads = buildHandoverPayloads({
    channelId,
    planId,
    planName,
    amount,
    merchantAddress,
    merchantName,
    apiUrl,
    networkPassphrase,
  });

  const session = {
    channelId,
    planId,
    planName,
    amount,
    merchantAddress,
    merchantName,
    createdAt,
    expiresAt,
    status: 'pending', // 'pending' | 'scanned' | 'confirmed' | 'expired'
    payloads,
    metadata,
  };

  localSessions.set(channelId, session);
  return session;
}

/**
 * Render QR code as high-resolution SVG string.
 */
export async function renderQRCodeSvg(payload, options = {}) {
  const defaultOptions = {
    type: 'svg',
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
    width: 280,
  };
  return QRCode.toString(payload, { ...defaultOptions, ...options });
}

/**
 * Render QR code as high-resolution Data URL.
 */
export async function renderQRCodeDataUrl(payload, options = {}) {
  const defaultOptions = {
    margin: 2,
    width: 280,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  };
  return QRCode.toDataURL(payload, { ...defaultOptions, ...options });
}

/**
 * Simulate mobile approval (useful for testing, demo mode, and local dev).
 */
export function simulateMobileApproval(channelId, confirmationData = {}) {
  const session = localSessions.get(channelId);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    session.status = 'expired';
    return false;
  }

  const txHash = confirmationData.txHash || `mob_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
  const customerWalletAddress = confirmationData.customerWalletAddress || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const subscriptionId = confirmationData.subscriptionId || `sub_${Math.random().toString(36).substring(2, 10)}`;

  session.status = 'confirmed';
  session.confirmedAt = Date.now();
  session.confirmation = {
    txHash,
    customerWalletAddress,
    subscriptionId,
    ...confirmationData,
  };

  localSessions.set(channelId, session);
  return session;
}

/**
 * Real-time listener for mobile handover session.
 * Supports polling and WebSocket with graceful fallback and strict 5-minute expiration.
 */
export function listenHandoverSession({
  channelId,
  apiUrl = 'http://localhost:3001',
  expiresAt,
  onStatusChange,
  onScanned,
  onConfirmed,
  onExpired,
  onError,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}) {
  let active = true;
  let pollTimer = null;
  let expiryTimer = null;
  let ws = null;
  let currentStatus = 'pending';

  const sessionExpiresAt = expiresAt || Date.now() + HANDOVER_EXPIRY_MS;

  const cleanup = () => {
    active = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
      ws = null;
    }
  };

  // 1. Clean expiration handler: stops polling cleanly at 5 minutes
  const remainingMs = Math.max(0, sessionExpiresAt - Date.now());
  if (remainingMs <= 0) {
    currentStatus = 'expired';
    onStatusChange?.('expired');
    onExpired?.();
    cleanup();
    return { stop: cleanup, getStatus: () => currentStatus };
  }

  expiryTimer = setTimeout(() => {
    if (!active) return;
    currentStatus = 'expired';
    onStatusChange?.('expired');
    onExpired?.();
    cleanup();
  }, remainingMs);

  // 2. Process status update
  const handleSessionUpdate = (sessionData) => {
    if (!active || !sessionData) return;

    if (Date.now() > sessionExpiresAt || sessionData.status === 'expired') {
      currentStatus = 'expired';
      onStatusChange?.('expired');
      onExpired?.();
      cleanup();
      return;
    }

    if (sessionData.status === 'scanned' && currentStatus !== 'scanned') {
      currentStatus = 'scanned';
      onStatusChange?.('scanned');
      onScanned?.(sessionData);
    } else if (sessionData.status === 'confirmed') {
      currentStatus = 'confirmed';
      onStatusChange?.('confirmed');
      const confirmation = sessionData.confirmation || {
        txHash: sessionData.tx_hash || sessionData.txHash,
        customerWalletAddress: sessionData.customer_wallet_address || sessionData.customerWalletAddress,
        subscriptionId: sessionData.subscription_id || sessionData.subscriptionId,
      };
      onConfirmed?.(confirmation);
      cleanup();
    }
  };

  // 3. Lightweight HTTP polling function
  const poll = async () => {
    if (!active) return;

    // Check local in-memory store first (for fast tests and offline preview)
    const local = localSessions.get(channelId);
    if (local && (local.status === 'scanned' || local.status === 'confirmed' || local.status === 'expired')) {
      handleSessionUpdate(local);
      if (!active) return;
    }

    try {
      const response = await fetch(`${apiUrl}/handover/sessions/${channelId}`, {
        headers: { Accept: 'application/json' },
      });
      if (!active) return;

      if (response.ok) {
        const data = await response.json();
        handleSessionUpdate(data.session || data);
      }
    } catch (err) {
      // Network failure during polling is treated as transient unless persistent
      onError?.(err);
    }
  };

  // 4. Attempt WebSocket connection if available
  try {
    const wsUrl = apiUrl.replace(/^http/, 'ws');
    if (typeof WebSocket !== 'undefined') {
      ws = new WebSocket(`${wsUrl}/handover?channelId=${encodeURIComponent(channelId)}`);
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleSessionUpdate(payload);
        } catch {
          // Ignore malformed WS payloads
        }
      };
      ws.onerror = () => {
        // Fall back entirely to polling on WS error
        if (ws) {
          try { ws.close(); } catch {}
          ws = null;
        }
      };
    }
  } catch {
    // WebSocket unavailable or unsupported, polling continues
  }

  // Start HTTP polling
  poll();
  pollTimer = setInterval(poll, pollIntervalMs);

  return {
    stop: cleanup,
    getStatus: () => currentStatus,
  };
}
