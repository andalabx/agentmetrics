import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

const ACCENT = "#6366f1";

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "12px",
      padding: "8px 12px",
      fontSize: "12px",
    }}>
      <p style={{ color: "var(--text-3)", marginBottom: 4 }}>{label}</p>
      <p style={{ color: ACCENT, fontWeight: 600 }}>${payload[0].value?.toFixed(6)}</p>
      {payload[1]?.value != null && (
        <p style={{ color: "var(--text-2)" }}>{payload[1].value} runs</p>
      )}
    </div>
  );
}

export default function CostChart({ data }) {
  if (!data?.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-t3">
        No data for this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={ACCENT} stopOpacity={0.2} />
            <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--text-3)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.slice(5)}
        />
        <YAxis
          tick={{ fill: "var(--text-3)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${v.toFixed(3)}`}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="cost"
          stroke={ACCENT}
          strokeWidth={2}
          fill="url(#costGradient)"
        />
        <Area
          type="monotone"
          dataKey="calls"
          stroke="var(--text-3)"
          strokeWidth={1}
          fill="none"
          strokeDasharray="4 2"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
