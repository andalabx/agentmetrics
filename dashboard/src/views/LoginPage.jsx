import React, { useEffect, useState } from "react";
import { login } from "../api/auth";
import { setToken } from "../lib/auth";
import PasswordInput from "../components/PasswordInput";

export default function LoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("auth_error");
      if (stored) {
        setError(stored);
        sessionStorage.removeItem("auth_error");
      }
    } catch {}
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await login(form.email, form.password);
      setToken(data.access_token);
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      window.location.href = safeNext;
    } catch (err) {
      setError(err?.response?.data?.detail || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--bg-base, #080b10)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border px-8 py-10 space-y-7"
        style={{
          background: "var(--bg-surface, #0e1117)",
          borderColor: "var(--border, #1e2736)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="#6366f1" strokeWidth="2" />
            <circle cx="16" cy="16" r="4" fill="#6366f1" />
            <line x1="16" y1="2" x2="16" y2="7" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
            <line x1="16" y1="25" x2="16" y2="30" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
            <line x1="2" y1="16" x2="7" y2="16" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
            <line x1="25" y1="16" x2="30" y2="16" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span
            className="text-xl font-bold tracking-tight"
            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "var(--text-1, #f0f4f8)" }}
          >
            AgentMetrics
          </span>
        </div>

        <div className="text-center space-y-1">
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "var(--text-1, #f0f4f8)" }}
          >
            Sign in
          </h1>
          <p className="text-sm" style={{ color: "var(--text-2, #8b9ab3)" }}>
            Your self-hosted AgentMetrics instance
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}
            >
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label
              className="block text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-2, #8b9ab3)" }}
            >
              Email
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
              style={{
                background: "var(--bg-elevated, #161b24)",
                border: "1px solid var(--border, #1e2736)",
                color: "var(--text-1, #f0f4f8)",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border, #1e2736)")}
            />
          </div>

          <div className="space-y-1.5">
            <label
              className="block text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--text-2, #8b9ab3)" }}
            >
              Password
            </label>
            <PasswordInput
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "#6366f1", color: "#fff" }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
