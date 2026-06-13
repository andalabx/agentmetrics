import React, { useState } from "react";

export default function PasswordInput({ value, onChange, placeholder = "Password", required = false, minLength, autoFocus, className = "" }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 pr-11 text-t1 placeholder:text-t3 transition-colors focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50 ${className}`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 transition-colors hover:text-t1"
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}
