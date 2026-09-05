# Kaszael Live Command Center

Real-time visual mirror of Hermes Agent + KASZAEL Workspace.

**Localhost only.** No public exposure. No fake activity.

## Statistics

- **Total code files:** 18
- **Total lines of code:** 5221
- **Languages:** .sh, .py, .html, .css, .js
- **Last updated:** Sun Sep  6 06:27:36 WIB 2026

## Changelog

### v3.1 (2026-09-05)
- 2-phase WALK state machine
- Camera math a.tx - worldW/2
- WebSocket wss:// on https tunnel
- REST fallback badge
- try/catch loadInitial

### v3.0 (2026-09-05)
- Character renderer: 19 states, 16 stations
- Neural renderer: 17 nodes, 31 edges, 33 event maps, signal particles
- Fixed 6 bugs: makeCharacter ReferenceError, neural h2 literal img, Math.random, renderMissions syntax, WS port 9130→9119, telemetry reads ev.ts not ev.timestamp

### v2.0 (initial)
- 8 adapters: telemetry, hermes, kaztael, nine_router, supabase, github, filesystem, agents
- 11 tabs: Command, Neural, Office, Missions, Agents, Events, 9Router, Supabase, GitHub, Filesystem, System
- Python stdlib + vanilla ES modules

## Quick Start

```bash
bash /sdcard/Kaszael/projects/active/kaszael-live-command-center/start.sh
```

Open http://127.0.0.1:9119/

## Architecture

- **Backend**: Python 3.13 stdlib (asyncio + http + websockets hand-rolled, ~600 LOC)
- **Frontend**: Vanilla ES modules + SVG (no bundler)
- **Realtime**: WebSocket on `/ws` with 2s state push + on-event push
- **Adapters**: 8 adapters for telemetry, Hermes, Kaztael, 9Router, Supabase, GitHub, filesystem, agents

## License

Proprietary — Kaszael Workspace.
