'use strict';
/* ------------------------------------------------------------------
   The classic arcade maze: 28 x 31 tiles, wrap-around tunnel on row 14.
   '#' wall   '.' dot   'o' power pellet   '-' pen door   ' ' open / void
   ------------------------------------------------------------------ */
const COLS = 28, ROWS = 31, TUNNEL_ROW = 14;

const MAZE_SRC = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.##### ## #####.######',
  '     #.##### ## #####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.##### ## #####.#     ',
  '######.##### ## #####.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......  .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];

/* Elder Futhark runes. Each rune has a keyboard letter so codes can be typed. */
const RUNES = [
  { g: 'ᚠ', k: 'f', n: 'Fehu' },    { g: 'ᚢ', k: 'u', n: 'Uruz' },
  { g: 'ᚦ', k: 'q', n: 'Thurisaz' },{ g: 'ᚨ', k: 'a', n: 'Ansuz' },
  { g: 'ᚱ', k: 'r', n: 'Raido' },   { g: 'ᚲ', k: 'k', n: 'Kaunan' },
  { g: 'ᚷ', k: 'g', n: 'Gebo' },    { g: 'ᚹ', k: 'w', n: 'Wunjo' },
  { g: 'ᚺ', k: 'h', n: 'Hagalaz' }, { g: 'ᚾ', k: 'n', n: 'Nauthiz' },
  { g: 'ᛁ', k: 'i', n: 'Isa' },     { g: 'ᛃ', k: 'j', n: 'Jera' },
  { g: 'ᛇ', k: 'y', n: 'Eihwaz' },  { g: 'ᛈ', k: 'p', n: 'Perthro' },
  { g: 'ᛉ', k: 'z', n: 'Algiz' },   { g: 'ᛊ', k: 's', n: 'Sowilo' },
  { g: 'ᛏ', k: 't', n: 'Tiwaz' },    { g: 'ᛒ', k: 'b', n: 'Berkano' },
  { g: 'ᛖ', k: 'e', n: 'Ehwaz' },    { g: 'ᛗ', k: 'm', n: 'Mannaz' },
  { g: 'ᛚ', k: 'l', n: 'Laguz' },    { g: 'ᛜ', k: 'x', n: 'Ingwaz' },
  { g: 'ᛞ', k: 'd', n: 'Dagaz' },    { g: 'ᛟ', k: 'o', n: 'Othala' },
];
const CODE_LEN = 4;                       // 24^4 = 331,776 rooms
const ROOM_PREFIX = 'p2pacman-rune-';

const runeGlyphs  = code => code.map(i => RUNES[i].g).join('');
const runeLetters = code => code.map(i => RUNES[i].k).join('');
const randomCode  = () => Array.from({ length: CODE_LEN }, () => Math.floor(Math.random() * RUNES.length));
function lettersToCode(str) {
  if (typeof str !== 'string' || str.length !== CODE_LEN) return null;
  const out = [];
  for (const ch of str.toLowerCase()) {
    const i = RUNES.findIndex(r => r.k === ch);
    if (i < 0) return null;
    out.push(i);
  }
  return out;
}

/* ---- parse ---- */
const TILE = [];                          // 'W' wall, 'D' door, 'P' path, 'V' void
const PASS = new Uint8Array(COLS * ROWS); // 1 = a pac-man may stand here
const DOTS_INIT = new Uint8Array(COLS * ROWS); // 1 dot, 2 power pellet

(function parseMaze() {
  const raw = [];
  for (let r = 0; r < ROWS; r++) {
    if (MAZE_SRC[r].length !== COLS) throw new Error('maze row ' + r + ' has length ' + MAZE_SRC[r].length);
    raw.push([]);
    for (let c = 0; c < COLS; c++) {
      const ch = MAZE_SRC[r][c];
      raw[r].push(ch === '#' ? 'W' : ch === '-' ? 'D' : ch === ' ' ? 'S' : 'P');
      if (ch === '.') DOTS_INIT[r * COLS + c] = 1;
      if (ch === 'o') DOTS_INIT[r * COLS + c] = 2;
    }
  }
  // flood-fill from the pac-man start tile; unreachable spaces become void
  const seen = new Uint8Array(COLS * ROWS);
  const stack = [[13, 23]];
  while (stack.length) {
    const [c, r] = stack.pop();
    const i = r * COLS + c;
    if (seen[i] || raw[r][c] === 'W' || raw[r][c] === 'D') continue;
    seen[i] = 1;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      if (nr < 0 || nr >= ROWS) continue;
      stack.push([(c + dc + COLS) % COLS, nr]);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    TILE.push([]);
    for (let c = 0; c < COLS; c++) {
      let t = raw[r][c];
      if (t === 'S') t = seen[r * COLS + c] ? 'P' : 'V';
      TILE[r].push(t);
      PASS[r * COLS + c] = t === 'P' ? 1 : 0;
    }
  }
})();
