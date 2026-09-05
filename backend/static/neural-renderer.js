// KASZAEL Live Command Center — Neural Network Renderer
// SVG-based neural graph. Real execution path highlights, signal particles
// travel along edges on real events. Designed to look like a network
// topology, NOT a vertical chain of circles.

const NEURAL_RENDERER = (() => {
  // V4 §25: Radial topology. HERMES at center, nodes in concentric rings.
  // Ring 0: HERMES core (cx, cy)
  // Ring 1: Intent, Mission, Memory (inner ring)
  // Ring 2: Role, Skill, Layer (middle ring)
  // Ring 3: Tool, Model, Provider, 9Router (execution ring)
  // Ring 4: GitHub, Supabase, Filesystem, Deploy (services ring)
  // Ring 5: Verify, Recover (post-execution)
  // Total: 17 nodes, 31 edges
  const NODES = [
    // Core
    { id: 'core',      label: 'HERMES',  sub: 'CORE',  ring: 0, angle: 0,   color: '#00d4ff', radius: 36 },
    // Ring 1
    { id: 'intent',    label: 'INTENT',  sub: '',      ring: 1, angle: -90, color: '#00d4ff', radius: 26 },
    { id: 'mission',   label: 'MISSION', sub: '',      ring: 1, angle: -30, color: '#b794ff', radius: 26 },
    { id: 'memory',    label: 'MEMORY',  sub: '',      ring: 1, angle: 30,  color: '#94a3b8', radius: 26 },
    // Ring 2
    { id: 'role',      label: 'ROLE',    sub: '',      ring: 2, angle: -120, color: '#b794ff', radius: 24 },
    { id: 'skill',     label: 'SKILL',   sub: '',      ring: 2, angle: -60,  color: '#b794ff', radius: 24 },
    { id: 'kaz_layer', label: 'LAYER',   sub: 'KZ 1-28', ring: 2, angle: 0,   color: '#a78bfa', radius: 24 },
    // Ring 3
    { id: 'tool',      label: 'TOOL',    sub: '',      ring: 3, angle: 150, color: '#34d399', radius: 22 },
    { id: 'model',     label: 'MODEL',   sub: '',      ring: 3, angle: 210, color: '#34d399', radius: 22 },
    { id: 'provider',  label: 'PROVIDER',sub: '',      ring: 3, angle: 90,  color: '#34d399', radius: 22 },
    { id: 'router',    label: '9ROUTER', sub: '',      ring: 3, angle: 30,  color: '#fbbf24', radius: 24 },
    // Ring 4
    { id: 'github',    label: 'GITHUB',  sub: '',      ring: 4, angle: 165, color: '#94a3b8', radius: 20 },
    { id: 'supabase',  label: 'SUPABASE',sub: '',      ring: 4, angle: 225, color: '#f97316', radius: 20 },
    { id: 'fs',        label: 'FS',      sub: '',      ring: 4, angle: 285, color: '#94a3b8', radius: 20 },
    { id: 'deploy',    label: 'DEPLOY',  sub: '',      ring: 4, angle: 105, color: '#34d399', radius: 20 },
    // Ring 5
    { id: 'verify',    label: 'VERIFY',  sub: '',      ring: 5, angle: -45, color: '#10b981', radius: 24 },
    { id: 'recover',   label: 'RECOVER', sub: '',      ring: 5, angle: 45,  color: '#fb923c', radius: 24 },
  ];
  // Compute (x, y) from ring + angle around center (cx=550, cy=400)
  // Desktop viewBox 1100x750, center at (550, 375)
  // Mobile viewBox 400x900, center at (200, 400)
  const viewCx = 550, viewCy = 375;
  const ringRadius = [0, 90, 165, 235, 305, 360]; // distance from center
  for (const n of NODES) {
    if (n.id === 'core') {
      n.x = viewCx; n.y = viewCy;
    } else {
      const rad = (n.angle * Math.PI) / 180;
      const r = ringRadius[n.ring] || 0;
      n.x = viewCx + Math.cos(rad) * r;
      n.y = viewCy + Math.sin(rad) * r;
    }
  }

  // Edges (from->to)
  const EDGES = [
    ['core', 'intent'], ['core', 'mission'], ['core', 'memory'],
    ['intent', 'role'], ['intent', 'skill'], ['mission', 'role'], ['mission', 'kaz_layer'],
    ['role', 'tool'], ['role', 'model'], ['skill', 'tool'], ['skill', 'kaz_layer'],
    ['kaz_layer', 'tool'], ['kaz_layer', 'model'], ['kaz_layer', 'provider'],
    ['model', 'provider'], ['provider', 'router'], ['model', 'router'],
    ['router', 'github'], ['router', 'supabase'], ['router', 'fs'], ['router', 'deploy'],
    ['tool', 'github'], ['tool', 'supabase'], ['tool', 'fs'], ['tool', 'deploy'],
    ['github', 'verify'], ['supabase', 'verify'], ['fs', 'verify'], ['deploy', 'verify'],
    ['verify', 'recover'], ['memory', 'recover'],
  ];

  // State
  let svg = null;
  let activeSet = new Set(['core']);
  let lastEdgeActivity = new Map(); // edgeId -> lastEventTs
  let signals = []; // active particle signals
  let nodeCounts = new Map(); // nodeId -> event count
  let viewBox = { x: 0, y: 0, w: 1200, h: 900 };
  let onNodeClickCb = null;
  let intensity = 0; // 0..100 from real events per second

  // Event -> node activation map
  const EVENT_TO_NODES = {
    'mission.started':    ['mission'],
    'mission.completed':  ['mission', 'verify'],
    'role.selected':      ['role'],
    'role.changed':       ['role'],
    'skill.activated':    ['skill'],
    'skill.completed':    ['skill'],
    'tool.started':       ['tool'],
    'tool.completed':     ['tool'],
    'tool.failed':        ['tool', 'recover'],
    'verification.started':['verify'],
    'verification.passed':['verify'],
    'verification.failed':['verify', 'recover'],
    'recovery.started':   ['recover'],
    'recovery.completed': ['recover', 'verify'],
    'github.request':     ['github'],
    'github.commit':      ['github'],
    'supabase.query':     ['supabase'],
    'supabase.migration': ['supabase'],
    'filesystem.read':    ['fs'],
    'filesystem.write':   ['fs'],
    'router.request':     ['router', 'model'],
    'router.fallback':    ['router', 'model', 'provider'],
    'test.started':       ['tool'],
    'test.passed':        ['verify'],
    'test.failed':        ['recover'],
    'deployment.started': ['deploy'],
    'deployment.completed':['deploy', 'verify'],
    'bootstrap.step':     ['memory'],
    'diagnostic.run':     ['tool', 'verify'],
    'security.scan':      ['tool', 'github'],
    'model.requested':    ['model'],
    'model.completed':    ['model'],
    'provider.selected':  ['provider'],
  };

  // Edge usage by event
  const EVENT_TO_EDGES = {
    'mission.started':     [['core', 'mission']],
    'tool.started':        [['role', 'tool'], ['skill', 'tool']],
    'tool.completed':      [['tool', 'verify']],
    'tool.failed':         [['tool', 'recover']],
    'verification.passed': [['github', 'verify'], ['supabase', 'verify'], ['fs', 'verify'], ['deploy', 'verify']],
    'supabase.query':      [['router', 'supabase'], ['tool', 'supabase']],
    'github.commit':       [['router', 'github'], ['tool', 'github']],
    'filesystem.write':    [['router', 'fs'], ['tool', 'fs']],
    'deployment.started':  [['router', 'deploy']],
    'router.fallback':     [['model', 'router']],
    'recovery.started':    [['verify', 'recover'], ['memory', 'recover']],
    'recovery.completed':  [['recover', 'verify']],
  };

  function init(svgEl) {
    svg = svgEl;
    render();
  }

  function ingestEvent(ev) {
    const nodes = EVENT_TO_NODES[ev.event_type];
    if (nodes) for (const n of nodes) {
      activeSet.add(n);
      nodeCounts.set(n, (nodeCounts.get(n) || 0) + 1);
    }
    const edges = EVENT_TO_EDGES[ev.event_type] || [];
    for (const [a, b] of edges) {
      const key = a < b ? `${a}->${b}` : `${b}->${a}`;
      lastEdgeActivity.set(key, Date.now());
      // Spawn signal particle along the edge
      spawnSignal(a, b, ev.event_type.includes('fail') ? '#f87171' :
                          ev.event_type.includes('pass') || ev.event_type.includes('success') ? '#10b981' :
                          ev.event_type.includes('recovery') ? '#fb923c' : '#00d4ff');
    }
    // Decay intensity
    intensity = Math.min(100, intensity + 8);
  }

  function spawnSignal(fromId, toId, color) {
    const a = NODES.find(n => n.id === fromId);
    const b = NODES.find(n => n.id === toId);
    if (!a || !b) return;
    signals.push({
      fromId, toId, color,
      t: 0,            // 0..1 progress
      speed: 0.015 + Math.random() * 0.01,  // speed has jitter but spawn is event-driven
    });
    if (signals.length > 40) signals.shift();
  }

  function nodeById(id) { return NODES.find(n => n.id === id); }
  function edgeKey(a, b) { return a < b ? `${a}->${b}` : `${b}->${a}`; }

  function viewState() {
    return { activeSet: Array.from(activeSet), signalCount: signals.length, intensity, nodeCounts: Object.fromEntries(nodeCounts) };
  }

  function render() {
    if (!svg) return;
    svg.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    const W = 1200, H = 900;

    // Defs: gradients, filters
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = `
      <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#00d4ff" stop-opacity="0.9"/>
        <stop offset="40%" stop-color="#0369a1" stop-opacity="0.7"/>
        <stop offset="100%" stop-color="#0a0e1a" stop-opacity="0.2"/>
      </radialGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    `;
    svg.appendChild(defs);

    // Background grid
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', W); bg.setAttribute('height', H);
    bg.setAttribute('fill', '#0a0e1a');
    svg.appendChild(bg);
    const grid = document.createElementNS(ns, 'g');
    grid.setAttribute('stroke', '#1f2940');
    grid.setAttribute('stroke-width', '0.5');
    grid.setAttribute('opacity', '0.4');
    for (let gx = 0; gx < W; gx += 40) {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', gx); l.setAttribute('y1', 0);
      l.setAttribute('x2', gx); l.setAttribute('y2', H);
      grid.appendChild(l);
    }
    for (let gy = 0; gy < H; gy += 40) {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', 0); l.setAttribute('y1', gy);
      l.setAttribute('x2', W); l.setAttribute('y2', gy);
      grid.appendChild(l);
    }
    svg.appendChild(grid);

    // Central core "membrane" — pulsing aura around HERMES
    const coreG = document.createElementNS(ns, 'g');
    for (let i = 0; i < 3; i++) {
      const ring = document.createElementNS(ns, 'circle');
      ring.setAttribute('cx', 600);
      ring.setAttribute('cy', 80);
      ring.setAttribute('r', 50 + i * 18);
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#00d4ff');
      ring.setAttribute('stroke-width', '1');
      ring.setAttribute('opacity', String(0.3 - i * 0.08));
      ring.setAttribute('class', 'core-ring');
      coreG.appendChild(ring);
    }
    svg.appendChild(coreG);

    // Edges
    const edgeG = document.createElementNS(ns, 'g');
    for (const [a, b] of EDGES) {
      const na = nodeById(a), nb = nodeById(b);
      if (!na || !nb) continue;
      const isActive = activeSet.has(a) && activeSet.has(b);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', na.x); line.setAttribute('y1', na.y);
      line.setAttribute('x2', nb.x); line.setAttribute('y2', nb.y);
      line.setAttribute('stroke', isActive ? '#00d4ff' : '#1f2940');
      line.setAttribute('stroke-width', isActive ? '1.5' : '0.6');
      line.setAttribute('opacity', isActive ? '0.7' : '0.3');
      if (isActive) line.setAttribute('filter', 'url(#softGlow)');
      edgeG.appendChild(line);
    }
    svg.appendChild(edgeG);

    // Signal particles (animated along edges)
    const sigG = document.createElementNS(ns, 'g');
    sigG.setAttribute('id', 'neural-signals');
    svg.appendChild(sigG);

    // Nodes
    for (const n of NODES) {
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'neural-node');
      g.setAttribute('data-id', n.id);
      g.style.cursor = 'pointer';

      const isActive = activeSet.has(n.id);
      const count = nodeCounts.get(n.id) || 0;

      // halo
      if (isActive) {
        const halo = document.createElementNS(ns, 'circle');
        halo.setAttribute('cx', n.x); halo.setAttribute('cy', n.y);
        halo.setAttribute('r', n.radius + 10);
        halo.setAttribute('fill', n.color);
        halo.setAttribute('opacity', '0.15');
        halo.setAttribute('class', 'node-halo');
        g.appendChild(halo);
      }

      // circle
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', n.x); c.setAttribute('cy', n.y);
      c.setAttribute('r', n.radius);
      if (n.id === 'core') {
        c.setAttribute('fill', 'url(#coreGrad)');
      } else {
        c.setAttribute('fill', isActive ? n.color : '#18203a');
        c.setAttribute('fill-opacity', isActive ? '0.9' : '0.6');
      }
      c.setAttribute('stroke', isActive ? n.color : '#5d6b85');
      c.setAttribute('stroke-width', isActive ? '2' : '1');
      if (isActive) c.setAttribute('filter', 'url(#softGlow)');
      g.appendChild(c);

      // count ring
      if (count > 0 && isActive) {
        const cr = document.createElementNS(ns, 'circle');
        cr.setAttribute('cx', n.x); cr.setAttribute('cy', n.y);
        cr.setAttribute('r', n.radius + 4);
        cr.setAttribute('fill', 'none');
        cr.setAttribute('stroke', n.color);
        cr.setAttribute('stroke-width', '1.2');
        cr.setAttribute('stroke-dasharray', `${Math.min(count * 4, 30)} 8`);
        cr.setAttribute('opacity', '0.7');
        g.appendChild(cr);
      }

      // label
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', n.x); t.setAttribute('y', n.y + 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', n.radius > 22 ? '11' : '9');
      t.setAttribute('font-weight', isActive ? '700' : '500');
      t.setAttribute('fill', n.id === 'core' ? '#0a0e1a' : (isActive ? '#0a0e1a' : '#98a3b8'));
      t.textContent = n.label;
      g.appendChild(t);

      if (n.sub) {
        const t2 = document.createElementNS(ns, 'text');
        t2.setAttribute('x', n.x); t2.setAttribute('y', n.y + n.radius + 12);
        t2.setAttribute('text-anchor', 'middle');
        t2.setAttribute('font-size', '8');
        t2.setAttribute('fill', isActive ? n.color : '#5d6b85');
        t2.textContent = n.sub;
        g.appendChild(t2);
      }

      // count badge
      if (count > 0) {
        const badge = document.createElementNS(ns, 'g');
        const bx = n.x + n.radius - 4, by = n.y - n.radius + 4;
        const bc = document.createElementNS(ns, 'circle');
        bc.setAttribute('cx', bx); bc.setAttribute('cy', by);
        bc.setAttribute('r', 8);
        bc.setAttribute('fill', '#0a0e1a');
        bc.setAttribute('stroke', n.color);
        bc.setAttribute('stroke-width', '1');
        badge.appendChild(bc);
        const bt = document.createElementNS(ns, 'text');
        bt.setAttribute('x', bx); bt.setAttribute('y', by + 3);
        bt.setAttribute('text-anchor', 'middle');
        bt.setAttribute('font-size', '8');
        bt.setAttribute('font-weight', '700');
        bt.setAttribute('fill', n.color);
        bt.textContent = count > 99 ? '99+' : String(count);
        badge.appendChild(bt);
        g.appendChild(badge);
      }

      // tooltip
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${n.label}${n.sub ? ' · ' + n.sub : ''} — ${count} event${count !== 1 ? 's' : ''}`;
      g.appendChild(title);

      if (onNodeClickCb) {
        g.addEventListener('click', () => onNodeClickCb(n.id, n));
      }

      svg.appendChild(g);
    }
  }

  // 60fps tick for signal particles + halo pulse
  let rafId = null;
  function tick() {
    rafId = requestAnimationFrame(tick);
    if (!svg) return;
    const sigG = svg.querySelector('#neural-signals');
    if (!sigG) return;

    // advance signals
    const next = [];
    for (const s of signals) {
      s.t += s.speed;
      if (s.t >= 1.0) continue;
      const a = nodeById(s.fromId), b = nodeById(s.toId);
      if (!a || !b) continue;
      const x = a.x + (b.x - a.x) * s.t;
      const y = a.y + (b.y - a.y) * s.t;
      next.push({ ...s, x, y });
    }
    signals = next;

    // render
    let html = '';
    for (const s of signals) {
      const fade = 1 - Math.abs(s.t - 0.5) * 2; // brightest at midpoint
      html += `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="3" fill="${s.color}" opacity="${(0.4 + fade * 0.6).toFixed(2)}" filter="url(#glow)"/>`;
    }
    sigG.innerHTML = html;

    // intensity decay
    intensity = Math.max(0, intensity - 0.5);
  }

  function start() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function onNodeClick(cb) { onNodeClickCb = cb; }
  function reset() {
    activeSet = new Set(['core']);
    lastEdgeActivity.clear();
    signals = [];
    nodeCounts.clear();
    intensity = 0;
    render();
  }
  function setView(vb) {
    viewBox = vb;
    if (svg) {
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }
  }

  return {
    init, render, start, stop, onNodeClick, reset, setView,
    ingestEvent,
    NODES, EDGES, EVENT_TO_NODES,
    get viewState() { return viewState(); },
  };
})();

// Expose to global scope (ES modules have isolated scope).
if (typeof window !== 'undefined') {
  window.NEURAL_RENDERER = NEURAL_RENDERER;
  window.NEURAL = NEURAL_RENDERER;  // alias
}
