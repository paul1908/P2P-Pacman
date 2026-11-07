'use strict';
/* ------------------------------------------------------------------
   UI, rune rooms and peer-to-peer networking (PeerJS / WebRTC).
   Host runs the simulation and streams snapshots; guest sends inputs.
   ------------------------------------------------------------------ */
const $ = id => document.getElementById(id);
const S = { screen: 'title', peer: null, conn: null, join: [], ping: 0, pingTimer: 0, joinTimer: 0, snapAcc: 0, overTimer: 0, lastPhase: '', hostCode: null };

/* ---------- screens + toast ---------- */
function show(name) {
  S.screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
}
let toastTimer = 0;
function toast(msg, ok) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('ok', !!ok); t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}

/* ---------- game events (sound + effects) ---------- */
function onGameEvent(ev) {
  switch (ev[0]) {
    case 'd': if (ev[2] === G.local) Sfx.waka(); break;
    case 'p': Sfx.pellet(); break;
    case 'r': case 'rf': Sfx.blip(); break;
    case 'rd': Sfx.ready(); break;
    case 'go': Sfx.go(); G.playStart = G.time; break;
    case 'c': {
      Sfx.chomp(ev[1] === G.local);
      G.fx.push({ x: ev[3], y: ev[4], txt: '+200', col: ev[2] === 0 ? COL.p1 : COL.p2, t: 1.2 });
      const el = $('screen-game');
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 120);
      break;
    }
    case 'w': Sfx.win(ev[1] === G.local); break;
  }
}

/* ---------- input ---------- */
const KEYDIR = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
};
let lastSent = '';
function setDir(dx, dy) {
  if (S.screen !== 'game') return;
  Sfx.unlock();
  if (G.mode === 'guest') {
    const k = dx + ',' + dy;
    if (k !== lastSent) { lastSent = k; netSend({ t: 'in', x: dx, y: dy }); }
  } else if (G.mode === 'host' || G.mode === 'practice') {
    const p = G.players[0];
    p.wx = dx; p.wy = dy;
  }
}

window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.screen === 'game') {
    const d = KEYDIR[e.key] || KEYDIR[e.key.toLowerCase()];
    if (d) { e.preventDefault(); setDir(d[0], d[1]); return; }
    if (e.key.toLowerCase() === 'm') toggleMute();
    else if (e.key === 'Escape') quitGame();
  } else if (S.screen === 'join') {
    if (e.key === 'Backspace') { e.preventDefault(); joinDel(); }
    else if (e.key === 'Enter') { if (S.join.length === CODE_LEN) joinRoom(S.join.slice()); }
    else {
      const i = RUNES.findIndex(r => r.k === e.key.toLowerCase());
      if (e.key.length === 1 && i >= 0) joinAdd(i);
    }
  }
});

(function touchInput() {
  let sx = 0, sy = 0;
  board.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  board.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 22) {
      if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0); else setDir(0, dy > 0 ? 1 : -1);
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }
    e.preventDefault();
  }, { passive: false });
  document.querySelectorAll('#dpad button').forEach(b => {
    b.addEventListener('pointerdown', e => { e.preventDefault(); const [x, y] = b.dataset.d.split(',').map(Number); setDir(x, y); });
  });
})();

/* ---------- rune rendering helpers ---------- */
function slotHtml(idx, active) {
  const r = idx == null ? null : RUNES[idx];
  return `<div class="slot${active ? ' active' : ''}"><span class="g">${r ? r.g : '·'}</span><span class="k">${r ? r.k : ''}</span></div>`;
}
function renderJoinSlots() {
  let h = '';
  for (let i = 0; i < CODE_LEN; i++) h += slotHtml(S.join[i], i === S.join.length);
  $('joinSlots').innerHTML = h;
  $('btnGo').disabled = S.join.length !== CODE_LEN;
}
function buildKeypad() {
  $('keypad').innerHTML = RUNES.map((r, i) => `<button class="key" data-i="${i}" title="${r.n}">${r.g}<small>${r.k}</small></button>`).join('');
  $('keypad').addEventListener('click', e => {
    const b = e.target.closest('.key');
    if (b) { Sfx.unlock(); joinAdd(+b.dataset.i); }
  });
}
function joinAdd(i) { if (S.join.length < CODE_LEN) { S.join.push(i); Sfx.blip(); renderJoinSlots(); } }
function joinDel() { S.join.pop(); renderJoinSlots(); }

