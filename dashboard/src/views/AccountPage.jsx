import React, { useEffect, useState } from "react";
import { updateMe } from "../api/auth";
import Seo from "../components/Seo";
import AppLayout from "../components/layout/AppLayout";
import { useAuth } from "../context/AuthContext";

function Panel({ eyebrow, title, description, children }) {
  return (
    <section className="rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card sm:p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-t2">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-bold tracking-tight text-t1">{title}</h2>
      {description && <p className="mt-2 max-w-3xl text-sm leading-7 text-t2">{description}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function ProfileTab({ org }) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue]     = useState(org?.company_name || "");
  const [nameSaving, setNameSaving]   = useState(false);
  const [nameError, setNameError]     = useState(null);
  const [displayName, setDisplayName] = useState(null);

  useEffect(() => {
    if (org?.company_name) setNameValue(org.company_name);
  }, [org?.company_name]);

  const shownName = displayName ?? org?.company_name;

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === shownName) { setEditingName(false); return; }
    setNameSaving(true);
    setNameError(null);
    try {
      const { data } = await updateMe({ company_name: trimmed });
      setDisplayName(data.company_name);
      setEditingName(false);
    } catch (err) {
      setNameError(err.response?.data?.detail || "Failed to save");
    } finally {
      setNameSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel eyebrow="Workspace profile" title="Account" description="Your workspace name and admin email.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-t2">Organization</p>
            {editingName ? (
              <div className="mt-2 flex flex-col gap-2">
                <input
                  autoFocus
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                  className="w-full rounded-xl border border-accent/50 bg-surface px-3 py-1.5 text-sm text-t1 focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
                {nameError && <p className="text-xs text-danger">{nameError}</p>}
                <div className="flex gap-2">
                  <button onClick={handleSaveName} disabled={nameSaving} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-txt disabled:opacity-60">
                    {nameSaving ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => { setEditingName(false); setNameValue(shownName || ""); setNameError(null); }} className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-t2">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-t1">{shownName}</p>
                <button
                  onClick={() => setEditingName(true)}
                  className="shrink-0 rounded-lg border border-[var(--border)] p-1 text-t2 transition-colors hover:border-accent/40 hover:text-accent"
                  title="Edit organization name"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-t2">Admin email</p>
            <p className="mt-2 text-sm font-medium text-t1">{org?.email}</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export default function AccountPage() {
  const { org, loading, refreshOrg } = useAuth();

  const seo = <Seo title="Account | AgentMetrics" description="Workspace profile." path="/account" app robots="noindex,nofollow" />;

  if (loading) {
    return (
      <AppLayout>
        {seo}
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card space-y-3">
              <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
              <div className="h-6 w-48 rounded bg-[var(--surface-2)]" />
            </div>
          ))}
        </div>
      </AppLayout>
    );
  }

  if (!org) {
    return (
      <AppLayout>
        {seo}
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          <div className="rounded-[28px] border border-[var(--border)] bg-surface p-10 text-center shadow-card">
            <p className="text-sm text-t2">Could not reach the backend. Please try again.</p>
            <button
              onClick={refreshOrg}
              className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt transition-opacity hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {seo}

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">

        <section className="fade-in-up rounded-[28px] border border-[var(--border)] bg-surface p-6 shadow-card sm:p-7">
          <h1 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl">Account</h1>
          <p className="mt-2 text-sm leading-7 text-t2">
            Workspace profile.
          </p>
        </section>

        <ProfileTab org={org} />
      </div>
    </AppLayout>
  );
}
