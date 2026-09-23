"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function SignInPage() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

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

          <div className="auth-footer-text">
            Don&apos;t have an account? <Link href="/get-started">Get started</Link>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
