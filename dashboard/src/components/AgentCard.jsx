import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";

function StatusBadge({ rate }) {
  const color = rate >= 90
    ? "text-savings border-savings/25 bg-savings/10"
    : rate >= 70
      ? "text-cost border-cost/25 bg-cost/10"
      : "text-danger border-danger/25 bg-danger/10";
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${color}`}>
      {rate.toFixed(1)}%
    </span>
  );
}

StatusBadge.propTypes = {
  rate: PropTypes.number.isRequired,
};

function Stat({ label, value, valueClass = "text-t1" }) {
  return (
    <div>
      <p className="text-xs text-t3">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

Stat.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  valueClass: PropTypes.string,
};

export default function AgentCard({ agent }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/agents/${encodeURIComponent(agent.agent_id)}`)}
      className="cursor-pointer rounded-[28px] border border-[var(--border)] bg-surface p-5 shadow-card transition-colors hover:border-accent/30 hover:bg-[var(--surface-2)]"
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-semibold text-t1">
            {agent.agent_id}
          </h3>
          <p className="mt-0.5 text-xs text-t3">
            {agent.last_seen ? `Last seen ${new Date(agent.last_seen).toLocaleString()}` : "No recent signal"}
          </p>
        </div>
        <StatusBadge rate={agent.success_rate} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <Stat label="Total cost"  value={`$${agent.total_cost.toFixed(4)}`}  valueClass="text-cost" />
        <Stat label="Cost / run"  value={`$${agent.avg_cost.toFixed(4)}`}    valueClass="text-cost" />
        <Stat label="Total runs"  value={agent.total_calls.toLocaleString()} valueClass="text-accent" />
        <Stat label="Failed"      value={agent.failed.toLocaleString()}      valueClass={agent.failed > 0 ? "text-danger" : "text-t1"} />
      </div>
    </div>
  );
}

AgentCard.propTypes = {
  agent: PropTypes.shape({
    agent_id: PropTypes.string.isRequired,
    success_rate: PropTypes.number.isRequired,
    total_cost: PropTypes.number.isRequired,
    avg_cost: PropTypes.number.isRequired,
    total_calls: PropTypes.number.isRequired,
    failed: PropTypes.number.isRequired,
    last_seen: PropTypes.string,
  }).isRequired,
};
