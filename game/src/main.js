// main.js — entry point: input, pointer lock, boot, staged states for
// screenshots (driven through the game's own code paths) and the test API.
// Staged states are deterministic: fixed seed, fixed placements, real
// systems (rounds, bots, grenades, HUD) doing the work.
import { S, TEAM_A, TEAM_B } from './store.js';
import { initGame, gameApi, input } from './game.js';
import { setBuyOpen, renderScoreboard, showBanner, showToast, addKillfeed,
  spawnDmgNum, renderRadio } from './hud.js';
import { audioInit } from './audio.js';
import { plantCharge } from './rounds.js';
import { SITES } from './map.js';
import { throwGrenade } from './grenades.js';

const params = new URLSearchParams(location.search);
S.stage = params.get('stage') || '';
const SEED = parseInt(params.get('seed') || '20261115', 10);

const api = gameApi();
let buyKeyLatch = false;

function requestLock() {
  const el = document.body;
  if (el.requestPointerLock) { try { el.requestPointerLock(); } catch (e) { /* staged/headless */ } }
}

function bindInput() {
  const keymap = {
    KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'jump', ShiftLeft: 'walk', ShiftRight: 'walk',
    ControlLeft: 'crouch', KeyE: 'use',
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); renderScoreboard(S, true); return; }
    const k = keymap[e.code];
    if (k) { input[k] = true; if (e.code === 'Space') e.preventDefault(); }
    if (e.code === 'KeyC' && !e.repeat) { S.player.crouch = !S.player.crouch; input.crouch = S.player.crouch; }
    if (e.code === 'ControlLeft') S.player.crouch = true;
    if (e.code === 'KeyR' && !e.repeat) {
      if (S.matchOver) api.restartMatch();
      else api.reloadPlayer();
    }
    if (e.code === 'KeyB' && !e.repeat) {
      if (S.phase === 'buy' || document.getElementById('buyMenu').style.display === 'flex') {
        const open = document.getElementById('buyMenu').style.display !== 'flex';
        setBuyOpen(open, S);
        if (open) document.exitPointerLock(); else requestLock();
      }
    }
    if (e.code === 'Digit1') api.switchWeapon(S.player.weapons.find((w) => w === 'nova' || w === 'zenith' || w === 'comet') || 'eclipse');
    if (e.code === 'Digit2') api.switchWeapon('eclipse');
    if (e.code === 'Digit3') api.switchWeapon('ridge');
    if (e.code === 'Digit4') api.selectNade('frag');
    if (e.code === 'Digit5') api.selectNade('flash');
    if (e.code === 'Digit6') api.selectNade('smoke');
    if (e.code === 'Digit7') api.selectNade('flare');
    if (e.code === 'KeyG' && !e.repeat) { api.selectNade('frag'); input.fire = true; input.fireEdge = true; setTimeout(() => { input.fire = false; }, 120); }
    if (e.code === 'KeyF' && !e.repeat) showToast('PLAN: ' + S.plan);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') { renderScoreboard(S, false); return; }
    const k = keymap[e.code];
    if (k) input[k] = false;
    if (e.code === 'ControlLeft') S.player.crouch = input.crouch;
  });
  window.addEventListener('blur', () => { for (const k of ['fwd', 'back', 'left', 'right', 'jump', 'fire', 'use']) input[k] = false; });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement) { input.lookDX += e.movementX; input.lookDY += e.movementY; }
  });
  document.addEventListener('pointerlockchange', () => { input.locked = !!document.pointerLockElement; });
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0) { input.fire = true; input.fireEdge = true; }
    if (e.button === 2) { input.aim = true; S.player.scoped = S.player.slot === 'zenith'; }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) { input.aim = false; S.player.scoped = false; }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.getElementById('startOv').addEventListener('click', () => {
    audioInit();
    document.getElementById('startOv').style.display = 'none';
    // The buy menu is open behind the overlay: leave the cursor free so the
    // player can click the crate; locking happens when the menu closes.
    if (document.getElementById('buyMenu').style.display !== 'flex') requestLock();
  });
  document.getElementById('buyMenu').addEventListener('click', (e) => {
    if (e.target.id === 'buyMenu') { setBuyOpen(false, S); requestLock(); }
  });
}

