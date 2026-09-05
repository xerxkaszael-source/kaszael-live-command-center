"""KASZAEL Live Command Center — backend server.

HTTP + WebSocket on http://127.0.0.1:9119
- GET /                 → serves /static/index.html (SPA)
- GET /api/state        → full state snapshot
- GET /api/health       → {ok, uptime_sec}
- GET /api/events       → recent events from bus history
- GET /api/telemetry    → telemetry aggregates
- GET /api/agents       → registry + active
- GET /api/missions     → current + history
- GET /api/projects     → filesystem scan
- GET /api/services     → 9router, supabase, github
- GET /api/timeline     → events grouped by minute
- WS /ws                → push events as they happen
"""
from __future__ import annotations
import asyncio
import json
import os
import re
import sys
import time
import traceback
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# stdlib HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import ThreadingMixIn
import threading

ROOT = Path(__file__).parent.resolve()
STATIC_DIR = ROOT / "static"

# Ensure adapters importable when run as script
sys.path.insert(0, str(ROOT))

from event_bus import BUS, Event, make_event_id  # noqa
from state import STATE
from adapters.telemetry import TelemetryAdapter  # noqa
from adapters.hermes import HermesAdapter  # noqa
from adapters.kaztael import KaztaelAdapter  # noqa
from adapters.nine_router import NineRouterAdapter  # noqa
from adapters.supabase import SupabaseAdapter  # noqa
from adapters.github import GitHubAdapter  # noqa
from adapters.filesystem import FilesystemAdapter  # noqa
from adapters.agents import AgentsAdapter  # noqa

# --- Globals ---
TELEMETRY = TelemetryAdapter("/sdcard/Kaszael/.kaszael/telemetry/events.jsonl")
HERMES = HermesAdapter()
KAZTAEL = KaztaelAdapter()
NINE_ROUTER = NineRouterAdapter()
SUPABASE = SupabaseAdapter()
GITHUB = GitHubAdapter()
FILESYSTEM = FilesystemAdapter()
AGENTS = AgentsAdapter()

# WS clients
WS_CLIENTS: set = set()
WS_LOCK = threading.Lock()

# State cache
STATE_CACHE = {
    "started_at": time.time(),
    "last_update": 0,
    "data": {},
}

# Bootstrap order: agents first (slow-changing), then start polling adapters
async def bootstrap():
    await AGENTS.start()
    await TELEMETRY.start()
    await HERMES.start()
    await KAZTAEL.start()
    await NINE_ROUTER.start()
    await SUPABASE.start()
    await GITHUB.start()
    await FILESYSTEM.start()
    # Subscribe to bus: append every event to state cache
    BUS.subscribe(_on_bus_event)
    print("[server] all adapters started", flush=True)

# Bus event -> state cache append
async def _on_bus_event(ev: Event):
    # Append to event log (capped)
    events = STATE_CACHE["data"].setdefault("events", [])
    events.append(_ev_to_dict(ev))
    if len(events) > 500:
        del events[:-500]
    # Broadcast to WS clients
    msg = json.dumps({"type": "event", "event": _ev_to_dict(ev)})
    encoded = _ws_encode(msg)
    dead = set()
    clients_snapshot = []
    with WS_LOCK:
        clients_snapshot = list(WS_CLIENTS)
    for ws in clients_snapshot:
        try:
            ws.write(encoded)
            await ws.drain()
        except Exception:
            dead.add(ws)
    if dead:
        with WS_LOCK:
            for d in dead:
                WS_CLIENTS.discard(d)
    # Update overall freshness
    STATE_CACHE["last_update"] = ev.timestamp

def _ev_to_dict(ev: Event) -> dict:
    return {
        "event_id": ev.event_id,
        "timestamp": ev.timestamp,
        "source": ev.source,
        "event_type": ev.event_type,
        "entity_type": ev.entity_type,
        "entity_id": ev.entity_id,
        "status": ev.status,
        "layer_id": ev.layer_id,
        "mission_id": ev.mission_id,
        "agent_id": ev.agent_id,
        "role_id": ev.role_id,
        "skill_id": ev.skill_id,
        "tool_id": ev.tool_id,
        "provider_id": ev.provider_id,
        "evidence_ref": ev.evidence_ref,
        "metadata": ev.metadata,
    }

