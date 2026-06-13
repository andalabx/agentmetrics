{/* ============================================================
    ARCHIVED — removed from WelcomePage.jsx landing page.
    These sections can be restored by pasting them back into
    WelcomePage.jsx between the "How it works" section and the
    "Final CTA" section.
    ============================================================ */}


{/* ── Testimonials ─────────────────────────────────────────── */}
{/*
        <section className="bg-bg py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <Reveal type="stamp">
              <div className="mb-14 text-center">
                <p className="text-[11px] uppercase tracking-[0.2em] text-t2 mb-3">What developers say</p>
                <h2 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl">
                  From the people using it every day.
                </h2>
              </div>
            </Reveal>

            <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
              {[
                { q: "I had no idea one agent was responsible for 60% of our LLM spend. Now I do, and it's fixed.", name: "Sara K.", role: "Staff Engineer" },
                { q: "Caught a runaway agent burning tokens in a retry loop on launch day. Worth it for that alone.", name: "James T.", role: "Backend Engineer" },
                { q: "Our agent was failing silently on 8% of requests. No exceptions, no alerts, just empty responses. AgentMetrics caught it on day one.", name: "Fatima A.", role: "Platform Engineer" },
                { q: "Our summarizer had a 12-second spike on one tool call. Two minutes to find in AgentMetrics. Would have been two days of log diving.", name: "Kenji L.", role: "Senior Engineer" },
                { q: "We run 14 agents across three products. Before this, checking on them meant 14 different places. Now it's one view.", name: "Marcus W.", role: "AI Lead" },
                { q: "It flagged we were using GPT-4 for tasks our cheaper model handled just as well. Saves ~$300/month, found in under a day.", name: "Daniel O.", role: "Head of AI" },
                { q: "The SDK is genuinely three lines of code. I've tried every other monitoring tool. This is the first one that didn't feel like a second job.", name: "Sam D.", role: "Founding Engineer" },
                { q: "We had agents in production we couldn't see into at all. Within an hour of setup, we had run counts, costs, and latency across all of them.", name: "Alex R.", role: "ML Engineer" },
                { q: "Spent three weeks thinking our agent was unreliable. Turned out one upstream API it called was consistently slow. Visible immediately here.", name: "Chris B.", role: "ML Engineer" },
              ].map(({ q, name, role }, i) => {
                const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2);
                return (
                  <Reveal key={name} type="up" delay={i * 40} className="break-inside-avoid">
                    <div className="rounded-2xl border border-[var(--border)] bg-surface px-5 py-5">
                      <p className="text-sm leading-7 text-t1">"{q}"</p>
                      <div className="mt-4 flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-t1 border border-[var(--border)]">
                          {initials}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-t1">{name}</p>
                          <p className="text-[11px] text-t3">{role}</p>
                        </div>
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>
*/}