function giveLoadout(money) {
  const p = S.player;
  p.money = money;
  p.weapons = ['nova', 'eclipse', 'ridge'];
  p.mags = { nova: 24, eclipse: 12 }; p.reserves = { nova: 90, eclipse: 48 };
  p.slot = 'nova'; p.heldNade = false;
  p.nades = { frag: 1, flash: 1, smoke: 1, flare: 1 };
  api.rebuildViewmodel();
}

function placeBot(id, x, z, yaw, hp) {
  const b = S.bots.find((x) => x.id === id);
  if (!b) return null;
  b.x = x; b.z = z; b.yaw = yaw; b.hp = hp === undefined ? 100 : hp;
  b.alive = true; b.state = 'hold'; b.route = []; b.wp = 0;
  b.feetY = 0; b.target = -1; b.react = 2; b.blind = 0; b.channel = 0; b.channelKind = '';
  if (b.mesh) { b.mesh.visible = true; b.mesh.rotation.x = 0; }
  return b;
}

function restageCover() {
  // Re-places the whole cover tableau through the same placement code, so
  // a slow capture can reset the fight (which plays out for real) right
  // before the shot: the player and LYRA alive, the plant half-done.
  // Every bot but the planter carries a short SUNBURST-blind — the game's
  // own flash mechanic — so the tableau holds still for the capture while
  // the staged tracers carry the firefight.
  const p = S.player;
  p.x = 22; p.z = 0; p.y = 0; p.yaw = 2.83; p.pitch = -0.02; p.hp = 86; p.alive = true;
  p.channel = 0; p.channelKind = ''; p.blind = 0;
  S.time = 11.3; // searchlight shaft crossing the dish face
  placeBot(6, 21, -7, 2.9, 62);    // WREN holding the B lane angle, left
  placeBot(8, 29, -9, -2.4, 100);  // SORA near the dish hut, right
  placeBot(1, 27, -4, 2.6, 100);   // VEGA, your sniper, right shoulder
  placeBot(3, 31, -18, 0.4, 78);   // RIGEL lurking past the dish
  const lyra = placeBot(2, 24, -14, 0.6, 100);
  lyra.state = 'plant'; lyra.channel = 1.4; lyra.channelKind = 'plant';
  // park the rest of the field out of frame, holding; KITE and PELL are
  // down (the killfeed's story), so the alive pips agree with the feed
  const kite = placeBot(5, -6, -26, 3.1, 0);
  kite.alive = false; if (kite.mesh) kite.mesh.rotation.x = -Math.PI / 2 * 0.9;
  const pell = placeBot(7, 6, -26, 3.1, 0);
  pell.alive = false; if (pell.mesh) pell.mesh.rotation.x = -Math.PI / 2 * 0.9;
  placeBot(9, 0, -28, 3.1, 100);
  placeBot(4, -2, 24, 2.8, 100);
  for (const b of S.bots) if (b.id !== 2) b.blind = 3;
  S.charge.state = 'carried'; S.charge.carrier = 2;
  S.phase = 'live';
}

