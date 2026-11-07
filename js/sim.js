'use strict';
/* ------------------------------------------------------------------
   Game simulation. Pure logic - no DOM. The host runs this; the guest
   only renders what the host streams. Practice mode runs it locally.
   ------------------------------------------------------------------ */
const STEP = 1 / 120;
const SPEED = 7.6;            // tiles / second
const SPEED_POW = 8.4;        // powered pac-man is a little faster
const POWER_TIME = 9;         // seconds of power after a pellet
const DEAD_TIME = 1.7;
const INV_TIME = 1.6;         // grace period after respawning
const READY_TIME = 3.4;
const PELLET_RESPAWN = 11;    // seconds until a pellet grows back
const WIN_CATCHES = 3;
const CATCH_DIST = 0.78;
const SPAWNS = [{ c: 1, r: 29, dx: 1 }, { c: 26, r: 29, dx: -1 }];

const NB = new Array(COLS * ROWS);   // neighbour lists for BFS / bot
(function () {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < COLS * ROWS; i++) {
    NB[i] = [];
    if (!PASS[i]) continue;
    const c = i % COLS, r = (i / COLS) | 0;
    for (const [dx, dy] of dirs) {
      const nr = r + dy;
      if (nr < 0 || nr >= ROWS) continue;
      const ni = nr * COLS + ((c + dx + COLS) % COLS);
      if (PASS[ni]) NB[i].push([ni, dx, dy]);
    }
  }
})();

function makePlayer(i) {
  const s = SPAWNS[i];
  return {
    i, x: s.c + 0.5, y: s.r + 0.5, dx: s.dx, dy: 0, wx: s.dx, wy: 0, fx: s.dx, fy: 0,
    power: 0, state: 'alive', st: 0, inv: 0, score: 0, catches: 0, bot: false,
    rx: s.c + 0.5, ry: s.r + 0.5, anim: 0, spd: SPEED, goal: -1,
  };
}

const G = {
  mode: 'menu',          // menu | host | guest | practice
  local: 0,              // which pac-man this screen controls
  room: '',
  phase: 'idle',         // idle | ready | play | over
  timer: 0, winner: -1, time: 0,
  dots: new Uint8Array(COLS * ROWS), dotsLeft: 0,
  respawn: [], out: [], fx: [],
  players: [makePlayer(0), makePlayer(1)],
  rematch: [false, false], snapT: 0,
};

function emit(ev) {
  G.out.push(ev);
  if (typeof onGameEvent === 'function') onGameEvent(ev);
}

function refillDots() {
  let n = 0;
  for (let i = 0; i < DOTS_INIT.length; i++) {
    if (DOTS_INIT[i] === 1) { G.dots[i] = 1; n++; }
  }
  G.dotsLeft = n;
}

function newMatch() {
  G.dots.set(DOTS_INIT);
  G.dotsLeft = 0;
  for (let i = 0; i < DOTS_INIT.length; i++) if (DOTS_INIT[i] === 1) G.dotsLeft++;
  for (let i = 0; i < 2; i++) {
    const bot = G.players[i].bot;
    G.players[i] = makePlayer(i);
    G.players[i].bot = bot;
  }
  G.phase = 'ready'; G.timer = READY_TIME; G.winner = -1;
  G.respawn.length = 0; G.out.length = 0; G.fx.length = 0;
  G.rematch = [false, false];
  if (typeof onGameEvent === 'function') onGameEvent(['rd']);
}

/* ---------- movement (grid-based, classic pac-man feel) ---------- */
function walkable(c, r) {
  if (r < 0 || r >= ROWS) return false;
  c = ((c % COLS) + COLS) % COLS;
  return PASS[r * COLS + c] === 1;
}

