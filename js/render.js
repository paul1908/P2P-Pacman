'use strict';
/* ------------------------------------------------------------------
   Canvas rendering: neon-tube maze, dots, pac-men, title teaser.
   ------------------------------------------------------------------ */
const T = 28;                                   // tile size in canvas pixels
const COL = { p1: '#ffe600', p2: '#ff5bd1', scared: '#2a3cff', wall: '#2f3dff', dot: '#ffb8ae' };
const PIXEL_FONT = '"Press Start 2P", "Courier New", monospace';
const RUNE_FONT = '"Noto Sans Runic", "Segoe UI Historic", "Segoe UI Symbol", "Apple Symbols", serif';

const board = document.getElementById('board');
board.width = COLS * T; board.height = ROWS * T;
const bctx = board.getContext('2d');
let mazeCanvas = null;

/* ---------- maze: trace wall outlines, round the corners, draw as double neon tubes ---------- */
function buildMazeCanvas() {
  const cv = document.createElement('canvas');
  cv.width = COLS * T; cv.height = ROWS * T;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);

  const isWall = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? true : TILE[r][c] === 'W';
  const V = (x, y) => y * (COLS + 1) + x;
  const edges = [];                       // directed, wall on the right-hand side
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (TILE[r][c] !== 'W') continue;
    if (!isWall(c, r - 1)) edges.push([c, r, c + 1, r]);
    if (!isWall(c + 1, r)) edges.push([c + 1, r, c + 1, r + 1]);
    if (!isWall(c, r + 1)) edges.push([c + 1, r + 1, c, r + 1]);
    if (!isWall(c - 1, r)) edges.push([c, r + 1, c, r]);
  }
  const outs = new Map(), ends = new Set();
  edges.forEach((e, i) => {
    const k = V(e[0], e[1]);
    if (!outs.has(k)) outs.set(k, []);
    outs.get(k).push(i);
    ends.add(V(e[2], e[3]));
  });
  const used = new Uint8Array(edges.length);
  const chains = [];
  function trace(start) {
    const pts = [[edges[start][0], edges[start][1]]];
    let i = start;
    for (;;) {
      used[i] = 1;
      const e = edges[i];
      pts.push([e[2], e[3]]);
      const list = outs.get(V(e[2], e[3]));
      let nx = -1;
      if (list) for (const j of list) if (!used[j]) { nx = j; break; }
      if (nx < 0) break;
      i = nx;
    }
    const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (closed) pts.pop();
    // drop collinear points
    const n = pts.length, keep = [];
    for (let k = 0; k < n; k++) {
      const a = pts[(k + n - 1) % n], b = pts[k], c = pts[(k + 1) % n];
      const edgeOfOpen = !closed && (k === 0 || k === n - 1);
      if (edgeOfOpen || ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) !== 0) keep.push(b);
    }
    chains.push({ pts: keep, closed });
  }
  edges.forEach((e, i) => { if (!used[i] && !ends.has(V(e[0], e[1]))) trace(i); });   // open chains first
  edges.forEach((e, i) => { if (!used[i]) trace(i); });                                // then loops

  const R = T * 0.45;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const paths = chains.map(({ pts, closed }) => {
    const P = pts.map(p => [p[0] * T, p[1] * T]);
    const path = new Path2D(), n = P.length;
    if (closed) {
      const m0 = mid(P[n - 1], P[0]);
      path.moveTo(m0[0], m0[1]);
      for (let i = 0; i < n; i++) {
        const m = mid(P[i], P[(i + 1) % n]);
        path.arcTo(P[i][0], P[i][1], m[0], m[1], R);
      }
      path.closePath();
    } else {
      path.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < n - 1; i++) {
        const m = mid(P[i], P[i + 1]);
        path.arcTo(P[i][0], P[i][1], m[0], m[1], R);
      }
      path.lineTo(P[n - 1][0], P[n - 1][1]);
    }
    return path;
  });
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = COL.wall; g.lineWidth = 7; g.shadowColor = COL.wall; g.shadowBlur = 12;
  paths.forEach(p => g.stroke(p));
  g.shadowBlur = 0; g.strokeStyle = '#000'; g.lineWidth = 3;
  paths.forEach(p => g.stroke(p));

  // pen door
  g.fillStyle = '#ffb8de';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (TILE[r][c] === 'D') g.fillRect(c * T, r * T + T * 0.4, T, T * 0.2);
  }
  return cv;
}

