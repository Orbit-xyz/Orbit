"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Brand } from "./brand";

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const closeMenu = () => setIsOpen(false);

  return (
    <header className="site-header">
      <div className="orbit-container nav-inner">
        <Brand />
        <nav className="nav-links" aria-label="Primary navigation">
          <Link
            className="nav-link"
            href="/#features"
            data-testid="link-features"
          >
            Features
          </Link>
          <Link
            className="nav-link"
            href="/#how-it-works"
            data-testid="link-how-it-works"
          >
            Flow
          </Link>
          <Link
            className={`nav-link ${pathname === "/pricing" ? "text-black font-semibold" : ""}`}
            href="/pricing"
            data-testid="link-pricing"
          >
            Pricing
          </Link>
          <Link
            className={`nav-link ${pathname === "/docs" ? "text-black font-semibold" : ""}`}
            href="/docs"
            data-testid="link-developers"
          >
            Developers
          </Link>
        </nav>

        <div className="nav-actions">
          <Link
            className="nav-link"
            href="/signin"
            data-testid="link-signin"
          >
            Sign in
          </Link>
          <Link
            className="button button-primary button-arrow"
            href="/get-started"
            data-testid="link-get-started"
          >
            Get started
          </Link>
        </div>

        <button
          className="mobile-menu-button"
          type="button"
          aria-label={isOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          data-testid="button-mobile-menu"
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Drawer with Framer Motion */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden border-t border-[rgba(0,0,0,0.08)] bg-[#FAFAFB]"
          >
            <div className="orbit-container mobile-nav">
              <Link
                className="nav-link text-base py-1"
                href="/#features"
                onClick={closeMenu}
                data-testid="mobile-link-features"
              >
                Features
              </Link>
              <Link
                className="nav-link text-base py-1"
                href="/#how-it-works"
                onClick={closeMenu}
                data-testid="mobile-link-flow"
              >
                How It Works
              </Link>
              <Link
                className="nav-link text-base py-1"
                href="/pricing"
                onClick={closeMenu}
                data-testid="mobile-link-pricing"
              >
                Pricing
              </Link>
              <Link
                className="nav-link text-base py-1"
                href="/docs"
                onClick={closeMenu}
                data-testid="mobile-link-developers"
              >
                Developers
              </Link>

              <div className="mobile-nav-actions pt-2 border-t border-[rgba(0,0,0,0.08)]">
                <Link
                  className="nav-link text-center py-2"
                  href="/signin"
                  onClick={closeMenu}
                  data-testid="mobile-link-signin"
                >
                  Sign in
                </Link>
                <Link
                  className="button button-primary button-arrow w-full justify-center"
                  href="/get-started"
                  onClick={closeMenu}
                  data-testid="mobile-button-get-started"
                >
                  Get started
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
