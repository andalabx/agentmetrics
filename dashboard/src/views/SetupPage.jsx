import { useState } from "react";
import { setStoredKey } from "../api/client";
import client from "../api/client";

export default function SetupPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Please enter your API key.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Verify the key actually works before saving
      setStoredKey(trimmed);
      await client.get("/auth/me");
      window.location.href = "/";
    } catch (err) {
      setStoredKey("");
      const status = err.response?.status;
      if (status === 401) {
        setError("Invalid API key. Check the key printed in your server console on first run.");
      } else {
        setError("Could not reach the AgentMetrics API. Is the server running?");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-2">AgentMetrics</h1>
          <p className="text-gray-400 text-sm">Enter your API key to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="am_..."
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm
                         placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              Your key was printed in the server console on first run.
            </p>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
                       text-white font-medium rounded-lg py-2 text-sm transition-colors"
          >
            {loading ? "Verifying…" : "Connect"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-gray-600">
          Key not working?{" "}
          <code className="text-gray-500">agentmetrics rotate-key</code> to generate a new one.
        </p>
      </div>
    </div>
  );
}
