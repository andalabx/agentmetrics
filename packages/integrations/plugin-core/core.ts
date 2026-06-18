/**
 * Shared utilities for AgentMetrics integration plugins.
 * Pure functions and constants with no runtime state.
 */

/** FNV-1a 32-bit hash → stable 8-char hex pseudonym for a tool name. */
export function hashName(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h ^ name.charCodeAt(i), 0x01000193)) >>> 0;
  }
  return `t_${h.toString(16).padStart(8, "0")}`;
}

export const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9\-_]{20,}/g,
  /am_[A-Za-z0-9\-_]{16,}/g,
  /\bey[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/g,
  /(?:api[_\-]?key|apikey|api[_\-]?token|access[_\-]?token|secret|password|passwd|auth)[=:\s"']+([^\s"'&,\]}\n]{8,})/gi,
];

export function scrubSecrets(str: string): string {
  let out = str;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

// Rates in USD per million tokens (input / output / cacheRead / cacheWrite).
// Populated from Anthropic public pricing page + common model providers.
// Unmapped models return undefined - dashboard shows "n/a" rather than wrong data.
export const PRICING: Record<string, [number, number, number?, number?]> = {
  // Claude 4
  "claude-opus-4-7":               [15.0,  75.0,  1.50,  18.75],
  "claude-opus-4-5":               [15.0,  75.0,  1.50,  18.75],
  "claude-opus-4":                 [15.0,  75.0,  1.50,  18.75],
  "claude-sonnet-4-6":             [ 3.0,  15.0,  0.30,   3.75],
  "claude-sonnet-4-5":             [ 3.0,  15.0,  0.30,   3.75],
  "claude-haiku-4-5":              [ 0.8,   4.0,  0.08,   1.00],
  // Claude 3.7 / 3.5
  "claude-sonnet-3-7":             [ 3.0,  15.0,  0.30,   3.75],
  "claude-3-5-sonnet-20241022":    [ 3.0,  15.0,  0.30,   3.75],
  "claude-3-5-sonnet-20240620":    [ 3.0,  15.0,  0.30,   3.75],
  "claude-3-5-haiku-20241022":     [ 0.8,   4.0,  0.08,   1.00],
  // Claude 3
  "claude-3-opus-20240229":        [15.0,  75.0,  1.50,  18.75],
  "claude-3-sonnet-20240229":      [ 3.0,  15.0],
  "claude-3-haiku-20240307":       [ 0.25,  1.25, 0.03,   0.30],
  // GPT-4o family
  "gpt-4o":                        [ 2.5,  10.0],
  "gpt-4o-mini":                   [ 0.15,  0.60],
  "gpt-4-turbo":                   [10.0,  30.0],
  "gpt-4":                         [30.0,  60.0],
  "gpt-3.5-turbo":                 [ 0.50,  1.50],
  // Gemini
  "gemini-2.0-flash":              [ 0.075, 0.30],
  "gemini-2.5-pro":                [ 1.25, 10.0],
  "gemini-1.5-pro":                [ 1.25,  5.0],
  "gemini-1.5-flash":              [ 0.075, 0.30],
};
