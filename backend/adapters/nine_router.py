"""9Router adapter — polls http://127.0.0.1:20128/api/health + /v1/models.

REAL data via HTTP. Uses stdlib only (no httpx/requests dependency).
"""
from __future__ import annotations
import asyncio
import json
import time
import urllib.request
import urllib.error

from event_bus import BUS, Event, make_event_id


class NineRouterAdapter:
    POLL_INTERVAL = 10.0

    def __init__(self, base_url: str = "http://127.0.0.1:20128"):
        self.base_url = base_url.rstrip("/")
        self.running = False
        self.health = None
        self.models_count = 0
        self.models_sample: list[str] = []
        self.providers: list[str] = []
        self.last_poll_ts: float | None = None
        self.last_error: str | None = None
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
                print(f"[9router] poll err: {e}", flush=True)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _poll(self):
        loop = asyncio.get_event_loop()
        ok, health = await loop.run_in_executor(None, self._fetch_health)
        models_count = 0
        models_sample = []
        providers = []
        if ok:
            ok2, models = await loop.run_in_executor(None, self._fetch_models)
            if ok2 and isinstance(models, dict):
                data = models.get("data", [])
                models_count = len(data)
                models_sample = [m.get("id", "") for m in data[:8] if m.get("id")]
                providers = sorted(set(m.get("owned_by", "?") for m in data))[:12]
        prev_running = self.running
        self.running = ok
        self.health = health
        self.models_count = models_count
        self.models_sample = models_sample
        self.providers = providers
        self.last_poll_ts = time.time()
        if ok != prev_running:
            await BUS.publish(Event(
                event_id=make_event_id(),
                timestamp=self.last_poll_ts,
                source="nine_router",
                event_type="nine_router.state_changed",
                entity_type="service",
                entity_id="9router",
                status="ok" if ok else "error",
                provider_id="nine_router",
                metadata={"running": ok, "models": models_count},
            ))

    def _fetch_health(self) -> tuple[bool, dict | None]:
        try:
            with urllib.request.urlopen(f"{self.base_url}/api/health", timeout=3) as r:
                body = r.read().decode()
                self.last_error = None
                return True, json.loads(body)
        except Exception as e:
            self.last_error = str(e)
            return False, None

    def _fetch_models(self) -> tuple[bool, dict | None]:
        try:
            with urllib.request.urlopen(f"{self.base_url}/v1/models", timeout=5) as r:
                return True, json.loads(r.read().decode())
        except Exception as e:
            self.last_error = str(e)
            return False, None

    def snapshot(self) -> dict:
        return {
            "endpoint": self.base_url,
            "running": self.running,
            "health": self.health,
            "models_count": self.models_count,
            "models_sample": self.models_sample,
            "providers": self.providers,
            "last_poll_ts": self.last_poll_ts,
            "last_error": self.last_error,
        }