/* ---------- networking ---------- */
function netSend(m) {
  try { if (S.conn && S.conn.open) S.conn.send(m); } catch (e) { /* connection closing */ }
}
function leaveNet() {
  clearInterval(S.pingTimer); clearTimeout(S.joinTimer);
  const { conn, peer } = S;
  S.conn = null; S.peer = null; S.hostCode = null;
  try { if (conn) conn.close(); } catch (e) { /* ignore */ }
  try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
  G.mode = 'menu'; G.phase = 'idle'; G.players[1].bot = false;
}
function leaveToTitle() {
  leaveNet();
  $('overlay').hidden = true;
  show('title');
}

function createRoom(attempt = 0) {
  if (typeof Peer === 'undefined') { toast('PEERJS FAILED TO LOAD - ARE YOU ONLINE?'); return; }
  leaveNet();
  show('host');
  $('hostCode').innerHTML = '';
  $('hostStatus').textContent = 'OPENING PORTAL...';
  $('shareLink').value = '';
  const code = randomCode();
  const peer = new Peer(ROOM_PREFIX + runeLetters(code), { debug: 0 });
  S.peer = peer;
  peer.on('open', () => {
    S.hostCode = code;
    $('hostCode').innerHTML = code.map(i => slotHtml(i)).join('');
    $('hostStatus').textContent = 'WAITING FOR A RIVAL...';
    $('shareLink').value = location.origin === 'null' || location.protocol === 'file:'
      ? location.href.split('#')[0] + '#' + runeLetters(code)
      : location.origin + location.pathname + '#' + runeLetters(code);
  });
  peer.on('connection', onIncoming);
  peer.on('error', err => {
    if (S.peer !== peer) return;
    if (err.type === 'unavailable-id' && attempt < 6) { createRoom(attempt + 1); return; }
    toast('NETWORK ERROR: ' + err.type.toUpperCase());
    if (!S.conn) leaveToTitle();
  });
  peer.on('disconnected', () => { if (S.peer === peer && !peer.destroyed) peer.reconnect(); });
}

function onIncoming(conn) {
  if (S.conn) {                               // room already has a rival
    conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 400); });
    return;
  }
  S.conn = conn;
  conn.on('open', () => {
    G.mode = 'host'; G.local = 0; G.players[1].bot = false;
    G.room = runeGlyphs(S.hostCode);
    startHostMatch();
    show('game');
    startPing();
    toast('RIVAL CONNECTED!', true);
  });
  conn.on('data', onData);
  conn.on('close', () => { if (S.conn === conn) { toast('YOUR RIVAL LEFT THE ROOM'); leaveToTitle(); } });
  conn.on('error', () => { if (S.conn === conn) { toast('CONNECTION LOST'); leaveToTitle(); } });
}

function joinRoom(code) {
  if (typeof Peer === 'undefined') { toast('PEERJS FAILED TO LOAD - ARE YOU ONLINE?'); return; }
  leaveNet();
  show('connecting');
  $('connText').textContent = 'KNOCKING ON ROOM ' + runeGlyphs(code);
  let done = false;
  const fail = msg => {
    if (done) return;
    done = true; toast(msg);
    leaveNet(); show('join');
  };
  const peer = new Peer({ debug: 0 });
  S.peer = peer;
  peer.on('open', () => {
    const conn = peer.connect(ROOM_PREFIX + runeLetters(code), { reliable: true, serialization: 'json' });
    S.conn = conn;
    conn.on('open', () => {
      done = true; clearTimeout(S.joinTimer);
      G.mode = 'guest'; G.local = 1; G.room = runeGlyphs(code);
      startPing();
    });
    conn.on('data', onData);
    conn.on('close', () => { if (S.conn === conn) { toast('THE HOST LEFT THE ROOM'); leaveToTitle(); } });
    conn.on('error', () => fail('CONNECTION FAILED'));
  });
  peer.on('error', err => {
    if (S.peer !== peer) return;
    if (done) { toast('NETWORK ERROR: ' + err.type.toUpperCase()); leaveToTitle(); return; }
    fail(err.type === 'peer-unavailable' ? 'NO ROOM WITH THOSE RUNES' : 'NETWORK ERROR: ' + err.type.toUpperCase());
  });
  S.joinTimer = setTimeout(() => fail('TIMED OUT REACHING THE ROOM'), 15000);
}

function startPing() {
  clearInterval(S.pingTimer);
  S.pingTimer = setInterval(() => netSend({ t: 'ping', ts: performance.now() }), 2000);
}

const dirOf = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

function onData(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'in':
      if (G.mode === 'host') {
        let x = dirOf(+m.x), y = dirOf(+m.y);
        if (x && y) y = 0;
        G.players[1].wx = x; G.players[1].wy = y;
      }
      break;
    case 'rematch':
      if (G.mode === 'host') { G.rematch[1] = true; hostRematchCheck(); }
      break;
    case 'new':
      if (G.mode === 'guest') {
        newMatch(); lastSent = ''; G.snapT = 0;
        $('overlay').hidden = true; setupHud(); show('game');
      }
      break;
    case 's': if (G.mode === 'guest') applySnapshot(m); break;
    case 'rm': G.rematch = m.r; updateOverlay(); break;
    case 'ping': netSend({ t: 'pong', ts: m.ts }); break;
    case 'pong': S.ping = Math.round(performance.now() - m.ts); break;
    case 'full': toast('THAT ROOM IS FULL'); leaveToTitle(); break;
  }
}