# State snapshot builder
def build_state() -> dict:
    now = time.time()
    # Build overall state
    hermes = HERMES.snapshot()
    kaztael = KAZTAEL.snapshot()
    nine = NINE_ROUTER.snapshot()
    sb = SUPABASE.snapshot()
    gh = GITHUB.snapshot()
    fs = FILESYSTEM.snapshot()
    agents_data = AGENTS.snapshot()
    # Derive active agents from telemetry counts
    # Get telemetry aggregates (from telemetry adapter)
    telem = TELEMETRY.last_event_ts  # may be None
    events_by_role = TELEMETRY.events_by_role
    events_by_type = TELEMETRY.events_by_type
    events_by_layer = TELEMETRY.events_by_layer
    active_agents = AGENTS.active_from_telemetry(events_by_role, limit=20)
    # Mission from: most recent mission.* event
    history = BUS.history(500, event_type="mission.started")
    current_mission = None
    if history:
        last = history[-1]
        current_mission = {
            "mission_id": last.mission_id or last.entity_id,
            "title": (last.metadata or {}).get("title") or last.entity_id,
            "state": (last.metadata or {}).get("state") or "EXECUTING",
            "started_at": last.timestamp,
            "source_event": last.event_type,
        }
    # Recompute freshness per source
    def fresh(ts, threshold_recent=10, threshold_stale=60):
        if ts is None:
            return "OFFLINE"
        age = now - ts
        if age < threshold_recent: return "LIVE"
        if age < threshold_stale: return "RECENT"
        return "STALE"
    state = {
        "server": {
            "started_at": STATE_CACHE["started_at"],
            "uptime_sec": now - STATE_CACHE["started_at"],
            "port": 9119,
            "version": "0.1.0",
        },
        "hermes": {**hermes, "freshness": fresh(hermes.get("last_snapshot_ts"))},
        "kaztael": kaztael,
        "nine_router": nine,
        "supabase": sb,
        "github": gh,
        "filesystem": fs,
        # Strip heavy static fields (experts, domains, role mappings) from
        # the WS push — they're ~28KB and never change. REST still has them
        # for the Agents page.
        "agents": {**{k: v for k, v in agents_data.items() if k not in ("experts", "domains", "domain_role_map", "roles_unique")}, "active": active_agents},
        "missions": {
            "current": current_mission,
            "history_count": len(history),
        },
        "telemetry": {
            "events_total": TELEMETRY.success_count + TELEMETRY.error_count,
            "events_by_type": events_by_type,
            "events_by_role": events_by_role,
            "events_by_layer": events_by_layer,
            "events_by_skill": TELEMETRY.events_by_skill,
            "success_count": TELEMETRY.success_count,
            "error_count": TELEMETRY.error_count,
            "last_event_ts": TELEMETRY.last_event_ts,
            "freshness": fresh(TELEMETRY.last_event_ts, threshold_recent=10, threshold_stale=60),
        },
        "events": STATE_CACHE["data"].get("events", [])[-50:],  # cap at 50 for WS push (vs 500 in REST)
    }
    STATE_CACHE["last_update"] = now
    STATE_CACHE["data"] = state
    return state

# Background state pusher
async def push_state_loop():
    """Push state to all connected WS clients every 2s.
    IMPORTANT: we must await drain() after write so the writer's internal
    buffer doesn't fill up and cause silent connection drops. With 141KB+
    state payloads (events array), a non-awaited write can fill the
    default 64KB transport buffer and the next write raises
    ConnectionResetError, which silently removes the client.
    """
    last_sent_signature = None
    while True:
        try:
            snap = build_state()
            # Skip if nothing changed since last push (save bandwidth)
            sig = (snap.get("hermes", {}).get("alive"),
                   snap.get("telemetry", {}).get("events_total"),
                   snap.get("missions", {}).get("current", {}).get("mission_id") if snap.get("missions", {}).get("current") else None,
                   len(snap.get("events", [])))
            if sig == last_sent_signature:
                await asyncio.sleep(2.0)
                continue
            last_sent_signature = sig
            msg = json.dumps({"type": "state", "state": snap})
            dead = set()
            clients_snapshot = []
            with WS_LOCK:
                clients_snapshot = list(WS_CLIENTS)
            for ws in clients_snapshot:
                try:
                    ws.write(_ws_encode(msg))
                    await ws.drain()
                except Exception:
                    dead.add(ws)
            if dead:
                with WS_LOCK:
                    for d in dead:
                        WS_CLIENTS.discard(d)
        except Exception as e:
            print(f"[push] err: {e}", flush=True)
        await asyncio.sleep(2.0)

# WebSocket handler using asyncio raw socket
WS_HANDSHAKE_RE = re.compile(rb"Sec-WebSocket-Key:\s*(\S+)", re.IGNORECASE)

