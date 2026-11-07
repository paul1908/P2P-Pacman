'use strict';
/* Tiny square-wave synth - everything is generated, no audio files. */
const Sfx = (() => {
  let ac = null, muted = false, flip = false, lastSiren = 0;
  try { muted = localStorage.getItem('p2pac-muted') === '1'; } catch (e) { /* ignore */ }

  function ctx() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, d, o = {}) {
    if (muted) return;
    const a = ctx();
    if (!a) return;
    const t = a.currentTime + (o.at || 0);
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
    const v = o.vol == null ? 0.045 : o.vol;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g); g.connect(a.destination);
    osc.start(t); osc.stop(t + d + 0.03);
  }
  function seq(notes, step, o = {}) {
    notes.forEach((f, i) => { if (f) tone(f, step * 0.9, Object.assign({}, o, { at: i * step })); });
  }

  return {
    unlock: ctx,
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('p2pac-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return muted;
    },
    waka() { flip = !flip; tone(flip ? 440 : 300, 0.07, { to: flip ? 270 : 500, vol: 0.035 }); },
    pellet() { seq([220, 330, 440, 660, 880], 0.045, { vol: 0.05 }); },
    blip() { tone(900, 0.06, { vol: 0.025 }); },
    ready() { seq([262, 392, 523, 392, 659, 523, 392, 523, 784], 0.15, { vol: 0.045 }); },
    go() { seq([523, 784], 0.08, { vol: 0.05 }); },
    chomp(mine) {                       // somebody got caught
      tone(mine ? 700 : 500, 0.5, { to: 60, vol: 0.07, type: 'sawtooth' });
      seq([880, 660, 440, 330, 220, 110], 0.09, { vol: 0.04, at: 0 });
    },
    win(mine) {
      if (mine) seq([392, 523, 659, 784, 1046, 784, 1046], 0.11, { vol: 0.05 });
      else seq([392, 349, 311, 262, 196], 0.18, { vol: 0.05, type: 'triangle' });
    },
    siren(now) {                        // low pulsing tick while somebody is powered up
      if (muted || now - lastSiren < 0.26) return;
      lastSiren = now;
      flip = !flip;
      tone(flip ? 150 : 190, 0.12, { vol: 0.02, type: 'triangle' });
    },
  };
})();
