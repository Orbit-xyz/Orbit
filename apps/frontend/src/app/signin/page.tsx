"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, signInWithWallet } = useAuth();

  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showWalletInput, setShowWalletInput] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setIsSubmitting(true);

    const res = await signIn(email, password, companyName);
    if (!res.success) {
      setErrorMsg(res.error || "Failed to sign in.");
      setIsSubmitting(false);
      return;
    }

    setSuccessMsg("Welcome back! Redirecting to dashboard...");
    setTimeout(() => {
      router.push("/dashboard");
    }, 800);
  };

  const handleWalletConnect = async () => {
    setErrorMsg("");
    setIsSubmitting(true);

    const win = typeof window !== "undefined" ? (window as any) : null;
    let detectedAddress = "";

    if (win?.ethereum?.selectedAddress) {
      detectedAddress = win.ethereum.selectedAddress;
    } else if (win?.freighterApi?.getPublicKey) {
      try {
        detectedAddress = await win.freighterApi.getPublicKey();
      } catch (err) {
        console.warn("Wallet extension not detected:", err);
      }
    }

    if (!detectedAddress) {
      setShowWalletInput(true);
      setIsSubmitting(false);
      return;
    }

    const res = await signInWithWallet(detectedAddress);
    if (res.success) {
      setSuccessMsg("Wallet connected! Redirecting to dashboard...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    } else {
      setErrorMsg(res.error || "Wallet sign-in failed.");
      setIsSubmitting(false);
    }
  };

  const handleManualWalletSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress || walletAddress.trim().length < 8) {
      setErrorMsg("Please enter a valid wallet address.");
      return;
    }
    setIsSubmitting(true);
    const res = await signInWithWallet(walletAddress.trim());
    if (res.success) {
      setSuccessMsg("Wallet authenticated! Redirecting to dashboard...");
      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    } else {
      setErrorMsg(res.error || "Wallet sign-in failed.");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-container">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="auth-card auth-card-centered"
        >
          <div className="auth-header text-center">
            <h1>Sign in to Orbit</h1>
            <p>Access your merchant control center and vaults.</p>
          </div>

          {errorMsg && <div className="auth-error">{errorMsg}</div>}
          {successMsg && <div className="auth-success">{successMsg}</div>}

          {!showWalletInput ? (
            <form onSubmit={handleSubmit} className="auth-form">
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
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="company">
                  <span>Company or Project Name</span>
                </label>
                <input
                  id="company"
                  type="text"
                  required
                  placeholder="e.g. MailKit Inc., Drips Studio, Acme"
                  className="form-input"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="password">
                  <span>Password</span>
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••••••"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="button button-primary w-full mt-2"
                style={{ width: "100%", height: "46px" }}
              >
                {isSubmitting ? (
                  "Signing in..."
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Sign in to Dashboard <ArrowRight size={15} />
                  </span>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleManualWalletSubmit} className="auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="walletInput">
                  Enter Wallet Address
                </label>
                <input
                  id="walletInput"
                  type="text"
                  required
                  placeholder="0x... or G..."
                  className="form-input font-mono text-xs"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="button button-primary w-full mt-2"
                style={{ width: "100%", height: "46px" }}
              >
                {isSubmitting ? "Authenticating..." : "Sign in with Address"}
              </button>

              <button
                type="button"
                onClick={() => setShowWalletInput(false)}
                className="text-xs text-neutral-500 hover:text-black text-center mt-2 underline"
              >
                Back to Email Sign In
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
            Don&apos;t have an account? <Link href="/get-started">Get started</Link>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
