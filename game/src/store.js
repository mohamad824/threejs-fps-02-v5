// store.js — the one state store. Every system reads and writes this single
// object; nothing else keeps game state. Fixed-step sim in game.js advances it.
export const TEAM_A = 'APOGEE';
export const TEAM_B = 'PERIGEE';
export const WIN_SCORE = 7;
export const ROUND_TIME = 100;
export const BUY_TIME = 20;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
export const BOMB_TIME = 35;

// Deterministic seeded RNG (mulberry32) so staged states and replays agree.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ROLES = ['ENTRY', 'SNIPER', 'SUPPORT', 'LURKER', 'FLEX'];
export const PLANS = [
  'SPLIT B — YOU: ENTRY',
  'RUSH A — YOU: ENTRY',
  'MID CONTROL — YOU: ENTRY',
  'FAKE A, HIT B — YOU: ENTRY',
  'SLOW B — YOU: ENTRY',
];

export function makeBot(id, name, role, team) {
  return {
    id, name, role, team,
    x: 0, y: 0, z: 0, yaw: 0, hp: 100, armour: 50, alive: true,
    weapon: 'nova', mag: 30, reserve: 90, reloading: 0,
    state: 'route', wp: 0, route: [], holdX: 0, holdZ: 0, holdYaw: 0,
    react: 0, target: -1, burst: 0, burstGap: 0, strafe: 0, strafeT: 0,
    blind: 0, lastX: 0, lastZ: 0, hasLast: false, investigate: 0,
    channel: 0, channelKind: '', kills: 0, deaths: 0, money: 800,
    mesh: null, headMesh: null, bodyMesh: null, speedMul: 1,
    hearX: 0, hearZ: 0, hearT: 0, seedOff: id * 0.37,
  };
}

export function freshState(seed) {
  const rng = makeRng(seed);
  const bots = [
    makeBot(1, 'VEGA', 'SNIPER', TEAM_A),
    makeBot(2, 'LYRA', 'SUPPORT', TEAM_A),
    makeBot(3, 'RIGEL', 'LURKER', TEAM_A),
    makeBot(4, 'ALTAIR', 'FLEX', TEAM_A),
    makeBot(5, 'KITE', 'ANCHOR', TEAM_B),
    makeBot(6, 'WREN', 'ANCHOR', TEAM_B),
    makeBot(7, 'PELL', 'ROAMER', TEAM_B),
    makeBot(8, 'SORA', 'SNIPER', TEAM_B),
    makeBot(9, 'NIX', 'LURKER', TEAM_B),
  ];
  return {
    seed, rng, time: 0, tick: 0,
    phase: 'buy', phaseT: BUY_TIME, round: 1,
    scores: { APOGEE: 0, PERIGEE: 0 },
    lossStreak: { APOGEE: 0, PERIGEE: 0 },
    playerTeam: TEAM_A, plan: PLANS[0], planIdx: 0,
    matchOver: false, matchWinner: '',
    player: {
      x: 0, y: 1.7, z: 34, vx: 0, vz: 0, yaw: Math.PI, pitch: 0,
      hp: 100, armour: 50, alive: true, money: 800,
      weapons: ['eclipse', 'ridge'], slot: 'eclipse',
      mags: { eclipse: 12 }, reserves: { eclipse: 48 },
      nades: { frag: 1, flash: 1, smoke: 1, flare: 0 },
      nadeSel: 'frag', crouch: false, onGround: true, vy: 0,
      recoil: 0, recoilX: 0, bloom: 0, reloading: 0, reloadTotal: 0,
      fireCd: 0, meleeCd: 0, blind: 0, carrying: false,
      channel: 0, channelKind: '', kills: 0, deaths: 0,
      scoped: false, noise: 0, lastDmgT: 0, spawnProt: 0, hasKit: false,
    },
    bots,
    charge: { state: 'carried', carrier: 2, x: 0, z: 0, site: '', plantT: 0, explodeT: 0, planter: -1 },
    grenades: [], smokes: [], flares: [], noises: [],
    tracers: [], particles: [], dmgNums: [],
    feed: [], radio: [],
    stats: { shots: 0, hits: 0, headshots: 0 },
    events: [], // one-frame event flags consumed by HUD/audio
    stage: '', started: false, paused: false,
  };
}

// Single store instance. game.js owns the loop; systems import S.
export const S = freshState(20261115);

export function resetForRound(s) {
  s.phaseT = s.phase === 'buy' ? BUY_TIME : ROUND_TIME;
  s.charge = { state: 'carried', carrier: 2, x: 0, z: 0, site: '', plantT: 0, explodeT: 0, planter: -1 };
  s.grenades.length = 0; s.smokes.length = 0; s.flares.length = 0;
  s.noises.length = 0; s.events.length = 0;
}

export function teamOf(s, isPlayer) { return isPlayer ? s.playerTeam : null; }
export function attackers(s) { return s.round <= 6 ? TEAM_A : TEAM_B; }
export function defenders(s) { return s.round <= 6 ? TEAM_B : TEAM_A; }
export function playerAttacks(s) { return s.playerTeam === attackers(s); }
export function aliveCount(s, team) {
  let n = 0;
  if (s.playerTeam === team && s.player.alive) n++;
  for (const b of s.bots) if (b.team === team && b.alive) n++;
  return n;
}
export function carrierBot(s) {
  for (const b of s.bots) if (b.id === s.charge.carrier) return b;
  return null;
}
