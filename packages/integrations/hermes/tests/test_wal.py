from __future__ import annotations

import pytest

from agentmetrics_hermes.pipeline import QueueItem
from agentmetrics_hermes.wal import WriteAheadLog


def _item(eid: str) -> QueueItem:
    return QueueItem(event={"event_id": eid, "event_name": "test"})


@pytest.mark.unit
def test_append_and_recover(tmp_path: pytest.TempPathFactory) -> None:
    wal = WriteAheadLog(str(tmp_path / "wal.jsonl"))
    wal.append(_item("ev-1"))
    wal.append(_item("ev-2"))

    recovered = wal.recover()
    assert len(recovered) == 2
    ids = {e["event_id"] for e in recovered}
    assert ids == {"ev-1", "ev-2"}


@pytest.mark.unit
def test_ack_removes_from_unacked(tmp_path: pytest.TempPathFactory) -> None:
    wal = WriteAheadLog(str(tmp_path / "wal.jsonl"))
    items = [_item("a"), _item("b")]
    for item in items:
        wal.append(item)
    wal.ack(items[:1])  # ack only "a"
    assert "a" not in wal._unacked
    assert "b" in wal._unacked


@pytest.mark.unit
def test_compact_removes_acked(tmp_path: pytest.TempPathFactory) -> None:
    wal = WriteAheadLog(str(tmp_path / "wal.jsonl"))
    items = [_item("keep"), _item("discard")]
    for item in items:
        wal.append(item)
    wal.ack(items[1:])  # ack "discard"
    wal.compact()

    # After compaction, only "keep" should remain on disk.
    wal2 = WriteAheadLog(str(tmp_path / "wal.jsonl"))
    recovered = wal2.recover()
    assert len(recovered) == 1
    assert recovered[0]["event_id"] == "keep"


@pytest.mark.unit
def test_encrypted_wal_roundtrip(tmp_path: pytest.TempPathFactory) -> None:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
    except ImportError:
        pytest.skip("cryptography package not installed")

    wal = WriteAheadLog.from_api_key(str(tmp_path / "wal-enc.jsonl"), "am_test_key")
    wal.append(_item("secret-ev"))
    recovered = wal.recover()
    assert len(recovered) == 1
    assert recovered[0]["event_id"] == "secret-ev"


@pytest.mark.unit
def test_recover_missing_file(tmp_path: pytest.TempPathFactory) -> None:
    wal = WriteAheadLog(str(tmp_path / "missing.jsonl"))
    assert wal.recover() == []


@pytest.mark.unit
def test_compact_deletes_file_when_all_acked(tmp_path: pytest.TempPathFactory) -> None:
    import os

    path = str(tmp_path / "wal.jsonl")
    wal = WriteAheadLog(path)
    item = _item("gone")
    wal.append(item)
    wal.ack([item])
    wal.compact()
    assert not os.path.exists(path)