async def ws_handler(reader, writer, method=None, path=None, headers=None):
    """Minimal RFC 6455 WebSocket handler for Python's asyncio.

    `headers` is the dict already parsed by HTTPHandler (with lowercase keys).
    We do NOT re-read the request — that would block.
    """
    try:
        # Find Sec-WebSocket-Key (case-insensitive in headers dict)
        key = None
        if headers:
            for k, v in headers.items():
                if k.lower() == "sec-websocket-key":
                    key = v.encode()
                    break
        if not key:
            print(f"[ws] no Sec-WebSocket-Key in headers: {list(headers.keys()) if headers else None}", flush=True)
            writer.close()
            return
        # Compute accept
        import hashlib, base64
        accept = base64.b64encode(
            hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-5AB5DC11B85A").digest()
        )
        response = (
            b"HTTP/1.1 101 Switching Protocols\r\n"
            b"Upgrade: websocket\r\n"
            b"Connection: Upgrade\r\n"
            b"Sec-WebSocket-Accept: " + accept + b"\r\n\r\n"
        )
        writer.write(response)
        await writer.drain()
        print(f"[ws] upgrade complete, registering client", flush=True)
        # Register
        with WS_LOCK:
            WS_CLIENTS.add(writer)
        # Send initial state
        try:
            initial = json.dumps({"type": "state", "state": build_state()})
            writer.write(_ws_encode(initial))
            await writer.drain()
            print(f"[ws] initial state sent ({len(initial)} bytes)", flush=True)
        except Exception as e:
            print(f"[ws] initial state err: {e}", flush=True)
        # Read loop (discard frames; we just need the connection alive)
        while True:
            data = await reader.read(4096)
            if not data:
                break
            # could parse frames but for now we only push
    except Exception as e:
        # print(f"[ws] err: {e}", flush=True)
        pass
    finally:
        with WS_LOCK:
            WS_CLIENTS.discard(writer)
        try:
            writer.close()
        except Exception:
            pass


def _ws_encode(payload: str) -> bytes:
    """Minimal client→server frame encoding (server doesn't need client msgs but keep stub)."""
    data = payload.encode()
    if len(data) < 126:
        return bytes([0x81, len(data)]) + data
    elif len(data) < 65536:
        return bytes([0x81, 126, (len(data) >> 8) & 0xff, len(data) & 0xff]) + data
    else:
        return bytes([0x81, 127]) + len(data).to_bytes(8, "big") + data


