// KASZAEL Live Command Center — Character Renderer
// Canvas-based 2D character engine. Rive/Spine-compatible API so it can
// be swapped to @rive-app/canvas or spine-player later by replacing only
// this file. No external dependencies. Drives all office agents from
// real telemetry events.
//
// Architecture:
//   WORLD STATE (authoritative)  <- canonical agent state from server
//     |
//     v
//   RENDER STATE (visual only)  <- lerp/animations, never mutates world
//     |
//     v
//   CANVAS FRAME (60fps rAF)
//
// Each character supports the brief's state set (§5):
//   IDLE, WALK, SIT, TYPE, THINK, READ, CODE, DEBUG, TEST, RESEARCH,
//   DATABASE, SECURITY, DEPLOY, WAIT, ERROR, RECOVER, SUCCESS, OFFLINE

const CHARACTER_RENDERER = (() => {
  const FRAME_MS = 1000 / 60; // target 60fps, but rAF self-throttles
  const LERP_RATE = 0.12;     // position interpolation per frame
  const WALK_SPEED = 1.6;     // px per frame at 60fps

  // Role -> color palette (workstation monitor + accent + body stripe)
  const ROLE_PALETTE = {
    'mission-controller': { primary: '#00d4ff', accent: '#7dd3fc', dark: '#0369a1' },
    'software-engineer':   { primary: '#34d399', accent: '#86efac', dark: '#047857' },
    'backend-engineer':    { primary: '#22c55e', accent: '#86efac', dark: '#15803d' },
    'frontend-engineer':   { primary: '#a78bfa', accent: '#c4b5fd', dark: '#6d28d9' },
    'database-engineer':   { primary: '#fb923c', accent: '#fdba74', dark: '#c2410c' },
    'supabase-engineer':   { primary: '#f97316', accent: '#fdba74', dark: '#9a3412' },
    'security-engineer':   { primary: '#f87171', accent: '#fca5a5', dark: '#b91c1c' },
    'qa-engineer':         { primary: '#fbbf24', accent: '#fde68a', dark: '#a16207' },
    'devops-engineer':     { primary: '#b794ff', accent: '#d8b4fe', dark: '#6b21a8' },
    'ai-engineer':         { primary: '#f472b6', accent: '#f9a8d4', dark: '#be185d' },
    'research-engineer':   { primary: '#c4b5fd', accent: '#ddd6fe', dark: '#5b21b6' },
    'github-engineer':     { primary: '#94a3b8', accent: '#cbd5e1', dark: '#475569' },
    'sre-engineer':        { primary: '#fbbf24', accent: '#fde68a', dark: '#92400e' },
    'bootstrap-orchestrator': { primary: '#06b6d4', accent: '#67e8f9', dark: '#0e7490' },
    'verification-engineer':  { primary: '#10b981', accent: '#6ee7b7', dark: '#065f46' },
    'unknown':             { primary: '#64748b', accent: '#94a3b8', dark: '#334155' },
  };

  // Station coordinates (world space 2400x1400, brief §21)
  const STATIONS = {
    cmd:  { x: 200,  y: 200, label: 'Command' },
    eng:  { x: 400,  y: 200, label: 'Engineering' },
    be:   { x: 600,  y: 200, label: 'Backend' },
    fe:   { x: 800,  y: 200, label: 'Frontend' },
    db:   { x: 1000, y: 200, label: 'Database' },
    sb:   { x: 1200, y: 200, label: 'Supabase' },
    sec:  { x: 1400, y: 200, label: 'Security' },
    qa:   { x: 200,  y: 700, label: 'QA' },
    ops:  { x: 400,  y: 700, label: 'DevOps' },
    ai:   { x: 600,  y: 700, label: 'AI/ML' },
    rsrch:{ x: 800,  y: 700, label: 'Research' },
    gh:   { x: 1000, y: 700, label: 'GitHub' },
    depl: { x: 1200, y: 700, label: 'Deploy' },
    obs:  { x: 1400, y: 700, label: 'Monitoring' },
    rec:  { x: 200,  y: 1100, label: 'Recovery' },
    default: { x: 1500, y: 1200, label: 'Lobby' },
  };

  // Role -> station id mapping (for the office layout)
  const ROLE_TO_STATION = {
    'mission-controller': 'cmd',
    'software-engineer':   'eng',
    'backend-engineer':    'be',
    'frontend-engineer':   'fe',
    'database-engineer':   'db',
    'supabase-engineer':   'sb',
    'security-engineer':   'sec',
    'qa-engineer':         'qa',
    'devops-engineer':     'ops',
    'ai-engineer':         'ai',
    'research-engineer':   'rsrch',
    'github-engineer':     'gh',
    'sre-engineer':        'obs',
    'verification-engineer':'qa',
    'bootstrap-orchestrator':'cmd',
  };

  // State -> animation behavior
  // Every state must have: { legPose, armPose, headPose, glowColor, speed, loop }
  const STATE_ANIM = {
    IDLE:        { head: 0, arm: 0, leg: 0, glow: null,         speed: 1.0, loop: 'breath' },
    WALK:        { head: 0, arm: 1, leg: 2, glow: null,         speed: 1.6, loop: 'walk' },
    SIT:         { head: 0, arm: 0, leg: 3, glow: null,         speed: 0.0, loop: 'sit' },
    TYPE:        { head: 1, arm: 4, leg: 3, glow: '#00d4ff',    speed: 4.0, loop: 'type' },
    CODE:        { head: 1, arm: 4, leg: 3, glow: '#34d399',    speed: 3.5, loop: 'type' },
    THINK:       { head: 2, arm: 5, leg: 3, glow: '#b794ff',    speed: 0.5, loop: 'think' },
    READ:        { head: 1, arm: 6, leg: 3, glow: '#fbbf24',    speed: 0.3, loop: 'read' },
    WRITE:       { head: 1, arm: 4, leg: 3, glow: '#34d399',    speed: 3.0, loop: 'type' },
    TEST:        { head: 1, arm: 7, leg: 3, glow: '#fbbf24',    speed: 2.5, loop: 'test' },
    DEBUG:       { head: 2, arm: 5, leg: 3, glow: '#f87171',    speed: 1.0, loop: 'debug' },
    RESEARCH:    { head: 1, arm: 6, leg: 3, glow: '#a78bfa',    speed: 0.5, loop: 'read' },
    DATABASE:    { head: 1, arm: 4, leg: 3, glow: '#fb923c',    speed: 2.0, loop: 'type' },
    SECURITY:    { head: 2, arm: 5, leg: 3, glow: '#f87171',    speed: 1.0, loop: 'scan' },
    DEPLOY:      { head: 1, arm: 7, leg: 3, glow: '#34d399',    speed: 3.0, loop: 'deploy' },
    WAIT:        { head: 0, arm: 8, leg: 3, glow: null,         speed: 0.3, loop: 'breath' },
    ERROR:       { head: 3, arm: 9, leg: 0, glow: '#f87171',    speed: 6.0, loop: 'alert' },
    RECOVER:     { head: 2, arm: 5, leg: 0, glow: '#fb923c',    speed: 2.0, loop: 'repair' },
    SUCCESS:     { head: 1, arm: 10, leg: 0, glow: '#34d399',   speed: 1.5, loop: 'celebrate' },
    OFFLINE:     { head: 4, arm: 11, leg: 0, glow: '#475569',   speed: 0.0, loop: null },
  };

  // World state store
  const agents = new Map(); // role -> agent
  let lastFrame = 0;
  let rafId = null;
  let reducedMotion = false;
  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let worldW = 1600, worldH = 1400;
  let camera = { x: 0, y: 0, zoom: 1 };
  let targetCamera = { x: 0, y: 0, zoom: 1 };
  let onTickCallback = null;
  let lastEvents = [];
  let isPaused = false;
  let isoMode = true;  // isometric projection (default ON for V4)
  let agentClickCallback = null;

  // Waypoint graph for pathfinding (V4 §11)
  // Nodes are walkable points; edges are straight paths between them.
  const NAV_NODES = [
    { id: 'lobby',           x: 1500, y: 1200, type: 'spawn' },
    { id: 'corridor_h_top',  x: 800,  y: 250,  type: 'corridor' },
    { id: 'corridor_h_mid',  x: 800,  y: 700,  type: 'corridor' },
    { id: 'corridor_h_bot',  x: 800,  y: 1150, type: 'corridor' },
    { id: 'corridor_v_left', x: 200,  y: 700,  type: 'corridor' },
    { id: 'corridor_v_right',x: 1400, y: 700,  type: 'corridor' },
  ];
  // Adjacency: from -> [to1, to2, ...]
  const NAV_EDGES = {
    'lobby':           ['corridor_h_bot'],
    'corridor_h_bot':  ['lobby', 'corridor_h_mid', 'corridor_v_left', 'corridor_v_right'],
    'corridor_h_mid':  ['corridor_h_bot', 'corridor_h_top', 'corridor_v_left', 'corridor_v_right'],
    'corridor_h_top':  ['corridor_h_mid', 'corridor_v_left', 'corridor_v_right'],
    'corridor_v_left': ['corridor_h_top', 'corridor_h_mid', 'corridor_h_bot'],
    'corridor_v_right':['corridor_h_top', 'corridor_h_mid', 'corridor_h_bot'],
  };

  // BFS pathfinding from waypoint graph (V4 §11)
  function findPath(fromX, fromY, toX, toY) {
    // 1) Find nearest waypoint to current
    let startWP = null, startDist = Infinity;
    for (const wp of NAV_NODES) {
      const d = Math.hypot(wp.x - fromX, wp.y - fromY);
      if (d < startDist) { startDist = d; startWP = wp.id; }
    }
    // 2) Find nearest waypoint to target
    let endWP = null, endDist = Infinity;
    for (const wp of NAV_NODES) {
      const d = Math.hypot(wp.x - toX, wp.y - toY);
      if (d < endDist) { endDist = d; endWP = wp.id; }
    }
    if (!startWP || !endWP) return [{ x: toX, y: toY }];
    if (startWP === endWP) return [{ x: toX, y: toY }];
    // 3) BFS
    const queue = [startWP];
    const came = { [startWP]: null };
    while (queue.length) {
      const cur = queue.shift();
      if (cur === endWP) break;
      for (const nxt of (NAV_EDGES[cur] || [])) {
        if (!(nxt in came)) { came[nxt] = cur; queue.push(nxt); }
      }
    }
    // 4) Reconstruct waypoint path
    if (!(endWP in came)) return [{ x: toX, y: toY }];
    const wpPath = [];
    let c = endWP;
    while (c) { wpPath.unshift(c); c = came[c]; }
    // 5) Convert waypoints to coordinate path: start -> wp1 -> wp2 -> ... -> target
    const path = [];
    path.push({ x: fromX, y: fromY });
    for (const id of wpPath) {
      const wp = NAV_NODES.find(n => n.id === id);
      path.push({ x: wp.x, y: wp.y });
    }
    path.push({ x: toX, y: toY });
    return path;
  }

  // Isometric projection: world (x, y) -> screen (sx, sy)
  // Uses 2:1 dimetric (common for pixel art games)
  function project(x, y) {
    if (!isoMode) return { sx: x, sy: y };
    return {
      sx: (x - y) * 0.866,   // cos(30°)
      sy: (x + y) * 0.5 - 0,  // sin(30°)
    };
  }
  function unproject(sx, sy) {
    if (!isoMode) return { x: sx, y: sy };
    return {
      x: (sx / 0.866 + sy * 2) / 2,
      y: (sy * 2 - sx / 0.866) / 2,
    };
  }

  // Pick agent at screen coords (after camera transform)
  function pickAgent(canvasX, canvasY) {
    // Convert canvas pixel -> world coords
    const wx = (canvasX - canvas.clientWidth / 2) / camera.zoom + camera.x + worldW / 2;
    const wy = (canvasY - canvas.clientHeight / 2) / camera.zoom + camera.y + worldH / 2;
    let best = null, bestD = 20; // 20px pick radius in world units
    for (const a of agents.values()) {
      const d = Math.hypot(a.x - wx, a.y - wy);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  // Page Visibility API: pause rAF when tab hidden
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      isPaused = document.hidden;
      if (!isPaused) {
        lastFrame = performance.now(); // reset delta so we don't jump
      }
    });
  }

  // Detect prefers-reduced-motion
  if (typeof window !== 'undefined' && window.matchMedia) {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Spawn or update agent from canonical state
  function syncAgent(role, meta) {
    let a = agents.get(role);
    if (!a) {
      const station = ROLE_TO_STATION[role] || 'default';
      const target = STATIONS[station] || STATIONS.default;
      a = {
        id: role,
        role,
        x: 100 + (agents.size * 80) % 400,  // spawn at lobby, deterministic
        y: 1300,
        tx: target.x, ty: target.y,
        state: 'IDLE',
        prevState: 'IDLE',
        stateTime: 0,
        phase: 0,
        scale: 1.0,
        meta: meta || {},
        lastEventTs: 0,
        walkT: 0,
        activityCount: 0,
        pulse: 0,
      };
      agents.set(role, a);
    }
    if (meta) a.meta = { ...a.meta, ...meta };
    return a;
  }

  // Apply event to agent — DETERMINISTIC, no random
  function applyEvent(ev) {
    lastEvents.push(ev);
    if (lastEvents.length > 100) lastEvents.shift();

    const role = ev.role_id || ev.role || ev.entity_id;
    if (!role) return;
    const a = syncAgent(role);
    a.lastEventTs = Date.now();

    // State mapping (canonical)
    // Two-phase: first WALK to target, then work state on arrival.
    // Arrival happens in the frame loop (see below).
    const map = {
      'mission.started':    'WALK',
      'mission.completed':  'SUCCESS',
      'role.selected':      'WALK',
      'role.changed':       'WALK',
      'skill.activated':    'WALK',
      'skill.completed':    'SUCCESS',
      'tool.started':       'WALK',
      'tool.completed':     'SUCCESS',
      'tool.failed':        'ERROR',
      'verification.started':'WALK',
      'verification.passed':'SUCCESS',
      'verification.failed':'ERROR',
      'recovery.started':   'WALK',
      'recovery.completed': 'SUCCESS',
      'incident.detected':  'ERROR',
      'github.commit':      'WALK',
      'github.request':     'WALK',
      'supabase.query':     'WALK',
      'supabase.migration': 'WALK',
      'filesystem.read':    'WALK',
      'filesystem.write':   'WALK',
      'router.request':     'WALK',
      'router.fallback':    'WALK',
      'test.started':       'WALK',
      'test.passed':        'SUCCESS',
      'test.failed':        'ERROR',
      'deployment.started': 'WALK',
      'deployment.completed':'SUCCESS',
      'bootstrap.step':     'IDLE',
      'diagnostic.run':     'WALK',
      'security.scan':      'WALK',
    };
    // Map the FINAL work state for each event (used after WALK arrives)
    const workState = {
      'mission.started':    'TYPE',
      'role.selected':      'TYPE',
      'skill.activated':    'SIT',
      'tool.started':       'TYPE',
      'verification.started':'TEST',
      'recovery.started':   'RECOVER',
      'github.commit':      'CODE',
      'github.request':     'CODE',
      'supabase.query':     'DATABASE',
      'supabase.migration': 'DATABASE',
      'filesystem.read':    'READ',
      'filesystem.write':   'WRITE',
      'router.request':     'CODE',
      'router.fallback':    'DEBUG',
      'test.started':       'TEST',
      'deployment.started': 'DEPLOY',
      'diagnostic.run':     'DEBUG',
      'security.scan':      'SECURITY',
    };
    const newState = map[ev.event_type] || 'IDLE';
    if (newState !== a.state) {
      a.prevState = a.state;
      a.state = newState;
      a.stateTime = 0;
      a.phase = 0;
    }
    // Remember the work state we should transition to when walk completes
    if (workState[ev.event_type]) {
      a.meta = a.meta || {};
      a.meta.workstation = workState[ev.event_type];
    }
    a.activityCount++;

    // Destination = workstation for this role
    const station = ROLE_TO_STATION[role] || 'default';
    const target = STATIONS[station] || STATIONS.default;
    a.tx = target.x + ((a.activityCount * 23) % 60) - 30; // deterministic lane offset
    a.ty = target.y;

    // Camera focus: we want the world coordinate (a.tx, a.ty) to land
    // in the center of the canvas. Given the world transform
    //   ctx.translate(-camera.x - worldW/2, -camera.y - worldH/2)
    // the point (a.tx, a.ty) is drawn at world-space (a.tx - camera.x - worldW/2).
    // To center it, we need camera.x = a.tx - worldW/2.
    // But we also need camera to start at 0,0 if the agent is at (0,0) — so:
    //   camera.x = a.tx - worldW/2  when worldW=1600 and agent at (200,200)
    //   => camera.x = 200 - 800 = -600
    // The transform then places agent at (200 - (-600) - 800) = 0 in world space,
    // which is the center of the canvas. Correct.
    if (ev.event_type !== 'heartbeat' && ev.event_type !== 'process.snapshot') {
      targetCamera.x = a.tx - worldW / 2;
      targetCamera.y = a.ty - worldH / 2;
    }
  }

  // Mark all agents offline if telemetry silent too long
  function checkStale() {
    const now = Date.now();
    for (const a of agents.values()) {
      const sinceEvent = now - a.lastEventTs;
      if (sinceEvent > 60000 && a.state !== 'OFFLINE') {
        a.prevState = a.state;
        a.state = 'OFFLINE';
        a.stateTime = 0;
      } else if (sinceEvent > 30000 && a.state === 'TYPE' && a.meta?.workstation) {
        // still working, just slow events
      } else if (sinceEvent > 15000 && (a.state === 'TYPE' || a.state === 'CODE') &&
                 a.stateTime > 300 && a.activityCount > 0) {
        a.prevState = a.state;
        a.state = 'IDLE';
        a.stateTime = 0;
      }
    }
  }

  // ---------- CANVAS DRAW ----------

  function drawCharacter(a) {
    const anim = STATE_ANIM[a.state] || STATE_ANIM.IDLE;
    const palette = ROLE_PALETTE[a.role] || ROLE_PALETTE.unknown;
    const t = a.stateTime;
    const ph = a.phase;

    // Soft pulse on active agents
    const pulse = (a.state !== 'IDLE' && a.state !== 'OFFLINE') ?
      1 + 0.08 * Math.sin(ph * 0.3) : 1;

    // Glow
    if (anim.glow) {
      const grd = ctx.createRadialGradient(a.x, a.y - 18, 0, a.x, a.y - 18, 28);
      grd.addColorStop(0, anim.glow + 'cc');
      grd.addColorStop(1, anim.glow + '00');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(a.x, a.y - 18, 28, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(a.x, a.y + 14, 12, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (with WALK cycle)
    const legSwing = anim.leg === 2 ? Math.sin(ph * 0.4) * 5 : 0;
    ctx.strokeStyle = palette.dark;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    // left leg
    ctx.beginPath();
    ctx.moveTo(a.x - 3, a.y + 4);
    ctx.lineTo(a.x - 4 - legSwing, a.y + 13);
    ctx.stroke();
    // right leg
    ctx.beginPath();
    ctx.moveTo(a.x + 3, a.y + 4);
    ctx.lineTo(a.x + 4 + legSwing, a.y + 13);
    ctx.stroke();

    // Body (torso)
    const bodyBob = anim.loop === 'breath' ? Math.sin(ph * 0.08) * 0.4 : 0;
    ctx.fillStyle = palette.primary;
    ctx.fillRect(a.x - 7, a.y - 5 + bodyBob, 14, 12);
    // stripe
    ctx.fillStyle = palette.accent;
    ctx.fillRect(a.x - 7, a.y - 5 + bodyBob, 14, 2);

    // Arms — by pose
    const armWave = anim.arm === 1 ? Math.sin(ph * 0.4) * 4 :
                    anim.arm === 4 ? Math.sin(ph * 0.5) * 1.5 :
                    anim.arm === 5 ? Math.sin(ph * 0.2) * 2 : 0;
    // left arm
    ctx.beginPath();
    if (anim.arm === 4) {
      // typing pose: forward
      ctx.moveTo(a.x - 5, a.y - 1);
      ctx.lineTo(a.x - 5 + armWave, a.y + 5);
    } else if (anim.arm === 9) {
      // ERROR arms up
      ctx.moveTo(a.x - 5, a.y - 1);
      ctx.lineTo(a.x - 9, a.y - 8);
    } else {
      ctx.moveTo(a.x - 5, a.y - 1);
      ctx.lineTo(a.x - 6 + armWave, a.y + 5);
    }
    ctx.stroke();
    // right arm
    ctx.beginPath();
    if (anim.arm === 4) {
      ctx.moveTo(a.x + 5, a.y - 1);
      ctx.lineTo(a.x + 5 - armWave, a.y + 5);
    } else if (anim.arm === 9) {
      ctx.moveTo(a.x + 5, a.y - 1);
      ctx.lineTo(a.x + 9, a.y - 8);
    } else if (anim.arm === 10) {
      // SUCCESS arms raised
      ctx.moveTo(a.x + 5, a.y - 1);
      ctx.lineTo(a.x + 9, a.y - 9);
    } else if (anim.arm === 11) {
      // OFFLINE arms down
      ctx.moveTo(a.x + 5, a.y - 1);
      ctx.lineTo(a.x + 6, a.y + 6);
    } else {
      ctx.moveTo(a.x + 5, a.y - 1);
      ctx.lineTo(a.x + 6 - armWave, a.y + 5);
    }
    ctx.stroke();

    // Head
    const headTilt = anim.head === 2 ? Math.sin(ph * 0.2) * 0.15 :
                     anim.head === 3 ? -0.2 : 0; // ERROR look down
    ctx.save();
    ctx.translate(a.x, a.y - 10);
    ctx.rotate(headTilt);
    // face
    ctx.fillStyle = '#d4a574';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.dark;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // eyes
    if (a.state === 'OFFLINE') {
      ctx.strokeStyle = '#475569';
      ctx.beginPath(); ctx.moveTo(-3, -1); ctx.lineTo(-1, 1); ctx.moveTo(-1, -1); ctx.lineTo(-3, 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1, -1); ctx.lineTo(3, 1); ctx.moveTo(3, -1); ctx.lineTo(1, 1); ctx.stroke();
    } else {
      ctx.fillStyle = '#0a0e1a';
      ctx.beginPath(); ctx.arc(-2, -1, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(2, -1, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    // hat/cap (role accent)
    ctx.fillStyle = palette.primary;
    ctx.fillRect(-6, -7, 12, 2);
    ctx.restore();

    // Status badge above head
    if (a.state !== 'IDLE' && a.state !== 'OFFLINE') {
      ctx.fillStyle = anim.glow || palette.accent;
      ctx.font = 'bold 7px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.state, a.x, a.y - 26);
    }
    // Role label below
    ctx.fillStyle = '#94a3b8';
    ctx.font = '6px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(a.role, a.x, a.y + 22);
  }

  function drawWalls() {
    // Outer walls (perimeter)
    ctx.strokeStyle = '#3d4a6b';
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 40, worldW - 80, worldH - 80);
    // Inner wall lines
    ctx.strokeStyle = '#2d3a5a';
    ctx.lineWidth = 1.5;
    // Vertical corridor walls (divide office into left/right)
    ctx.beginPath();
    ctx.moveTo(worldW / 3, 80); ctx.lineTo(worldW / 3, 1200);
    ctx.moveTo(2 * worldW / 3, 80); ctx.lineTo(2 * worldW / 3, 1200);
    // Horizontal mid-line
    ctx.moveTo(80, worldH / 2); ctx.lineTo(worldW - 80, worldH / 2);
    ctx.stroke();
  }

  function drawCarpet() {
    // Reception area carpet (top center) — a distinct colored area
    const cx = 600, cy = 100;
    ctx.fillStyle = '#1a2a48';
    ctx.fillRect(cx - 80, cy - 50, 160, 100);
    ctx.strokeStyle = '#3d4a6b';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(cx - 80, cy - 50, 160, 100);
    ctx.setLineDash([]);
    // "RECEPTION" label
    ctx.fillStyle = '#5d6b85';
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('RECEPTION', cx, cy - 35);
    // Neural core decoration in reception
    const pulse = 3 + Math.sin(Date.now() * 0.003) * 1.5;
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.arc(cx, cy + 10, pulse + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0e1a';
    ctx.beginPath();
    ctx.arc(cx, cy + 10, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.arc(cx, cy + 10, pulse - 1, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCeilingLights() {
    // Overhead lights (conical glow at fixed positions)
    const lights = [
      { x: 300, y: 80, c: '#00d4ff' },
      { x: 700, y: 80, c: '#b794ff' },
      { x: 1100, y: 80, c: '#34d399' },
      { x: 1500, y: 80, c: '#fb923c' },
      { x: 300, y: 480, c: '#34d399' },
      { x: 700, y: 480, c: '#a78bfa' },
      { x: 1100, y: 480, c: '#f87171' },
      { x: 1500, y: 480, c: '#fbbf24' },
      { x: 300, y: 880, c: '#94a3b8' },
      { x: 700, y: 880, c: '#b794ff' },
      { x: 1100, y: 880, c: '#34d399' },
      { x: 1500, y: 880, c: '#fb923c' },
    ];
    for (const l of lights) {
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.001 + l.x * 0.01);
      const r = 70;
      const grd = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      grd.addColorStop(0, l.c + '88');
      grd.addColorStop(0.5, l.c + '22');
      grd.addColorStop(1, l.c + '00');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(l.x, l.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Bright center dot
      ctx.fillStyle = l.c;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(l.x, l.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawFurniture() {
    // Potted plants at corners (decorative)
    const plants = [
      { x: 100, y: 100 }, { x: worldW - 100, y: 100 },
      { x: 100, y: worldH - 100 }, { x: worldW - 100, y: worldH - 100 },
      { x: 100, y: worldH / 2 }, { x: worldW - 100, y: worldH / 2 },
    ];
    for (const p of plants) {
      // Pot
      ctx.fillStyle = '#5d3a1f';
      ctx.fillRect(p.x - 6, p.y - 4, 12, 10);
      ctx.fillStyle = '#3a2410';
      ctx.fillRect(p.x - 6, p.y + 4, 12, 2);
      // Leaves
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(p.x - 4, p.y - 6, 4, 0, Math.PI * 2);
      ctx.arc(p.x + 4, p.y - 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Server racks along the back wall (decorative tech)
    for (let i = 0; i < 4; i++) {
      const sx = 200 + i * 80, sy = 100;
      ctx.fillStyle = '#18203a';
      ctx.fillRect(sx - 15, sy - 50, 30, 50);
      ctx.strokeStyle = '#3d4a6b';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(sx - 15, sy - 50, 30, 50);
      // Blinking LEDs
      for (let j = 0; j < 4; j++) {
        const blink = Math.sin(Date.now() * 0.005 + i + j) > 0;
        ctx.fillStyle = blink ? '#34d399' : '#1a3a2a';
        ctx.fillRect(sx - 12, sy - 45 + j * 10, 3, 3);
        ctx.fillStyle = Math.sin(Date.now() * 0.003 + j) > 0 ? '#fbbf24' : '#3a2a1a';
        ctx.fillRect(sx - 6, sy - 45 + j * 10, 3, 3);
        ctx.fillStyle = '#5d6b85';
        ctx.fillRect(sx, sy - 45 + j * 10, 6, 3);
      }
    }
  }

  function drawCorridor() {
    // Main horizontal corridor with directional markings
    const cy = worldH / 2;
    // Corridor floor (slightly lighter)
    ctx.fillStyle = '#0f1729';
    ctx.fillRect(60, cy - 40, worldW - 120, 80);
    // Center dashed line
    ctx.strokeStyle = '#3d4a6b';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(60, cy); ctx.lineTo(worldW - 60, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrow indicators
    for (let i = 0; i < 4; i++) {
      const ax = 200 + i * 350;
      ctx.fillStyle = '#3d4a6b';
      ctx.beginPath();
      ctx.moveTo(ax, cy - 6);
      ctx.lineTo(ax + 12, cy);
      ctx.lineTo(ax, cy + 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawStation(x, y, label, color) {
    // Desk surface (wood-tone)
    ctx.fillStyle = '#2a1f12';
    ctx.fillRect(x - 36, y - 18, 72, 22);
    // Desk edge highlight
    ctx.fillStyle = '#4a3a22';
    ctx.fillRect(x - 36, y - 18, 72, 2);
    // Monitor (back stand)
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x - 2, y - 36, 4, 20);
    // Monitor screen
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(x - 18, y - 44, 36, 24);
    // Screen glow (animated, activity-based)
    const stationId = Object.keys(STATIONS).find(k => STATIONS[k].x === x && STATIONS[k].y === y);
    const isActive = stationId && Array.from(agents.values()).some(a =>
      ROLE_TO_STATION[a.role] === stationId && a.state !== 'IDLE' && a.state !== 'OFFLINE' && a.state !== 'WALK'
    );
    const glowAlpha = isActive ? (0.6 + 0.3 * Math.sin(Date.now() * 0.005)) : 0.25;
    ctx.fillStyle = color;
    ctx.globalAlpha = glowAlpha;
    ctx.fillRect(x - 16, y - 42, 32, 20);
    ctx.globalAlpha = 1;
    // Screen bezel
    ctx.strokeStyle = '#3d4a6b';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x - 18, y - 44, 36, 24);
    // Chair (back)
    ctx.fillStyle = '#1a2238';
    ctx.fillRect(x - 8, y + 4, 16, 12);
    ctx.fillStyle = '#2d3a5a';
    ctx.fillRect(x - 6, y + 6, 12, 2);
    // Station label (above monitor)
    ctx.fillStyle = color;
    ctx.font = 'bold 8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x, y - 48);
    // Department indicator dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - 52, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawOffice() {
    // 1. Carpeted area (warm floor)
    ctx.fillStyle = '#0d1426';
    ctx.fillRect(40, 40, worldW - 80, worldH - 80);
    // 2. Subtle floor grid (less prominent)
    ctx.strokeStyle = '#1a2238';
    ctx.lineWidth = 0.3;
    for (let gx = 40; gx < worldW - 40; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 40); ctx.lineTo(gx, worldH - 40);
      ctx.stroke();
    }
    for (let gy = 40; gy < worldH - 40; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(40, gy); ctx.lineTo(worldW - 40, gy);
      ctx.stroke();
    }
    // 3. Walls
    drawWalls();
    // 4. Corridor
    drawCorridor();
    // 5. Reception carpet
    drawCarpet();
    // 6. Ceiling lights
    drawCeilingLights();
    // 7. Furniture (plants, server racks)
    drawFurniture();
    // 8. Stations (on top of everything)
    for (const [id, s] of Object.entries(STATIONS)) {
      if (id === 'default') continue;
      const color = (ROLE_PALETTE[Object.keys(ROLE_TO_STATION).find(r => ROLE_TO_STATION[r] === id)] || {}).primary || '#5d6b85';
      drawStation(s.x, s.y, s.label, color);
    }
    // Lobby spawn — different style (open floor, no desk)
    const lx = STATIONS.default.x, ly = STATIONS.default.y;
    ctx.fillStyle = '#1a2238';
    ctx.fillRect(lx - 40, ly - 20, 80, 50);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(lx - 40, ly - 20, 80, 50);
    ctx.setLineDash([]);
    // Reception desk
    ctx.fillStyle = '#2a1f12';
    ctx.fillRect(lx - 25, ly - 5, 50, 8);
    ctx.fillStyle = '#4a3a22';
    ctx.fillRect(lx - 25, ly - 5, 50, 2);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '8px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOBBY', lx, ly + 22);
  }

  function drawConnections() {
    // Lines from each active agent to its workstation
    ctx.strokeStyle = '#00d4ff44';
    ctx.lineWidth = 1;
    for (const a of agents.values()) {
      if (a.state === 'OFFLINE' || a.state === 'IDLE') continue;
      const station = ROLE_TO_STATION[a.role] || 'default';
      const target = STATIONS[station] || STATIONS.default;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 4);
      ctx.lineTo(target.x, target.y - 4);
      ctx.stroke();
    }
  }

  function frame(now) {
    if (isPaused) {
      rafId = requestAnimationFrame(frame);
      return; // skip render when tab hidden
    }
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(now - lastFrame, 100);
    lastFrame = now;

    if (!ctx || !canvas) return;

    // Resize handling
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Camera lerp
    camera.x += (targetCamera.x - camera.x) * LERP_RATE;
    camera.y += (targetCamera.y - camera.y) * LERP_RATE;
    camera.zoom += (targetCamera.zoom - camera.zoom) * LERP_RATE;

    // Stale check
    checkStale();

    // World transform
    ctx.save();
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.translate(canvas.clientWidth / 2, canvas.clientHeight / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x - worldW / 2, -camera.y - worldH / 2);

    drawOffice();
    drawConnections();
    for (const a of agents.values()) {
      // Move toward target whenever agent has a non-zero distance to target
      // and the target was set (i.e. a.tx, a.ty are valid).
      const dx = a.tx - a.x, dy = a.ty - a.y;
      const dist = Math.hypot(dx, dy);
      const needWalk = dist > 1;
      if (needWalk) {
        // Animate walking
        if (a.state !== 'WALK') {
          a.prevState = a.state;
          a.state = 'WALK';
          a.stateTime = 0;
        }
        if (!reducedMotion) {
          a.x += (dx / dist) * WALK_SPEED;
          a.y += (dy / dist) * WALK_SPEED;
        } else {
          a.x = a.tx; a.y = a.ty;
        }
        a.walkT++;
      } else if (a.state === 'WALK') {
        // Arrived — transition to work state (or IDLE)
        a.prevState = a.state;
        a.state = (a.meta && a.meta.workstation) ? a.meta.workstation : 'IDLE';
        a.stateTime = 0;
        a.walkT = 0;
      }
      // Phase advance
      a.phase += dt * 0.06;
      a.stateTime += dt;
      drawCharacter(a);
    }

    ctx.restore();

    // HUD: live counts
    if (onTickCallback) {
      let active = 0, idle = 0, offline = 0, error = 0;
      for (const a of agents.values()) {
        if (a.state === 'OFFLINE') offline++;
        else if (a.state === 'ERROR' || a.state === 'RECOVER') error++;
        else if (a.state === 'IDLE' || a.state === 'WAIT') idle++;
        else active++;
      }
      onTickCallback({ active, idle, offline, error, total: agents.size });
    }
  }

  // ---------- PUBLIC API ----------

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    onTickCallback = null;
    lastFrame = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    // Auto-fit to show the whole office on first init, and after a short
    // delay to allow the canvas to size to its container.
    setTimeout(() => {
      if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        fitOffice();
        camera.x = targetCamera.x;
        camera.y = targetCamera.y;
        camera.zoom = targetCamera.zoom;
      }
    }, 50);
    // V4: click-to-select agent (V4 §46)
    canvas.addEventListener('click', (e) => {
      if (!agentClickCallback) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const a = pickAgent(cx, cy);
      if (a) agentClickCallback(a);
    });
    // V4: drag-to-pan (V4 §19)
    let isDragging = false, dragX = 0, dragY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      isDragging = true; dragX = e.clientX; dragY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - dragX) / camera.zoom;
      const dy = (e.clientY - dragY) / camera.zoom;
      targetCamera.x -= dx;
      targetCamera.y -= dy;
      dragX = e.clientX; dragY = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      isDragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    // V4: mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cur = targetCamera.zoom;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(cur * factor);
    }, { passive: false });
  }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    agents.clear();
    lastEvents = [];
  }

  function onTick(cb) { onTickCallback = cb; }

  function focusAgent(role) {
    const a = agents.get(role);
    if (!a) return;
    // Center the agent in the canvas. Use the agent's TARGET if it's
    // still walking (current pos is far from target); otherwise current.
    const isAtTarget = Math.hypot(a.tx - a.x, a.ty - a.y) < 2;
    const fx = isAtTarget ? a.x : a.tx;
    const fy = isAtTarget ? a.y : a.ty;
    targetCamera.x = fx - worldW / 2;
    targetCamera.y = fy - worldH / 2;
    targetCamera.zoom = Math.max(targetCamera.zoom, 1.0);
  }

  function focusStation(stationId) {
    const s = STATIONS[stationId];
    if (!s) return;
    targetCamera.x = s.x - worldW / 2;
    targetCamera.y = s.y - worldH / 2;
  }

  function fitOffice() {
    // Show the world centered. The world spans 0..worldW, 0..worldH.
    // To put world center (worldW/2, worldH/2) at canvas center:
    //   camera.x = worldW/2 - worldW/2 = 0
    //   camera.y = worldH/2 - worldH/2 = 0
    // So center the view at camera=(0,0). Then zoom so the world fits.
    if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    const sx = (canvas.clientWidth - 16) / worldW;
    const sy = (canvas.clientHeight - 16) / worldH;
    targetCamera.zoom = Math.max(0.4, Math.min(1.5, Math.min(sx, sy)));
    targetCamera.x = 0;
    targetCamera.y = 0;
  }

  function setZoom(z) {
    targetCamera.zoom = Math.max(0.2, Math.min(2.5, z));
  }

  function pan(dx, dy) {
    targetCamera.x += dx / camera.zoom;
    targetCamera.y += dy / camera.zoom;
  }

  function setRoleWorkstation(role, workstation) {
    const a = syncAgent(role);
    a.meta = a.meta || {};
    a.meta.workstation = workstation;
  }

  function ingestEvent(ev) {
    applyEvent(ev);
  }

  function ingestEvents(events) {
    for (const ev of events) applyEvent(ev);
  }

  function getAgents() {
    return Array.from(agents.values()).map(a => ({
      id: a.id, role: a.role, state: a.state, x: Math.round(a.x), y: Math.round(a.y),
      activityCount: a.activityCount, lastEventTs: a.lastEventTs,
    }));
  }

  function resize() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      // Auto-fit on first resize
      if (camera.zoom === 1 && camera.x === 0 && camera.y === 0) {
        fitOffice();
      }
    }
  }

  return {
    init, destroy, onTick,
    focusAgent, focusStation, fitOffice, setZoom, pan, resize,
    setRoleWorkstation,
    ingestEvent, ingestEvents, getAgents,
    STATIONS, ROLE_TO_STATION, ROLE_PALETTE, STATE_ANIM,
    get camera() { return camera; },
    get targetCamera() { return targetCamera; },
    get worldW() { return worldW; },
    get worldH() { return worldH; },
    get isPaused() { return isPaused; },
    setIsoMode(on) { isoMode = !!on; },
    onAgentClick: (cb) => { agentClickCallback = cb; },
    pickAgent: (mx, my) => pickAgent(mx, my),
  };
})();

// Expose to global scope so other ES modules (app.js) can use it.
// ES module scope is isolated; without this, app.js can't reach CHARACTER_RENDERER.
if (typeof window !== 'undefined') {
  window.CHARACTER_RENDERER = CHARACTER_RENDERER;
  window.CHARACTER = CHARACTER_RENDERER;  // alias
}
