"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./brand";
import { DOCS_URL } from "@/lib/links";

export function Footer() {
  const pathname = usePathname();

  if (pathname?.startsWith("/dashboard") || pathname?.startsWith("/pay") || pathname?.startsWith("/docs")) {
    return null;
  }

  return (
    <footer className="site-footer">
      <div className="orbit-container">
        <div className="footer-top">
          <div>
            <Brand />
            <p className="footer-brand-copy">
              Non-custodial pull payments for businesses that sell, subscribe,
              and pay globally.
            </p>
          </div>
          <div className="footer-columns">
            <div className="footer-column">
              <h3>Product</h3>
              <Link href="/#features">Allowance Vault</Link>
              <Link href="/#features">Batch Payroll</Link>
              <Link href="/#features">Recurring Pulls</Link>
              <Link href="/pricing">Pricing Plans</Link>
            </div>
            <div className="footer-column">
              <h3>Resources</h3>
              <Link href={DOCS_URL}>Documentation</Link>
              <Link href={`${DOCS_URL}/api-reference/overview`}>API Reference</Link>
              <Link href="/get-started">Developer Playground</Link>
              <Link href={`${DOCS_URL}/quickstart`}>SDK Quickstart</Link>
            </div>
            <div className="footer-column">
              <h3>Company</h3>
              <Link href="/docs">About Orbit</Link>
              <Link href="/docs">Brand Guidelines</Link>
              <Link href="/docs">Release Notes</Link>
              <Link href="/docs">Network Status</Link>
            </div>
            <div className="footer-column">
              <h3>Legal</h3>
              <Link href="/docs">Privacy Policy</Link>
              <Link href="/docs">Terms of Service</Link>
              <Link href="/docs">Security Disclosures</Link>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© Orbit Technologies 2026. All rights reserved.</span>
          <span className="mono">
            PROGRAMMABLE PULL PAYMENT PROTOCOL
          </span>
        </div>
      </div>
    </footer>
  );
}
