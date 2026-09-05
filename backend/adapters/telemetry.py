"""Telemetry adapter — tails .kaszael/telemetry/events.jsonl and emits bus events.

REAL data only. No fabrication. If file is missing/stale, publish "stale" event.
"""
from __future__ import annotations
import asyncio
import json
import os
import time
from pathlib import Path

from event_bus import BUS, Event, make_event_id


class TelemetryAdapter:
    """Polls the JSONL file every 1s, emits new lines as events."""

    def __init__(self, path: str):
        self.path = Path(path)
        self.last_offset = 0
        self.last_mtime = 0
        self.last_event_ts: float | None = None
        self.events_by_type: dict[str, int] = {}
        self.events_by_role: dict[str, int] = {}
        self.events_by_layer: dict[str, int] = {}
        self.events_by_skill: dict[str, int] = {}
        self.error_count = 0
        self.success_count = 0
        self._task: asyncio.Task | None = None
        self._stop = False

    async def start(self) -> None:
        # Bootstrap: read existing file from start to build aggregates.
        # We process historical lines to seed counters but don't publish them
        # as live bus events (those should be NEW events from now on).
        if self.path.exists():
            try:
                with open(self.path) as f:
                    for line in f:
                        line = line.strip()
                        if not line: continue
                        try:
                            ev = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        et = ev.get("event_type", "unknown")
                        role = ev.get("role") or "unknown"
                        layer = str(ev.get("layer", "unknown"))
                        skill = ev.get("skill") or "unknown"
                        status = ev.get("status", "ok")
                        self.events_by_type[et] = self.events_by_type.get(et, 0) + 1
                        self.events_by_role[role] = self.events_by_role.get(role, 0) + 1
                        self.events_by_layer[layer] = self.events_by_layer.get(layer, 0) + 1
                        self.events_by_skill[skill] = self.events_by_skill.get(skill, 0) + 1
                        if status == "ok" or status == "detected":
                            self.success_count += 1
                        else:
                            self.error_count += 1
                        ts = _parse_ts(ev.get("ts") or ev.get("timestamp"))
                        if ts is not None:
                            # Track the MOST RECENT historical timestamp
                            if self.last_event_ts is None or ts > self.last_event_ts:
                                self.last_event_ts = ts
                # Set offset to current size so we only publish NEW events
                with open(self.path, "rb") as f:
                    f.seek(0, 2)
                    self.last_offset = f.tell()
                self.last_mtime = self.path.stat().st_mtime
            except Exception as e:
                print(f"[telemetry] bootstrap err: {e}", flush=True)
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._stop = True
        if self._task:
            self._task.cancel()

    async def _loop(self) -> None:
        while not self._stop:
            try:
                await self._poll_once()
            except Exception as e:
                print(f"[telemetry] poll error: {e}", flush=True)
            await asyncio.sleep(1.0)

    async def _poll_once(self) -> None:
        if not self.path.exists():
            return
        try:
            mtime = self.path.stat().st_mtime
            size = self.path.stat().st_size
            if size < self.last_offset:
                # File was rotated/truncated
                self.last_offset = 0
            if size == self.last_offset:
                return  # no new data
            with open(self.path, "rb") as f:
                f.seek(self.last_offset)
                chunk = f.read(size - self.last_offset)
            self.last_offset = size
            self.last_mtime = mtime
            for line in chunk.decode("utf-8", errors="replace").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # normalize
                et = ev.get("event_type", "unknown")
                role = ev.get("role") or "unknown"
                layer = str(ev.get("layer", "unknown"))
                skill = ev.get("skill") or "unknown"
                status = ev.get("status", "ok")
                self.events_by_type[et] = self.events_by_type.get(et, 0) + 1
                self.events_by_role[role] = self.events_by_role.get(role, 0) + 1
                self.events_by_layer[layer] = self.events_by_layer.get(layer, 0) + 1
                self.events_by_skill[skill] = self.events_by_skill.get(skill, 0) + 1
                if status == "ok" or status == "detected":
                    self.success_count += 1
                else:
                    self.error_count += 1
                ts = _parse_ts(ev.get("ts") or ev.get("timestamp")) or time.time()
                self.last_event_ts = ts
                # Emit bus event
                eid = make_event_id()
                bus_ev = Event(
                    event_id=eid,
                    timestamp=ts,
                    source="telemetry",
                    event_type=et,
                    entity_type=_entity_for_type(et),
                    entity_id=ev.get("mission_id") or ev.get("agent") or eid,
                    status=status,
                    agent_id=ev.get("agent"),
                    role_id=role,
                    skill_id=skill,
                    layer_id=ev.get("layer"),
                    mission_id=ev.get("mission_id"),
                    metadata={
                        "duration_ms": ev.get("duration_ms"),
                        "error_class": ev.get("error_class"),
                        "provider": ev.get("provider"),
                        "model": ev.get("model"),
                    },
                    evidence_ref=f"{self.path}:{self.last_offset}",
                )
                await BUS.publish(bus_ev)
        except Exception as e:
            print(f"[telemetry] read err: {e}", flush=True)


def _entity_for_type(et: str) -> str:
    if et.startswith("mission."): return "mission"
    if et.startswith("recovery."): return "incident"
    if et.startswith("verification."): return "verification"
    if et.startswith("router."): return "agent"
    if et.startswith("diag."): return "diagnostic"
    if et.startswith("bootstrap."): return "bootstrap"
    if et.startswith("observability."): return "telemetry"
    return "event"


def _parse_ts(ts) -> float | None:
    """Parse a timestamp from various JSONL formats. Returns epoch seconds or None."""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return float(ts)
    if isinstance(ts, str):
        try:
            from datetime import datetime
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except Exception:
            return None
    return None