function movePlayer(p, dt, speed) {
  let rem = speed * dt, guard = 0;
  while (rem > 1e-7 && guard++ < 8) {
    const c = Math.floor(p.x), r = Math.floor(p.y);
    const cx = c + 0.5, cy = r + 0.5;
    const atC = Math.abs(p.x - cx) < 1e-5 && Math.abs(p.y - cy) < 1e-5;
    // reversing is allowed anywhere
    if (!atC && (p.dx || p.dy) && (p.wx || p.wy) && p.wx === -p.dx && p.wy === -p.dy) {
      p.dx = p.wx; p.dy = p.wy;
    }
    if (atC) {
      p.x = cx; p.y = cy;
      if (p.bot) botThink(p);          // bots decide exactly when they reach a tile centre
      if ((p.wx || p.wy) && walkable(c + p.wx, r + p.wy)) { p.dx = p.wx; p.dy = p.wy; }
      else if (!((p.dx || p.dy) && walkable(c + p.dx, r + p.dy))) { p.dx = 0; p.dy = 0; return; }
    }
    if (!p.dx && !p.dy) return;
    p.fx = p.dx; p.fy = p.dy;
    // next tile centre along the current direction
    let target, dist;
    if (p.dx) {
      const k = Math.floor(p.x) + 0.5;
      target = p.dx > 0 ? (p.x < k - 1e-5 ? k : k + 1) : (p.x > k + 1e-5 ? k : k - 1);
      dist = Math.abs(target - p.x);
    } else {
      const k = Math.floor(p.y) + 0.5;
      target = p.dy > 0 ? (p.y < k - 1e-5 ? k : k + 1) : (p.y > k + 1e-5 ? k : k - 1);
      dist = Math.abs(target - p.y);
    }
    const m = Math.min(rem, dist);
    if (p.dx) p.x = m >= dist ? target : p.x + p.dx * m;
    else p.y = m >= dist ? target : p.y + p.dy * m;
    rem -= m;
    if (p.x < 0) p.x += COLS; else if (p.x >= COLS) p.x -= COLS;
  }
}

/* ---------- rules ---------- */
function eatAt(p) {
  const idx = Math.floor(p.y) * COLS + Math.floor(p.x);
  const v = G.dots[idx];
  if (!v) return;
  G.dots[idx] = 0;
  if (v === 1) {
    p.score += 10; G.dotsLeft--;
    emit(['d', idx, p.i]);
    if (G.dotsLeft <= 0) { refillDots(); emit(['rf']); }
  } else {
    p.score += 50; p.power = POWER_TIME;
    G.respawn.push({ idx, t: PELLET_RESPAWN });
    emit(['p', idx, p.i]);
  }
}

function respawnPlayer(p) {
  const s = SPAWNS[p.i];
  p.x = s.c + 0.5; p.y = s.r + 0.5; p.dx = s.dx; p.dy = 0; p.wx = s.dx; p.wy = 0;
  p.fx = s.dx; p.fy = 0; p.state = 'alive'; p.st = 0; p.inv = INV_TIME; p.power = 0;
}

function doCatch(k, v) {
  k.catches++; k.score += 200; k.power = 0;
  v.state = 'dead'; v.st = DEAD_TIME; v.power = 0; v.dx = v.dy = 0;
  emit(['c', v.i, k.i, +v.x.toFixed(2), +v.y.toFixed(2)]);
  if (k.catches >= WIN_CATCHES) {
    G.phase = 'over'; G.winner = k.i;
    emit(['w', k.i]);
  }
}

function collide() {
  const a = G.players[0], b = G.players[1];
  if (a.state !== 'alive' || b.state !== 'alive') return;
  let dx = Math.abs(a.x - b.x);
  if (dx > COLS / 2) dx = COLS - dx;
  if (Math.hypot(dx, a.y - b.y) > CATCH_DIST) return;
  const ap = a.power > 0, bp = b.power > 0;
  if (ap && !bp && b.inv <= 0) doCatch(a, b);
  else if (bp && !ap && a.inv <= 0) doCatch(b, a);
  // both powered, or neither: pac-men slip through each other
}

function stepPlayer(p, dt) {
  if (p.state === 'dead') {
    p.st -= dt;
    if (p.st <= 0) respawnPlayer(p);
    return;
  }
  if (p.power > 0) p.power = Math.max(0, p.power - dt);
  if (p.inv > 0) p.inv = Math.max(0, p.inv - dt);
  p.spd = p.power > 0 ? SPEED_POW : SPEED * (p.bot ? 0.94 : 1);
  movePlayer(p, dt, p.spd);
  eatAt(p);
}

