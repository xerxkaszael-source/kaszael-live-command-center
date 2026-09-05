"""Event bus — in-process pub/sub for the Live Command Center.

REAL events only. No timers that fabricate data. Subscribers receive
events as they happen; publishers emit when an adapter observes a real
state change.
"""
from __future__ import annotations
import asyncio
import json
import time
from collections import deque
from dataclasses import dataclass, asdict, field
from typing import Any, Callable, Awaitable


@dataclass
class Event:
    event_id: str
    timestamp: float  # epoch seconds (real)
    source: str       # adapter that produced it
    event_type: str   # e.g. "telemetry.event", "process.snapshot"
    entity_type: str  # e.g. "agent", "tool", "mission"
    entity_id: str
    status: str = "ok"
    metadata: dict = field(default_factory=dict)
    layer_id: int | None = None
    mission_id: str | None = None
    agent_id: str | None = None
    role_id: str | None = None
    skill_id: str | None = None
    tool_id: str | None = None
    provider_id: str | None = None
    evidence_ref: str | None = None  # pointer to source

    def to_json(self) -> str:
        return json.dumps(asdict(self), default=str)

    @classmethod
    def from_dict(cls, d: dict) -> "Event":
        # Strip unknown keys
        keep = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in keep})


class EventBus:
    """Simple in-memory bus with async fan-out + a bounded history."""

    def __init__(self, max_history: int = 5000):
        self._subscribers: list[Callable[[Event], Awaitable[None]]] = []
        self._history: deque[Event] = deque(maxlen=max_history)
        self._lock = asyncio.Lock()

    async def publish(self, ev: Event) -> None:
        async with self._lock:
            self._history.append(ev)
        # fan-out (best effort — a failing subscriber doesn't break others)
        for sub in list(self._subscribers):
            try:
                await sub(ev)
            except Exception as e:
                # Don't crash the bus on subscriber errors
                print(f"[bus] subscriber error: {e}", flush=True)

    def subscribe(self, cb: Callable[[Event], Awaitable[None]]) -> None:
        self._subscribers.append(cb)

    def unsubscribe(self, cb: Callable[[Event], Awaitable[None]]) -> None:
        if cb in self._subscribers:
            self._subscribers.remove(cb)

    def history(self, limit: int = 100, source: str | None = None,
                event_type: str | None = None) -> list[Event]:
        items = list(self._history)
        if source:
            items = [e for e in items if e.source == source]
        if event_type:
            items = [e for e in items if e.event_type == event_type]
        return items[-limit:]

    def latest_event_ts(self) -> float | None:
        if not self._history:
            return None
        return self._history[-1].timestamp


# Global bus singleton
BUS = EventBus()


def make_event_id() -> str:
    return f"ev-{int(time.time() * 1000)}-{id(BUS) & 0xffff:x}"