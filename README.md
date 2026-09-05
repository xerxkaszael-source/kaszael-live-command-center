# 🚀 Kaszael Live Command Center

> Real-time visual mirror of Hermes Agent + KASZAEL Workspace.  
> **Localhost only.** No public exposure. No fake activity.

---

## 📊 Project Statistics

| Metric | Value |
|--------|-------|
| **Total code files** | 20 |
| **Total lines of code** | 5,282 |
| **Languages** | .sh, .md, .py, .html, .css, .js |
| **Commits** | 1 |
| **Last updated** | Sun Sep 6 06:27:55 2026 +0700 |

---

## 🧩 Architecture

- **Backend**: Python 3.13 stdlib (asyncio + http + websockets hand-rolled, ~600 LOC)
- **Frontend**: Vanilla ES modules + SVG (no bundler, no npm)
- **Realtime**: WebSocket on `/ws` with 2s state push + on-event push
- **Adapters**: 8 adapters for telemetry, Hermes, Kaztael, 9Router, Supabase, GitHub, filesystem, agents

---

## 🚀 Quick Start

```bash
bash /sdcard/Kaszael/projects/active/kaszael-live-command-center/start.sh
```

Then open **http://127.0.0.1:9119/**

---

## 📋 Tabs

- **Command** – Hero stats + active mission + agents + services
- **Neural** – SVG graph of system components
- **Office** – Isometric office with characters at workstations
- **Missions** – Current mission + log files
- **Agents** – 128 experts by domain + 50 role mappings
- **Events** – Live event stream
- **9Router** – Health, models, providers
- **Supabase** – Project status, tables, RPCs
- **GitHub** – User, repos
- **Filesystem** – Workspace stats + recent changes
- **System** – Health categories + bootstrap chain

---

## 📦 Adapters (8)

1. **telemetry** – tails `~/.kaszael/telemetry/events.jsonl`
2. **hermes** – `/proc` scan for Hermes + kernel runner + 9router processes
3. **kaztael** – reads bootstrap.json, health-score.json, layer-audit
4. **nine_router** – polls http://127.0.0.1:20128
5. **supabase** – Management API via PAT
6. **github** – REST API via token
7. **filesystem** – recursive walk of `/sdcard/Kaszael`
8. **agents** – reads `lab/experts/registry.yaml`

---

## 🔐 Security

- Binds to 127.0.0.1 only (no LAN/public)
- All secrets redacted in agent cmdline display
- No command-execution endpoints
- Read-only filesystem monitoring
- Path traversal protected

---

## 📝 Changelog

### v3.1 (2026-09-05)
- 2-phase WALK state machine  
- Camera math `a.tx - worldW/2`  
- WebSocket `wss://` on https tunnel  
- REST fallback badge  
- `try/catch loadInitial`

### v3.0 (2026-09-05)
- Character renderer: 19 states, 16 stations  
- Neural renderer: 17 nodes, 31 edges, 33 event maps, signal particles  
- Fixed 6 bugs:  
  - `makeCharacter` ReferenceError  
  - neural h2 literal img  
  - Math.random  
  - renderMissions syntax  
  - WS port 9130→9119  
  - telemetry reads `ev.ts` not `ev.timestamp`

### v2.0 (initial)
- 8 adapters  
- 11 tabs  
- Python stdlib + vanilla ES modules

---

## 📁 Directory Structure

```
kaszael-live-command-center/
├── start.sh
├── README.md
├── backend/
│   ├── server.py          # HTTP + WS server
│   ├── event_bus.py       # in-process pub/sub
│   ├── state.py           # normalized state
│   ├── adapters/          # 8 adapters
│   ├── static/            # index.html, styles.css, app.js, icons/
│   └── tests/             # ws_test.py
└── assets/                # project-level assets
```

---

## 📜 License

Proprietary — Kaszael Workspace.