/* ---------- pac-man ---------- */
function drawPacShape(g, x, y, rad, ang, mouth, color, opt = {}) {
  g.save();
  g.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
  if (opt.glow) { g.shadowColor = opt.glowColor || color; g.shadowBlur = opt.glow; }
  g.fillStyle = color;
  g.beginPath();
  if (mouth >= Math.PI - 0.01) { g.restore(); return; }
  g.moveTo(x, y);
  g.arc(x, y, rad, ang + mouth, ang + Math.PI * 2 - mouth);
  g.closePath();
  g.fill();
  if (opt.outline) { g.shadowBlur = 0; g.strokeStyle = opt.outline; g.lineWidth = 2; g.stroke(); }
  if (opt.eyes) {
    g.shadowBlur = 0; g.fillStyle = '#fff';
    const fx = Math.cos(ang), fy = Math.sin(ang), px = -fy, py = fx;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(x + fx * rad * 0.25 + px * rad * 0.42 * s, y + fy * rad * 0.25 + py * rad * 0.42 * s, rad * 0.17, 0, 7);
      g.fill();
    }
  }
  g.restore();
}

function drawPlayer(g, p, dt) {
  const col = p.i === 0 ? COL.p1 : COL.p2;
  const px = p.rx * T, py = p.ry * T, rad = T * 0.46;
  if (p.state === 'dead') { drawDeath(g, p, px, py, rad, col); return; }
  const moving = p.dx || p.dy;
  if (moving) p.anim += dt * 17;
  const mouth = moving ? 0.07 + 0.72 * Math.abs(Math.sin(p.anim)) : 0.4;
  const ang = Math.atan2(p.fy, p.fx);
  const opp = G.players[1 - p.i];
  const scared = opp.power > 0 && p.power <= 0 && opp.state === 'alive';
  const powered = p.power > 0;
  let color = col, o = {};
  if (scared) {
    const blink = opp.power < 2.2 && Math.floor(G.time * 7) % 2 === 0;
    color = blink ? '#ffffff' : COL.scared;
    o = { outline: blink ? COL.scared : '#9fb0ff', eyes: !blink };
  } else if (powered) {
    o = { glow: 18 + 8 * Math.sin(G.time * 10) };
  }
  if (p.inv > 0 && Math.floor(G.time * 12) % 2 === 0) o.alpha = 0.3;
  const offs = (px < T || px > COLS * T - T) ? [0, -COLS * T, COLS * T] : [0];
  for (const ox of offs) {
    if (powered) {                                  // hunting aura
      const a = 0.18 + 0.1 * Math.sin(G.time * 12);
      g.save(); g.globalAlpha = a; g.fillStyle = col;
      g.beginPath(); g.arc(px + ox, py, rad * (1.9 + 0.2 * Math.sin(G.time * 9)), 0, 7); g.fill(); g.restore();
    }
    drawPacShape(g, px + ox, py, powered ? rad * 1.12 : rad, ang, mouth, color, o);
  }
}

function drawDeath(g, p, px, py, rad, col) {
  const prog = 1 - p.st / DEAD_TIME;
  if (prog < 0.75) {
    drawPacShape(g, px, py, rad, -Math.PI / 2, (prog / 0.75) * Math.PI, col);
  } else {
    const k = (prog - 0.75) / 0.25;
    g.save(); g.globalAlpha = 1 - k; g.strokeStyle = col; g.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      g.beginPath();
      g.moveTo(px + Math.cos(a) * rad * (0.4 + k), py + Math.sin(a) * rad * (0.4 + k));
      g.lineTo(px + Math.cos(a) * rad * (0.9 + k * 1.6), py + Math.sin(a) * rad * (0.9 + k * 1.6));
      g.stroke();
    }
    g.restore();
  }
}

/* ---------- board ---------- */
function drawPen(g) {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#7d8bff'; g.font = `${T * 0.38}px ${PIXEL_FONT}`;
  g.fillText(G.mode === 'practice' ? 'PRACTICE' : 'ROOM', 14 * T, 13.75 * T);
  g.save();
  g.font = `${T * 1.25}px ${RUNE_FONT}`;
  g.fillStyle = '#00e5ff'; g.shadowColor = '#00e5ff'; g.shadowBlur = 10;
  const rs = G.mode === 'practice' ? '' : Array.from(G.room || '');
  if (rs.length) rs.forEach((ch, i) => g.fillText(ch, (14 + (i - (rs.length - 1) / 2) * 1.4) * T, 15 * T));
  else { g.font = `${T * 0.5}px ${PIXEL_FONT}`; g.fillText('SOLO', 14 * T, 15 * T); }
  g.restore();
}