# HTTP request handler using asyncio
class HTTPHandler:
    def __init__(self, reader, writer, loop):
        self.reader = reader
        self.writer = writer
        self.loop = loop
        self.peername = writer.get_extra_info("peername")

    async def handle(self):
        try:
            request_line = await self.reader.readline()
            if not request_line:
                return
            print(f"[http] {self.peername} request: {request_line[:80]!r}", flush=True)
            try:
                method, path, _ = request_line.decode("latin-1").split(" ", 2)
            except ValueError:
                return
            # Read headers
            self.headers = {}
            while True:
                line = await self.reader.readline()
                if not line or line == b"\r\n":
                    break
                try:
                    k, v = line.decode("latin-1").split(":", 1)
                    self.headers[k.strip().lower()] = v.strip()
                except ValueError:
                    pass
            print(f"[http] {self.peername} {method} {path} headers={len(self.headers)}", flush=True)
            # Route
            if path == "/ws":
                # Hand raw reader/writer to ws_handler without re-reading the request
                await ws_handler(self.reader, self.writer, method, path, self.headers)
                return
            await self._route(method, path)
        except Exception as e:
            print(f"[http] err: {e}", flush=True)
            traceback.print_exc()
        finally:
            try:
                self.writer.close()
            except Exception:
                pass

    async def _route(self, method, path):
        parsed = urlparse(path)
        p = parsed.path
        qs = parse_qs(parsed.query)
        # API routes
        if p == "/api/health":
            return await self._json({"ok": True, "uptime_sec": time.time() - STATE_CACHE["started_at"], "version": "0.1.0"})
        if p == "/api/state":
            return await self._json(build_state())
        if p == "/api/events":
            limit = int(qs.get("limit", ["100"])[0])
            evs = [{"timestamp": e["timestamp"], "source": e["source"], "event_type": e["event_type"],
                    "entity_type": e["entity_type"], "entity_id": e["entity_id"],
                    "status": e["status"], "role_id": e["role_id"], "skill_id": e["skill_id"],
                    "layer_id": e["layer_id"]} for e in STATE_CACHE["data"].get("events", [])[-limit:]]
            return await self._json({"events": evs})
        if p == "/api/telemetry":
            return await self._json({
                "events_total": TELEMETRY.success_count + TELEMETRY.error_count,
                "events_by_type": TELEMETRY.events_by_type,
                "events_by_role": TELEMETRY.events_by_role,
                "events_by_layer": TELEMETRY.events_by_layer,
                "events_by_skill": TELEMETRY.events_by_skill,
                "success_count": TELEMETRY.success_count,
                "error_count": TELEMETRY.error_count,
                "last_event_ts": TELEMETRY.last_event_ts,
            })
        if p == "/api/agents":
            sd = AGENTS.snapshot()
            return await self._json({**sd, "active": AGENTS.active_from_telemetry(TELEMETRY.events_by_role, limit=20)})
        if p == "/api/missions":
            history = BUS.history(500, event_type="mission.started")
            return await self._json({
                "current": (history[-1] if history else None).__dict__ if history else None,
                "history": [{"mission_id": e.entity_id, "timestamp": e.timestamp} for e in history],
            })
        if p == "/api/projects":
            return await self._json(FILESYSTEM.snapshot())
        if p == "/api/services":
            return await self._json({
                "nine_router": NINE_ROUTER.snapshot(),
                "supabase": SUPABASE.snapshot(),
                "github": GITHUB.snapshot(),
                "hermes": HERMES.snapshot(),
            })
        if p == "/api/timeline":
            events = STATE_CACHE["data"].get("events", [])
            by_min = defaultdict(list)
            for e in events:
                bucket = int(e["timestamp"]) // 60
                by_min[bucket].append(e)
            timeline = [{"minute": k * 60, "count": len(v)} for k, v in sorted(by_min.items())]
            return await self._json({"timeline": timeline})
        # Static
        if p == "/" or p == "":
            p = "/index.html"
        # Prevent path traversal
        if ".." in p or p.startswith("//"):
            return await self._404()
        file_path = STATIC_DIR / p.lstrip("/")
        if not file_path.exists() or not file_path.is_file():
            # SPA fallback to index.html
            file_path = STATIC_DIR / "index.html"
        if not file_path.exists():
            return await self._404()
        return await self._serve_file(file_path)

    async def _json(self, obj):
        body = json.dumps(obj, default=str).encode()
        self.writer.write(b"HTTP/1.1 200 OK\r\n")
        self.writer.write(b"Content-Type: application/json\r\n")
        self.writer.write(b"Access-Control-Allow-Origin: *\r\n")
        self.writer.write(f"Content-Length: {len(body)}\r\n\r\n".encode())
        self.writer.write(body)
        await self.writer.drain()

    async def _404(self):
        self.writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
        await self.writer.drain()

    async def _serve_file(self, path: Path):
        # Determine mime
        ext = path.suffix.lower()
        mime = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".json": "application/json",
            ".png": "image/png",
            ".ico": "image/x-icon",
        }.get(ext, "application/octet-stream")
        body = path.read_bytes()
        self.writer.write(b"HTTP/1.1 200 OK\r\n")
        self.writer.write(f"Content-Type: {mime}\r\n".encode())
        self.writer.write(b"Access-Control-Allow-Origin: *\r\n")
        self.writer.write(f"Content-Length: {len(body)}\r\n\r\n".encode())
        self.writer.write(body)
        await self.writer.drain()


async def main():
    HOST = "127.0.0.1"
    PORT = int(os.environ.get("LCC_PORT", "9119"))
    print(f"[server] starting on http://{HOST}:{PORT}", flush=True)
    # Start adapters
    await bootstrap()
    # State pusher
    asyncio.create_task(push_state_loop())
    # HTTP server
    async def handle_client(reader, writer):
        await HTTPHandler(reader, writer, asyncio.get_event_loop()).handle()
    # Try primary port first, then a list of fallbacks if it's busy
    PORTS_TO_TRY = [int(os.environ.get("LCC_PORT", "9119")), 9130, 9140, 9150, 9160, 9170, 9180]
    server = None
    for port in PORTS_TO_TRY:
        try:
            server = await asyncio.start_server(handle_client, HOST, port)
            PORT = port
            break
        except OSError as e:
            if e.errno == 98:  # address in use
                print(f"[server] port {port} in use, trying next", flush=True)
                continue
            raise
    if not server:
        print(f"[server] no available port in {PORTS_TO_TRY}", flush=True)
        return
    print(f"[server] listening on http://{HOST}:{PORT}", flush=True)
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[server] shutting down", flush=True)