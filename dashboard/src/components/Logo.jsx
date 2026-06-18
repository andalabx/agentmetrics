export default function Logo({ markSize = 32, showWordmark = false, wordmarkColor, mono = false, className = "" }) {
  const wordColor = mono ? "var(--text-1)" : (wordmarkColor || "var(--text-1)");
  const accentColor = mono ? "var(--text-1)" : (wordmarkColor || null);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label="AgentMetrics"
        className="text-accent"
      >
        {/* Outer ring - the observation layer watching the agent */}
        <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.5" />

        {/* Inner diamond - the AI agent being monitored (square rotated 45°) */}
        <rect
          x="7.8" y="7.8" width="8.4" height="8.4" rx="1.2"
          stroke="currentColor" strokeWidth="1.5"
          transform="rotate(45 12 12)"
        />
      </svg>

      {showWordmark && (
        <span
          style={{ fontSize: markSize * 0.5, lineHeight: 1, color: wordColor }}
          className="font-bold tracking-tight select-none"
        >
          Agent
          <span style={{ color: accentColor || undefined }} className={accentColor ? "" : "text-accent"}>
            Metrics
          </span>
        </span>
      )}
    </div>
  );
}
