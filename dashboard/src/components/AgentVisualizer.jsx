import React, { useEffect, useRef, useState } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function polarToCart(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function formatTokens(n) {
  if (!n) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PulseRing({ cx, cy, r, color, delay = 0, duration = 2 }) {
  return (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="1.5"
      style={{
        animation: `vizPulse ${duration}s ease-out ${delay}s infinite`,
        opacity: 0,
        transformOrigin: `${cx}px ${cy}px`,
      }}
    />
  );
}

function ConnectionLine({ x1, y1, x2, y2, color = "#6366f1", animated = false, progress = 1 }) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={color} strokeWidth="1.5" strokeOpacity={0.5}
      strokeDasharray={animated ? "6 4" : undefined}
      style={animated ? { animation: "vizDash 1s linear infinite" } : undefined}
    />
  );
}

function ToolNode({ cx, cy, name, state, index }) {
  // state: 'active' | 'done' | 'error'
  const color  = state === "error" ? "#EF4444" : state === "active" ? "#F59E0B" : "#4B6B63";
  const glow   = state === "active" ? "#F59E0B44" : "transparent";
  const short  = name.length > 10 ? name.slice(0, 9) + "…" : name;
  return (
    <g style={{ animation: "vizFadeIn 0.3s ease-out forwards" }}>
      <circle cx={cx} cy={cy} r={22} fill={glow} />
      <circle cx={cx} cy={cy} r={18} fill="var(--surface)" stroke={color} strokeWidth="1.5" />
      {state === "active" && <PulseRing cx={cx} cy={cy} r={22} color={color} duration={1} />}
      <rect x={cx - 5} y={cy - 6} width="10" height="10" rx="2" fill="none" stroke={color} strokeWidth="1.5" />
      <text x={cx} y={cy + 32} textAnchor="middle" fontSize="9" fill="var(--text-2)">{short}</text>
    </g>
  );
}

