import React, { useEffect, useState } from "react";
import { getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, getAlertHistory } from "../api/alerts";
import { getMe, updateSettings } from "../api/auth";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";

const METRIC_CONFIG = {
  error_rate:  {
    label: "Error rate",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    color: "danger",
    bg: "bg-danger/10 border-danger/25",
    iconBg: "bg-danger/10 text-danger",
    fmt: (v) => `${(v * 100).toFixed(0)}%`,
    hint: "Fraction 0–1, e.g. 0.1 = 10% of runs failing",
  },
  cost_usd:    {
    label: "Cost per hour",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
      </svg>
    ),
    color: "cost",
    bg: "bg-cost/10 border-cost/25",
    iconBg: "bg-cost/10 text-cost",
    fmt: (v) => `$${Number(v).toFixed(2)}`,
    hint: "Total USD spend within the window",
  },
  duration_ms: {
    label: "Latency p95",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "accent",
    bg: "bg-accent/10 border-accent/25",
    iconBg: "bg-[var(--accent-bg)] text-accent",
    fmt: (v) => `${Number(v).toLocaleString()} ms`,
    hint: "95th-percentile response time in milliseconds",
  },
  run_count:   {
    label: "Run count",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    color: "t2",
    bg: "border-[var(--border)] bg-[var(--surface-2)]",
    iconBg: "bg-[var(--surface-2)] text-t2",
    fmt: (v) => Number(v).toLocaleString(),
    hint: "Total runs within the window",
  },
  loop_count:  {
    label: "Loop / retries",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    ),
    color: "cost",
    bg: "bg-cost/10 border-cost/25",
    iconBg: "bg-cost/10 text-cost",
    fmt: (v) => Number(v).toLocaleString(),
    hint: "Total loop/retry iterations within the window",
  },
};

const METRICS  = Object.entries(METRIC_CONFIG).map(([value, c]) => ({ value, label: c.label, hint: c.hint }));
const OPERATORS = [
  { value: "gt",  label: "greater than ( > )"  },
  { value: "gte", label: "at least ( ≥ )"       },
  { value: "lt",  label: "less than ( < )"      },
  { value: "lte", label: "at most ( ≤ )"        },
];
const OP_SYMBOL = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

const EMPTY_FORM = { name: "", metric: "error_rate", operator: "gt", threshold: "", window_minutes: 60, notify_email: true };

function fmtValue(metric, value) {
  if (value == null) return "-";
  return METRIC_CONFIG[metric]?.fmt(value) ?? Number(value).toLocaleString();
}