function coverFx() {
  // The cover frame's live fire, through the game's own tracer, particle,
  // killfeed and damage-number systems. Re-runnable so a slow capture can
  // refresh the frame right before the shot.
  const p = S.player;
  const eye = { x: p.x, y: 1.62, z: p.z };
  api.spawnTracer(eye.x + 0.3, eye.y - 0.1, eye.z - 0.5, 21, 1.4, -7, 0xffc46a);
  api.spawnTracer(21, 1.5, -7, eye.x + 1.5, 1.5, eye.z + 1, 0x9fd0ff);
  api.spawnTracer(29, 1.5, -9, 24, 1.2, -8, 0xffc46a);
  api.spawnParticles(21, 1.4, -7, 6, { r: 1, g: 0.77, b: 0.42 }, 2, 0.4);
  addKillfeed(S, 'YOU', 'KITE', 'NOVA-9', true);
  addKillfeed(S, 'VEGA', 'PELL', 'ZENITH DMR', false);
  const pt = api.project(21, 1.9, -7);
  if (pt) spawnDmgNum(pt.x, pt.y - 10, 'HEADSHOT 86', true);
}

function stageCover() {
  giveLoadout(3250);
  api.openLive();
  S.phaseT = 62; S.round = 5; S.scores[TEAM_A] = 3; S.scores[TEAM_B] = 2;
  S.time = 7.1; // searchlight crossing DISH B
  restageCover();
  coverFx();
  S.radio.push({ name: 'LYRA', role: 'SUPPORT', text: 'Planting the charge — cover me!', t: S.time });
  S.radio.push({ name: 'VEGA', role: 'SNIPER', text: 'Two on B. Entry, take the left angle.', t: S.time });
  S.radio.push({ name: 'RIGEL', role: 'LURKER', text: 'Dish hut clear. Rotating behind them.', t: S.time });
  renderRadio(S);
  document.getElementById('startOv').style.display = 'none';
  input.locked = true;
}

function stageBuy() {
  giveLoadout(5200);
  S.player.x = -2; S.player.z = 36; S.player.yaw = Math.PI; S.player.pitch = -0.04;
  S.round = 2; S.scores[TEAM_A] = 1; S.scores[TEAM_B] = 0;
  S.phaseT = 14;
  setBuyOpen(true, S);
  document.getElementById('startOv').style.display = 'none';
  input.locked = true;
}

function stageGrenade() {
  giveLoadout(2100);
  api.openLive();
  S.phaseT = 74; S.round = 3; S.scores[TEAM_A] = 1; S.scores[TEAM_B] = 1;
  S.time = 11.3;
  const p = S.player;
  p.x = 0; p.z = 14; p.y = 0; p.yaw = 3.14; p.pitch = -0.02; p.hp = 100;
  api.selectNade('smoke');
  placeBot(5, 2, -8, 0.1, 100);   // KITE holding beyond the veil
  placeBot(6, -3, -7, 0.2, 100);  // WREN on the far side of the lane
  placeBot(2, -3, 7, 3.0, 92);    // LYRA stacking up on the left
  // the rest of the field parks behind the player so no stray tag piles up
  placeBot(1, -2, 25, 3.1, 100);
  placeBot(3, 2, 25, 3.1, 100);
  placeBot(4, 0, 27, 3.1, 100);
  placeBot(7, 6, 26, 3.1, 100);
  placeBot(8, -6, 26, 3.1, 100);
  placeBot(9, 33, 18, 3.1, 100);
  for (const b of S.bots) b.blind = 3; // hold the tableau for the capture
  // smoke + flare through the real grenade code paths, with fuses long
  // enough to land up the lane before blooming / igniting; the flare
  // lands ON the raised deck so its flame clears the deck edge
  throwGrenade(S, 'smoke', 0, 1.6, 13, 0, 0.28, -1, p.team, 0);
  S.grenades[S.grenades.length - 1].fuse = 0.85;
  throwGrenade(S, 'flare', 1.5, 1.6, 12, 0.05, 0.25, -1, p.team, 0);
  S.grenades[S.grenades.length - 1].fuse = 0.6;
  api.switchWeapon('nova'); // rifle back in hand; smoke stays selected
  S.radio.push({ name: 'LYRA', role: 'SUPPORT', text: 'Smoke out — the lane is blind. Go, go!', t: S.time });
  S.radio.push({ name: 'KITE', role: 'ANCHOR', text: 'Holding B. I hear them in the smoke.', t: S.time });
  renderRadio(S);
  document.getElementById('startOv').style.display = 'none';
  input.locked = true;
}