/* ---- host side ---- */
function startHostMatch() {
  newMatch();
  netSend({ t: 'new' });
  $('overlay').hidden = true;
  setupHud();
}
function hostRematchCheck() {
  if (G.rematch[0] && G.rematch[1]) startHostMatch();
  else { netSend({ t: 'rm', r: G.rematch }); updateOverlay(); }
}
function buildSnapshot() {
  return {
    t: 's', ph: G.phase, tm: +G.timer.toFixed(2), wn: G.winner,
    p: G.players.map(p => [+p.x.toFixed(3), +p.y.toFixed(3), p.dx, p.dy, p.fx, p.fy, +p.power.toFixed(2),
      p.state === 'dead' ? 1 : 0, +p.st.toFixed(2), +p.inv.toFixed(2), p.score, p.catches, +p.spd.toFixed(2)]),
    e: G.out.splice(0),
  };
}

/* ---- guest side ---- */
function applySnapshot(m) {
  G.phase = m.ph; G.timer = m.tm; G.winner = m.wn;
  m.p.forEach((a, i) => {
    const p = G.players[i];
    p.x = a[0]; p.y = a[1]; p.dx = a[2]; p.dy = a[3]; p.fx = a[4]; p.fy = a[5];
    p.power = a[6]; p.state = a[7] ? 'dead' : 'alive'; p.st = a[8]; p.inv = a[9];
    p.score = a[10]; p.catches = a[11]; p.spd = a[12];
  });
  for (const ev of m.e) {
    switch (ev[0]) {
      case 'd': case 'p': G.dots[ev[1]] = 0; break;
      case 'r': G.dots[ev[1]] = 2; break;
      case 'rf': refillDots(); break;
    }
    onGameEvent(ev);
  }
  G.snapT = performance.now();
  if (!G.snapSeen) { for (const p of G.players) { p.rx = p.x; p.ry = p.y; } G.snapSeen = true; }
}

function smoothGuest(dt) {
  const age = Math.min(0.12, (performance.now() - G.snapT) / 1000);
  for (const p of G.players) {
    if (p.state === 'dead') { p.st = Math.max(0, p.st - dt); p.rx = p.x; p.ry = p.y; continue; }
    let tx = p.x + p.dx * p.spd * age, ty = p.y + p.dy * p.spd * age;
    tx = (tx + COLS) % COLS;
    let ddx = tx - p.rx;
    if (Math.abs(ddx) > COLS / 2) { p.rx = tx; ddx = 0; }          // tunnel wrap: snap
    if (Math.abs(ddx) > 3 || Math.abs(ty - p.ry) > 3) { p.rx = tx; p.ry = ty; continue; }
    const k = 1 - Math.exp(-dt * 28);
    p.rx += (tx - p.rx) * k; p.ry += (ty - p.ry) * k;
  }
}

/* ---------- HUD + end-of-match overlay ---------- */
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setupHud() {
  $('hp0').classList.toggle('me', G.local === 0);
  $('hp1').classList.toggle('me', G.local === 1);
  const solo = G.mode === 'practice';
  $('hlabel').textContent = solo ? 'PRACTICE' : 'ROOM';
  $('hroom').textContent = solo ? 'ᛟᚠᛚ' : G.room;
  $('hroom').style.display = solo ? 'none' : '';
  $('hp1').querySelector('.who').textContent = solo ? 'BOT' : '2UP';
  G.snapSeen = false;
  S.lastPhase = '';
  clearTimeout(S.overTimer);
  Sfx.unlock();
}
function updateHud() {
  for (let i = 0; i < 2; i++) {
    const p = G.players[i];
    setText('sc' + i, String(p.score).padStart(2, '0'));
    const pips = $('pips' + i).children;
    for (let k = 0; k < pips.length; k++) pips[k].classList.toggle('on', k < p.catches);
    const w = Math.round((p.power / POWER_TIME) * 100) + '%';
    if (hudCache['pb' + i] !== w) { hudCache['pb' + i] = w; $('pb' + i).style.width = w; }
  }
  setText('hping', G.mode === 'host' || G.mode === 'guest' ? 'PING ' + S.ping + 'ms' : '');
}
function updateOverlay() {
  if ($('overlay').hidden) return;
  const me = G.local, won = G.winner === me;
  const t = $('ovTitle');
  t.textContent = won ? 'YOU WIN!' : 'CHOMPED!';
  t.className = won ? 'win' : 'lose';
  const a = G.players[me], b = G.players[1 - me];
  $('ovSub').innerHTML = `CATCHES ${a.catches} - ${b.catches}<br>SCORE ${a.score} - ${b.score}`;
  let w = '';
  if (G.mode === 'practice') w = '';
  else if (G.rematch[me]) w = 'WAITING FOR YOUR RIVAL...';
  else if (G.rematch[1 - me]) w = 'YOUR RIVAL WANTS A REMATCH!';
  $('ovWait').textContent = w;
  $('btnRematch').disabled = G.mode !== 'practice' && !!G.rematch[me];
}
function watchPhase() {
  if (G.phase === S.lastPhase) return;
  S.lastPhase = G.phase;
  if (G.phase === 'over') {
    clearTimeout(S.overTimer);
    S.overTimer = setTimeout(() => { $('overlay').hidden = false; updateOverlay(); }, 1700);
  } else if (G.phase === 'ready') {
    $('overlay').hidden = true;
  }
}

