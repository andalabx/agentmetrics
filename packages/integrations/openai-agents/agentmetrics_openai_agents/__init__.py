from agentmetrics_openai_agents.processor import AgentMetricsProcessor


def instrument(
    api_key: str,
    agent_id: str = "openai-agent",
    base_url: str = "http://localhost:8099",
) -> AgentMetricsProcessor:
    """
    Register AgentMetrics as a tracing processor for all OpenAI Agents SDK runs.

    Usage::

        from agentmetrics_openai_agents import instrument

        instrument(api_key="am_...")
        # All agent runs are now tracked automatically.
    """
    from agents.tracing import add_trace_processor

    processor = AgentMetricsProcessor(api_key=api_key, agent_id=agent_id, base_url=base_url)
    add_trace_processor(processor)
    return processor


__version__ = "0.1.0"
__all__ = ["AgentMetricsProcessor", "instrument"]
