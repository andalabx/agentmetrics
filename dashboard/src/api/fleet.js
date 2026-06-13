import client from "./client";

export const getFleetHealth   = () => client.get("/fleet/health");
export const getFleetBriefing = () => client.get("/fleet/briefing");
