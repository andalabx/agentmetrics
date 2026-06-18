import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpClient } from "./http-client.js";

describe("HttpClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips trailing slash and /v1 suffix from baseUrl", () => {
    const c1 = new HttpClient({ apiKey: "k", baseUrl: "http://localhost:8099/" });
    const c2 = new HttpClient({ apiKey: "k", baseUrl: "http://localhost:8099/v1" });
    // Both should post to the same URL (verified indirectly via fireAndForget)
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    c1.fireAndForget({ event_id: "1" });
    c2.fireAndForget({ event_id: "2" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url1] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    const [url2] = mockFetch.mock.calls[1] as [string, ...unknown[]];
    expect(url1).toBe("http://localhost:8099/v1/events");
    expect(url2).toBe("http://localhost:8099/v1/events");
  });

  it("sends Authorization header when apiKey is set", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const client = new HttpClient({ apiKey: "test-key", baseUrl: "http://localhost:8099" });
    client.fireAndForget({ event_id: "1" });
    await client.flush();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");
  });

  it("fireAndForgetBatch skips empty array", () => {
    const mockFetch = vi.mocked(fetch);
    const client = new HttpClient({ apiKey: "k", baseUrl: "http://localhost:8099" });
    client.fireAndForgetBatch([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("flush resolves when all pending requests settle", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const client = new HttpClient({ apiKey: "k", baseUrl: "http://localhost:8099" });
    client.fireAndForget({ event_id: "a" });
    client.fireAndForget({ event_id: "b" });
    await expect(client.flush()).resolves.toBeUndefined();
  });
});
