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

export function hashToolName(name: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h ^ name.charCodeAt(i), 0x01000193)) >>> 0;
  }
  return `t_${h.toString(16).padStart(8, "0")}`;
}