function drawDots(g) {
  const blink = Math.floor(G.time * 4) % 2 === 0;
  g.fillStyle = COL.dot;
  for (let i = 0; i < G.dots.length; i++) {
    const v = G.dots[i];
    if (!v) continue;
    const cx = ((i % COLS) + 0.5) * T, cy = (((i / COLS) | 0) + 0.5) * T;
    if (v === 1) g.fillRect(cx - 2.5, cy - 2.5, 5, 5);
    else if (blink) { g.beginPath(); g.arc(cx, cy, T * 0.33, 0, 7); g.fill(); }
  }
}

function drawLabels(g) {
  const ready = G.phase === 'ready';
  const showYou = ready || (G.phase === 'play' && G.time - (G.playStart || 0) < 3.5);
  if (ready) {
    g.fillStyle = COL.p1; g.font = `${T * 0.7}px ${PIXEL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('READY!', 14 * T, 17.5 * T);
    const sec = Math.ceil(G.timer);
    if (sec > 0 && sec <= 3) {
      g.fillStyle = '#fff'; g.font = `${T * 0.5}px ${PIXEL_FONT}`;
      g.fillText(String(sec), 14 * T, 19.2 * T);
    }
  }
  if (showYou && Math.floor(G.time * 3) % 3 !== 2) {
    for (const p of G.players) {
      const col = p.i === 0 ? COL.p1 : COL.p2, mine = p.i === G.local;
      const x = Math.min(Math.max(p.rx * T, T * 2), T * (COLS - 2)), y = p.ry * T - T * 1.05;
      g.fillStyle = col; g.font = `${T * 0.34}px ${PIXEL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(mine ? 'YOU' : 'RIVAL', x, y);
      g.beginPath(); g.moveTo(x - 5, y + 9); g.lineTo(x + 5, y + 9); g.lineTo(x, y + 15); g.closePath(); g.fill();
    }
  }
}

function drawFx(g, dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const f = G.fx[i];
    f.t -= dt;
    if (f.t <= 0) { G.fx.splice(i, 1); continue; }
    g.save();
    g.globalAlpha = Math.min(1, f.t * 2);
    g.fillStyle = f.col; g.font = `${T * 0.5}px ${PIXEL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = f.col; g.shadowBlur = 8;
    g.fillText(f.txt, f.x * T, f.y * T - (1.2 - f.t) * T * 1.2);
    g.restore();
  }
}

function render(dt) {
  if (!mazeCanvas) mazeCanvas = buildMazeCanvas();
  const g = bctx;
  g.drawImage(mazeCanvas, 0, 0);
  drawPen(g);
  drawDots(g);
  const order = G.players.slice().sort((a, b) => (a.power > 0) - (b.power > 0));   // powered one on top
  for (const p of order) drawPlayer(g, p, dt);
  drawLabels(g);
  drawFx(g, dt);
}

/* ---------- title teaser: the whole game in one loop ---------- */
const titleCv = document.getElementById('titleCanvas');
function drawTitle(t) {
  if (!titleCv) return;
  const g = titleCv.getContext('2d'), W = titleCv.width, H = titleCv.height;
  g.clearRect(0, 0, W, H);
  const x0 = 34, x1 = W - 34, y = H / 2, gap = 0.27;
  const ph = (t % 8) / 4;                           // 0..2
  const L = ph < 1 ? ph : 2 - ph;
  const lead = gap + L * (1 - gap), chase = lead - gap;
  const X = u => x0 + u * (x1 - x0);
  const dirRight = ph < 1, ang = dirRight ? 0 : Math.PI;
  const A = X(lead), B = X(chase);                  // A (yellow) leads, B (pink) trails
  g.fillStyle = COL.dot;
  for (let x = x0 + 22; x < x1 - 14; x += 22) {
    if (Math.abs(x - A) < 22 || Math.abs(x - B) < 22) continue;
    g.fillRect(x - 2, y - 2, 4, 4);
  }
  if (Math.floor(t * 4) % 2 === 0) {
    g.beginPath(); g.arc(dirRight ? x1 : x0, y, 9, 0, 7); g.fill();
  }
  const mouth = 0.08 + 0.7 * Math.abs(Math.sin(t * 14));
  const aScared = dirRight, bScared = !dirRight;
  drawPacShape(g, A, y, 20, ang, mouth, aScared ? COL.scared : COL.p1,
    aScared ? { outline: '#9fb0ff', eyes: true } : { glow: 16 });
  drawPacShape(g, B, y, 20, ang, mouth, bScared ? COL.scared : COL.p2,
    bScared ? { outline: '#9fb0ff', eyes: true } : { glow: 16 });
}
