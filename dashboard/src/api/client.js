import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1`
  : "/v1";

export const API_KEY_STORAGE_KEY = "agentmetrics_api_key";

export function getStoredKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredKey(key) {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch {}
}

export function clearStoredKey() {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {}
}

const client = axios.create({
  baseURL: API_URL,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// Attach the API key from localStorage on every request
client.interceptors.request.use((config) => {
  const key = getStoredKey();
  if (key) {
    config.headers["Authorization"] = `Bearer ${key}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    if (status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/setup")) {
      // Dispatch event so the app can react gracefully (e.g. show a banner)
      // rather than doing a hard page reload that destroys React state.
      window.dispatchEvent(new CustomEvent("api:unauthorized"));
    }
    if (status >= 500 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("api:error", {
        detail: { status, url: err.config?.url },
      }));
    }
    return Promise.reject(err);
  }
);

export default client;
