import Link from "next/link";

export default function DocsPage() {
  return (
    <main className="interstitial">
      <div className="orbit-container interstitial-inner">
        <span className="eyebrow">DEVELOPERS / PROTOCOL SPEC</span>
        <h1>
          Build the pull, <span>not the paperwork.</span>
        </h1>
        <p>
          Orbit&apos;s architecture maps the MVP flow from customer checkout
          approval to merchant-triggered pull and one-click batch payout on
          Stellar. Full interactive documentation is scheduled alongside the
          v1 contract testnet deployment.
        </p>

        <div className="interstitial-actions">
          <Link
            className="button button-primary button-arrow"
            href="/get-started"
            data-testid="docs-button-get-started"
          >
            Open the testnet playground
          </Link>
          <Link
            className="button button-secondary"
            href="/"
            data-testid="docs-button-home"
          >
            Back to Orbit
          </Link>
        </div>

        <div className="placeholder-panel">
          <span className="mono">DOCUMENTATION / MVP SPEC OVERVIEW</span>
          <p>
            Allowance Vaults enforce strict time and budget limits. Batch
            Disbursement routes exact stablecoin amounts to multiple recipients
            in a single ledger execution block on Soroban.
          </p>
        </div>
      </div>
    </main>
  );
}
