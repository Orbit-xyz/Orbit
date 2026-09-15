import Link from "next/link";

export default function NotFound() {
  return (
    <main className="interstitial">
      <div className="orbit-container interstitial-inner">
        <span className="eyebrow">404 / NOT FOUND</span>
        <h1>
          Orbit out of <span>range.</span>
        </h1>
        <p>
          The page you requested does not exist or has moved out of orbit.
        </p>

        <div className="interstitial-actions">
          <Link
            className="button button-primary button-arrow"
            href="/"
            data-testid="not-found-button-home"
          >
            Return to orbit
          </Link>
        </div>
      </div>
    </main>
  );
}
