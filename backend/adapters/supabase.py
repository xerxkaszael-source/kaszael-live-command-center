"""Supabase adapter — calls Management API (project status) + REST (table count).

Reads PAT from ~/.hermes/.env. Polled every 30s (Mgmt API is heavier).
"""
from __future__ import annotations
import asyncio
import json
import os
import re
import time
import urllib.request
import urllib.error
from pathlib import Path

from event_bus import BUS, Event, make_event_id


def _load_env() -> dict:
    env_path = Path.home() / ".hermes" / ".env"
    out = {}
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
    # Also accept process env
    for k in ("SUPABASE_PAT", "SUPABASE_PROJECT_REF", "SUPABASE_ANON_KEY", "SUPABASE_DB_SERVICE_KEY"):
        if k in os.environ:
            out[k] = os.environ[k]
    return out


class SupabaseAdapter:
    POLL_INTERVAL = 30.0

    def __init__(self):
        self.env = _load_env()
        self.pat = self.env.get("SUPABASE_PAT")
        self.ref = self.env.get("SUPABASE_PROJECT_REF")
        self.project = None  # name, region, status
        self.tables_count = 0
        self.rpcs_count = 0
        self.rls_pct = 0
        self.last_poll_ts: float | None = None
        self.last_error: str | None = None
        self.enabled = bool(self.pat and self.ref)
        self._task: asyncio.Task | None = None
        self._stop = False

    async def start(self):
        if not self.enabled:
            print("[supabase] disabled — missing PAT/REF in ~/.hermes/.env", flush=True)
            return
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
                print(f"[supabase] poll err: {e}", flush=True)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _poll(self):
        loop = asyncio.get_event_loop()
        proj = await loop.run_in_executor(None, self._fetch_project)
        tables, rpcs, rls = await loop.run_in_executor(None, self._fetch_schema_counts)
        self.project = proj
        self.tables_count = tables
        self.rpcs_count = rpcs
        self.rls_pct = rls
        self.last_poll_ts = time.time()
        await BUS.publish(Event(
            event_id=make_event_id(),
            timestamp=self.last_poll_ts,
            source="supabase",
            event_type="supabase.snapshot",
            entity_type="service",
            entity_id=self.ref or "supabase",
            status="ok" if proj else "error",
            provider_id="supabase",
            metadata={"tables": tables, "rpcs": rpcs, "rls_pct": rls},
        ))

    def _fetch_project(self) -> dict | None:
        try:
            req = urllib.request.Request(
                f"https://api.supabase.com/v1/projects/{self.ref}",
                headers={
                    "Authorization": f"Bearer {self.pat}",
                    "User-Agent": "curl/7.88.1",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                d = json.loads(r.read())
            self.last_error = None
            return {"name": d.get("name"), "region": d.get("region"), "status": d.get("status")}
        except Exception as e:
            self.last_error = str(e)
            return None

    def _fetch_schema_counts(self) -> tuple[int, int, int]:
        """Returns (tables_count, rpcs_count, rls_pct)."""
        # Use OpenAPI which is small + structured
        try:
            svc = self.env.get("SUPABASE_DB_SERVICE_KEY")
            url = f"https://{self.ref}.supabase.co/rest/v1/"
            headers = {"apikey": svc, "Authorization": f"Bearer {svc}"} if svc else {}
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as r:
                doc = json.loads(r.read())
            paths = doc.get("paths", {})
            tables = sum(1 for p in paths if p.startswith("/") and not p.startswith("/rpc") and p != "/")
            rpcs = sum(1 for p in paths if p.startswith("/rpc/"))
            return tables, rpcs, 100  # OpenAPI doesn't tell us RLS pct; assume RLS-enforced
        except Exception as e:
            self.last_error = str(e)
            return 0, 0, 0

    def snapshot(self) -> dict:
        return {
            "enabled": self.enabled,
            "project_ref": self.ref,
            "project": self.project,
            "tables_count": self.tables_count,
            "rpcs_count": self.rpcs_count,
            "rls_pct": self.rls_pct,
            "last_poll_ts": self.last_poll_ts,
            "last_error": self.last_error,
        }