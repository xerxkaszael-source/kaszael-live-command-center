// KASZAEL Live Command Center — frontend SPA
// Vanilla ES module, no deps. Real-time WebSocket + REST polling.
// Character engine: ./character-renderer.js
// Neural engine:   ./neural-renderer.js

const API = '/api';
const WS_URL = (() => {
  // Allow ?port= override for debugging
  const m = location.search.match(/[?&]port=(\d+)/);
  // If we're on https (cloudflare tunnel or similar), use wss and no port
  // (the page itself is being served on 443). Otherwise use ws://host:port/ws.
  if (m) {
    return `ws://${location.hostname}:${m[1]}/ws`;
  }
  if (location.protocol === 'https:') {
    return `wss://${location.hostname}/ws`;
  }
  if (location.port) {
    return `ws://${location.hostname}:${location.port}/ws`;
  }
  // Fallback: assume canonical LCC port 9119 on localhost
  return `ws://${location.hostname}:9119/ws`;
})();

// ---------- State ----------
const state = {
  data: null,
  ws: null,
  wsStatus: 'connecting',
  currentTab: 'command',
  history: [],
  selectedAgent: null,
};

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (c == null) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
};

// ---------- Helpers ----------
const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-US', { hour12: false });
};
const fmtAgo = (ts) => {
  if (!ts) return 'never';
  const sec = (Date.now() / 1000) - ts;
  if (sec < 5) return 'just now';
  if (sec < 60) return `${Math.floor(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
};
const freshBadge = (ts, threshold = { recent: 10, stale: 60 }) => {
  if (!ts) return { cls: 'badge-offline', text: 'OFFLINE' };
  const age = (Date.now() / 1000) - ts;
  if (age < threshold.recent) return { cls: 'badge-live', text: 'LIVE' };
  if (age < threshold.stale) return { cls: 'badge-recent', text: 'RECENT' };
  return { cls: 'badge-stale', text: 'STALE' };
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// ---------- API ----------
async function fetchJSON(path) {
  try {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(r.statusText);
    return await r.json();
  } catch (e) {
    console.error('fetch', path, e);
    return null;
  }
}

async function loadInitial() {
  let d = null;
  try {
    d = await fetchJSON('/state');
  } catch (e) {
    console.warn('[LCC] REST /state failed:', e.message || e);
  }
  if (d) {
    applyState(d);
    // If REST works, show "REST" badge so user knows we have data even
    // if WebSocket connection is slow/blocked (e.g. via https tunnel).
    if (state.wsStatus !== 'live') {
      const el = $('#ws-status');
      if (el) {
        el.className = 'badge badge-recent';
        el.innerHTML = '<img src="/icons/live.svg" width="11" height="11" alt=""><span>REST</span>';
      }
      state.wsStatus = 'rest';
    }
  } else {
    // Backend unreachable
    const main = $('#content');
    if (main) {
      main.innerHTML = '<div class="empty"><img class="empty-icon" src="/icons/system.svg" width="40" height="40" alt=""><div>NO LIVE DATA</div><span class="muted">Backend unreachable — try refreshing</span></div>';
    }
  }
}

function applyState(d) {
  state.data = d;
  const main = $('#content');
  if (!d) {
    main.innerHTML = '<div class="empty"><img class="empty-icon" src="/icons/system.svg" width="40" height="40" alt=""><div>NO LIVE DATA</div><span class="muted">Backend unreachable</span></div>';
    return;
  }
  // Dispatch to current tab renderer
  if (state.currentTab === 'command') renderCommand(d);
  else if (state.currentTab === 'neural') renderNeural(d);
  else if (state.currentTab === 'office') renderOffice(d);
  else if (state.currentTab === 'missions') renderMissions(d);
  else if (state.currentTab === 'agents') renderAgents(d);
  else if (state.currentTab === 'events') renderEvents(d);
  else if (state.currentTab === 'nine_router') renderNineRouter(d);
  else if (state.currentTab === 'supabase') renderSupabase(d);
  else if (state.currentTab === 'github') renderGitHub(d);
  else if (state.currentTab === 'filesystem') renderFilesystem(d);
  else if (state.currentTab === 'system') renderSystem(d);
}

// ===========================================================================
// WebSocket — INSTANT reconnect, no OFFLINE flicker
// ===========================================================================
let _wsReconnectAttempts = 0;
function connectWS() {
  const ws = new WebSocket(WS_URL);
  state.ws = ws;
  _wsReconnectAttempts++;
  // While connecting, show RECONNECTING (not OFFLINE)
  if (_wsReconnectAttempts > 1) {
    const el = $('#ws-status');
    if (el) {
      el.className = 'badge badge-recent';
      el.innerHTML = '<img src="/icons/live.svg" width="11" height="11" alt=""><span>RECONNECT</span>';
    }
  }
  ws.addEventListener('open', () => {
    state.wsStatus = 'live';
    _wsReconnectAttempts = 0;
    const el = $('#ws-status');
    if (el) {
      el.className = 'badge badge-live';
      el.innerHTML = '<img src="/icons/live.svg" width="11" height="11" alt=""><span>LIVE</span>';
    }
  });
  ws.addEventListener('close', () => {
    // Don't immediately show OFFLINE — show RECONNECTING with backoff
    // so the badge doesn't flicker. Only show OFFLINE after 3 failed attempts.
    state.wsStatus = 'offline';
    const el = $('#ws-status');
    if (el) {
      if (_wsReconnectAttempts >= 3) {
        el.className = 'badge badge-stale';
        el.innerHTML = '<img src="/icons/stale.svg" width="11" height="11" alt=""><span>OFFLINE</span>';
      } else {
        el.className = 'badge badge-recent';
        el.innerHTML = '<img src="/icons/live.svg" width="11" height="11" alt=""><span>RECONNECT</span>';
      }
    }
    // Reconnect with exponential backoff: 0.5s, 1s, 2s, 4s, max 8s
    const delay = Math.min(8000, 500 * Math.pow(2, _wsReconnectAttempts - 1));
    setTimeout(connectWS, delay);
  });
  ws.addEventListener('error', () => {
    state.wsStatus = 'offline';
    try { ws.close(); } catch (e) { /* ignore */ }
  });
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') applyState(msg.state);
      else if (msg.type === 'event') {
        if (!state.data) state.data = { events: [] };
        if (!state.data.events) state.data.events = [];
        state.data.events.push(msg.event);
        if (state.data.events.length > 500) state.data.events.shift();
        if (state.currentTab === 'events') renderEvents(state.data);
        // Feed live event into visual engines (Office + Neural)
        if (window.CHARACTER) CHARACTER.ingestEvent(msg.event);
        if (window.NEURAL) NEURAL.ingestEvent(msg.event);
      }
    } catch (e) { console.error(e); }
  });
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  if (state.data) applyState(state.data);
}

// ===========================================================================
// TAB 1: COMMAND CENTER
// ===========================================================================
function renderCommand(d) {
  const main = $('#content');
  main.innerHTML = '';
  const h = d.hermes || {};
  const k = d.kaztael || {};
  const nr = d.nine_router || {};
  const sb = d.supabase || {};
  const gh = d.github || {};
  const fs = d.filesystem || {};
  const t = d.telemetry || {};
  const m = d.missions || {};

  // Hero stats
  const hs = k.health_score;
  const hero = el('div', { class: 'stat-row' },
    stat('Hermes', h.alive ? 'ALIVE' : 'OFFLINE', `${h.processes?.length || 0} procs`, 'live'),
    stat('Health', hs != null ? `${hs}/100` : '—', '', hs != null && hs >= 90 ? 'live' : 'stale'),
    stat('Bootstrap', k.bootstrap_ok ? 'OK' : 'BROKEN', '', k.bootstrap_ok ? 'live' : 'stale'),
    stat('9Router', nr.running ? 'RUNNING' : 'DOWN', `${nr.models_count || 0} models`, nr.running ? 'live' : 'stale'),
    stat('Supabase', sb.project?.status || '—', sb.enabled ? `${sb.tables_count} tables` : 'disabled', sb.enabled && sb.project ? 'live' : 'stale'),
    stat('GitHub', gh.user?.login || '—', `${gh.repos?.length || 0} repos`, gh.enabled && gh.user ? 'live' : 'stale'),
    stat('Telemetry', `${t.events_total || 0}`, t.error_count ? `${t.error_count} err` : '', t.error_count > 50 ? 'stale' : 'live'),
    stat('Files', `${fs.files_tracked || 0}`, `${(fs.active_projects||[]).length} projects`, 'live'),
  );
  main.appendChild(hero);

  // Current mission + active agents
  const grid = el('div', { class: 'grid grid-cols-2' });
  const cur = m.current;
  grid.appendChild(card('Card', 'Mission Control',
    cur ? cardBody([
      field('Mission ID', cur.mission_id),
      field('Title', cur.title),
      field('State', cur.state, 'purple'),
      field('Started', fmtAgo(cur.started_at)),
      field('Event', cur.source_event),
    ]) : emptyState('mission.svg', 'NO ACTIVE MISSION', 'No mission.started event in last 100 events')
  ));

  // Active agents (top 8 by telemetry count)
  const active = (d.agents?.active || []).slice(0, 8);
  grid.appendChild(card('Card', 'Active Agents (from telemetry)',
    active.length ? el('div', { class: 'grid grid-cols-2' },
      ...active.map(a => el('div', { class: 'agent-card' },
        el('div', { class: 'agent-name' }, a.role),
        el('div', { class: 'agent-role' }, (a.matched_experts || []).slice(0, 2).join(', ') || '—'),
        el('div', { class: 'agent-count' }, `${a.count} events`),
        el('div', { class: `agent-state ${a.state === 'ACTIVE' ? 'green' : 'yellow'}` }, a.state),
      ))
    ) : emptyState('agent.svg', 'NO ACTIVE AGENTS', 'Telemetry has no recent role activity')
  ));
  main.appendChild(grid);

  // Services grid
  const svcGrid = el('div', { class: 'grid grid-cols-3' });
  svcGrid.appendChild(svcCard('9Router', nr, [
    ['endpoint', nr.endpoint],
    ['models', nr.models_count],
    ['last poll', fmtAgo(nr.last_poll_ts)],
    ['error', nr.last_error || 'none'],
  ]));
  svcGrid.appendChild(svcCard('Supabase', sb, [
    ['project', sb.project?.name],
    ['region', sb.project?.region],
    ['status', sb.project?.status],
    ['tables', sb.tables_count],
    ['rpcs', sb.rpcs_count],
  ]));
  svcGrid.appendChild(svcCard('GitHub', gh, [
    ['user', gh.user?.login],
    ['public repos', gh.repos?.length],
    ['top', gh.repos?.[0]?.full_name],
    ['last poll', fmtAgo(gh.last_poll_ts)],
  ]));
  main.appendChild(svcGrid);

  // Recent events
  main.appendChild(card('Card', 'Recent Events (live)',
    renderEventsTable((d.events || []).slice(-15).reverse())
  ));
}

function stat(label, value, sub, freshness) {
  const cls = freshness === 'live' ? 'green' : freshness === 'stale' ? 'yellow' : '';
  return el('div', { class: 'stat' },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: `stat-value ${cls}` }, value),
    sub ? el('div', { class: 'stat-sub' }, sub) : null
  );
}
function card(cls, title, body) {
  const c = el('div', { class: 'card' });
  if (title) c.appendChild(el('h3', {}, title));
  if (body) c.appendChild(body);
  return c;
}
function cardBody(rows) {
  const wrap = el('div', {});
  rows.forEach(([k, v, cls]) => {
    const row = el('div', { style: 'display:flex; justify-content:space-between; padding:3px 0; font-size:12px;' },
      el('span', { class: 'muted' }, k),
      el('span', { class: cls || 'mono' }, String(v ?? '—'))
    );
    wrap.appendChild(row);
  });
  return wrap;
}
function field(label, val, cls) { return [label, val ?? '—', cls || 'mono']; }
function emptyState(glyph, title, sub) {
  // glyph is now an icon filename like 'agent.svg' (no leading /icons/)
  const iconHtml = glyph
    ? `<img class="empty-icon" src="/icons/${glyph}" width="36" height="36" alt="">`
    : '';
  return el('div', { class: 'empty', html: iconHtml },
    el('div', {}, title),
    el('div', { class: 'muted', style: 'font-size:11px; margin-top:4px;' }, sub)
  );
}
function svcCard(title, svc, rows) {
  const enabled = svc.enabled !== false;
  return card('Card', title, el('div', {},
    el('div', { style: 'margin-bottom:8px;' },
      el('span', { class: enabled ? 'badge badge-live' : 'badge badge-offline' }, enabled ? 'ENABLED' : 'DISABLED')
    ),
    cardBody(rows)
  ));
}
function renderEventsTable(events) {
  const wrap = el('div', { class: 'events' });
  if (!events.length) wrap.appendChild(emptyState('events.svg', 'NO EVENTS', 'Bus history is empty'));
  const isEventMobile = window.innerWidth < 600;
  events.forEach(e => {
    if (isEventMobile) {
      // Stacked card layout for mobile
      wrap.appendChild(el('div', { class: 'event-card' },
        el('div', { class: 'event-card-row' },
          el('span', { class: 'event-time' }, fmtTime(e.timestamp)),
          el('span', { class: `event-status ${e.status === 'ok' || e.status === 'detected' ? 'green' : e.status === 'error' ? 'red' : 'muted'}` }, e.status || '')
        ),
        el('div', { class: 'event-type' }, e.event_type || ''),
        el('div', { class: 'event-source' }, `Source: ${e.source || '—'}`),
        el('div', { class: 'event-meta' }, e.entity_id || '')
      ));
    } else {
      // Desktop table row
      wrap.appendChild(el('div', { class: 'event-row' },
        el('span', { class: 'event-time' }, fmtTime(e.timestamp)),
        el('span', { class: 'event-type' }, e.event_type || ''),
        el('span', { class: 'event-source' }, e.source || ''),
        el('span', { class: 'event-meta' }, e.entity_id || ''),
        el('span', { class: `event-status ${e.status === 'ok' || e.status === 'detected' ? 'green' : e.status === 'error' ? 'red' : 'muted'}` }, e.status || '')
      ));
    }
  });
  return wrap;
}

// ===========================================================================
// TAB 2: NEURAL LINK — Radial core with signal particles
// ===========================================================================
let _neuralInitialized = false;
let _neuralCurrentData = null;
function renderNeural(d) {
  const main = $('#content');
  main.innerHTML = '';
  _neuralCurrentData = d;

  const wrap = el('div', { class: 'neural-wrap' });
  wrap.appendChild(el('div', { class: 'neural-header' },
    el('div', { class: 'neural-title' },
      el('img', { src: '/icons/neural.svg', width: '14', height: '14', alt: '' }),
      el('span', {}, 'Neural Link — Live Execution Topology')
    ),
    el('div', { class: 'muted neural-sub' },
      'Central Hermes core radiating to intent · mission · role · skill · tool · model · 9Router · services · verification · recovery'
    )
  ));

  // Legend pills
  const legend = el('div', { class: 'neural-legend' });
  const legendItems = [
    { c: '#00d4ff', l: 'CORE' },
    { c: '#b794ff', l: 'ROUTING' },
    { c: '#a78bfa', l: 'KASZAEL LAYERS' },
    { c: '#34d399', l: 'EXECUTION' },
    { c: '#fbbf24', l: '9ROUTER' },
    { c: '#94a3b8', l: 'SERVICES' },
    { c: '#10b981', l: 'VERIFY' },
    { c: '#fb923c', l: 'RECOVER' },
  ];
  for (const li of legendItems) {
    legend.appendChild(el('div', { class: 'zone-pill' },
      el('span', { class: 'zone-dot', style: `background:${li.c}` }),
      el('span', {}, li.l)
    ));
  }
  wrap.appendChild(legend);

  // SVG canvas
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'neural-svg');
  svg.setAttribute('id', 'neural-svg');
  // Radial layout: HERMES at center, other nodes in concentric rings
  // V4 §25: replace vertical stack with radial topology
  const isNeuralMobile = window.innerWidth < 600;
  if (isNeuralMobile) {
    svg.setAttribute('viewBox', '0 0 400 900');
  } else {
    svg.setAttribute('viewBox', '0 0 1100 750');
  }
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  wrap.appendChild(svg);

  // Stats footer
  const stats = el('div', { class: 'neural-stats' });
  stats.setAttribute('id', 'neural-stats');
  wrap.appendChild(stats);

  // Filter toolbar
  const toolbar = el('div', { class: 'neural-toolbar' });
  for (const f of ['ALL NODES', 'ACTIVE PATH', 'CORE', 'SERVICES', 'VERIFY']) {
    toolbar.appendChild(el('button', {
      class: 'neural-filter',
      onClick: (e) => {
        document.querySelectorAll('.neural-filter').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        if (window.NEURAL) window.NEURAL.setFilter(f);
      }
    }, f));
  }
  wrap.appendChild(toolbar);

  main.appendChild(wrap);

  // Initialize neural engine (only once)
  if (!_neuralInitialized && window.NEURAL) {
    NEURAL.init(svg);
    NEURAL.onNodeClick((id, n) => {
      switchTab('system');
    });
    NEURAL.start();
    _neuralInitialized = true;
  } else if (window.NEURAL) {
    NEURAL.init(svg);
    NEURAL.start();
  }

  // Replay all known events to populate graph
  if (window.NEURAL && d) {
    NEURAL.reset();
    if (d.events) {
      for (const ev of d.events.slice(-50)) NEURAL.ingestEvent(ev);
    }
    if (d.missions?.current?.source_event) {
      NEURAL.ingestEvent({ event_type: d.missions.current.source_event, role_id: d.missions.current.title });
    }
  }
}

// ===========================================================================
// TAB 3: AI OFFICE — Canvas-rendered agents with state machine
// ===========================================================================
let _officeInitialized = false;
let _officeCurrentData = null;
function renderOffice(d) {
  // IDEMPOTENT: if Office is already rendered, just update the data and
  // re-seed events. Do NOT wipe and recreate — that destroys the canvas
  // and causes a visible blink.
  if (_officeInitialized && document.getElementById('office-canvas')) {
    _officeCurrentData = d;
    // Re-seed events that arrived while user was away
    if (window.CHARACTER && d) {
      if (d.events) {
        for (const ev of d.events.slice(-30)) CHARACTER.ingestEvent(ev);
      }
    }
    return;
  }

  const main = $('#content');
  main.innerHTML = '';
  _officeCurrentData = d;

  const wrap = el('div', { class: 'office-wrap' });

  // Title bar
  wrap.appendChild(el('div', { class: 'office-header' },
    el('div', { class: 'office-title' },
      el('img', { src: '/icons/office.svg', width: '14', height: '14', alt: '' }),
      el('span', {}, 'AI Office — Live Agent Workspace')
    ),
    el('div', { class: 'muted office-sub' },
      'Agents walk to their role workstation when a real event activates their skill. Camera follows the active agent.'
    )
  ));

  // Stats row
  const stats = el('div', { class: 'office-stats' });
  stats.setAttribute('id', 'office-stats');
  stats.appendChild(statPill('ACTIVE', '0', 'green', 'os-active'));
  stats.appendChild(statPill('IDLE', '0', 'mute', 'os-idle'));
  stats.appendChild(statPill('ERROR', '0', 'red', 'os-error'));
  stats.appendChild(statPill('OFFLINE', '0', 'mute', 'os-offline'));
  stats.appendChild(statPill('TOTAL', '0', 'accent', 'os-total'));
  wrap.appendChild(stats);

  // Camera controls
  const ctrls = el('div', { class: 'office-controls' });
  ctrls.appendChild(el('button', { class: 'oc-btn', onClick: () => window.CHARACTER && CHARACTER.fitOffice() }, 'Fit'));
  ctrls.appendChild(el('button', { class: 'oc-btn', onClick: () => {
    if (window.CHARACTER) {
      const cur = (CHARACTER.targetCamera && CHARACTER.targetCamera.zoom) || 1;
      CHARACTER.setZoom(cur * 1.25);
    }
  }}, '+'));
  ctrls.appendChild(el('button', { class: 'oc-btn', onClick: () => {
    if (window.CHARACTER) {
      const cur = (CHARACTER.targetCamera && CHARACTER.targetCamera.zoom) || 1;
      CHARACTER.setZoom(cur * 0.8);
    }
  }}, '−'));
  ctrls.appendChild(el('button', { class: 'oc-btn', onClick: () => {
    if (window.CHARACTER) {
      const agents = CHARACTER.getAgents();
      const active = agents.find(a => a.state !== 'IDLE' && a.state !== 'OFFLINE');
      if (active) CHARACTER.focusAgent(active.role);
    }
  }}, 'Focus'));
  ctrls.appendChild(el('button', { class: 'oc-btn', onClick: () => {
    if (window.CHARACTER) {
      const agents = CHARACTER.getAgents();
      if (agents.length) CHARACTER.focusAgent(agents[0].role);
    }
  }}, '1st'));
  ctrls.appendChild(el('span', { class: 'oc-hint' }, 'tap agent · drag to pan · wheel to zoom'));
  wrap.appendChild(ctrls);

  // Canvas container
  const canvasContainer = el('div', { class: 'office-canvas-wrap' });
  const canvas = document.createElement('canvas');
  canvas.setAttribute('id', 'office-canvas');
  canvas.setAttribute('class', 'office-canvas');
  canvasContainer.appendChild(canvas);
  wrap.appendChild(canvasContainer);

  // Agent roster panel
  const roster = el('div', { class: 'office-roster' });
  roster.setAttribute('id', 'office-roster');
  roster.appendChild(el('div', { class: 'roster-title' }, 'AGENT ROSTER'));
  wrap.appendChild(roster);

  // Empty state
  const empty = el('div', { class: 'office-empty', id: 'office-empty' });
  empty.appendChild(el('img', { src: '/icons/office.svg', width: '48', height: '48', alt: '' }));
  empty.appendChild(el('div', { class: 'empty-title' }, 'NO ACTIVE AGENTS'));
  empty.appendChild(el('div', { class: 'muted empty-sub' }, 'Waiting for live Hermes activity…'));
  wrap.appendChild(empty);

  main.appendChild(wrap);

  // Init character engine
  if (window.CHARACTER) {
    CHARACTER.init(canvas);
    // V4: click agent opens detail panel
    CHARACTER.onAgentClick((agent) => {
      showAgentDetail(agent);
    });
    CHARACTER.onTick((statsData) => {
      const update = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      update('os-active', statsData.active);
      update('os-idle', statsData.idle);
      update('os-error', statsData.error);
      update('os-offline', statsData.offline);
      update('os-total', statsData.total);

      // Roster
      const r = document.getElementById('office-roster');
      if (r) {
        // Remove all children except title
        while (r.children.length > 1) r.removeChild(r.lastChild);
        const agents = CHARACTER.getAgents().sort((a, b) => b.activityCount - a.activityCount);
        if (agents.length === 0) {
          r.appendChild(el('div', { class: 'roster-empty muted' }, 'No agents yet'));
        } else {
          for (const a of agents.slice(0, 12)) {
            r.appendChild(el('div', { class: 'roster-row' },
              el('span', { class: `roster-dot roster-${a.state.toLowerCase()}` }),
              el('span', { class: 'roster-role' }, a.role),
              el('span', { class: 'roster-state muted' }, a.state),
              el('span', { class: 'roster-count' }, String(a.activityCount))
            ));
          }
        }
      }
      const emp = document.getElementById('office-empty');
      if (emp) emp.style.display = statsData.total === 0 ? 'flex' : 'none';
    });
    if (!_officeInitialized) {
      _officeInitialized = true;
    }
    // Always refit on visit (in case canvas resized) — after a tick so
    // clientWidth/clientHeight are accurate.
    setTimeout(() => {
      if (window.CHARACTER) {
        CHARACTER.fitOffice();
        CHARACTER.resize();
      }
    }, 80);
  }

  // Replay events to seed agents
  if (window.CHARACTER && d) {
    if (d.events) {
      for (const ev of d.events.slice(-50)) CHARACTER.ingestEvent(ev);
    }
    if (d.missions?.current) {
      CHARACTER.ingestEvent({
        event_type: d.missions.current.source_event || 'mission.started',
        role_id: 'mission-controller',
        skill_id: 'orchestration',
        mission_id: d.missions.current.mission_id,
        timestamp: d.missions.current.started_at,
      });
    }
  }
}

function statPill(label, value, color, id) {
  return el('div', { class: `stat-pill stat-${color}` },
    el('div', { class: 'stat-pill-label' }, label),
    el('div', { class: 'stat-pill-value', id }, value)
  );
}

// ===========================================================================
// V4: AGENT DETAIL PANEL
// ===========================================================================
function showAgentDetail(agent) {
  // Remove existing panel if any
  const existing = document.getElementById('agent-detail');
  if (existing) existing.remove();
  // Find the agent's most recent event in the stream
  const recent = (state.data?.events || []).slice().reverse().find(e => e.role_id === agent.role);
  const panel = el('div', { class: 'agent-detail', id: 'agent-detail' },
    el('div', { class: 'agent-detail-header' },
      el('div', { class: 'agent-detail-title' }, agent.role.toUpperCase()),
      el('button', { class: 'agent-detail-close', onClick: () => {
        const p = document.getElementById('agent-detail');
        if (p) p.remove();
      } }, '×')
    ),
    el('div', { class: 'agent-detail-body' },
      field('STATE', agent.state, agent.state === 'ERROR' ? 'red' : agent.state === 'OFFLINE' ? 'mute' : 'green'),
      field('ACTIVITY', String(agent.activityCount)),
      field('POSITION', `(${Math.round(agent.x)}, ${Math.round(agent.y)})`),
      field('LAST EVENT', recent ? recent.event_type : 'none'),
      field('LAST TOUCHED', recent ? fmtAgo(recent.timestamp) : 'never'),
      recent ? field('EVENT SOURCE', recent.source || '—') : null,
    )
  );
  document.body.appendChild(panel);
}
// ===========================================================================
// TAB 4: MISSIONS
// ===========================================================================
function renderMissions(d) {
  const main = $('#content');
  main.innerHTML = '';
  const cur = d.missions?.current;
  main.appendChild(card('Card', 'Current Mission',
    cur ? cardBody([
      field('Mission ID', cur.mission_id),
      field('Title', cur.title),
      field('State', cur.state, 'purple'),
      field('Started', fmtTime(cur.started_at) + ' (' + fmtAgo(cur.started_at) + ')'),
      field('Source Event', cur.source_event),
    ]) : emptyState('mission.svg', 'NO ACTIVE MISSION', 'No mission.started event in last 500 events')
  ));

  // Active task / role / skill derived from latest telemetry events
  const events = (d.events || []).slice().reverse();
  const lastRoleEvent = events.find(e => e.role_id && e.role_id !== 'unknown');
  const lastSkillEvent = events.find(e => e.skill_id && e.skill_id !== 'unknown');
  const lastToolEvent = events.find(e => e.event_type && e.event_type.startsWith('tool.'));
  main.appendChild(card('Card', 'Current Task Context (from latest telemetry)',
    (lastRoleEvent || lastSkillEvent || lastToolEvent) ? cardBody([
      field('Active Role', lastRoleEvent ? lastRoleEvent.role_id : '—', 'cyan'),
      field('Active Skill', lastSkillEvent ? lastSkillEvent.skill_id : '—', 'purple'),
      field('Last Tool Event', lastToolEvent ? lastToolEvent.event_type : '—'),
      field('Last Event', fmtAgo(events[0]?.timestamp)),
    ]) : emptyState('events.svg', 'NO TASK CONTEXT', 'No role/skill/tool events in stream')
  ));

  // Real mission log files from filesystem snapshot if available
  const missionLogs = (d.filesystem?.mission_logs) || [];
  const knownMissions = [
    'MISSION-20260902-001-layer-17-25-os-upgrade.md',
    'MISSION-20260902-002-kaszael-chit-chat.md',
    'MISSION-20260904-001-9router-integration.md',
    'MISSION-20260905-002-health-score-100.md',
    'MISSION-20260905-003-lcc-discovery-checkpoint.md',
  ];
  const logList = missionLogs.length ? missionLogs : knownMissions;
  main.appendChild(card('Card', `Mission Log Files (${logList.length} found)`,
    el('div', { class: 'mono', style: 'font-size:11px;' },
      ...logList.map(name => el('div', { style: 'display:flex; align-items:center; gap:6px; padding:3px 0; border-bottom:1px solid var(--border);' },
        el('img', { src: '/icons/filesystem.svg', width: '12', height: '12', alt: '' }),
        el('span', { style: 'overflow-wrap:anywhere;' }, name)
      ))
    )
  ));
}

// ===========================================================================
// TAB 5: AGENTS
// ===========================================================================
function renderAgents(d) {
  const main = $('#content');
  main.innerHTML = '';
  const agents = d.agents || {};
  const regCount = (agents.experts || []).length;
  const domains = agents.domains || {};
  main.appendChild(card('Card', `Expert Registry (${regCount} experts, ${Object.keys(domains).length} domains)`,
    el('div', { class: 'grid grid-cols-4' },
      ...Object.entries(domains).map(([dom, cnt]) => el('div', { class: 'agent-card' },
        el('div', { class: 'agent-name' }, dom),
        el('div', { class: 'agent-count' }, `${cnt}`),
        el('div', { class: 'agent-state green' }, 'REGISTRY'),
      ))
    )
  ));
  const active = agents.active || [];
  main.appendChild(card('Card', `Active Agents (from telemetry, ${active.length})`,
    active.length ? el('div', { class: 'grid grid-cols-3' },
      ...active.map(a => el('div', { class: 'agent-card' },
        el('div', { class: 'agent-name' }, a.role),
        el('div', { class: 'agent-role' }, (a.matched_experts || []).slice(0, 3).join(', ') || '—'),
        el('div', { class: 'agent-count' }, `${a.count} events`),
        el('div', { class: `agent-state ${a.state === 'ACTIVE' ? 'green' : 'yellow'}` }, a.state),
      ))
    ) : emptyState('agent.svg', 'NO ACTIVE AGENTS', 'Telemetry empty or roles unknown')
  ));
  const roleMap = agents.domain_role_map || {};
  if (Object.keys(roleMap).length > 0) {
    main.appendChild(card('Card', `Domain → Role Mapping (${Object.keys(roleMap).length})`,
      el('div', { class: 'mono', style: 'font-size:11px; max-height:300px; overflow-y:auto;' },
        ...Object.entries(roleMap).map(([dom, role]) =>
          el('div', {}, `${dom.padEnd(15)} → ${role}`)
        )
      )
    ));
  }
}

// ===========================================================================
// TAB 6: EVENTS
// ===========================================================================
function renderEvents(d) {
  const main = $('#content');
  main.innerHTML = '';
  const events = (d.events || []).slice().reverse();
  const total = d.telemetry?.events_total || 0;
  main.appendChild(card('Card', `Event Stream (${events.length} of ${total} total)`,
    renderEventsTable(events.slice(0, 200))
  ));
}

// ===========================================================================
// TAB 7: 9ROUTER
// ===========================================================================
function renderNineRouter(d) {
  const main = $('#content');
  main.innerHTML = '';
  const nr = d.nine_router || {};
  main.appendChild(card('Card', '9Router Status',
    cardBody([
      ['Endpoint', nr.endpoint || '—'],
      ['Running', nr.running ? 'YES' : 'NO', nr.running ? 'green' : 'red'],
      ['Health', JSON.stringify(nr.health || {})],
      ['Models', nr.models_count || 0],
      ['Providers', (nr.providers || []).join(', ') || '—'],
      ['Last poll', fmtAgo(nr.last_poll_ts)],
      ['Last error', nr.last_error || 'none'],
    ])
  ));
  if ((nr.models_sample || []).length > 0) {
    main.appendChild(card('Card', `Models Sample (${nr.models_count} total)`,
      el('div', {},
        ...nr.models_sample.map(m => el('div', { class: 'mono', style: 'font-size:11px; padding:3px 0;' }, `• ${m}`))
      )
    ));
  }
}

// ===========================================================================
// TAB 8: SUPABASE
// ===========================================================================
function renderSupabase(d) {
  const main = $('#content');
  main.innerHTML = '';
  const sb = d.supabase || {};
  main.appendChild(card('Card', 'Supabase Project',
    cardBody([
      ['Project Ref', sb.project_ref || '—'],
      ['Name', sb.project?.name || '—'],
      ['Region', sb.project?.region || '—'],
      ['Status', sb.project?.status || '—', sb.project?.status === 'ACTIVE_HEALTHY' ? 'green' : 'yellow'],
      ['Tables', sb.tables_count || 0],
      ['RPCs', sb.rpcs_count || 0],
      ['RLS %', sb.rls_pct || 0, 'green'],
      ['Enabled', sb.enabled ? 'YES' : 'NO (no PAT in .env)', sb.enabled ? 'green' : 'red'],
      ['Last poll', fmtAgo(sb.last_poll_ts)],
    ])
  ));
}

// ===========================================================================
// TAB 9: GITHUB
// ===========================================================================
function renderGitHub(d) {
  const main = $('#content');
  main.innerHTML = '';
  const gh = d.github || {};
  main.appendChild(card('Card', 'GitHub',
    cardBody([
      ['User', gh.user?.login || '—'],
      ['Name', gh.user?.name || '—'],
      ['Repos', gh.repos?.length || 0],
      ['Enabled', gh.enabled ? 'YES' : 'NO (no token)', gh.enabled ? 'green' : 'red'],
      ['Last poll', fmtAgo(gh.last_poll_ts)],
    ])
  ));
  if ((gh.repos || []).length > 0) {
    main.appendChild(card('Card', `Repositories (${gh.repos.length})`,
      el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Repo'), el('th', {}, 'Branch'), el('th', {}, 'Updated'), el('th', {}, 'Lang')
        )),
        el('tbody', {},
          ...gh.repos.map(r => el('tr', {},
            el('td', {}, r.full_name || ''),
            el('td', {}, r.default_branch || ''),
            el('td', {}, (r.updated_at || '').slice(0, 10)),
            el('td', {}, r.language || '—'),
          ))
        )
      )
    ));
  }
}

// ===========================================================================
// TAB 10: FILESYSTEM
// ===========================================================================
function renderFilesystem(d) {
  const main = $('#content');
  main.innerHTML = '';
  const fs = d.filesystem || {};
  main.appendChild(card('Card', 'Filesystem Monitor',
    cardBody([
      ['Workspace', fs.workspace || '—'],
      ['Files tracked', fs.files_tracked || 0],
      ['Active projects', (fs.active_projects || []).join(', ') || '—'],
    ])
  ));
  if ((fs.recent_changes || []).length > 0) {
    main.appendChild(card('Card', `Recent Changes (${fs.recent_changes.length})`,
      el('div', { class: 'mono', style: 'font-size:11px; max-height:400px; overflow-y:auto;' },
        ...fs.recent_changes.slice(0, 30).map(c => el('div', { style: 'padding:2px 0;' },
          el('span', { class: c.kind === 'new' ? 'green' : c.kind === 'removed' ? 'red' : 'yellow' }, c.kind.padEnd(10)),
          el('span', {}, c.path)
        ))
      )
    ));
  }
}

// ===========================================================================
// TAB 11: SYSTEM HEALTH
// ===========================================================================
function renderSystem(d) {
  const main = $('#content');
  main.innerHTML = '';
  const k = d.kaztael || {};
  const cats = k.health_categories || {};
  if (Object.keys(cats).length > 0) {
    main.appendChild(card('Card', `KASZAEL Health Categories (${Object.keys(cats).length})`,
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Category'), el('th', {}, 'Before'), el('th', {}, 'Now'), el('th', {}, 'Bar'))),
        el('tbody', {},
          ...Object.entries(cats).map(([name, c]) => el('tr', {},
            el('td', {}, name),
            el('td', {}, String(c.before ?? '—')),
            el('td', { class: c.score >= 90 ? 'green' : c.score >= 70 ? 'yellow' : 'red' }, String(c.score ?? '—')),
            el('td', {}, el('div', { class: 'bar' }, el('div', { class: `bar-fill ${c.score >= 90 ? 'green' : c.score >= 70 ? 'yellow' : 'red'}`, style: `width:${c.score || 0}%` })))
          ))
        )
      )
    ));
  }
  main.appendChild(card('Card', 'Bootstrap Chain',
    el('div', { class: 'grid grid-cols-2' },
      ...Object.entries(k.bootstrap_chain || {}).map(([k_, v]) =>
        el('div', { class: 'agent-card' },
          el('div', { class: 'agent-name' }, k_),
          el('div', { class: `agent-state ${v ? 'green' : 'red'}` }, v ? 'OK' : 'FAIL')
        )
      )
    )
  ));
  main.appendChild(card('Card', 'Process Monitor',
    el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'PID'), el('th', {}, 'Name'), el('th', {}, 'Uptime'))),
      el('tbody', {},
        ...(d.hermes?.processes || []).map(p => el('tr', {},
          el('td', {}, String(p.pid)),
          el('td', {}, p.name),
          el('td', {}, p.uptime_sec != null ? `${Math.floor(p.uptime_sec)}s` : '—'),
        ))
      )
    )
  ));
}

// ===========================================================================
// Command palette
// ===========================================================================
$('#cmd-btn').addEventListener('click', openCmd);
document.addEventListener('keydown', e => {
  if (e.key === '/' && !$('#cmd-input').matches(':focus')) { e.preventDefault(); openCmd(); }
  if (e.key === 'Escape') closeCmd();
});
function openCmd() {
  $('#cmd-modal').classList.remove('hidden');
  $('#cmd-input').focus();
}
function closeCmd() {
  $('#cmd-modal').classList.add('hidden');
}
$('#cmd-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const results = $('#cmd-results');
  results.innerHTML = '';
  if (!q) return;
  const items = [
    ...['command', 'neural', 'office', 'missions', 'agents', 'events', 'nine_router', 'supabase', 'github', 'filesystem', 'system'].map(t =>
      ({ kind: 'tab', label: `Tab: ${t}`, value: t })
    ),
    ...((state.data?.agents?.experts || []).slice(0, 50).map(e =>
      ({ kind: 'expert', label: `Expert: ${e.id}`, sub: e.title })
    )),
    ...((state.data?.agents?.active || []).slice(0, 20).map(a =>
      ({ kind: 'role', label: `Role: ${a.role}`, sub: `${a.count} events` })
    )),
  ];
  items.filter(i => i.label.toLowerCase().includes(q) || (i.sub || '').toLowerCase().includes(q)).slice(0, 30).forEach((i) => {
    const li = el('li', { onClick: () => { if (i.kind === 'tab') switchTab(i.value); closeCmd(); }},
      el('span', {}, i.label),
      i.sub ? el('span', { class: 'meta' }, i.sub) : null
    );
    results.appendChild(li);
  });
});

// ===========================================================================
// Boot
// ===========================================================================
console.log('[LCC] Booting...');
// Engines are attached to window by character-renderer.js and neural-renderer.js
// (which are loaded as separate ES modules BEFORE app.js in index.html).
// We just re-alias defensively in case of load-order issues.
if (typeof window !== 'undefined') {
  if (window.CHARACTER_RENDERER) {
    window.CHARACTER = window.CHARACTER || window.CHARACTER_RENDERER;
  }
  if (window.NEURAL_RENDERER) {
    window.NEURAL = window.NEURAL || window.NEURAL_RENDERER;
  }
}
console.log('[LCC] Engines ready:', { character: !!window.CHARACTER, neural: !!window.NEURAL, ws: WS_URL });

loadInitial();
connectWS();

// Connection health probe (every 5s) — only override OFFLINE→REST when data is fresh
// (don't fight the connectWS state machine during normal operation).
setInterval(() => {
  if (state.wsStatus === 'live' || state.wsStatus === 'rest') return; // connectWS handles these
  const el = document.getElementById('ws-status');
  if (!el) return;
  const telemTs = state.data && state.data.telemetry && state.data.telemetry.last_event_ts;
  const dataAge = telemTs ? (Date.now() / 1000 - telemTs) : Infinity;
  // If WS is OFFLINE but we have very fresh data, show REST instead
  if (state.wsStatus === 'offline' && dataAge < 15) {
    el.className = 'badge badge-recent';
    el.innerHTML = '<img src="/icons/live.svg" width="11" height="11" alt=""><span>REST</span>';
    state.wsStatus = 'rest';
  }
}, 5000);

// Periodic REST re-fetch (5s) as fallback for when WebSocket is unavailable
// (e.g. behind HTTPS tunnel without WSS forwarding). When WS IS live,
// this just re-applies state, which is harmless.
setInterval(async () => {
  let d = null;
  try { d = await fetchJSON('/state'); } catch (e) { /* silent */ }
  if (d) {
    applyState(d);
    // Only show REST if WS is NOT in live state (don't override LIVE)
    if (state.wsStatus !== 'live' && state.wsStatus !== 'rest') {
      const el = $('#ws-status');
      if (el) {
        el.className = 'badge badge-recent';
        el.innerHTML = '<img src="/icons/live.svg" width="11" height="11" alt=""><span>REST</span>';
      }
      state.wsStatus = 'rest';
    }
  }
}, 5000);
