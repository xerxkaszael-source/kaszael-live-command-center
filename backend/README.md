# KASZAEL Live Command Center — Backend

Pure-stdlib Python backend (no external deps). Runs on http://127.0.0.1:9119.

## Structure
- `server.py` — HTTP + WebSocket server entry point
- `event_bus.py` — In-process pub/sub bus
- `state.py` — Normalized state store
- `adapters/` — Data source adapters (telemetry, hermes, kaztael, supabase, github, ninerouter, filesystem, processes)
- `static/` — Frontend served from here (../frontend/ symlinked in)
- `tests/` — Tests