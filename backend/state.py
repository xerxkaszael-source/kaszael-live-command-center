"""Normalized state store.

One source of truth for the entire UI. Built from real adapter snapshots;
never fabricated. Subscribers (HTTP handlers, WS clients) read from here.
"""
from __future__ import annotations
import time
from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class State:
    # Hermes
    hermes: dict = field(default_factory=lambda: {
        "process": None,         # {pid, name, status, started_at}
        "uptime_sec": None,
        "alive": False,
        "last_event_ts": None,
        "freshness": "UNKNOWN",  # LIVE / RECENT / STALE / OFFLINE
    })

    # KASZAEL
    kaztael: dict = field(default_factory=lambda: {
        "bootstrap_ok": None,
        "bootstrap_chain": {},
        "health_score": None,    # 0..100
        "health_evidence": None,
        "diagnostics": {},       # {script: pass/total}
        "layers_defined": None,
        "runtime_used": None,
    })

    # Missions
    missions: dict = field(default_factory=lambda: {
        "current": None,         # {id, title, state, objective}
        "history": [],           # list of past mission ids
    })

    # Agents (from registry.yaml + recent telemetry)
    agents: dict = field(default_factory=lambda: {
        "registry": [],          # 128 expert entries (id, title, domain)
        "active": [],            # recently-active agents from telemetry
    })

    # Roles
    roles: dict = field(default_factory=lambda: {
        "registry": [],          # 50 unique roles
        "active": [],            # role frequency from telemetry
    })

    # Skills
    skills: dict = field(default_factory=lambda: {
        "covered": [],           # unique skills seen in events
        "active": [],
    })

    # Integrations
    nine_router: dict = field(default_factory=lambda: {
        "running": False,
        "endpoint": None,
        "health": None,
        "models_count": None,
    })
    supabase: dict = field(default_factory=lambda: {
        "project_ref": None,
        "status": None,
        "region": None,
        "tables_count": None,
        "rpcs_count": None,
        "rls_enabled": None,
    })
    github: dict = field(default_factory=lambda: {
        "reachable": False,
        "user": None,
        "repos": [],
    })

    # Filesystem
    filesystem: dict = field(default_factory=lambda: {
        "workspace": "/sdcard/Kaszael",
        "active_projects": [],
        "recent_changes": [],
    })

    # Processes
    processes: dict = field(default_factory=lambda: {
        "hermes": [],
        "nine_router": [],
        "other": [],
    })

    # Recent events (for UI event stream)
    events: list = field(default_factory=list)  # last 200

    # Telemetry aggregates
    telemetry: dict = field(default_factory=lambda: {
        "events_total": 0,
        "success_rate_pct": None,
        "error_count": 0,
        "events_by_type": {},
        "events_by_role": {},
        "events_by_layer": {},
        "last_event_ts": None,
    })

    # Mission/task graph
    task_graph: dict = field(default_factory=lambda: {
        "nodes": [],   # {id, label, state}
        "edges": [],   # {from, to}
    })

    # Verification
    verification: dict = field(default_factory=lambda: {
        "health_score": None,
        "evidence_files": {},
    })

    # Incidents
    incidents: dict = field(default_factory=lambda: {
        "recent": [],   # from telemetry recovery.test.missed
        "active": None,
    })

    # Server meta
    server: dict = field(default_factory=lambda: {
        "started_at": time.time(),
        "version": "0.1.0",
        "port": 9119,
    })

    def to_dict(self) -> dict:
        return asdict(self)


# Global
STATE = State()