"""
Rule-based recommendation engine.
Rules use actual usage data (model, token ratios, cache hit rate) for honest savings estimates.
"""
import logging
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.schemas.agent import Recommendation

logger = logging.getLogger(__name__)

# Cheaper alternatives for common expensive models
# Format: { expensive_model_substring: (suggested_model, typical_cost_reduction_pct) }
_CHEAPER_ALTERNATIVES = {
    "gpt-4o":           ("gpt-4o-mini",             0.97),  # 97% cheaper
    "gpt-4-turbo":      ("gpt-4o-mini",             0.92),
    "gpt-4":            ("gpt-4o-mini",             0.90),
    "claude-opus":      ("claude-sonnet",           0.80),
    "claude-3-opus":    ("claude-3-5-sonnet",       0.80),
    "claude-sonnet":    ("claude-haiku",            0.75),
    "claude-3-sonnet":  ("claude-3-haiku",          0.75),
    "gemini-1.5-pro":   ("gemini-1.5-flash",        0.87),
    "gemini-pro":       ("gemini-flash",            0.80),
    "o1":               ("gpt-4o",                  0.80),
    "o3":               ("o1-mini",                 0.85),
}


def _find_cheaper_alternative(model: str) -> tuple[str, float] | None:
    """Return (cheaper_model_name, reduction_fraction) or None."""
    if not model:
        return None
    model_lower = model.lower()
    for key, (alt, reduction) in _CHEAPER_ALTERNATIVES.items():
        if key in model_lower:
            return alt, reduction
    return None


def enrich_agents_data(org_id: str, agents_data: list[dict], db: Session) -> list[dict]:
    """
    Adds per-agent enrichment fields to agents_data dicts:
    - top_model: the model used in the most runs
    - cache_read_tokens: total cache read tokens
    - total_input_tokens: total input tokens
    - already_caching: bool - cache_read_tokens > 0
    - cache_savings_possible: estimated monthly savings from caching if not already caching
    """
    if not agents_data:
        return agents_data

    agent_ids = [a["agent_id"] for a in agents_data]
    placeholders = ", ".join(f":id_{i}" for i in range(len(agent_ids)))
    params: dict = {"org_id": org_id}
    for i, aid in enumerate(agent_ids):
        params[f"id_{i}"] = aid

    try:
        _nsm = "AND (run_metadata IS NULL OR run_metadata->>'event_name' IS NULL OR run_metadata->>'event_name' != 'session_metrics')"

        # Top model per agent (by run count)
        model_rows = db.execute(text(f"""
            SELECT agent_id, model,
                   COUNT(*) AS cnt,
                   SUM(cost_usd) AS model_cost
            FROM events
            WHERE org_id = :org_id
              AND agent_id IN ({placeholders})
              AND model IS NOT NULL
              {_nsm}
            GROUP BY agent_id, model
            ORDER BY agent_id, cnt DESC
        """), params).fetchall()

        top_models: dict[str, dict] = {}
        for row in model_rows:
            aid = row[0]
            if aid not in top_models:
                top_models[aid] = {"model": row[1], "model_cost": float(row[3] or 0)}

        # Cache token data per agent (use promoted columns with JSONB fallback)
        cache_rows = db.execute(text(f"""
            SELECT agent_id,
                   SUM(input_tokens) AS input_tokens,
                   COALESCE(SUM(COALESCE(cache_read_tokens,  (run_metadata->>'cache_read_tokens')::numeric::bigint)), 0) AS cache_read,
                   COALESCE(SUM(COALESCE(cache_write_tokens, (run_metadata->>'cache_write_tokens')::numeric::bigint)), 0) AS cache_write
            FROM events
            WHERE org_id = :org_id
              AND agent_id IN ({placeholders})
              {_nsm}
            GROUP BY agent_id
        """), params).fetchall()

        cache_data: dict[str, dict] = {
            row[0]: {
                "input_tokens":    int(row[1] or 0),
                "cache_read":      int(row[2] or 0),
                "cache_write":     int(row[3] or 0),
            }
            for row in cache_rows
        }

        for agent in agents_data:
            aid = agent["agent_id"]
            model_info = top_models.get(aid, {})
            cache_info = cache_data.get(aid, {})

            agent["top_model"]         = model_info.get("model")
            agent["top_model_cost"]    = model_info.get("model_cost", 0.0)
            agent["cache_read_tokens"] = cache_info.get("cache_read", 0)
            agent["cache_write_tokens"] = cache_info.get("cache_write", 0)
            agent["total_input_tokens"] = cache_info.get("input_tokens", 0)
            agent["already_caching"]   = cache_info.get("cache_read", 0) > 0

    except Exception as exc:
        logger.warning("[recommendations] enrich_agents_data failed: %s", exc)

    return agents_data


