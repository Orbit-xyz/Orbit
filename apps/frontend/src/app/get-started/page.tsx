import Link from "next/link";

export default function GetStartedPage() {
  return (
    <main className="interstitial">
      <div className="orbit-container interstitial-inner">
        <h1>
          Make the next payment <span>automatic.</span>
        </h1>
        <p>
          Walk through the Orbit interactive demo: connect your Web3
          wallet in the checkout widget, approve a time and budget allowance,
          execute the pull, and route an instant batch payout.
        </p>

        <div className="interstitial-actions">
          <Link
            className="button button-primary button-arrow"
            href="/#features"
            data-testid="get-started-button-features"
          >
            Explore the MVP toolkit
          </Link>
          <Link
            className="button button-secondary"
            href="/"
            data-testid="get-started-button-home"
          >
            Back to Orbit
          </Link>
        </div>

        <div className="placeholder-panel">
          <p>
            Customer approves a protected Allowance Vault. Merchant triggers the
            pull when due. The smart contract executes direct wallet settlement in USDC. Zero
            custody, zero chargebacks, sub-second settlement.
          </p>
        </div>
      </div>
    </main>
  );
}
