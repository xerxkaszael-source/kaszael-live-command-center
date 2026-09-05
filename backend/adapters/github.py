"""GitHub adapter — REST API using token from ~/.git-credentials or ~/.bashrc.

Polled every 30s. Lists user repos and recent activity.
"""
from __future__ import annotations
import asyncio
import json
import re
import time
import urllib.request
import urllib.error
from pathlib import Path

from event_bus import BUS, Event, make_event_id


def _find_token() -> str | None:
    """Find GH token from ~/.git-credentials (preferred) or ~/.bashrc (GH_TOKEN)."""
    candidates = [
        Path.home() / ".git-credentials",  # Preferred (active token used by git)
        Path.home() / ".bashrc",           # Fallback (may be older)
    ]
    for c in candidates:
        if not c.exists():
            continue
        try:
            content = c.read_text()
        except Exception:
            continue
        # git-credentials style: https://user:token@github.com  (github.com at end)
        m = re.search(r'https://[^:\s]+:([A-Za-z0-9_-]+)@github\.com', content)
        if m:
            return m.group(1)
        # bashrc style
        m = re.search(r'GH_TOKEN=["\']?([A-Za-z0-9_-]+)', content)
        if m:
            return m.group(1)
    return None


class GitHubAdapter:
    POLL_INTERVAL = 30.0

    def __init__(self):
        self.token = _find_token()
        # A real GitHub PAT starts with ghp_ and is 40 chars
        # The git-credentials placeholder has 3 literal dots, making it invalid
        self.enabled = bool(self.token) and self.token.startswith("ghp_") and "..." not in self.token
        self.user = None
        self.repos = []
        self.recent_activity = []
        self.last_poll_ts: float | None = None
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None
        self._stop = False

    async def start(self):
        if not self.enabled:
            print("[github] disabled — no token in ~/.git-credentials or ~/.bashrc", flush=True)
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
                print(f"[github] poll err: {e}", flush=True)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _poll(self):
        loop = asyncio.get_event_loop()
        user, repos = await loop.run_in_executor(None, self._fetch_user_repos)
        self.user = user
        self.repos = repos
        self.last_poll_ts = time.time()
        await BUS.publish(Event(
            event_id=make_event_id(),
            timestamp=self.last_poll_ts,
            source="github",
            event_type="github.snapshot",
            entity_type="service",
            entity_id=(user.get("login") if user else None) or "github",
            status="ok" if user else "error",
            provider_id="github",
            metadata={"repos_count": len(repos)},
        ))

    def _fetch_user_repos(self) -> tuple[dict | None, list]:
        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "lcc-backend",
            }
            req = urllib.request.Request("https://api.github.com/user", headers=headers)
            with urllib.request.urlopen(req, timeout=10) as r:
                user = json.loads(r.read())
            req2 = urllib.request.Request(
                "https://api.github.com/user/repos?per_page=10&sort=updated",
                headers=headers,
            )
            with urllib.request.urlopen(req2, timeout=10) as r:
                repos_raw = json.loads(r.read())
            repos = [
                {
                    "full_name": r.get("full_name"),
                    "private": r.get("private"),
                    "default_branch": r.get("default_branch"),
                    "updated_at": r.get("updated_at"),
                    "language": r.get("language"),
                }
                for r in repos_raw
            ]
            self.last_error = None
            return user, repos
        except Exception as e:
            self.last_error = str(e)
            return None, []

    def snapshot(self) -> dict:
        return {
            "enabled": self.enabled,
            "user": self.user,
            "repos": self.repos,
            "recent_activity": self.recent_activity,
            "last_poll_ts": self.last_poll_ts,
            "last_error": self.last_error,
        }