function SubagentNode({ cx, cy, agentId, outcome }) {
  const color = outcome === "error" ? "#EF4444" : outcome === "ok" ? "#10B981" : "#6366f1";
  const short = agentId ? (agentId.length > 10 ? agentId.slice(0, 9) + "…" : agentId) : "subagent";
  return (
    <g style={{ animation: "vizFadeIn 0.4s ease-out forwards" }}>
      <circle cx={cx} cy={cy} r={20} fill="var(--surface)" stroke={color} strokeWidth="1.5" strokeDasharray="4 2" />
      {!outcome && <PulseRing cx={cx} cy={cy} r={24} color={color} duration={1.5} />}
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fill={color}>agent</text>
      <text x={cx} y={cy + 34} textAnchor="middle" fontSize="9" fill="var(--text-2)">{short}</text>
    </g>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgentVisualizer({ agentId, recentEvents = [], stats = {} }) {
  // Derived visual state from events
  const [vizState, setVizState] = useState("idle"); // idle | thinking | tool | subagent | done
  const [activeTools,    setActiveTools]    = useState([]); // [{ name, state, id }]
  const [activeSubagents, setActiveSubagents] = useState([]); // [{ agentId, outcome }]
  const [lastModel, setLastModel] = useState(null);
  const toolIdRef = useRef(0);

  // Derive visual state from the most recent events
  useEffect(() => {
    if (!recentEvents.length) return;
    const last = recentEvents[recentEvents.length - 1];
    const type = last?.type;

    if (type === "llm_start") {
      setVizState("thinking");
      if (last.data?.model) setLastModel(last.data.model);
    } else if (type === "llm_end") {
      setVizState("idle");
    } else if (type === "tool_start") {
      setVizState("tool");
      setActiveTools(prev => {
        const id = ++toolIdRef.current;
        const next = [...prev.filter(t => t.state !== "done").slice(-4), {
          id, name: last.data?.tool_name ?? "tool", state: "active",
        }];
        return next;
      });
    } else if (type === "tool_end") {
      setActiveTools(prev => prev.map(t =>
        t.state === "active" && t.name === (last.data?.tool_name ?? t.name)
          ? { ...t, state: last.data?.error ? "error" : "done" }
          : t
      ));
      setVizState("idle");
    } else if (type === "subagent_start") {
      setVizState("subagent");
      setActiveSubagents(prev => [
        ...prev.slice(-3),
        { agentId: last.data?.child_agent_id ?? "subagent", outcome: null },
      ]);
    } else if (type === "subagent_end") {
      setActiveSubagents(prev => prev.map((s, i) =>
        i === prev.length - 1 ? { ...s, outcome: last.data?.outcome ?? "ok" } : s
      ));
      setVizState("idle");
    } else if (type === "run_end") {
      setVizState(last.data?.status === "failed" ? "error" : "done");
      // Reset after a short flash
      setTimeout(() => {
        setVizState("idle");
        setActiveTools([]);
        setActiveSubagents([]);
      }, 2500);
    } else if (type === "run_start") {
      setVizState("idle");
      setActiveTools([]);
      setActiveSubagents([]);
    }
  }, [recentEvents]);

  // ── Layout constants ────────────────────────────────────────────────────────
  const W  = 560;
  const H  = 380;
  const cx = 200; // agent center x
  const cy = H / 2;

  // Agent glow color based on state
  const agentColor =
    vizState === "thinking" ? "#6366f1" :
    vizState === "tool"     ? "#F59E0B" :
    vizState === "subagent" ? "#A78BFA" :
    vizState === "done"     ? "#10B981" :
    vizState === "error"    ? "#EF4444" :
    "#6366f1";

  const agentGlowOpacity = vizState === "idle" ? 0.08 : 0.2;

  // Tool node positions - fan out to the right
  const toolPositions = activeTools.map((_, i) => {
    const total  = Math.max(activeTools.length, 1);
    const spread = Math.min(total * 50, 200);
    const step   = total > 1 ? spread / (total - 1) : 0;
    const startY = cy - (total - 1) * step / 2;
    return { x: cx + 160, y: startY + i * step };
  });

  // Subagent positions - fan below-right
  const subagentPositions = activeSubagents.map((_, i) => {
    const total  = Math.max(activeSubagents.length, 1);
    const spread = Math.min(total * 60, 180);
    const step   = total > 1 ? spread / (total - 1) : 0;
    const startX = cx - (total - 1) * step / 2;
    return { x: startX + i * step, y: cy + 120 };
  });

  const thinkingAngle = useRef(0);
  const rafRef = useRef(null);
  const [orbitAngle, setOrbitAngle] = useState(0);

  useEffect(() => {
    if (vizState !== "thinking") {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const animate = () => {
      thinkingAngle.current = (thinkingAngle.current + 2) % 360;
      setOrbitAngle(thinkingAngle.current);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [vizState]);

  const orbitDots = [0, 120, 240].map(offset => {
    const pos = polarToCart(cx, cy, 58, orbitAngle + offset);
    return pos;
  });

  return (
    <div className="relative w-full h-full flex items-center justify-center select-none">
      <style>{`
        @keyframes vizPulse {
          0%   { opacity: 0.6; r: var(--r0); }
          100% { opacity: 0; r: var(--r1); }
        }
        @keyframes vizPulse {
          0%   { opacity: 0.7; transform: scale(1); }
          100% { opacity: 0;   transform: scale(1.8); }
        }
        @keyframes vizDash {
          to { stroke-dashoffset: -20; }
        }
        @keyframes vizFadeIn {
          from { opacity: 0; transform: scale(0.7); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes vizSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes vizFlash {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
      `}</style>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-[560px]"
        style={{ overflow: "visible" }}
      >
        {/* ── Background dot grid ───────────────────────────────────────── */}
        <defs>
          <pattern id="vizGrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--border)" />
          </pattern>
          <radialGradient id="agentGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={agentColor} stopOpacity={agentGlowOpacity * 3} />
            <stop offset="100%" stopColor={agentColor} stopOpacity="0" />
          </radialGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect width={W} height={H} fill="url(#vizGrid)" opacity="0.4" rx="16" />

        {/* ── Connections: agent → tools ────────────────────────────────── */}
        {activeTools.map((tool, i) => (
          <ConnectionLine key={tool.id}
            x1={cx + 44} y1={cy}
            x2={toolPositions[i].x - 18} y2={toolPositions[i].y}
            color={tool.state === "error" ? "#EF4444" : tool.state === "active" ? "#F59E0B" : "#4B6B6344"}
            animated={tool.state === "active"}
          />
        ))}

        {/* ── Connections: agent → subagents ───────────────────────────── */}
        {activeSubagents.map((sub, i) => (
          <ConnectionLine key={i}
            x1={cx} y1={cy + 44}
            x2={subagentPositions[i].x} y2={subagentPositions[i].y - 20}
            color="#A78BFA88"
            animated={!sub.outcome}
          />
        ))}

        {/* ── Agent glow circle ─────────────────────────────────────────── */}
        <circle cx={cx} cy={cy} r={90} fill="url(#agentGlow)" />

        {/* ── Pulse rings (always present, faster when active) ──────────── */}
        <PulseRing cx={cx} cy={cy} r={48} color={agentColor}
          delay={0} duration={vizState === "idle" ? 3 : 1.5} />
        <PulseRing cx={cx} cy={cy} r={48} color={agentColor}
          delay={vizState === "idle" ? 1 : 0.5} duration={vizState === "idle" ? 3 : 1.5} />

        {/* ── Thinking orbit dots ───────────────────────────────────────── */}
        {vizState === "thinking" && orbitDots.map((dot, i) => (
          <circle key={i} cx={dot.x} cy={dot.y} r={4}
            fill={agentColor} opacity={0.9 - i * 0.25}
            filter="url(#glow)"
          />
        ))}

        {/* ── Agent center node ─────────────────────────────────────────── */}
        <circle cx={cx} cy={cy} r={44}
          fill="var(--surface)"
          stroke={agentColor} strokeWidth="2"
          filter={vizState !== "idle" ? "url(#glow)" : undefined}
          style={vizState === "thinking" ? { animation: "vizFlash 1s ease-in-out infinite" } : undefined}
        />
        {/* Inner ring */}
        <circle cx={cx} cy={cy} r={36} fill="none" stroke={agentColor} strokeWidth="0.5" strokeOpacity="0.3" />

        {/* Agent icon - aperture / initials */}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="20"
          fill={agentColor} fontFamily="monospace" fontWeight="700">
          {agentId ? agentId.slice(0, 2).toUpperCase() : "AG"}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9"
          fill="var(--text-2)" fontFamily="monospace" letterSpacing="2">
          {vizState === "thinking" ? "THINKING" :
           vizState === "tool"     ? "TOOL CALL" :
           vizState === "subagent" ? "SUBAGENT" :
           vizState === "done"     ? "COMPLETE" :
           vizState === "error"    ? "FAILED" : "IDLE"}
        </text>

        {/* ── Tool nodes ────────────────────────────────────────────────── */}
        {activeTools.map((tool, i) => (
          <ToolNode key={tool.id}
            cx={toolPositions[i].x} cy={toolPositions[i].y}
            name={tool.name} state={tool.state} index={i}
          />
        ))}

        {/* ── Subagent nodes ────────────────────────────────────────────── */}
        {activeSubagents.map((sub, i) => (
          <SubagentNode key={i}
            cx={subagentPositions[i].x} cy={subagentPositions[i].y}
            agentId={sub.agentId} outcome={sub.outcome}
          />
        ))}

        {/* ── Stats bar (bottom) ────────────────────────────────────────── */}
        <g transform={`translate(${W / 2 - 160}, ${H - 32})`}>
          {[
            { label: "tokens", value: formatTokens((stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)) },
            { label: "tools",  value: stats.toolCalls ?? 0 },
            { label: "llm",    value: stats.llmCalls  ?? 0 },
          ].map(({ label, value }, i) => (
            <g key={label} transform={`translate(${i * 120}, 0)`}>
              <text textAnchor="middle" fontSize="16" fill="var(--text-1)" fontWeight="600" fontFamily="monospace">
                {value}
              </text>
              <text y="14" textAnchor="middle" fontSize="9" fill="var(--text-3)" letterSpacing="1.5">
                {label.toUpperCase()}
              </text>
            </g>
          ))}
        </g>

        {/* ── Model badge (top right) ───────────────────────────────────── */}
        {lastModel && (
          <g transform={`translate(${W - 12}, 16)`}>
            <text textAnchor="end" fontSize="10" fill="var(--text-2)" fontFamily="monospace">
              {lastModel}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