function rematch() {
  Sfx.unlock();
  if (G.mode === 'practice') { newMatch(); setupHud(); $('overlay').hidden = true; return; }
  if (G.mode === 'host') { G.rematch[0] = true; hostRematchCheck(); }
  else if (G.mode === 'guest') { G.rematch[1] = true; netSend({ t: 'rematch' }); updateOverlay(); }
}
function quitGame() {
  if (G.phase === 'over' || G.mode === 'practice' || confirm('Leave this match?')) leaveToTitle();
}
function toggleMute() {
  const m = Sfx.toggle();
  $('btnMute').textContent = m ? 'SOUND OFF' : 'SOUND ON';
}

/* ---------- practice ---------- */
function startPractice() {
  Sfx.unlock();
  leaveNet();
  G.mode = 'practice'; G.local = 0; G.room = '';
  G.players[1].bot = true;
  newMatch();
  setupHud();
  show('game');
}

/* ---------- menu wiring ---------- */
function wire() {
  buildKeypad();
  renderJoinSlots();
  $('btnCreate').onclick = () => { Sfx.unlock(); createRoom(); };
  $('btnJoin').onclick = () => { Sfx.unlock(); S.join = []; renderJoinSlots(); show('join'); };
  $('btnPractice').onclick = startPractice;
  $('btnHelp').onclick = () => show('help');
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = leaveToTitle);
  $('btnDel').onclick = joinDel;
  $('btnGo').onclick = () => joinRoom(S.join.slice());
  $('btnRematch').onclick = rematch;
  $('btnLeave').onclick = leaveToTitle;
  $('btnQuit').onclick = quitGame;
  $('btnMute').onclick = toggleMute;
  $('btnMute').textContent = Sfx.muted ? 'SOUND OFF' : 'SOUND ON';
  const copy = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); toast(msg, true); }
    catch (e) { toast('COPY FAILED - SELECT THE TEXT MANUALLY'); }
  };
  $('btnCopyLink').onclick = () => copy($('shareLink').value, 'INVITE LINK COPIED');
  $('btnCopyCode').onclick = () => S.hostCode && copy(runeLetters(S.hostCode).toUpperCase(), 'CODE COPIED: ' + runeLetters(S.hostCode).toUpperCase());
  $('shareLink').onclick = e => e.target.select();
  if (typeof Peer === 'undefined') toast('OFFLINE? ROOMS NEED PEERJS - PRACTICE STILL WORKS');

  // invite link: index.html#fuqa
  const code = lettersToCode(location.hash.replace('#', ''));
  if (code) { S.join = code; renderJoinSlots(); show('join'); if (typeof Peer !== 'undefined') joinRoom(code); }
}

/* ---------- main loop ---------- */
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  G.time += dt;
  if (S.screen === 'title') drawTitle(G.time);
  if (S.screen === 'game') {
    if (G.mode === 'host' || G.mode === 'practice') {
      acc += dt;
      while (acc >= STEP) { simStep(STEP); acc -= STEP; }
      for (const p of G.players) { p.rx = p.x; p.ry = p.y; }
      if (G.mode === 'host') {
        S.snapAcc += dt;
        if (S.snapAcc >= 1 / 30) { S.snapAcc = 0; netSend(buildSnapshot()); }
      } else G.out.length = 0;
    } else if (G.mode === 'guest') {
      smoothGuest(dt);
    }
    if (G.phase === 'play' && (G.players[0].power > 0 || G.players[1].power > 0)) Sfx.siren(G.time);
    watchPhase();
    render(dt);
    updateHud();
  }
  requestAnimationFrame(frame);
}

wire();
requestAnimationFrame(frame);
