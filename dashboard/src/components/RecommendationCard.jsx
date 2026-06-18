const ICONS = {
  model_switch: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  caching: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
    </svg>
  ),
  error_fix: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  cost_spike: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
};

const TYPE_CONFIG = {
  model_switch: { iconClass: "text-accent", borderClass: "border-accent/20 bg-[var(--accent-bg)]" },
  caching:      { iconClass: "text-savings", borderClass: "border-savings/20 bg-savings/10"        },
  error_fix:    { iconClass: "text-danger",  borderClass: "border-danger/20 bg-danger/10"          },
  cost_spike:   { iconClass: "text-cost",    borderClass: "border-cost/20 bg-cost/10"              },
};

export default function RecommendationCard({ rec }) {
  const config = TYPE_CONFIG[rec.type] || TYPE_CONFIG.model_switch;
  const icon   = ICONS[rec.type] || ICONS.model_switch;

  return (
    <div className={`rounded-2xl border px-5 py-4 ${config.borderClass}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 shrink-0 ${config.iconClass}`}>{icon}</span>
          <div>
            <p className="text-sm font-semibold text-t1">{rec.title}</p>
            <p className="mt-1 text-xs leading-6 text-t2">{rec.description}</p>
            {rec.agent_id && (
              <p className="mt-2 text-xs text-t3">
                Agent: <span className="font-mono text-t2">{rec.agent_id}</span>
              </p>
            )}
          </div>
        </div>
        {rec.estimated_savings_usd > 0 && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-t3">Projected savings</p>
            <p className="text-sm font-bold text-savings">${rec.estimated_savings_usd.toFixed(2)}/mo</p>
          </div>
        )}
      </div>
    </div>
  );
}
