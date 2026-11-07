# P2P PAC-MAN — Rune Rooms

Two Pac-Men, one classic 28×31 maze, no ghosts. Grab a power pellet, turn the other Pac-Man blue, and chomp them. First to **3 catches** wins.

## Run
Open `index.html`, or `node serve.js` → http://localhost:5173. No build step.
Rooms need internet (PeerJS fetches from unpkg and uses its free broker only for the handshake; gameplay is WebRTC peer-to-peer).

## Rooms
- **Create room** → you get 4 Elder Futhark runes (24⁴ ≈ 331k rooms) plus an invite link `…/#brqx`.
- **Join room** → tap the runes on the keypad, or type their letters (shown under each rune).
- The host's browser runs the simulation and streams 30 Hz snapshots; the guest sends direction inputs. Keep the host tab visible.
- **Practice vs Bot** works offline.

## Rules
- Arrows / WASD (swipe or D-pad on touch), `M` mutes.
- Power pellet = 9 s hunter mode (+10% speed). Pellets regrow after ~11 s.
- A scared Pac-Man can steal another pellet to flip the hunt; both powered = you slip through each other.
- After a catch the victim respawns at their corner with 1.6 s of protection; the hunter's power ends.

## Files
`js/maze.js` map + rune codes · `js/sim.js` rules + bot · `js/render.js` canvas · `js/audio.js` synth · `js/main.js` UI + PeerJS
