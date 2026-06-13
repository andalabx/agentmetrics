import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1`
  : "/v1";

const client = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    if (status >= 500 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("api:error", {
        detail: { status, url: err.config?.url },
      }));
    }
    return Promise.reject(err);
  }
);

export default client;
