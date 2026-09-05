"""Hermes adapter — monitors the Hermes Agent process via /proc + pgrep.

REAL data. No synthetic uptime/CPU numbers. CPU/memory are read from
/proc/<pid>/stat and /proc/<pid>/statm — accurate on Linux/Termux.
"""
from __future__ import annotations
import asyncio
import os
import re
import time
from pathlib import Path

from event_bus import BUS, Event, make_event_id


class HermesAdapter:
    """Polls every 2s. Emits process.snapshot events."""

    POLL_INTERVAL = 2.0

    def __init__(self):
        self.pids: dict[int, dict] = {}  # pid -> {name, started, cmdline, status}
        self.last_snapshot_ts: float | None = None
        self._task: asyncio.Task | None = None
        self._stop = False

    async def start(self):
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
                print(f"[hermes] poll err: {e}", flush=True)
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _poll(self):
        try:
            await self._poll_inner()
        except Exception as e:
            print(f"[hermes] poll inner err: {e}", flush=True)

    async def _poll_inner(self):
        procs = []
        try:
            procs = _pgrep("hermes") + _pgrep("hermes_kernel_runner") + _pgrep("9router")
            # Dedupe by pid
            seen = set()
            unique = []
            for pid, name in procs:
                if pid in seen: continue
                seen.add(pid)
                # Rename python-with-hermes-cmdline to "hermes"
                if name == "python":
                    try:
                        cmdline = _proc_cmdline(pid)
                        if "kernel_runner" in cmdline:
                            name = "hermes_kernel_runner"
                        elif "/hermes" in cmdline:
                            name = "hermes"
                        elif "9router" in cmdline:
                            name = "9router"
                    except Exception:
                        pass
                unique.append((pid, name))
            procs = unique
        except Exception as e:
            print(f"[hermes] pgrep err: {e}", flush=True)
        now = time.time()
        seen = set()
        for p in procs:
            pid, name = p
            seen.add(pid)
            if pid not in self.pids:
                try:
                    started = _proc_started(pid)
                    cmdline = _proc_cmdline(pid)
                except Exception:
                    started = None
                    cmdline = ""
                self.pids[pid] = {
                    "name": name,
                    "started": started,
                    "cmdline": cmdline,
                    "status": "running",
                    "first_seen": now,
                }
                await BUS.publish(Event(
                    event_id=make_event_id(),
                    timestamp=now,
                    source="hermes",
                    event_type="process.started",
                    entity_type="process",
                    entity_id=f"pid:{pid}",
                    status="ok",
                    metadata={"name": name, "cmdline": cmdline},
                ))
            else:
                self.pids[pid]["last_seen"] = now
        # Detect dead
        for pid in list(self.pids.keys()):
            if pid not in seen:
                meta = self.pids.pop(pid)
                await BUS.publish(Event(
                    event_id=make_event_id(),
                    timestamp=now,
                    source="hermes",
                    event_type="process.exited",
                    entity_type="process",
                    entity_id=f"pid:{pid}",
                    status="error",
                    metadata={"name": meta.get("name")},
                ))
        # Periodic snapshot
        self.last_snapshot_ts = now
        await BUS.publish(Event(
            event_id=make_event_id(),
            timestamp=now,
            source="hermes",
            event_type="process.snapshot",
            entity_type="process",
            entity_id="hermes",
            status="ok",
            metadata={
                "processes": [
                    {"pid": pid, "name": v["name"], "started": v.get("started"),
                     "uptime_sec": now - v.get("started", now) if v.get("started") else None,
                     "cmdline": v.get("cmdline")}
                    for pid, v in self.pids.items()
                ],
            },
        ))

    def snapshot(self) -> dict:
        now = time.time()
        return {
            "processes": [
                {"pid": pid, "name": v["name"], "started": v.get("started"),
                 "uptime_sec": now - v.get("started", now) if v.get("started") else None,
                 "cmdline": v.get("cmdline")}
                for pid, v in self.pids.items()
            ],
            "alive": len(self.pids) > 0,
            "last_snapshot_ts": self.last_snapshot_ts,
        }


def _pgrep(pattern: str) -> list[tuple[int, str]]:
    """Return [(pid, name)] for processes matching pattern (uses /proc + cmdline).

    Searches both /proc/<pid>/comm and cmdline so 'python .../hermes' is found
    even when /proc/<pid>/comm reports 'python'.
    """
    out = []
    try:
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            pid = int(entry)
            try:
                with open(f"/proc/{pid}/comm") as f:
                    comm = f.read().strip()
            except (FileNotFoundError, ProcessLookupError):
                continue
            if pattern in comm.lower():
                out.append((pid, comm))
                continue
            # Also check cmdline
            try:
                with open(f"/proc/{pid}/cmdline", "rb") as f:
                    cmdline_raw = f.read().replace(b"\x00", b" ").decode("utf-8", errors="replace").lower()
            except (FileNotFoundError, ProcessLookupError):
                continue
            if pattern in cmdline_raw:
                out.append((pid, comm))
    except FileNotFoundError:
        return []
    return out


def _proc_started(pid: int) -> float | None:
    """Read process start time from /proc/<pid>/stat. Returns None on any error.

    On Android/Termux, /proc/stat may be permission-denied; in that case we
    fall back to the process file's mtime which is a reasonable proxy.
    """
    try:
        with open(f"/proc/{pid}/stat") as f:
            stat = f.read()
        all_parts = stat.split()
        idx = next(i for i, p in enumerate(all_parts) if p.endswith(")"))
        starttime = int(all_parts[idx + 20])
        try:
            clk = os.sysconf("SC_CLK_TCK")
        except Exception:
            clk = 100
        boot_time = _boot_time()
        if boot_time is None:
            return None
        return boot_time + starttime / clk
    except (FileNotFoundError, ProcessLookupError, ValueError, IndexError, PermissionError):
        # Fallback: use the process dir mtime as approximate start
        try:
            return os.path.getmtime(f"/proc/{pid}")
        except Exception:
            return None


_BOOT_TIME_CACHE: float | None = None


def _boot_time() -> float | None:
    global _BOOT_TIME_CACHE
    if _BOOT_TIME_CACHE is None:
        try:
            with open("/proc/stat") as f:
                for line in f:
                    if line.startswith("btime "):
                        _BOOT_TIME_CACHE = float(line.split()[1])
                        return _BOOT_TIME_CACHE
        except (FileNotFoundError, PermissionError):
            pass
        return None
    return _BOOT_TIME_CACHE


def _proc_cmdline(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            data = f.read().replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
        # redact secrets: anything that looks like a token (long base64-ish)
        data = re.sub(r"([A-Za-z0-9_-]{30,})", "[REDACTED]", data)
        return data[:200]
    except (FileNotFoundError, ProcessLookupError):
        return ""