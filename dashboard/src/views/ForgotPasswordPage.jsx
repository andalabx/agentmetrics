import React from "react";
import { Link } from "react-router-dom";
import { SITE_URL } from "../lib/config";
import Logo from "../components/Logo";
import Seo from "../components/Seo";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Seo
        title="Forgot password | AgentMetrics"
        path="/forgot-password"
        app
        robots="noindex,nofollow"
      />
      <div className="glass-panel fade-in-up w-full max-w-md rounded-[32px] px-8 py-10 text-center space-y-6">
        <a href={SITE_URL}><Logo markSize={36} showWordmark wordmarkColor="var(--text-1)" /></a>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-t1">Password reset</h2>
          <p className="mt-3 text-sm text-t2">
            Password reset via email is not available in self-hosted mode.
            <br />
            To reset your password, update it directly in the database or re-create your account.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-opacity hover:opacity-80"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
