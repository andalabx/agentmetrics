import client from "./client";

export const getAlertRules   = ()         => client.get("/alerts");
export const createAlertRule = (data)     => client.post("/alerts", data);
export const updateAlertRule = (id, data) => client.patch(`/alerts/${id}`, data);
export const deleteAlertRule = (id)       => client.delete(`/alerts/${id}`);
export const getAlertHistory = ()         => client.get("/alerts/history");
