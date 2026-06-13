import client from "./client";

export const getAgents = () => client.get("/agents");

export const getAgent = (agentId) => client.get(`/agents/${encodeURIComponent(agentId)}`);

export const getRecommendations = () => client.get("/recommendations");

export const updateRecommendation = (id, status) =>
  client.patch(`/recommendations/${id}`, { status });

export const deleteAgent = (agentId) =>
  client.delete(`/agents/${encodeURIComponent(agentId)}`);

export const getAgentNames = () => client.get("/agents/names");

export const renameAgent = (agentId, name) =>
  client.put(`/agents/${encodeURIComponent(agentId)}/name`, { name });

export const getMonthlyStats = () => client.get("/stats/monthly");

export const getAgentRuns = (agentId, { limit = 50, offset = 0 } = {}) =>
  client.get(`/agents/${encodeURIComponent(agentId)}/runs`, { params: { limit, offset } });

export const getWeekComparison = () => client.get("/stats/week-comparison");

export const getAgentHourly = (agentId) =>
  client.get(`/agents/${encodeURIComponent(agentId)}/hourly`);
