from pydantic import BaseModel
from typing import Optional, Any


class ActivityEvent(BaseModel):
    """
    An intermediate real-time event emitted by the plugin during a run.
    Stored in-memory and streamed to dashboard subscribers via SSE.

    type values:
      run_start     - agent started a new run
      run_end       - agent finished (success or failed)
      llm_start     - LLM call began (model known)
      llm_end       - LLM response received (with token counts)
      tool_start    - tool call is about to execute
      tool_end      - tool call finished (with duration + optional error)
      subagent_start - child subagent spawned
      subagent_end   - child subagent finished
      gateway_start  - OpenClaw gateway came online
      gateway_stop   - gateway shut down
      compaction     - context window compaction triggered
      reset          - session reset triggered
    """
    type:        str
    agent_id:    str
    session_key: Optional[str] = None
    run_id:      Optional[str] = None
    ts:          int  # unix epoch ms
    data:        Optional[dict[str, Any]] = None
