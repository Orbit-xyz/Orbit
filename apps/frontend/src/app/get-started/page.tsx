"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, ArrowRight, ShieldCheck, Zap, Globe, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function GetStartedPage() {
  const router = useRouter();
  const { signUp, signInWithWallet } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [showWalletInput, setShowWalletInput] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setIsSubmitting(true);

    const res = await signUp({
      email,
      password,
      businessName,
      walletAddress: payoutAddress,
    });

    if (!res.success) {
      setErrorMsg(res.error || "Failed to create account.");
      setIsSubmitting(false);
      return;
    }

    setSuccessMsg("Merchant account registered! Launching control center...");
    setTimeout(() => {
      router.push("/dashboard");
    }, 900);
  };

  const handleWalletConnect = async () => {
    setErrorMsg("");
    setIsSubmitting(true);

    // Check if browser has a web3 wallet provider
    const win = typeof window !== "undefined" ? (window as any) : null;
    let detectedAddress = "";

    if (win?.ethereum?.selectedAddress) {
      detectedAddress = win.ethereum.selectedAddress;
    } else if (win?.freighterApi?.getPublicKey) {
      try {
        detectedAddress = await win.freighterApi.getPublicKey();
      } catch (err) {
        console.warn("Freighter wallet not responding:", err);
      }
    }

    if (!detectedAddress) {
      setShowWalletInput(true);
      setIsSubmitting(false);
      return;
    }

    const res = await signInWithWallet(detectedAddress);
    if (res.success) {
      setSuccessMsg("Wallet connected! Launching control center...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 900);
    } else {
      setErrorMsg(res.error || "Could not connect wallet.");
      setIsSubmitting(false);
    }
  };

  const handleManualWalletSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutAddress || payoutAddress.trim().length < 8) {
      setErrorMsg("Please enter a valid wallet address.");
      return;
    }
    setIsSubmitting(true);
    const res = await signInWithWallet(payoutAddress.trim());
    if (res.success) {
      setSuccessMsg("Wallet connected! Launching control center...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 900);
    } else {
      setErrorMsg(res.error || "Could not authenticate with wallet.");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-container">
        <div className="auth-grid">
          {/* Left Column: Product Value & Trust */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="auth-sidebar"
          >
            <h2>
              Start accepting <span>automated</span> pull payments.
            </h2>
            <p className="auth-sidebar-desc">
              Create your merchant account in seconds. Configure recurring
              allowance vaults, charge subscriptions globally in USDC, and
              settle directly to your own wallet.
            </p>

            <div className="auth-perks">
              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <ShieldCheck size={14} />
                </div>
                <div>
                  <div className="auth-perk-title">Non-Custodial Smart Vaults</div>
                  <div className="auth-perk-detail">
                    Orbit never holds your funds. Subscriptions settle directly
                    between customer wallets and your treasury address.
                  </div>
                </div>
              </div>

              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <Zap size={14} />
                </div>
                <div>
                  <div className="auth-perk-title">Zero Chargebacks & Friction</div>
                  <div className="auth-perk-detail">
                    Pre-approved on-chain allowance caps eliminate dispute fraud
                    and awkward monthly manual signature requests.
                  </div>
                </div>
              </div>

              <div className="auth-perk-item">
                <div className="auth-perk-icon">
                  <Globe size={14} />
                </div>
                <div>
                  <div className="auth-perk-title">Global Borderless Settlement</div>
                  <div className="auth-perk-detail">
                    Charge users anywhere on earth in digital dollars (USDC)
                    without expensive international bank wires or card processing fees.
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right Column: Registration Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="auth-card"
          >
            <div className="auth-header">
              <h1>Create your merchant account</h1>
              <p>Get started with Orbit. No credit card required.</p>
            </div>

            {errorMsg && <div className="auth-error">{errorMsg}</div>}
            {successMsg && <div className="auth-success">{successMsg}</div>}

            {!showWalletInput ? (
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="form-group">
                  <label className="form-label" htmlFor="businessName">
                    Business / Project Name
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    required
                    placeholder="Acme Inc or MailKit"
                    className="form-input"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="email">
                    Work Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="alex@yourcompany.com"
                    className="form-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    placeholder="Create a secure password"
                    className="form-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="payoutAddress">
                    <span>Payout Settlement Address</span>
                    <span className="form-label-hint">Optional (add anytime)</span>
                  </label>
                  <input
                    id="payoutAddress"
                    type="text"
                    placeholder="0x... or G... (where USDC will be received)"
                    className="form-input font-mono text-xs"
                    value={payoutAddress}
                    onChange={(e) => setPayoutAddress(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="button button-primary w-full mt-2 font-semibold"
                  style={{ width: "100%", height: "46px" }}
                >
                  {isSubmitting ? (
                    "Setting up account..."
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      Create Merchant Account <ArrowRight size={15} />
                    </span>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleManualWalletSubmit} className="auth-form">
                <div className="form-group">
                  <label className="form-label" htmlFor="manualWallet">
                    Enter Settlement Wallet Address
                  </label>
                  <input
                    id="manualWallet"
                    type="text"
                    required
                    placeholder="0x... or G..."
                    className="form-input font-mono text-xs"
                    value={payoutAddress}
                    onChange={(e) => setPayoutAddress(e.target.value)}
                    autoFocus
                  />
                  <span className="text-[12px] text-neutral-500 mt-1">
                    Your wallet will serve as your non-custodial merchant treasury.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="button button-primary w-full mt-2"
                  style={{ width: "100%", height: "46px" }}
                >
                  {isSubmitting ? "Connecting..." : "Continue with Wallet"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowWalletInput(false)}
                  className="text-xs text-neutral-500 hover:text-black text-center mt-2 underline"
                >
                  Back to Email Sign Up
                </button>
              </form>
            )}

            {!showWalletInput && (
              <>
                <div className="auth-divider">
                  <span>or</span>
                </div>

                <button
                  type="button"
                  onClick={handleWalletConnect}
                  className="auth-wallet-btn"
                >
                  <Wallet size={16} />
                  <span>Connect Web3 Wallet</span>
                </button>
              </>
            )}

            <div className="auth-footer-text">
              Already have an account? <Link href="/signin">Sign in</Link>
            </div>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