function simStep(dt) {
  if (G.phase === 'ready') {
    G.timer -= dt;
    if (G.timer <= 0) { G.phase = 'play'; G.timer = 0; emit(['go']); }
    return;
  }
  if (G.phase === 'over') {
    for (const p of G.players) if (p.state === 'dead') p.st = Math.max(0, p.st - dt);
    return;
  }
  if (G.phase !== 'play') return;
  for (const p of G.players) stepPlayer(p, dt);
  if (G.phase === 'play') collide();
  for (let i = G.respawn.length - 1; i >= 0; i--) {
    const e = G.respawn[i];
    e.t -= dt;
    if (e.t <= 0) { G.dots[e.idx] = 2; G.respawn.splice(i, 1); emit(['r', e.idx]); }
  }
}

/* ---------- practice-mode bot ---------- */
function bfs(src) {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const prev = new Int16Array(COLS * ROWS).fill(-1);
  const q = [src];
  dist[src] = 0;
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const nb of NB[u]) {
      const v = nb[0];
      if (dist[v] < 0) { dist[v] = dist[u] + 1; prev[v] = u; q.push(v); }
    }
  }
  return { dist, prev };
}

function hasPellet() { for (let i = 0; i < G.dots.length; i++) if (G.dots[i] === 2) return true; return false; }

function botThink(p) {
  const c = Math.floor(p.x), r = Math.floor(p.y);
  if (Math.abs(p.x - c - 0.5) > 1e-4 || Math.abs(p.y - r - 0.5) > 1e-4) return;   // decide at tile centres only
  const me = r * COLS + c;
  const opp = G.players[1 - p.i];
  const oi = Math.floor(opp.y) * COLS + Math.floor(opp.x);
  const A = bfs(me);
  const oppAlive = opp.state === 'alive';
  let goal = -1;

  if (oppAlive && p.power > 0 && opp.power <= 0 && A.dist[oi] >= 0 && A.dist[oi] < p.power * SPEED_POW * 0.9 + 2) {
    goal = oi;                                           // hunt!
  } else if (oppAlive && opp.power > 0 && p.power <= 0) {
    const B = bfs(oi);                                   // run!
    if (B.dist[me] >= 0 && B.dist[me] <= 14) {
      let best = null, bs = -1e9;
      for (const [n, dx, dy] of NB[me]) {
        let s = B.dist[n] + Math.random() * 0.6 + NB[n].length * 0.4;
        if ((p.dx || p.dy) && dx === -p.dx && dy === -p.dy) s -= 1.5;
        if (s > bs) { bs = s; best = [dx, dy]; }
      }
      if (best) { p.wx = best[0]; p.wy = best[1]; }
      return;
    }
  }
  if (goal < 0 && p.goal >= 0 && G.dots[p.goal] && A.dist[p.goal] >= 0 && (G.dots[p.goal] === 2 || !hasPellet())) goal = p.goal;   // stick to the plan
  if (goal < 0) {                                        // otherwise graze, with a taste for pellets
    let bd = 1e9;
    for (let i = 0; i < G.dots.length; i++) {
      const v = G.dots[i];
      if (!v || A.dist[i] < 0) continue;
      const d = A.dist[i] - (v === 2 ? 10 : 0) + Math.random() * 2;
      if (d < bd) { bd = d; goal = i; }
    }
  }
  if (goal < 0 || goal === me) { p.goal = -1; return; }
  if (goal !== oi) p.goal = goal;
  let s = goal;
  while (A.prev[s] !== me && A.prev[s] >= 0) s = A.prev[s];
  const sc = s % COLS, sr = (s / COLS) | 0;
  let dx = sc - c;
  if (dx > 1) dx = -1; else if (dx < -1) dx = 1;
  p.wx = dx; p.wy = sr - r;
}
