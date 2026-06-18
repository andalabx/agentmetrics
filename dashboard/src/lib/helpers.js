export function timeSince(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function fmtMs(ms) {
  if (ms == null) return "N/A";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function fmtDur(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function agentDisplayName(agentId, namesMap) {
  if (namesMap && namesMap[agentId]) return namesMap[agentId];
  if (agentId === "main") return "OpenClaw (main)";
  return agentId;
}

export function healthOf(successRate) {
  if (successRate >= 95) return "healthy";
  if (successRate >= 80) return "degraded";
  return "critical";
}

export function latencyColor(ms) {
  if (ms == null) return "text-t2";
  if (ms < 500) return "text-savings";
  if (ms < 2000) return "text-accent";
  if (ms < 5000) return "text-cost";
  return "text-danger";
}

export function fmtModel(model) {
  if (!model) return "-";
  // Strip provider prefix (e.g. "claude-", "gpt-") and date suffixes (e.g. "-20241022")
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/^(anthropic|openai|google|meta|mistral|cohere|deepseek)\./, "");
}
