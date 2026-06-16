import { getStoredKey } from "./client";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Open a self-healing SSE connection to /v1/activity/live.
 * Auto-reconnects with exponential backoff: 1s → 2s → 4s → 8s → max 30s.
 */
export function openActivityStream(onEvent, onError, onStatus) {
  let es         = null;
  let stopped    = false;
  let retryDelay = 1000;
  let retryTimer = null;

  async function connect() {
    if (stopped) return;

    // Exchange for a short-lived ticket to avoid credentials in the SSE URL
    let ticket;
    try {
      const res = await fetch(`${BASE_URL}/v1/activity/ticket`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${getStoredKey()}` },
      });
      if (!res.ok) throw new Error(`Ticket exchange failed: ${res.status}`);
      ({ ticket } = await res.json());
    } catch {
      if (!stopped) {
        onStatus?.("reconnecting");
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30000);
          connect();
        }, retryDelay);
      }
      return;
    }

    const url = `${BASE_URL}/v1/activity/live?ticket=${encodeURIComponent(ticket)}`;
    es = new EventSource(url);

    es.onopen = () => {
      retryDelay = 1000;
      onStatus?.("connected");
    };

    es.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch { /* malformed, ignore */ }
    };

    es.onerror = () => {
      if (stopped) return;
      es?.close();
      es = null;
      onStatus?.("reconnecting");
      retryTimer = setTimeout(() => {
        retryDelay = Math.min(retryDelay * 2, 30000);
        connect();
      }, retryDelay);
    };
  }

  connect();

  return {
    cleanup() {
      stopped = true;
      clearTimeout(retryTimer);
      es?.close();
      es = null;
    },
    reconnect() {
      clearTimeout(retryTimer);
      es?.close();
      es = null;
      retryDelay = 1000;
      onStatus?.("reconnecting");
      connect();
    },
  };
}
