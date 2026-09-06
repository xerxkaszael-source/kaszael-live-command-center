<div align="center">

# 🚀 Kaszael Live Command Center

### Real‑time visual mirror of Hermes Agent + KASZAEL Workspace

**Localhost only.** No public exposure. No fake activity.

<br/>

![status](https://img.shields.io/badge/status-LIVE-22c55e?style=for-the-badge&logo=github&logoColor=white)
![stack](https://img.shields.io/badge/stack-Python%20%2B%20Vanilla%20ES-3b82f6?style=for-the-badge&logo=python&logoColor=white)
![realtime](https://img.shields.io/badge/realtime-WebSocket-a855f7?style=for-the-badge&logo=websocket&logoColor=white)
![adapters](https://img.shields.io/badge/adapters-8-f59e0b?style=for-the-badge&logo=plug&logoColor=white)
![tabs](https://img.shields.io/badge/tabs-11-e91e63?style=for-the-badge&logo=table&logoColor=white)
![build](https://img.shields.io/badge/build-3b3a48c-1a4a47f?style=for-the-badge&logo=git&logoColor=white)
![loc](https://img.shields.io/badge/loc-6.2k-3ecf8e?style=for-the-badge&logo=code&logoColor=white)

<br/>

[**📖 Docs**](./backend/README.md) ·
[**📦 Source**](https://github.com/xerxkaszael-source/kaszael-live-command-center) ·
[**🧪 Quick start**](#-quick-start)

<br/>

</div>

---

## 📖 Table of contents

- [What is it?](#-what-is-it)
- [Features at a glance](#-features-at-a-glance)
- [Architecture](#-architecture)
- [Quick start](#-quick-start)
- [Adapters](#-adapters)
- [Tabs](#-tabs)
- [Changelog](#-changelog)
- [Repo layout](#-repo-layout)
- [Security](#-security)
- [License](#-license)

---

## ✨ What is it?

**Kaszael Live Command Center (LCC)** is a local‑only, real‑time dashboard that visualises the state of the KASZAEL workspace and Hermes Agent. It aggregates telemetry, process health, GitHub status, Supabase metrics, 9Router health, filesystem changes, and expert registry — all in one web interface.

It is **not** a public service. It binds to `127.0.0.1:9119` and is intended for developers monitoring their own infrastructure.

Built by **Kaszael Lab** on Android (Termux) — Python stdlib + vanilla ES modules, no dependencies.

---

## 🎯 Features at a glance

<table>
<tr><td width="33%" valign="top">

### 📊 Real‑time state
- WebSocket push every 2s
- 8 adapter sources aggregated
- Live event stream
- Signal particles for neural graph
- Character animations (19 states, 16 stations)
- Auto‑reconnect (4s backoff)
- 2‑phase WALK state machine
- Camera math `a.tx - worldW/2`

</td><td width="33%" valign="top">

### 🧩 11 tabs
- **Command** – hero stats, active mission, agents, services
- **Neural** – SVG graph of system components (17 nodes, 31 edges, 33 event maps)
- **Office** – isometric office with characters at workstations
- **Missions** – current mission + log files
- **Agents** – 128 experts by domain + 50 role mappings
- **Events** – live event stream
- **9Router** – health, models, providers
- **Supabase** – project status, tables, RPCs
- **GitHub** – user, repos
- **Filesystem** – workspace stats + recent changes
- **System** – health categories + bootstrap chain

</td><td width="33%" valign="top">

### 🛠 Adapter architecture
- **8 adapters** – telemetry, hermes, kaztael, nine_router, supabase, github, filesystem, agents
- Modular, plug‑in design
- Each adapter produces a normalized state slice
- Adapters run in parallel, aggregated by event bus
- Read‑only — no writes to external systems
- REST fallback badge for failed WS
- WebSocket wss:// on https tunnel
- try/catch loadInitial for graceful degradation

</td></tr>
</table>

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser (localhost:9119)                                                │
│   static/index.html · styles.css · app.js (41KB)                        │
│   character-renderer.js (37KB) · neural-renderer.js (17KB)               │
│   Vanilla ES modules (no bundler, no npm)                               │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ WebSocket (/ws) + HTTP
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Python 3.13 server (asyncio)                                            │
│   server.py · event_bus.py · state.py                                   │
│   adapters/ (8) → filesystem, github, hermes, kaztael,                 │
│                  nine_router, supabase, telemetry, agents              │
│   static/ (served)                                                     │
│   Port: 9119 (localhost only)                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick start

```bash
bash /sdcard/Kaszael/projects/active/kaszael-live-command-center/start.sh
```

Then open **http://127.0.0.1:9119/**

Server stays in foreground; stop with `Ctrl+C`.

---

## 📦 Adapters (8)

| Adapter | Source |
|---------|--------|
| **telemetry** | tails `~/.kaszael/telemetry/events.jsonl` |
| **hermes** | `/proc` scan for Hermes + kernel runner + 9router processes |
| **kaztael** | reads `bootstrap.json`, `health-score.json`, layer‑audit |
| **nine_router** | polls `http://127.0.0.1:20128` |
| **supabase** | Management API via PAT |
| **github** | REST API via token |
| **filesystem** | recursive walk of `/sdcard/Kaszael` |
| **agents** | reads `lab/experts/registry.yaml` |

All adapters run in the same event‑loop and push state updates to the frontend over WebSocket.

---

## 📋 Tabs (11)

| Tab | Description |
|-----|-------------|
| **Command** | Hero stats + active mission + agents + services |
| **Neural** | SVG graph of system components (17 nodes, 31 edges, 33 event maps) with signal particles |
| **Office** | Isometric office with characters at workstations (19 states, 16 stations) |
| **Missions** | Current mission + log files |
| **Agents** | 128 experts by domain + 50 role mappings |
| **Events** | Live event stream |
| **9Router** | Health, models, providers |
| **Supabase** | Project status, tables, RPCs |
| **GitHub** | User, repos |
| **Filesystem** | Workspace stats + recent changes |
| **System** | Health categories + bootstrap chain |

---

## 📝 Changelog

### v3.1 (2026‑09‑05)
- 2‑phase WALK state machine
- Camera math `a.tx - worldW/2`
- WebSocket `wss://` on https tunnel
- REST fallback badge
- `try/catch loadInitial`

### v3.0 (2026‑09‑05)
- Character renderer: 19 states, 16 stations
- Neural renderer: 17 nodes, 31 edges, 33 event maps, signal particles
- Fixed 6 bugs:
  - `makeCharacter` ReferenceError
  - neural h2 literal img
  - `Math.random`
  - renderMissions syntax
  - WS port 9130→9119
  - telemetry reads `ev.ts` not `ev.timestamp`

### v2.0 (initial)
- 8 adapters
- 11 tabs
- Python stdlib + vanilla ES modules

---

## 📁 Repo layout

```
kaszael-live-command-center/
├── start.sh                     # entry point
├── README.md                    # this file
├── backend/
│   ├── server.py                # HTTP + WS server (600 LOC)
│   ├── event_bus.py             # in‑process pub/sub
│   ├── state.py                 # normalized state store
│   ├── adapters/                # 8 adapters (one file each)
│   │   ├── telemetry.py
│   │   ├── hermes.py
│   │   ├── kaztael.py
│   │   ├── nine_router.py
│   │   ├── supabase.py
│   │   ├── github.py
│   │   ├── filesystem.py
│   │   └── agents.py
│   ├── static/                  # frontend assets
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js               (41KB)
│   │   ├── character-renderer.js (37KB)
│   │   ├── neural-renderer.js   (17KB)
│   │   └── icons/               (46 SVG icons)
│   └── tests/
│       └── ws_test.py
└── assets/                      # project‑level assets
```

---

## 🔐 Security

- Binds to `127.0.0.1` only (no LAN/public exposure)
- All secrets redacted in agent cmdline display
- No command‑execution endpoints
- Read‑only filesystem monitoring
- Path traversal protected

---

## 🪪 License

Proprietary — Kaszael Lab. All rights reserved.

<div align="center">

<sub>Built with ☕ on Android · deployed from a phone · 8 adapters · 11 tabs · 0 external dependencies · real‑time WebSocket · 3 versions.</sub>

</div>
