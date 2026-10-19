import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function ReceiptView({
  receipt,
  plan,
  customerAddress,
  onClose,
  accentColor = '#6366f1',
  networkPassphrase = 'Test SDF Network ; September 2015',
}) {
  const containerRef = useRef(null);
  const isPublic = networkPassphrase.includes('Public');
  const explorerBase = isPublic
    ? 'https://stellar.expert/explorer/public/tx'
    : 'https://stellar.expert/explorer/testnet/tx';

  const txHash = receipt?.vaultHash || receipt?.txHash || receipt?.hash || '';
  const subscriptionId = receipt?.subscriptionId || receipt?.subscription_id;

  useEffect(() => {
    // Respect reduced-motion preferences
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.fromTo(
        '.orbit-receipt-card',
        { scale: 0.88, opacity: 0, y: 15 },
        { scale: 1, opacity: 1, y: 0, duration: 0.45, ease: 'back.out(1.6)' }
      )
        .fromTo(
          '.orbit-checkmark-circle',
          { strokeDashoffset: 160, opacity: 0 },
          { strokeDashoffset: 0, opacity: 1, duration: 0.5, ease: 'power2.out' },
          '-=0.15'
        )
        .fromTo(
          '.orbit-checkmark-check',
          { strokeDashoffset: 50, opacity: 0 },
          { strokeDashoffset: 0, opacity: 1, duration: 0.35, ease: 'power2.out' },
          '-=0.1'
        )
        .fromTo(
          '.orbit-receipt-item',
          { y: 14, opacity: 0 },
          { y: 0, opacity: 1, stagger: 0.07, duration: 0.35, ease: 'power1.out' },
          '-=0.15'
        );
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="orbit-receipt-container" role="status" aria-live="polite">
      <div className="orbit-receipt-card" style={styles.card}>
        {/* Animated Checkmark SVG */}
        <div style={styles.iconWrapper}>
          <svg width="68" height="68" viewBox="0 0 52 52" style={styles.svg}>
            <circle
              className="orbit-checkmark-circle"
              cx="26"
              cy="26"
              r="23"
              fill="none"
              stroke="#10b981"
              strokeWidth="3.5"
              strokeDasharray="160"
              strokeDashoffset="0"
            />
            <path
              className="orbit-checkmark-check"
              fill="none"
              stroke="#10b981"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="50"
              strokeDashoffset="0"
              d="M14.5 27l7.5 7.5 15.5-16"
            />
          </svg>
        </div>

        <h3 className="orbit-receipt-item" style={styles.title}>
          {receipt?.demo ? 'Demo Complete' : 'Subscription Active!'}
        </h3>
        <p className="orbit-receipt-item" style={styles.subtitle}>
          {receipt?.demo
            ? 'Preview mode completed without signing on-chain.'
            : 'Your recurring allowance has been verified on Stellar.'}
        </p>

        {/* Receipt Details Box */}
        <div className="orbit-receipt-item" style={styles.detailsBox}>
          {plan && (
            <>
              <div style={styles.row}>
                <span style={styles.label}>Plan</span>
                <span style={styles.value}>{plan.name}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.label}>Amount</span>
                <span style={styles.value}>
                  ${(Number(plan.usdc_amount) / 10000000).toFixed(2)} USDC /{' '}
                  {Math.max(1, Math.round(Number(plan.interval_seconds) / 86400))}d
                </span>
              </div>
            </>
          )}

          {customerAddress && (
            <div style={styles.row}>
              <span style={styles.label}>Subscriber</span>
              <span style={styles.value} title={customerAddress}>
                {customerAddress.slice(0, 6)}...{customerAddress.slice(-4)}
              </span>
            </div>
          )}

          {subscriptionId && (
            <div style={styles.row}>
              <span style={styles.label}>Subscription ID</span>
              <span style={{ ...styles.value, fontFamily: 'monospace', fontSize: 12 }}>
                {subscriptionId}
              </span>
            </div>
          )}

          {txHash && (
            <div style={styles.row}>
              <span style={styles.label}>Transaction</span>
              <a
                href={`${explorerBase}/${txHash}`}
                target="_blank"
                rel="noreferrer"
                style={{ ...styles.value, color: accentColor, textDecoration: 'underline' }}
              >
                {txHash.slice(0, 8)}...{txHash.slice(-6)} ↗
              </a>
            </div>
          )}
        </div>

        <button
          className="orbit-receipt-item"
          style={{ ...styles.button, background: accentColor }}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

const styles = {
  card: {
    textAlign: 'center',
    padding: '8px 4px',
  },
  iconWrapper: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 16,
  },
  svg: {
    filter: 'drop-shadow(0 4px 12px rgba(16, 185, 129, 0.25))',
  },
  title: {
    margin: '0 0 6px 0',
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--orbit-text)',
  },
  subtitle: {
    margin: '0 0 20px 0',
    fontSize: 13,
    color: 'var(--orbit-muted)',
    lineHeight: 1.4,
  },
  detailsBox: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--orbit-border)',
    borderRadius: 'var(--orbit-radius)',
    padding: 14,
    marginBottom: 20,
    textAlign: 'left',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    fontSize: 13,
  },
  label: {
    color: 'var(--orbit-muted)',
  },
  value: {
    fontWeight: 600,
    color: 'var(--orbit-text)',
  },
  button: {
    width: '100%',
    padding: '12px 16px',
    border: 0,
    borderRadius: 'var(--orbit-radius)',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
};