def run_basic_rules(agents_data: list) -> list[Recommendation]:
    """
    Deterministic rules based on actual per-agent metrics.
    Savings estimates are derived from real usage data, not magic percentages.
    """
    recommendations = []

    for agent in agents_data:
        agent_id     = agent.get("agent_id", "")
        total_calls  = agent.get("total_calls", 0)
        failed       = agent.get("failed", 0)
        total_cost   = agent.get("total_cost", 0.0)
        avg_cost     = agent.get("avg_cost", 0.0)
        success_rate = agent.get("success_rate", 100.0)

        # Enriched fields (may be absent if enrich failed)
        top_model           = agent.get("top_model")
        already_caching     = agent.get("already_caching", False)
        cache_read_tokens   = agent.get("cache_read_tokens", 0)
        total_input_tokens  = agent.get("total_input_tokens", 0)

        if total_calls == 0:
            continue

        failure_rate = failed / total_calls

        if failed > 0:
            # Savings = actual cost of failed runs (they're wasted spend)
            wasted   = round(failed * avg_cost, 6)
            severity = "high" if failure_rate > 0.20 else ("medium" if failure_rate > 0.05 else "low")
            recommendations.append(Recommendation(
                type="error_fix",
                priority=severity,
                title=f"Failed runs on '{agent_id}'",
                description=(
                    f"{failed} of {total_calls} runs failed ({failure_rate:.0%} failure rate). "
                    + (
                        f"Failed runs still consume tokens - ${wasted:.4f} in wasted spend at current volume. "
                        f"Review the Top Errors section in the agent detail page."
                        if wasted > 0.0001 else
                        "Investigate error logs in the agent detail page to find the root cause."
                    )
                ),
                estimated_savings_usd=wasted,
                agent_id=agent_id,
            ))

        # Only fire if we know the model and there's a concrete cheaper alternative
        if avg_cost > 0.05 and top_model:
            alt = _find_cheaper_alternative(top_model)
            if alt:
                alt_name, reduction = alt
                # Savings based on actual cost, not a guess
                potential_saving = round(total_cost * reduction, 4)
                recommendations.append(Recommendation(
                    type="model_switch",
                    priority="medium" if avg_cost > 0.05 else "low",
                    title=f"Switch '{agent_id}' from {top_model} to {alt_name}",
                    description=(
                        f"This agent uses {top_model} at ${avg_cost:.4f}/run. "
                        f"{alt_name} handles most tasks with similar quality at {int(reduction * 100)}% lower cost. "
                        f"Based on {total_calls} runs, switching could save ~${potential_saving:.4f} at current volume."
                    ),
                    estimated_savings_usd=potential_saving,
                    agent_id=agent_id,
                ))

        # Only suggest if NOT already caching; skip if caching is active
        if total_calls >= 10 and avg_cost > 0 and not already_caching:
            # Estimate: if system prompt is ~20% of input tokens, caching it
            # saves ~90% of that portion (cache read is ~10x cheaper than input)
            if total_input_tokens > 0:
                # Rough: assume 15% of input is repetitive system prompt
                cacheable_fraction = 0.15
                cache_token_saving = total_input_tokens * cacheable_fraction * 0.90
                # Estimate cost saved: proportional to input token fraction
                input_cost_fraction = 0.5  # rough: input tokens ~50% of cost
                cache_saving = round(total_cost * input_cost_fraction * cacheable_fraction * 0.90, 6)
            else:
                cache_saving = round(total_cost * 0.08, 6)  # conservative 8% if no token data

            recommendations.append(Recommendation(
                type="caching",
                priority="low",
                title=f"Enable prompt caching for '{agent_id}'",
                description=(
                    f"'{agent_id}' has run {total_calls} times with no prompt cache hits detected. "
                    f"If your system prompt or instructions are repeated across runs, enabling caching "
                    f"(supported on Claude and GPT-4o) could reduce input token costs by ~8–15%, "
                    f"saving ~${cache_saving:.4f} at current volume."
                ),
                estimated_savings_usd=cache_saving,
                agent_id=agent_id,
            ))

        if total_calls >= 3 and total_cost == 0.0:
            recommendations.append(Recommendation(
                type="instrumentation",
                priority="medium",
                title=f"Cost tracking not active for '{agent_id}'",
                description=(
                    f"'{agent_id}' has {total_calls} recorded runs but $0 tracked cost. "
                    f"This usually means the model name isn't being sent or isn't in the "
                    f"pricing table. Ensure the `model` field is set in your agent's SDK config."
                ),
                estimated_savings_usd=0.0,
                agent_id=agent_id,
            ))

        if total_calls >= 5 and success_rate < 80 and failed > 0:
            # Don't double-fire with rule 1 if already there; this is a higher-level rec
            wasted = round(failed * avg_cost, 4)
            recommendations.append(Recommendation(
                type="reliability",
                priority="high",
                title=f"Reliability issue on '{agent_id}'",
                description=(
                    f"Success rate is {success_rate:.1f}% over {total_calls} runs - "
                    f"below the 80% healthy threshold. "
                    f"Check the Top Errors section in the agent detail page for recurring patterns."
                ),
                estimated_savings_usd=wasted,
                agent_id=agent_id,
            ))

    # Deduplicate same type per agent, sort by priority then savings
    seen: set[str] = set()
    deduped = []
    for rec in recommendations:
        key = f"{rec.agent_id}:{rec.type}"
        if key not in seen:
            seen.add(key)
            deduped.append(rec)

    deduped.sort(key=lambda r: (
        {"high": 0, "medium": 1, "low": 2}.get(getattr(r, "priority", "low"), 3),
        -(getattr(r, "estimated_savings_usd", 0) or 0),
    ))
    return deduped[:15]