{/* ── Pricing ───────────────────────────────────────────────── */}
{/*
        <section className="bg-surface py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">

            <Reveal type="stamp">
              <div className="mb-14 text-center">
                <h2 className="text-3xl font-bold tracking-tight text-t1 sm:text-4xl">
                  Start free. Scale when you need to.
                </h2>
                <p className="mt-4 text-lg text-t2">No credit card required.</p>
              </div>
            </Reveal>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {/* Free *\/}
              <Reveal type="up" delay={0}>
              <div className="flex flex-col rounded-[28px] border border-[var(--border)] bg-bg p-5 sm:p-7">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-t2">Free SDK</p>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-4xl font-bold tracking-tight text-t1">$0</span>
                  <span className="mb-1 text-sm text-t2">forever</span>
                </div>
                <p className="mt-2 text-sm text-t2">Open source. MIT-licensed. Your data stays yours.</p>
                <ul className="mt-6 flex flex-col gap-2.5">
                  {["1 tracked agent", "10,000 events/month", "7-day history", "Python and JavaScript SDK", "Community support"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-t2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent"><polyline points="20 6 9 17 4 12"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <a href="https://app.agentmetrics.dev/signup"
                    className="block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-sm font-semibold text-t1 transition-colors hover:bg-[var(--surface-2)]">
                    Get started free
                  </a>
                </div>
              </div>
              </Reveal>

              {/* Growth - highlighted *\/}
              <Reveal type="up" delay={90}>
              <div className="relative flex flex-col rounded-[28px] border-2 border-accent bg-bg p-5 sm:p-7 shadow-[0_0_48px_rgba(0,212,168,0.1)]">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="inline-flex rounded-full bg-accent px-4 py-1.5 text-xs font-bold text-accent-txt">Most Popular</span>
                </div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Growth</p>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-4xl font-bold tracking-tight text-t1">$79</span>
                  <span className="mb-1 text-sm text-t2">/month</span>
                </div>
                <p className="mt-2 text-sm text-t2">Managed cloud. For developers and teams shipping agents.</p>
                <p className="mt-1 text-xs text-t2">Makes sense when agent spend &gt; $500/month.</p>
                <ul className="mt-6 flex flex-col gap-2.5">
                  {["10 tracked agents", "1M events/month", "90-day history", "AI recommendations", "Slack and email alerts", "OpenClaw and Hermes integration", "Team dashboards"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-t2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent"><polyline points="20 6 9 17 4 12"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <a href="https://app.agentmetrics.dev/signup"
                    className="block w-full rounded-lg bg-accent px-4 py-3 text-center text-sm font-bold text-accent-txt transition-opacity hover:opacity-90">
                    Start 14-day free trial
                  </a>
                </div>
              </div>
              </Reveal>

              {/* Pro *\/}
              <Reveal type="up" delay={180}>
              <div className="flex flex-col rounded-[28px] border border-[var(--border)] bg-bg p-5 sm:p-7">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-t2">Pro</p>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-4xl font-bold tracking-tight text-t1">$399</span>
                  <span className="mb-1 text-sm text-t2">/month</span>
                </div>
                <p className="mt-2 text-sm text-t2">For high-volume developers and teams that need unlimited scale.</p>
                <p className="mt-1 text-xs text-t2">Makes sense when agent spend &gt; $1,500/month.</p>
                <ul className="mt-6 flex flex-col gap-2.5">
                  {["Unlimited tracked agents", "Unlimited events", "365-day history", "AI recommendations", "Slack and email alerts", "OpenClaw and Hermes integration", "Team dashboards", "Priority support"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-t2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent"><polyline points="20 6 9 17 4 12"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <a href="https://app.agentmetrics.dev/signup"
                    className="block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-sm font-semibold text-t1 transition-colors hover:bg-[var(--surface-2)]">
                    Start 14-day free trial
                  </a>
                </div>
              </div>
              </Reveal>
            </div>

            {/* Enterprise row *\/}
            <Reveal type="up" delay={60}>
            <div className="mt-5 rounded-[28px] border border-[var(--border)] bg-bg p-7">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-t2">Enterprise</p>
                  <p className="mt-2 text-lg font-bold text-t1">Custom pricing</p>
                  <p className="mt-1 text-sm text-t2">For organizations that need control, compliance, and dedicated support.</p>
                  <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {["Everything in Pro", "SSO and audit logs", "On-premise deployment", "Dedicated support engineer", "SLA guarantees", "Custom data retention", "Volume pricing"].map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-t2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent"><polyline points="20 6 9 17 4 12"/></svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="shrink-0 sm:pt-8">
                  <a href="mailto:support@agentmetrics.dev?subject=Enterprise inquiry"
                    className="inline-block rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm font-semibold text-t1 transition-colors hover:bg-[var(--surface-2)]">
                    Talk to sales
                  </a>
                </div>
              </div>
            </div>
            </Reveal>

          </div>
        </section>
*/}