function stageDefuse() {
  // Second half: APOGEE defends, the charge is armed at DISH B, and the
  // player is mid-defuse with the scoreboard open.
  S.round = 11; S.scores[TEAM_A] = 6; S.scores[TEAM_B] = 4;
  giveLoadout(1800);
  api.startRound();
  S.round = 11; S.scores[TEAM_A] = 6; S.scores[TEAM_B] = 4;
  api.openLive();
  plantCharge(S, SITES.B, 5, { onPlanted: () => {} });
  S.charge.explodeT = 12; S.phaseT = 12;
  const p = S.player;
  p.x = 24.2; p.z = -14.2; p.y = 0; p.yaw = -0.21; p.pitch = -0.1; p.hp = 41;
  p.channel = 1.2; p.channelKind = 'defuse'; p.kills = 1;
  input.use = true;
  placeBot(1, 20, -7, -0.5, 55);   // VEGA covering the defuse, left
  placeBot(3, 26, -9, -0.3, 100);  // RIGEL watching the lane, right
  placeBot(6, 18, 0, 3.0, 100);    // WREN pushing up the lane, distant
  S.bots.find((b) => b.id === 1).kills = 1;
  // the fallen: the planter beside the charge, his roamer in the lane —
  // the killfeed, the scoreboard and the pips all tell the same story
  const kite = placeBot(5, 26, -16, 0.5, 0);
  kite.alive = false; kite.deaths = 1;
  if (kite.mesh) { kite.mesh.rotation.x = -Math.PI / 2 * 0.9; kite.mesh.position.y = 0.25; }
  const pell = placeBot(7, 22, -11, -0.4, 0);
  pell.alive = false; pell.deaths = 1;
  if (pell.mesh) { pell.mesh.rotation.x = -Math.PI / 2 * 0.9; pell.mesh.position.y = 0.25; }
  for (const b of S.bots) if (b.alive) b.blind = 3; // hold the tableau
  addKillfeed(S, 'YOU', 'KITE', 'NOVA-9', false);
  addKillfeed(S, 'VEGA', 'PELL', 'ZENITH DMR', false);
  S.radio.push({ name: 'VEGA', role: 'SNIPER', text: 'Cover the defuse — they are coming back!', t: S.time });
  renderRadio(S);
  renderScoreboard(S, true);
  // the defuse ring drops below the scoreboard so both stay readable, and
  // the armed bar moves to the clear left column, off the banner
  document.getElementById('objBox').style.bottom = '36px';
  const pb = document.getElementById('plantedBar');
  pb.style.left = '14px'; pb.style.top = '400px'; pb.style.transform = 'none'; pb.style.width = '260px';
  showBanner('CHARGE ARMED', 'DEFUSE AT DISH B — HOLD THE SITE', true);
  document.getElementById('startOv').style.display = 'none';
  input.locked = true;
}

function applyStage() {
  if (S.stage === 'cover') stageCover();
  else if (S.stage === 'buy') stageBuy();
  else if (S.stage === 'grenade') stageGrenade();
  else if (S.stage === 'defuse') stageDefuse();
  else return;
  // staged states skip the start overlay; the sim still runs live
  document.getElementById('startOv').style.display = 'none';
}

function boot() {
  initGame(document.getElementById('app'));
  bindInput();
  if (S.stage) applyStage();
  window.__APERTURE__ = {
    S, input, api,
    look(dx, dy) { input.lookDX += dx; input.lookDY += dy; },
    setLook(yaw, pitch) { S.player.yaw = yaw; S.player.pitch = pitch; },
    key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })); },
    fire(down) { input.fire = down; if (down) input.fireEdge = true; },
    fx() { coverFx(); },
    restage() { restageCover(); coverFx(); },
    stage: S.stage,
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
