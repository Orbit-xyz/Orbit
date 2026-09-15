import Link from "next/link";

export default function SignInPage() {
  return (
    <main className="interstitial">
      <div className="orbit-container interstitial-inner">
        <h1>
          The control room is <span>still orbiting.</span>
        </h1>
        <p>
          The merchant dashboard is currently being prepared. This will be where
          founders configure subscription plans, monitor active on-chain
          allowance vaults, trigger recurring pulls, and execute batch contractor
          payroll.
        </p>

        <div className="interstitial-actions">
          <Link
            className="button button-primary button-arrow"
            href="/get-started"
            data-testid="signin-button-start"
          >
            See the MVP flow
          </Link>
          <Link
            className="button button-secondary"
            href="/"
            data-testid="signin-button-home"
          >
            Back to Orbit
          </Link>
        </div>

        <div className="placeholder-panel">
          <p>
            No account or wallet connection is required for this demo. The
            current release is focused on proving the protocol primitives and
            interactive playground.
          </p>
        </div>
      </div>
    </main>
  );
}
