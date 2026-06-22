from __future__ import annotations

import gzip
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from agentmetrics_hermes.client import AgentMetricsClient
from agentmetrics_hermes.config import AgentMetricsConfig


def _local_server(handler: type[BaseHTTPRequestHandler]) -> tuple[HTTPServer, int]:
    server = HTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()
    return server, port


@pytest.mark.unit
def test_post_events_success() -> None:
    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            self.send_response(201)
            self.end_headers()

        def log_message(self, *args: object) -> None:
            pass

    _, port = _local_server(_Handler)
    cfg = AgentMetricsConfig(endpoint=f"http://127.0.0.1:{port}", api_key="am_test")
    client = AgentMetricsClient(cfg)
    status, error = client.post_events([{"event_id": "1"}])
    assert status == 201
    assert error == ""


@pytest.mark.unit
def test_post_events_http_error() -> None:
    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            self.send_response(422)
            self.end_headers()

        def log_message(self, *args: object) -> None:
            pass

    _, port = _local_server(_Handler)
    cfg = AgentMetricsConfig(endpoint=f"http://127.0.0.1:{port}", api_key="am_test")
    client = AgentMetricsClient(cfg)
    status, _ = client.post_events([{"event_id": "2"}])
    assert status == 422


@pytest.mark.unit
def test_payload_too_large_rejected() -> None:
    cfg = AgentMetricsConfig(endpoint="http://localhost:8099", api_key="am_test")
    client = AgentMetricsClient(cfg)
    # Build a payload that exceeds the cap.
    huge = [{"event_id": str(i), "data": "x" * 10_000} for i in range(1100)]
    status, error = client.post_events(huge)
    assert status == 413
    assert "too large" in error


@pytest.mark.unit
def test_gzip_compression_sent(tmp_path: pytest.TempPathFactory) -> None:
    received: list[bytes] = []

    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            received.append(body)
            self.send_response(201)
            self.end_headers()

        def log_message(self, *args: object) -> None:
            pass

    _, port = _local_server(_Handler)
    cfg = AgentMetricsConfig(
        endpoint=f"http://127.0.0.1:{port}",
        api_key="am_test",
        compress_payloads=True,
    )
    client = AgentMetricsClient(cfg)
    big_payload = [{"event_id": str(i), "data": "x" * 500} for i in range(5)]
    client.post_events(big_payload)

    assert len(received) == 1
    # Should be gzip-compressed — verify it decompresses correctly.
    decompressed = gzip.decompress(received[0])
    parsed = json.loads(decompressed)
    assert len(parsed["events"]) == 5
