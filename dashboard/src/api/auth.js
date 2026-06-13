import client from "./client";

export const getMe = () => client.get("/auth/me");
export const updateMe = (data) => client.patch("/auth/me", data);
export const updateSettings = (settings) => client.patch("/auth/me", settings);
