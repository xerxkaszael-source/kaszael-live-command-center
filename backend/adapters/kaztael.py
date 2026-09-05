"""KASZAEL adapter — reads bootstrap.json, health-score.json, audit files.

REAL data only. Refreshes every 5s.
"""
from __future__ import annotations
import asyncio
import json
import time
from pathlib import Path

from event_bus import BUS, Event, make_event_id


class KaztaelAdapter:
    POLL_INTERVAL = 5.0

    def __init__(self, root: str = "/sdcard/Kaszael"):
        self.root = Path(root)
        self.bootstrap = None
        self.health_score = None
        self.layer_audit = None
        self.layer_integration = None
        self.recovery_evidence = None
        self.role_evidence = None
        self.runtime_evidence = None
        self.skill_evidence = None
        self.verification_evidence = None
        self.dashboard = None
        self.last_poll_ts: float | None = None
        self._task: asyncio.Task | None = None
        self._stop = False

    async def start(self):
        await self._poll()
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        self._stop = True
        if self._task:
            self._task.cancel()

    async def _loop(self):
        while not self._stop:
            try:
                await self._poll()
            except Exception as e:
                print(f"[kaztael] poll err: {e}", flush=True)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _poll(self):
        self.bootstrap = _read_json(self.root / ".kaszael/state/bootstrap.json")
        self.health_score = _read_json(self.root / ".kaszael/verification/health-score.json")
        self.layer_audit = _read_json(self.root / ".kaszael/verification/layer-1-28-audit.json")
        self.layer_integration = _read_json(self.root / ".kaszael/verification/layer-integration.json")
        self.recovery_evidence = _read_json(self.root / ".kaszael/verification/recovery-evidence.json")
        self.role_evidence = _read_json(self.root / ".kaszael/verification/role-evidence.json")
        self.runtime_evidence = _read_json(self.root / ".kaszael/verification/runtime-evidence.json")
        self.skill_evidence = _read_json(self.root / ".kaszael/verification/skill-evidence.json")
        self.verification_evidence = _read_json(self.root / ".kaszael/verification/verification-evidence.json")
        self.dashboard = _read_json(self.root / ".kaszael/telemetry/dashboard.json")
        self.last_poll_ts = time.time()
        now = self.last_poll_ts
        await BUS.publish(Event(
            event_id=make_event_id(),
            timestamp=now,
            source="kaztael",
            event_type="kaztael.snapshot",
            entity_type="workspace",
            entity_id="kaztael",
            status="ok" if self.health_score else "stale",
            metadata={
                "health_score": (self.health_score or {}).get("overall_score"),
                "bootstrap_ok": (self.bootstrap or {}).get("all_chain_ok"),
            },
        ))

    def snapshot(self) -> dict:
        hs = self.health_score or {}
        cats = hs.get("categories", {})
        bs = self.bootstrap or {}
        return {
            "bootstrap_ok": bs.get("all_chain_ok"),
            "bootstrap_chain": bs.get("chain", {}),
            "health_score": hs.get("overall_score"),
            "health_categories": {
                name: {"score": c.get("score"), "before": c.get("before"), "evidence": c.get("evidence")}
                for name, c in cats.items()
            },
            "diagnostics": {
                "telemetry": (self.dashboard or {}).get("events_total"),
                "recovery": (self.recovery_evidence or {}).get("detection_rate_pct"),
                "role_routing": (self.role_evidence or {}).get("match_rate_pct"),
                "runtime": (self.runtime_evidence or {}).get("mission_count"),
                "verification": (self.verification_evidence or {}).get("success_rate_pct"),
            },
            "layers_defined": len((self.layer_audit or {}).get("layers", [])),
            "last_poll_ts": self.last_poll_ts,
        }


def _read_json(path: Path):
    try:
        if not path.exists():
            return None
        with open(path) as f:
            return json.load(f)
    except Exception as e:
        print(f"[kaztael] read {path} err: {e}", flush=True)
        return None