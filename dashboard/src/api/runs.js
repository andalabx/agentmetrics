import client from "./client";

export const getRun = (traceId) => client.get(`/runs/${encodeURIComponent(traceId)}`);
