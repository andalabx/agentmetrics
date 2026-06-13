import client from "./client";

export const getSlo = (windowHours = 24) =>
  client.get(`/slo?window_hours=${windowHours}`);
