import { useCallback, useState } from "react";
import { getAgent, getAgentNames, getAgentHourly, renameAgent } from "../api/agents";
import usePolling from "./usePolling";

/**
 * Fetches and polls the core agent data set: stats, display names, hourly volume.
 * Extra fetches (recommendations, runs list) stay in the calling page.
 */
export function useAgentData(agentId, pollMs = 10_000) {
  const [agent, setAgent]         = useState(null);
  const [namesMap, setNamesMap]   = useState({});
  const [hourlyData, setHourlyData] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const fetchData = useCallback(async () => {
    if (!agentId) return null;
    try {
      const [agentRes, namesRes, hourlyRes] = await Promise.all([
        getAgent(agentId),
        getAgentNames(),
        getAgentHourly(agentId).catch(() => ({ data: [] })),
      ]);
      setAgent(agentRes.data);
      setNamesMap(namesRes.data);
      setHourlyData(hourlyRes.data || []);
      setError(null);
      return agentRes.data;
    } catch (err) {
      setError(err.response?.status === 404 ? "Agent not found" : "Failed to load agent data");
      return null;
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  usePolling(fetchData, pollMs);

  return { agent, namesMap, setNamesMap, hourlyData, loading, error };
}

/**
 * Manages agent rename UI state. Requires setNamesMap from useAgentData so the
 * displayed name updates immediately without a refetch.
 */
export function useAgentRename(agentId, namesMap, setNamesMap) {
  const [renaming, setRenaming]     = useState(false);
  const [nameInput, setNameInput]   = useState("");
  const [savingName, setSavingName] = useState(false);

  const startRename = () => {
    setNameInput(namesMap[agentId] || "");
    setRenaming(true);
  };

  const saveRename = async (override) => {
    const value = override !== undefined ? override : nameInput;
    setSavingName(true);
    try {
      const { data } = await renameAgent(agentId, value);
      setNamesMap(data);
      setRenaming(false);
    } finally {
      setSavingName(false);
    }
  };

  const cancelRename = () => setRenaming(false);

  return { renaming, nameInput, setNameInput, savingName, startRename, saveRename, cancelRename };
}
