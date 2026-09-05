"""Filesystem adapter — polls /sdcard/Kaszael for changes.

REAL data. Walks workspace + projects/active. Detects new/changed files.
"""
from __future__ import annotations
import asyncio
import os
import time
from pathlib import Path

from event_bus import BUS, Event, make_event_id


class FilesystemAdapter:
    POLL_INTERVAL = 8.0
    MAX_DEPTH = 5
    SKIP_DIRS = {".git", "node_modules", ".9router", "vendor", "rotated", "db", "__pycache__"}

    def __init__(self, root: str = "/sdcard/Kaszael"):
        self.root = Path(root)
        self.snapshot_mtimes: dict[str, float] = {}
        self.last_poll_ts: float | None = None
        self.recent_changes: list[dict] = []
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
                print(f"[fs] poll err: {e}", flush=True)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _poll(self):
        loop = asyncio.get_event_loop()
        new_mtimes, active_projects, recent = await loop.run_in_executor(None, self._walk)
        # Diff against last snapshot
        changes = []
        # Detect new/changed
        for path, mtime in new_mtimes.items():
            old = self.snapshot_mtimes.get(path)
            if old is None:
                changes.append({"path": path, "kind": "new", "mtime": mtime})
            elif abs(old - mtime) > 0.001:
                changes.append({"path": path, "kind": "modified", "mtime": mtime})
        # Detect removed
        for path in list(self.snapshot_mtimes.keys()):
            if path not in new_mtimes:
                changes.append({"path": path, "kind": "removed", "mtime": self.snapshot_mtimes[path]})
        self.snapshot_mtimes = new_mtimes
        self.last_poll_ts = time.time()
        self.recent_changes = (changes + self.recent_changes)[:50]
        # Emit events for each change
        for ch in changes[:10]:
            await BUS.publish(Event(
                event_id=make_event_id(),
                timestamp=self.last_poll_ts,
                source="filesystem",
                event_type=f"filesystem.{ch['kind']}",
                entity_type="file",
                entity_id=ch["path"],
                status="ok",
                metadata={"mtime": ch["mtime"]},
            ))
        await BUS.publish(Event(
            event_id=make_event_id(),
            timestamp=self.last_poll_ts,
            source="filesystem",
            event_type="filesystem.snapshot",
            entity_type="workspace",
            entity_id=str(self.root),
            status="ok",
            metadata={
                "files_tracked": len(self.snapshot_mtimes),
                "changes_this_poll": len(changes),
                "active_projects": active_projects,
            },
        ))

    def _walk(self) -> tuple[dict[str, float], list[str], list[dict]]:
        mtimes: dict[str, float] = {}
        active = []
        try:
            for dirpath, dirnames, filenames in os.walk(self.root):
                # depth limit
                rel = dirpath[len(str(self.root)):].count(os.sep)
                if rel > self.MAX_DEPTH:
                    dirnames[:] = []
                    continue
                # skip heavy dirs
                dirnames[:] = [d for d in dirnames if d not in self.SKIP_DIRS]
                # detect active project
                if "/projects/active/" in dirpath and rel == 2:
                    active.append(os.path.basename(dirpath))
                for fn in filenames:
                    p = os.path.join(dirpath, fn)
                    try:
                        mtimes[p] = os.path.getmtime(p)
                    except OSError:
                        pass
        except Exception as e:
            print(f"[fs] walk err: {e}", flush=True)
        recent = [
            {"path": p, "mtime": m}
            for p, m in sorted(mtimes.items(), key=lambda kv: -kv[1])[:20]
        ]
        return mtimes, active, recent

    def snapshot(self) -> dict:
        return {
            "workspace": str(self.root),
            "files_tracked": len(self.snapshot_mtimes),
            "recent_changes": self.recent_changes[:20],
            "active_projects": list(set(
                os.path.basename(os.path.dirname(p)) if "/projects/active/" in p else None
                for p in self.snapshot_mtimes.keys()
            ))[:10],
            "last_poll_ts": self.last_poll_ts,
        }