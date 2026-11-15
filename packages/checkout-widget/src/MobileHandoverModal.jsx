import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  createHandoverSession,
  listenHandoverSession,
  renderQRCodeDataUrl,
  simulateMobileApproval,
  HANDOVER_EXPIRY_MS,
} from './mobileHandover';

const FORMATS = [
  { id: 'universal', label: 'Universal QR' },
  { id: 'lobstr', label: 'Lobstr' },
  { id: 'albedo', label: 'Albedo' },
  { id: 'walletConnect', label: 'WalletConnect' },
];

export default function MobileHandoverModal({
  plan,
  planId,
  apiUrl = 'http://localhost:3001',
  networkPassphrase,
  accentColor = '#6366f1',
  demo = false,
  onConfirmed,
  onClose,
}) {
  const [session, setSession] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState('universal');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [status, setStatus] = useState('pending'); // 'pending' | 'scanned' | 'confirmed' | 'expired'
  const [remainingSeconds, setRemainingSeconds] = useState(Math.floor(HANDOVER_EXPIRY_MS / 1000));
  const [copied, setCopied] = useState(false);
  const listenerRef = useRef(null);

  // Initialize or re-generate session
  const initSession = () => {
    if (listenerRef.current) {
      listenerRef.current.stop();
      listenerRef.current = null;
    }

    const newSession = createHandoverSession({
      planId: plan?.id || planId,
      planName: plan?.name,
      amount: plan?.usdc_amount,
      merchantAddress: plan?.merchants?.wallet_address,
      merchantName: plan?.merchants?.name,
      apiUrl,
      networkPassphrase,
    });

    setSession(newSession);
    setStatus('pending');
    setRemainingSeconds(Math.floor(HANDOVER_EXPIRY_MS / 1000));

    // Register session with backend if reachable
    fetch(`${apiUrl}/handover/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_id: newSession.channelId,
        plan_id: newSession.planId,
        amount: newSession.amount,
        merchant_address: newSession.merchantAddress,
        expires_at: newSession.expiresAt,
      }),
    }).catch(() => {
      // Offline / fallback to in-process session listener
    });

    // Start real-time listener (polling + WebSocket)
    listenerRef.current = listenHandoverSession({
      channelId: newSession.channelId,
      apiUrl,
      expiresAt: newSession.expiresAt,
      onStatusChange: (newStatus) => setStatus(newStatus),
      onScanned: () => setStatus('scanned'),
      onConfirmed: (confirmation) => {
        setStatus('confirmed');
        onConfirmed?.(confirmation);
      },
      onExpired: () => setStatus('expired'),
    });
  };

  useEffect(() => {
    initSession();
    return () => {
      if (listenerRef.current) {
        listenerRef.current.stop();
        listenerRef.current = null;
      }
    };
  }, [planId, apiUrl, networkPassphrase]);

  // Generate QR code whenever the session or format changes
  useEffect(() => {
    if (!session) return;
    const uri = session.payloads[selectedFormat] || session.payloads.universal;
    renderQRCodeDataUrl(uri, {
      width: 240,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch((err) => console.error('Failed to generate QR code:', err));
  }, [session, selectedFormat]);

  // Countdown timer: 5 minutes limit
  useEffect(() => {
    if (!session || status === 'expired' || status === 'confirmed') return undefined;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        setStatus('expired');
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session, status]);

  const activeUri = useMemo(() => {
    if (!session) return '';
    return session.payloads[selectedFormat] || session.payloads.universal;
  }, [session, selectedFormat]);

  const handleCopy = () => {
    if (!activeUri) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(activeUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSimulateApproval = () => {
    if (!session) return;
    simulateMobileApproval(session.channelId, {
      customerWalletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      txHash: `sim_tx_${Date.now()}_stellar`,
      subscriptionId: `sub_mob_${Date.now()}`,
    });
  };

  const formatTimer = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="handover-title" style={styles.modal}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>📱</span>
          <h3 id="handover-title" style={styles.title}>
            Scan with Mobile Wallet
          </h3>
        </div>
        <button onClick={onClose} style={styles.closeButton} aria-label="Close modal">
          ✕
        </button>
      </div>

      <p style={styles.description}>
        Scan this QR code with Lobstr, Albedo, or any WalletConnect Stellar wallet to approve this subscription.
      </p>

      {/* Format Selector Tabs */}
      <div style={styles.tabContainer}>
        {FORMATS.map((fmt) => (
          <button
            key={fmt.id}
            onClick={() => setSelectedFormat(fmt.id)}
            style={{
              ...styles.tab,
              borderColor: selectedFormat === fmt.id ? accentColor : 'transparent',
              background: selectedFormat === fmt.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
              color: selectedFormat === fmt.id ? 'var(--orbit-text)' : 'var(--orbit-muted)',
              fontWeight: selectedFormat === fmt.id ? 600 : 400,
            }}
          >
            {fmt.label}
          </button>
        ))}
      </div>

      {/* QR Code Container */}
      <div style={styles.qrContainer}>
        {status === 'expired' ? (
          <div style={styles.expiredBox}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
            <strong style={{ color: '#ef4444', display: 'block', marginBottom: 4 }}>
              Session Expired
            </strong>
            <p style={{ fontSize: 12, color: 'var(--orbit-muted)', margin: '0 0 14px 0' }}>
              For security, mobile handover codes expire after 5 minutes.
            </p>
            <button
              onClick={initSession}
              style={{ ...styles.actionBtn, background: accentColor }}
            >
              🔄 Refresh QR Code
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Scan with mobile wallet QR code"
                style={styles.qrImage}
              />
            ) : (
              <div style={styles.qrPlaceholder}>Generating QR Code...</div>
            )}
            {status === 'scanned' && (
              <div style={styles.scannedOverlay}>
                <span style={{ fontSize: 28, marginBottom: 6 }}>📲</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Mobile Wallet Connected</span>
                <small style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>
                  Confirm transaction on your phone...
                </small>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expiry Countdown & Status */}
      {status !== 'expired' && (
        <div style={styles.statusFooter}>
          <div style={styles.countdown}>
            <span style={{ color: remainingSeconds < 60 ? '#ef4444' : 'var(--orbit-muted)' }}>
              Expires in: <strong>{formatTimer(remainingSeconds)}</strong>
            </span>
          </div>

          <div style={styles.pulseContainer}>
            <span
              style={{
                ...styles.pulseDot,
                background: status === 'scanned' ? '#3b82f6' : '#10b981',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--orbit-muted)' }}>
              {status === 'scanned'
                ? 'Approve on your mobile wallet...'
                : 'Listening for mobile approval...'}
            </span>
          </div>
        </div>
      )}

      {/* Deep Link URL copy & Developer helpers */}
      <div style={styles.actionsFooter}>
        <button onClick={handleCopy} style={styles.copyBtn}>
          {copied ? '✓ URI Copied' : '📋 Copy Deep Link URI'}
        </button>

        {demo && (
          <button
            onClick={handleSimulateApproval}
            style={styles.simulateBtn}
            title="Simulate successful mobile scan & confirmation"
          >
            ⚡ Test: Simulate Mobile Approval
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  modal: {
    position: 'absolute',
    inset: 12,
    background: 'var(--orbit-surface)',
    borderRadius: 'var(--orbit-radius)',
    padding: 20,
    zIndex: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    border: '1px solid var(--orbit-border)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    margin: 0,
    fontSize: 17,
    fontWeight: 700,
    color: 'var(--orbit-text)',
  },
  closeButton: {
    background: 'transparent',
    border: 0,
    color: 'var(--orbit-muted)',
    fontSize: 16,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  description: {
    fontSize: 12,
    color: 'var(--orbit-muted)',
    margin: '0 0 12px 0',
    lineHeight: 1.4,
  },
  tabContainer: {
    display: 'flex',
    gap: 4,
    background: 'rgba(255, 255, 255, 0.04)',
    padding: 3,
    borderRadius: 8,
    border: '1px solid var(--orbit-border)',
    marginBottom: 14,
  },
  tab: {
    flex: 1,
    padding: '6px 4px',
    border: '1px solid transparent',
    borderRadius: 6,
    fontSize: 11,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  qrContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
    background: '#ffffff',
    borderRadius: 'var(--orbit-radius)',
    border: '1px solid var(--orbit-border)',
    marginBottom: 12,
    minHeight: 220,
  },
  qrImage: {
    display: 'block',
    width: 210,
    height: 210,
    borderRadius: 6,
  },
  qrPlaceholder: {
    width: 210,
    height: 210,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666',
    fontSize: 13,
  },
  scannedOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    color: '#ffffff',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    textAlign: 'center',
  },
  expiredBox: {
    textAlign: 'center',
    padding: '16px 8px',
  },
  actionBtn: {
    padding: '8px 16px',
    border: 0,
    borderRadius: 'var(--orbit-radius)',
    color: '#ffffff',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  statusFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    fontSize: 12,
  },
  countdown: {
    fontSize: 12,
  },
  pulseContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
  },
  actionsFooter: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 'auto',
  },
  copyBtn: {
    background: 'transparent',
    border: '1px solid var(--orbit-border)',
    color: 'var(--orbit-text)',
    padding: '8px 12px',
    borderRadius: 'var(--orbit-radius)',
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'center',
  },
  simulateBtn: {
    background: 'rgba(16, 185, 129, 0.1)',
    border: '1px dashed #10b981',
    color: '#10b981',
    padding: '6px 10px',
    borderRadius: 'var(--orbit-radius)',
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'center',
  },
};