function timeSince(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function RuleCard({ rule, onToggle, onDelete, onThresholdSave }) {
  const cfg = METRIC_CONFIG[rule.metric] ?? METRIC_CONFIG.run_count;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(rule.threshold));
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try { await onToggle(rule.id, !rule.enabled); } finally { setToggling(false); }
  };

  const handleSave = async () => {
    const val = parseFloat(draft);
    if (isNaN(val)) return;
    setSaving(true);
    try {
      await onThresholdSave(rule.id, val);
      setEditing(false);
    } finally { setSaving(false); }
  };

  return (
    <div className={`fade-in-up rounded-[28px] border bg-surface p-5 shadow-card transition-all sm:p-6 ${rule.enabled ? cfg.bg : "border-[var(--border)] opacity-50"}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${cfg.bg} ${cfg.iconBg}`}>
          {cfg.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${rule.enabled ? "border-savings/30 bg-savings/10 text-savings" : "border-t3/30 bg-[var(--surface-2)] text-t2"}`}>
              {rule.enabled ? "Active" : "Paused"}
            </span>
          </div>

          <p className="mt-2 text-sm font-semibold text-t1">{rule.name}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs text-t2">{cfg.label}</span>
            <span className="text-xs text-t2">{OP_SYMBOL[rule.operator] ?? rule.operator}</span>

            {editing ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="number"
                  step="any"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setDraft(String(rule.threshold)); } }}
                  className="w-24 rounded-lg border border-accent/50 bg-surface px-2 py-0.5 text-xs text-t1 focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
                <button onClick={handleSave} disabled={saving} className="rounded-lg bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-txt disabled:opacity-60">
                  {saving ? "…" : "Save"}
                </button>
                <button onClick={() => { setEditing(false); setDraft(String(rule.threshold)); }} className="text-[10px] text-t2">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-0.5 text-xs font-medium text-t1 transition-colors hover:border-accent/40 hover:text-accent"
              >
                {cfg.fmt(rule.threshold)}
                <svg className="h-3 w-3 text-t2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
              </button>
            )}

            <span className="text-xs text-t2">in {rule.window_minutes}m window</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={rule.enabled ? "Pause this rule" : "Enable this rule"}
            className={`relative inline-flex h-5 w-9 cursor-pointer rounded-full border-2 transition-colors duration-200 disabled:opacity-50 ${rule.enabled ? "border-savings bg-savings/20" : "border-[var(--border)] bg-[var(--surface-2)]"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 translate-y-[-1px] rounded-full shadow transition-transform duration-200 ${rule.enabled ? "translate-x-[14px] bg-savings" : "translate-x-0 bg-t2"}`} />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setConfirmDelete(false); onDelete(rule.id); }}
                className="rounded-lg bg-danger/10 px-2 py-1 text-[10px] font-semibold text-danger transition-colors hover:bg-danger/20"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-2 py-1 text-[10px] text-t2 hover:text-t1"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete rule"
              className="rounded-lg p-1 text-t2 transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ event }) {
  const cfg = METRIC_CONFIG[event.metric] ?? METRIC_CONFIG.run_count;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-danger/15 bg-danger/[0.03] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${cfg.iconBg}`}>
          {cfg.icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-t1 truncate">{event.rule_name || "Unnamed rule"}</p>
          <p className="mt-0.5 text-xs text-t2">
            {cfg.label} {OP_SYMBOL[event.operator] ?? event.operator} {fmtValue(event.metric, event.threshold)}
            {event.agent_id && <span className="ml-2 opacity-70">· {event.agent_id}</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-5 shrink-0">
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] text-t2">Actual</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-danger">{fmtValue(event.metric, event.value)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] text-t2">{event.notified ? "Notified" : "Fired"}</p>
          <p className="mt-0.5 text-xs text-t2">{timeSince(event.fired_at)}</p>
        </div>
        {event.notified && (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-savings/30 bg-savings/10">
            <svg className="h-3.5 w-3.5 text-savings" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

function SlackWebhookPanel() {
  const [webhook, setWebhook] = useState("");
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getMe().then((res) => {
      const url = res?.data?.slack_webhook ?? "";
      setWebhook(url);
      setSaved(url || null);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const handleSave = async (valueOverride) => {
    const value = valueOverride !== undefined ? valueOverride : webhook;
    setSaving(true);
    try {
      await updateSettings({ slack_webhook: value });
      setSaved(value || null);
      if (valueOverride !== undefined) setWebhook(value);
    } catch {}
    finally { setSaving(false); }
  };

  if (!loaded) return null;

  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#4A154B]/10 border border-[#4A154B]/20">
          <svg className="h-5 w-5 text-[#6B24B2]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-t1">Slack notifications</p>
          <p className="text-xs text-t2">
            {saved ? "Connected. Alerts will fire to your Slack channel." : "Paste a Slack Incoming Webhook URL to receive alerts in Slack."}
          </p>
        </div>
        {saved && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-savings/25 bg-savings/10 px-3 py-1 text-[11px] font-semibold text-savings">
            <span className="h-1.5 w-1.5 rounded-full bg-savings" />
            Connected
          </span>
        )}
      </div>
      <div className="flex gap-3">
        <input
          type="url"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          placeholder="https://hooks.slack.com/services/T.../B.../..."
          className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 font-mono text-xs text-t1 placeholder:text-t2 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving..." : saved ? "Update" : "Save"}
        </button>
        {saved && (
          <button
            onClick={() => handleSave("")}
            className="shrink-0 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-t2 transition-colors hover:text-danger"
          >
            Remove
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-t2">
        Create a webhook at <span className="font-mono text-accent">api.slack.com/apps</span> under "Incoming Webhooks". All enabled alert rules will post to this channel.
      </p>
    </section>
  );
}

export default function AlertsPage() {
  const [rules, setRules]         = useState([]);
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState(null);

  const load = async () => {
    try {
      const [rulesRes, histRes] = await Promise.allSettled([getAlertRules(), getAlertHistory()]);
      if (rulesRes.status === "fulfilled") setRules(rulesRes.value.data);
      if (histRes.status  === "fulfilled") setHistory(histRes.value.data);
      setError(null);
    } catch (err) {
      if (err?.response?.status !== 404) {
        setError("Failed to load alert rules");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.threshold || isNaN(Number(form.threshold))) {
      setFormError("Threshold must be a number.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const { data } = await createAlertRule({ ...form, threshold: Number(form.threshold), window_minutes: Number(form.window_minutes) });
      setRules((prev) => [...prev, data]);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch {
      setFormError("Failed to create rule. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id, enabled) => {
    await updateAlertRule(id, { enabled });
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled } : r));
  };

  const handleThresholdSave = async (id, threshold) => {
    await updateAlertRule(id, { threshold });
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, threshold } : r));
  };

  const handleDelete = async (id) => {
    try {
      await deleteAlertRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Failed to delete rule. Please try again.");
    }
  };

  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <AppLayout>
      <Seo
        title="Alerts | AgentMetrics"
        description="Real-time alert monitoring for your AI agents."
        path="/alerts"
        app
        robots="noindex,nofollow"
      />

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">

        {/* Header */}
        <section className="rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl">Alert protection</h1>
              <p className="mt-2 text-sm leading-7 text-t2">
                {loading ? "Loading rules…" : (
                  activeCount > 0
                    ? `${activeCount} rule${activeCount !== 1 ? "s" : ""} actively monitoring your agents. Email alerts sent via AgentMetrics.`
                    : "No active rules. Enable a rule below to start getting notified."
                )}
              </p>
            </div>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-2.5 text-sm font-semibold text-t1 transition-colors hover:bg-surface"
            >
              {showForm ? "Cancel" : "+ Custom rule"}
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">{error}</div>
        )}

        {/* Slack integration */}
        <SlackWebhookPanel />

        {/* Rules grid */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-[var(--surface-2)]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-16 rounded bg-[var(--surface-2)]" />
                    <div className="h-4 w-32 rounded bg-[var(--surface-2)]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-[28px] border border-[var(--border)] bg-surface p-10 text-center shadow-card">
            <p className="text-t2">No alert rules yet.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rules.map((rule, i) => (
              <div key={rule.id} className="fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
                <RuleCard
                  rule={rule}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onThresholdSave={handleThresholdSave}
                />
              </div>
            ))}
          </div>
        )}

        {/* Alert history */}
        {!loading && history.length > 0 && (
          <section className="rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card sm:p-7">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-danger">Recent firings</p>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-t1">Alert history</h2>
              </div>
              <span className="rounded-full border border-danger/25 bg-danger/10 px-3 py-1 text-xs font-bold text-danger">
                {history.length}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {history.map((event) => (
                <HistoryRow key={event.id} event={event} />
              ))}
            </div>
          </section>
        )}

        {/* Custom rule form */}
        {showForm && (
          <section className="rounded-[28px] border border-accent/25 bg-surface p-6 shadow-card sm:p-7">
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-accent">New custom rule</p>
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Rule name</label>
                <input
                  type="text" required value={form.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder="e.g. Weekend cost spike"
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-t1 placeholder:text-t2 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Metric</label>
                <select value={form.metric} onChange={(e) => field("metric", e.target.value)}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-t1 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50">
                  {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {form.metric && <p className="mt-1.5 text-[10px] text-t2">{METRICS.find((m) => m.value === form.metric)?.hint}</p>}
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Condition</label>
                <select value={form.operator} onChange={(e) => field("operator", e.target.value)}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-t1 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50">
                  {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Threshold</label>
                <input type="number" step="any" required value={form.threshold}
                  onChange={(e) => field("threshold", e.target.value)}
                  placeholder={METRIC_CONFIG[form.metric]?.hint?.split(",")[0] || ""}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-t1 placeholder:text-t2 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-t2">Window (minutes)</label>
                <input type="number" min="5" required value={form.window_minutes}
                  onChange={(e) => field("window_minutes", e.target.value)}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-t1 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
              </div>
              <div className="flex items-center gap-3">
                <input id="notify-email" type="checkbox" checked={form.notify_email}
                  onChange={(e) => field("notify_email", e.target.checked)}
                  className="h-4 w-4 rounded accent-accent cursor-pointer"
                />
                <label htmlFor="notify-email" className="text-sm text-t2 cursor-pointer select-none">Email notification</label>
              </div>
              {formError && (
                <div className="sm:col-span-2 lg:col-span-3 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{formError}</div>
              )}
              <div className="sm:col-span-2 lg:col-span-3">
                <button type="submit" disabled={saving}
                  className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90 disabled:opacity-50">
                  {saving ? "Creating…" : "Create rule"}
                </button>
              </div>
            </form>
          </section>
        )}


      </div>
    </AppLayout>
  );
}
